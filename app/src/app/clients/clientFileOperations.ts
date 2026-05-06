import { HttpError } from 'wasp/server';
import { randomBytes } from 'crypto';
import * as XLSX from 'xlsx';
import sharp from 'sharp';
import { putObject, removeObject, getPresignedUrl, getObjectBuffer } from '../../server/storage';

const IMAGE_JPEG_QUALITY = 82;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

async function ensureClientOwned(clientId: string, companyId: string, entities: any) {
  const client = await entities.Client.findUnique({ where: { id: clientId } });
  if (!client || client.companyId !== companyId) throw new HttpError(404);
  return client;
}

function uid(): string {
  return randomBytes(12).toString('hex');
}

const IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
]);

function clientFileKey(companyId: string, clientId: string, filename: string): string {
  return `companies/${companyId}/clients/${clientId}/files/${filename}`;
}

async function addUrls(files: any[]): Promise<any[]> {
  return Promise.all(
    files.map(async (f) => {
      if (f.isFolder || !f.key) return { ...f, url: null };
      const url = await getPresignedUrl(f.key).catch(() => null);
      return { ...f, url };
    }),
  );
}

async function collectDescendantIds(ids: string[], entities: any): Promise<string[]> {
  const all = new Set<string>(ids);
  async function recurse(parentIds: string[]) {
    if (!parentIds.length) return;
    const children = await entities.ClientFile.findMany({
      where: { parentId: { in: parentIds } },
      select: { id: true },
    });
    const childIds = children.map((c: any) => c.id);
    childIds.forEach((id: string) => all.add(id));
    await recurse(childIds);
  }
  await recurse(ids);
  return Array.from(all);
}

// ─── Editor content helpers ───────────────────────────────────────────────────

type EditorContent =
  | { type: 'text'; content: string }
  | { type: 'docx'; base64: string }
  | { type: 'spreadsheet'; workbook: any; sheets: { name: string; data: any[][] }[] };

function sheetjsStyleToCSS(s: any): string {
  const parts: string[] = [];
  if (s.font) {
    if (s.font.bold) parts.push('font-weight:bold');
    if (s.font.italic) parts.push('font-style:italic');
    if (s.font.underline) parts.push('text-decoration:underline');
    if (s.font.sz) parts.push(`font-size:${s.font.sz}pt`);
    if (s.font.color?.rgb) parts.push(`color:#${s.font.color.rgb.slice(-6)}`);
    if (s.font.name) parts.push(`font-family:${s.font.name}`);
  }
  if (s.fill) {
    const pat = s.fill.patternType;
    const bg = s.fill.bgColor?.rgb ?? s.fill.fgColor?.rgb;
    if (pat && pat !== 'none' && bg) parts.push(`background-color:#${bg.slice(-6)}`);
  }
  if (s.alignment) {
    if (s.alignment.horizontal) parts.push(`text-align:${s.alignment.horizontal}`);
    if (s.alignment.vertical) {
      const vm: Record<string, string> = { top: 'top', center: 'middle', bottom: 'bottom' };
      if (vm[s.alignment.vertical]) parts.push(`vertical-align:${vm[s.alignment.vertical]}`);
    }
    if (s.alignment.wrapText) parts.push('white-space:pre-wrap');
  }
  if (s.border) {
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      const b = (s.border as any)[side];
      if (b?.style && b.style !== 'none') {
        const styleMap: Record<string, string> = { thin: '1px solid', medium: '2px solid', thick: '3px solid', dashed: '1px dashed', dotted: '1px dotted', double: '3px double' };
        const color = b.color?.rgb ? `#${b.color.rgb.slice(-6)}` : '#000';
        const css = styleMap[b.style] ? `${styleMap[b.style]} ${color}` : `1px solid ${color}`;
        parts.push(`border-${side}:${css}`);
      }
    }
  }
  return parts.join(';');
}

function xlsxToSyncfusionWorkbook(xlsxWb: XLSX.WorkBook): any {
  const sfSheets = xlsxWb.SheetNames.map((name) => {
    const sheet = xlsxWb.Sheets[name];
    if (!sheet['!ref']) return { name, rows: [] };
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const merges: XLSX.Range[] = (sheet['!merges'] as any) ?? [];
    const rows: any[] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells: any[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        const merge = merges.find((m) => m.s.r === r && m.s.c === c);
        const cellObj: any = {
          value: cell ? String(cell.v ?? '') : '',
          index: c,
          style: cell?.s ? sheetjsStyleToCSS(cell.s) : undefined,
        };
        if (merge) {
          cellObj.rowspan = merge.e.r - merge.s.r + 1;
          cellObj.colspan = merge.e.c - merge.s.c + 1;
        }
        cells.push(cellObj);
      }
      rows.push({ index: r, cells });
    }
    const columns = ((sheet['!cols'] as any[]) ?? [])
      .map((col: any, i: number) => ({ index: i, width: col?.wch ? Math.round(col.wch * 7) : undefined }))
      .filter((c: any) => c.width != null);
    const sfSheet: any = { name, rows };
    if (columns.length) sfSheet.columns = columns;
    return sfSheet;
  });
  return { sheets: sfSheets };
}

async function buildEditorContent(file: any): Promise<EditorContent> {
  if (!file.key) throw new HttpError(400, "Ce fichier n'a pas de contenu");
  const keyExt = file.key.split('.').pop()?.toLowerCase() ?? '';
  const nameExt = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() ?? '' : '';
  const ext = keyExt || nameExt;
  const buffer = await getObjectBuffer(file.key);
  if (['txt', 'md', 'json', 'csv'].includes(ext)) {
    return { type: 'text', content: buffer.toString('utf-8') };
  }
  if (['docx', 'doc'].includes(ext)) {
    return { type: 'docx', base64: buffer.toString('base64') };
  }
  if (['xlsx', 'xls', 'xlsm', 'xlsb'].includes(ext)) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellStyles: true });
    const workbook = xlsxToSyncfusionWorkbook(wb);
    const sheets = wb.SheetNames.map((name) => ({
      name,
      data: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) as any[][],
    }));
    return { type: 'spreadsheet', workbook, sheets };
  }
  throw new HttpError(400, 'Type de fichier non supporté pour l\'édition');
}

async function applyEditorContent(
  file: any,
  content: string,
  contentType: 'text' | 'spreadsheet',
): Promise<{ buffer: Buffer; mimeType: string }> {
  const keyExt = file.key?.split('.').pop()?.toLowerCase() ?? '';
  const nameExt = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() ?? '' : '';
  const ext = keyExt || nameExt;
  if (contentType === 'text') {
    const mimeType =
      ext === 'json' ? 'application/json' :
      ext === 'md' ? 'text/markdown' :
      ext === 'csv' ? 'text/csv' :
      'text/plain';
    return { buffer: Buffer.from(content, 'utf-8'), mimeType };
  }
  throw new HttpError(400, 'Contenu invalide pour ce type de fichier');
}

// ─── getClientFiles ───────────────────────────────────────────────────────────

export const getClientFiles = async (
  { clientId }: { clientId: string },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureClientOwned(clientId, companyId, context.entities);
  const files = await context.entities.ClientFile.findMany({
    where: { clientId },
    orderBy: [{ isFolder: 'desc' }, { name: 'asc' }],
  });
  return addUrls(files);
};

// ─── createClientFolder ──────────────────────────────────────────────────────

export const createClientFolder = async (
  { clientId, name, parentId }: { clientId: string; name: string; parentId?: string | null },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureClientOwned(clientId, companyId, context.entities);
  if (!name?.trim()) throw new HttpError(400, 'Nom requis');
  if (parentId) {
    const parent = await context.entities.ClientFile.findUnique({ where: { id: parentId } });
    if (!parent || parent.clientId !== clientId || !parent.isFolder) {
      throw new HttpError(400, 'Dossier parent invalide');
    }
  }
  return context.entities.ClientFile.create({
    data: { clientId, name: name.trim(), isFolder: true, parentId: parentId ?? null, size: 0 },
  });
};

// ─── uploadClientFile ─────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const uploadClientFile = async (
  { clientId, dataUrl, name, originalName, parentId }: {
    clientId: string;
    dataUrl: string;
    name: string;
    originalName: string;
    parentId?: string | null;
  },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureClientOwned(clientId, companyId, context.entities);

  const m = /^data:([a-zA-Z0-9.+/\-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'Format invalide');
  let mimeType = m[1];
  let buffer: Buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > MAX_FILE_BYTES) throw new HttpError(400, 'Fichier trop volumineux (max 20 Mo)');

  const isRasterImage = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff'].includes(mimeType);
  let ext: string;
  if (isRasterImage) {
    buffer = Buffer.from(await sharp(buffer).rotate().jpeg({ quality: IMAGE_JPEG_QUALITY, mozjpeg: true }).toBuffer());
    mimeType = 'image/jpeg';
    ext = 'jpg';
  } else {
    ext = originalName.includes('.') ? originalName.split('.').pop()!.toLowerCase() : 'bin';
  }

  if (parentId) {
    const parent = await context.entities.ClientFile.findUnique({ where: { id: parentId } });
    if (!parent || parent.clientId !== clientId || !parent.isFolder) {
      throw new HttpError(400, 'Dossier parent invalide');
    }
  }

  const key = clientFileKey(companyId, clientId, `${uid()}.${ext}`);
  await putObject(key, buffer, mimeType);

  return context.entities.ClientFile.create({
    data: {
      clientId,
      name: name.trim() || originalName,
      isFolder: false,
      parentId: parentId ?? null,
      key,
      mimeType,
      size: buffer.length,
    },
  });
};

// ─── deleteClientFiles ────────────────────────────────────────────────────────

export const deleteClientFiles = async (
  { clientId, ids }: { clientId: string; ids: string[] },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureClientOwned(clientId, companyId, context.entities);

  const allIds = await collectDescendantIds(ids, context.entities);

  const files = await context.entities.ClientFile.findMany({
    where: { id: { in: allIds }, isFolder: false, key: { not: null } },
    select: { key: true },
  });

  await context.entities.ClientFile.deleteMany({ where: { id: { in: ids } } });
  await Promise.all(files.map((f: any) => removeObject(f.key)));

  return { deleted: allIds.length };
};

// ─── renameClientFile ─────────────────────────────────────────────────────────

export const renameClientFile = async (
  { id, name }: { id: string; name: string },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const file = await context.entities.ClientFile.findUnique({ where: { id } });
  if (!file) throw new HttpError(404);
  await ensureClientOwned(file.clientId, companyId, context.entities);
  if (!name?.trim()) throw new HttpError(400, 'Nom requis');
  return context.entities.ClientFile.update({ where: { id }, data: { name: name.trim() } });
};

// ─── moveClientFiles ──────────────────────────────────────────────────────────

export const moveClientFiles = async (
  { clientId, ids, targetParentId }: {
    clientId: string;
    ids: string[];
    targetParentId: string | null;
  },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureClientOwned(clientId, companyId, context.entities);

  if (targetParentId) {
    const target = await context.entities.ClientFile.findUnique({ where: { id: targetParentId } });
    if (!target || target.clientId !== clientId || !target.isFolder) {
      throw new HttpError(400, 'Dossier cible invalide');
    }
  }

  await context.entities.ClientFile.updateMany({
    where: { id: { in: ids }, clientId },
    data: { parentId: targetParentId },
  });

  return { moved: ids.length };
};

// ─── createNewClientFile ──────────────────────────────────────────────────────

export const createNewClientFile = async (
  { clientId, name, parentId }: {
    clientId: string;
    name: string;
    type?: string;
    parentId?: string | null;
  },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureClientOwned(clientId, companyId, context.entities);
  if (!name?.trim()) throw new HttpError(400, 'Nom requis');

  if (parentId) {
    const parent = await context.entities.ClientFile.findUnique({ where: { id: parentId } });
    if (!parent || parent.clientId !== clientId || !parent.isFolder) {
      throw new HttpError(400, 'Dossier parent invalide');
    }
  }

  const buffer = Buffer.from('# Nouveau document\n\n');
  const mimeType = 'text/markdown';
  const filename = `${name.trim()}.md`;
  const key = clientFileKey(companyId, clientId, `${uid()}.md`);
  await putObject(key, buffer, mimeType);

  return context.entities.ClientFile.create({
    data: {
      clientId,
      name: filename,
      isFolder: false,
      parentId: parentId ?? null,
      key,
      mimeType,
      size: buffer.length,
    },
  });
};

// ─── getClientFileEditorContent ───────────────────────────────────────────────

export const getClientFileEditorContent = async (
  { id }: { id: string },
  context: any,
): Promise<EditorContent> => {
  const companyId = ensureCompany(context.user);
  const file = await context.entities.ClientFile.findUnique({ where: { id } });
  if (!file || file.isFolder) throw new HttpError(404);
  await ensureClientOwned(file.clientId, companyId, context.entities);
  return buildEditorContent(file);
};

// ─── createClientFileFromTemplate ────────────────────────────────────────────

export const createClientFileFromTemplate = async (
  { clientId, templateId, name, parentId, extraVars }: {
    clientId: string;
    templateId: string;
    name: string;
    parentId?: string | null;
    extraVars?: { date_expiry?: string; payment_link?: string };
  },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureClientOwned(clientId, companyId, context.entities);

  const template = await context.entities.DocumentTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.companyId !== companyId) throw new HttpError(404, 'Modèle introuvable');

  const client = await context.entities.Client.findUnique({ where: { id: clientId } });
  if (!client) throw new HttpError(404);

  const company = await context.entities.Company.findUnique({ where: { id: companyId } });
  if (!company) throw new HttpError(404);

  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });
  const clientAddress = [client.address, client.city, client.province, client.postalCode]
    .filter(Boolean).join(', ');
  const companyAddress = [company.address, company.city, company.province, company.postalCode]
    .filter(Boolean).join(', ');

  const vars: Record<string, string> = {
    '{{date}}':            dateStr,
    '{{date_expiry}}':     extraVars?.date_expiry ?? '',
    '{{client.name}}':    client.contactName ?? client.name,
    '{{client.company}}': client.name,
    '{{client.email}}':   client.email ?? '',
    '{{client.phone}}':   client.phone ?? '',
    '{{client.address}}': clientAddress,
    '{{company.name}}':    company.name,
    '{{company.email}}':   company.email ?? '',
    '{{company.phone}}':   company.phone ?? '',
    '{{company.address}}': companyAddress,
    '{{company.neq}}':     company.neq ?? '',
    '{{company.tps}}':     company.taxNumberGst ?? '',
    '{{company.tvq}}':     company.taxNumberQst ?? '',
    '{{payment.link}}':    extraVars?.payment_link ?? '',
  };

  let content = template.content;
  for (const [key, value] of Object.entries(vars)) {
    content = content.split(key).join(value);
  }

  if (parentId) {
    const parent = await context.entities.ClientFile.findUnique({ where: { id: parentId } });
    if (!parent || parent.clientId !== clientId || !parent.isFolder) {
      throw new HttpError(400, 'Dossier parent invalide');
    }
  }

  const safeName = (name.trim() || template.name).replace(/[/\\?%*:|"<>]/g, '-');
  const filename = safeName.endsWith('.md') ? safeName : `${safeName}.md`;
  const buffer = Buffer.from(content, 'utf-8');
  const key = clientFileKey(companyId, clientId, `${uid()}.md`);
  await putObject(key, buffer, 'text/markdown');

  return context.entities.ClientFile.create({
    data: {
      clientId,
      name: filename,
      isFolder: false,
      parentId: parentId ?? null,
      key,
      mimeType: 'text/markdown',
      size: buffer.length,
      sourceTemplateId: template.id,
      sourceTemplateType: template.type,
    },
  });
};

// ─── updateClientFileContent ──────────────────────────────────────────────────

export const updateClientFileContent = async (
  { id, content, contentType }: {
    id: string;
    content: string;
    contentType: 'text' | 'spreadsheet';
  },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const file = await context.entities.ClientFile.findUnique({ where: { id } });
  if (!file || file.isFolder || !file.key) throw new HttpError(404);
  await ensureClientOwned(file.clientId, companyId, context.entities);
  const { buffer, mimeType } = await applyEditorContent(file, content, contentType);
  await putObject(file.key, buffer, mimeType);
  return context.entities.ClientFile.update({
    where: { id },
    data: { size: buffer.length },
  });
};

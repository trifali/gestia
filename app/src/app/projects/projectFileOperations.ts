import { HttpError } from 'wasp/server';
import { randomBytes } from 'crypto';
import * as XLSX from 'xlsx';
import sharp from 'sharp';
import { putObject, removeObject, getPresignedUrl, getObjectBuffer } from '../../server/storage';

// JPEG quality for compressed image uploads
const IMAGE_JPEG_QUALITY = 82;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

async function ensureProjectOwned(projectId: string, companyId: string, entities: any) {
  const project = await entities.Project.findUnique({ where: { id: projectId } });
  if (!project || project.companyId !== companyId) throw new HttpError(404);
  return project;
}

function uid(): string {
  return randomBytes(12).toString('hex');
}

const IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
]);

function minioKey(companyId: string, projectId: string, filename: string): string {
  return `companies/${companyId}/projects/${projectId}/files/${filename}`;
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

// ─── getProjectFiles ─────────────────────────────────────────────────────────

export const getProjectFiles = async (
  { projectId }: { projectId: string },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureProjectOwned(projectId, companyId, context.entities);

  const files = await context.entities.ProjectFile.findMany({
    where: { projectId },
    orderBy: [{ isFolder: 'desc' }, { name: 'asc' }],
  });

  return addUrls(files);
};

// ─── createProjectFolder ─────────────────────────────────────────────────────

export const createProjectFolder = async (
  { projectId, name, parentId }: { projectId: string; name: string; parentId?: string | null },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureProjectOwned(projectId, companyId, context.entities);

  if (!name?.trim()) throw new HttpError(400, 'Nom requis');

  // Validate parentId belongs to the same project
  if (parentId) {
    const parent = await context.entities.ProjectFile.findUnique({ where: { id: parentId } });
    if (!parent || parent.projectId !== projectId || !parent.isFolder) {
      throw new HttpError(400, 'Dossier parent invalide');
    }
  }

  return context.entities.ProjectFile.create({
    data: {
      projectId,
      name: name.trim(),
      isFolder: true,
      parentId: parentId ?? null,
      size: 0,
    },
  });
};

// ─── uploadProjectFile ────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export const uploadProjectFile = async (
  { projectId, dataUrl, name, originalName, parentId }: {
    projectId: string;
    dataUrl: string;
    name: string;
    originalName: string;
    parentId?: string | null;
  },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureProjectOwned(projectId, companyId, context.entities);

  const m = /^data:([a-zA-Z0-9.+/\-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'Format invalide');
  let mimeType = m[1];
  let buffer: Buffer<ArrayBufferLike> = Buffer.from(m[2], 'base64');
  if (buffer.length > MAX_FILE_BYTES) throw new HttpError(400, 'Fichier trop volumineux (max 20 Mo)');

  // Convert raster images (except GIF/SVG) to JPEG and compress
  const isRasterImage = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff']
    .includes(mimeType);
  let ext: string;
  if (isRasterImage) {
    buffer = Buffer.from(await sharp(buffer)
      .rotate() // auto-orient via EXIF
      .jpeg({ quality: IMAGE_JPEG_QUALITY, mozjpeg: true })
      .toBuffer());
    mimeType = 'image/jpeg';
    ext = 'jpg';
  } else {
    ext = originalName.includes('.') ? originalName.split('.').pop()!.toLowerCase() : 'bin';
  }

  const key = minioKey(companyId, projectId, `${uid()}.${ext}`);
  await putObject(key, buffer, mimeType);

  // Validate parentId
  if (parentId) {
    const parent = await context.entities.ProjectFile.findUnique({ where: { id: parentId } });
    if (!parent || parent.projectId !== projectId || !parent.isFolder) {
      throw new HttpError(400, 'Dossier parent invalide');
    }
  }

  return context.entities.ProjectFile.create({
    data: {
      projectId,
      name: name.trim() || originalName,
      isFolder: false,
      parentId: parentId ?? null,
      key,
      mimeType,
      size: buffer.length,
    },
  });
};

// ─── deleteProjectFiles ───────────────────────────────────────────────────────

async function collectDescendantIds(ids: string[], entities: any): Promise<string[]> {
  const all = new Set<string>(ids);
  async function recurse(parentIds: string[]) {
    if (parentIds.length === 0) return;
    const children = await entities.ProjectFile.findMany({
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

export const deleteProjectFiles = async (
  { projectId, ids }: { projectId: string; ids: string[] },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureProjectOwned(projectId, companyId, context.entities);

  const allIds = await collectDescendantIds(ids, context.entities);

  // Collect MinIO keys to delete
  const files = await context.entities.ProjectFile.findMany({
    where: { id: { in: allIds }, isFolder: false, key: { not: null } },
    select: { key: true },
  });

  // Delete from DB (cascade handles children)
  await context.entities.ProjectFile.deleteMany({
    where: { id: { in: ids } }, // cascade handles subtree
  });

  // Remove from MinIO
  await Promise.all(files.map((f: any) => removeObject(f.key)));

  return { deleted: allIds.length };
};

// ─── renameProjectFile ────────────────────────────────────────────────────────

export const renameProjectFile = async (
  { id, name }: { id: string; name: string },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const file = await context.entities.ProjectFile.findUnique({ where: { id } });
  if (!file) throw new HttpError(404);

  const project = await context.entities.Project.findUnique({ where: { id: file.projectId } });
  if (!project || project.companyId !== companyId) throw new HttpError(403);

  if (!name?.trim()) throw new HttpError(400, 'Nom requis');

  return context.entities.ProjectFile.update({
    where: { id },
    data: { name: name.trim() },
  });
};

// ─── moveProjectFiles ─────────────────────────────────────────────────────────

export const moveProjectFiles = async (
  { projectId, ids, targetParentId }: {
    projectId: string;
    ids: string[];
    targetParentId: string | null;
  },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureProjectOwned(projectId, companyId, context.entities);

  // Validate target
  if (targetParentId) {
    const target = await context.entities.ProjectFile.findUnique({ where: { id: targetParentId } });
    if (!target || target.projectId !== projectId || !target.isFolder) {
      throw new HttpError(400, 'Dossier cible invalide');
    }
  }

  await context.entities.ProjectFile.updateMany({
    where: { id: { in: ids }, projectId },
    data: { parentId: targetParentId },
  });

  return { moved: ids.length };
};

// ─── createNewProjectFile ─────────────────────────────────────────────────────

type NewFileType = 'md';

function buildNewFileBuffer(): { buffer: Buffer; mimeType: string } {
  return { buffer: Buffer.from('# Nouveau document\n\n'), mimeType: 'text/markdown' };
}

export const createNewProjectFile = async (
  { projectId, name, parentId }: {
    projectId: string;
    name: string;
    type?: string; // kept for API compat, only 'md' is supported
    parentId?: string | null;
  },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureProjectOwned(projectId, companyId, context.entities);

  if (!name?.trim()) throw new HttpError(400, 'Nom requis');

  // Validate parentId
  if (parentId) {
    const parent = await context.entities.ProjectFile.findUnique({ where: { id: parentId } });
    if (!parent || parent.projectId !== projectId || !parent.isFolder) {
      throw new HttpError(400, 'Dossier parent invalide');
    }
  }

  const { buffer, mimeType } = buildNewFileBuffer();
  const filename = `${name.trim()}.md`;
  const key = minioKey(companyId, projectId, `${uid()}.md`);
  await putObject(key, buffer, mimeType);

  return context.entities.ProjectFile.create({
    data: {
      projectId,
      name: filename,
      isFolder: false,
      parentId: parentId ?? null,
      key,
      mimeType,
      size: buffer.length,
    },
  });
};

// ─── createNewPortalFile ──────────────────────────────────────────────────────

export const createNewPortalFile = async (
  { token, name, parentId }: {
    token: string;
    name: string;
    parentId?: string | null;
  },
  context: any,
) => {
  const { projectId, companyId } = await resolvePortalProject(token, context.entities);

  if (!name?.trim()) throw new HttpError(400, 'Nom requis');

  if (parentId) {
    const parent = await context.entities.ProjectFile.findUnique({ where: { id: parentId } });
    if (!parent || parent.projectId !== projectId || !parent.isFolder) {
      throw new HttpError(400, 'Dossier parent invalide');
    }
  }

  const { buffer, mimeType } = buildNewFileBuffer();
  const filename = `${name.trim()}.md`;
  const key = minioKey(companyId, projectId, `${uid()}.md`);
  await putObject(key, buffer, mimeType);

  return context.entities.ProjectFile.create({
    data: {
      projectId,
      name: filename,
      isFolder: false,
      parentId: parentId ?? null,
      key,
      mimeType,
      size: buffer.length,
    },
  });
};

// ─── submitPortalFile (public – token auth) ───────────────────────────────────

export const submitPortalFile = async (
  { token, dataUrl, name, originalName }: {
    token: string;
    dataUrl: string;
    name: string;
    originalName: string;
  },
  context: any,
) => {
  const access = await context.entities.ProjectClientAccess.findUnique({ where: { token } });
  if (!access || access.isRevoked) throw new HttpError(403, 'Lien invalide ou révoqué');
  if (access.expiresAt && access.expiresAt < new Date()) throw new HttpError(403, 'Ce lien a expiré');

  const projectId = access.projectId;
  const project = await context.entities.Project.findUnique({ where: { id: projectId } });
  if (!project) throw new HttpError(404);
  const companyId = project.companyId;

  const m = /^data:([a-zA-Z0-9.+/\-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'Format invalide');
  let mimeType = m[1];
  let buffer: Buffer<ArrayBufferLike> = Buffer.from(m[2], 'base64');
  if (buffer.length > MAX_FILE_BYTES) throw new HttpError(400, 'Fichier trop volumineux (max 20 Mo)');

  const isRasterImage = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff']
    .includes(mimeType);
  let ext: string;
  if (isRasterImage) {
    buffer = Buffer.from(await sharp(buffer)
      .rotate()
      .jpeg({ quality: IMAGE_JPEG_QUALITY, mozjpeg: true })
      .toBuffer());
    mimeType = 'image/jpeg';
    ext = 'jpg';
  } else {
    ext = originalName.includes('.') ? originalName.split('.').pop()!.toLowerCase() : 'bin';
  }

  const key = minioKey(companyId, projectId, `${uid()}.${ext}`);
  await putObject(key, buffer, mimeType);

  return context.entities.ProjectFile.create({
    data: {
      projectId,
      name: name.trim() || originalName,
      isFolder: false,
      parentId: null,
      key,
      mimeType,
      size: buffer.length,
    },
  });
};

// ─── Portal token auth helper ─────────────────────────────────────────────────

async function resolvePortalProject(token: string, entities: any): Promise<{ projectId: string; companyId: string }> {
  const access = await entities.ProjectClientAccess.findUnique({ where: { token } });
  if (!access || access.isRevoked) throw new HttpError(403, 'Lien invalide ou révoqué');
  if (access.expiresAt && access.expiresAt < new Date()) throw new HttpError(403, 'Ce lien a expiré');
  const project = await entities.Project.findUnique({ where: { id: access.projectId } });
  if (!project) throw new HttpError(404);
  return { projectId: access.projectId, companyId: project.companyId };
}

// ─── getProjectFilesByToken ───────────────────────────────────────────────────

export const getProjectFilesByToken = async (
  { token }: { token: string },
  context: any,
) => {
  const { projectId } = await resolvePortalProject(token, context.entities);
  const files = await context.entities.ProjectFile.findMany({ where: { projectId } });
  return addUrls(files);
};

// ─── uploadPortalFile ─────────────────────────────────────────────────────────

export const uploadPortalFile = async (
  { token, dataUrl, name, originalName, parentId }: {
    token: string;
    dataUrl: string;
    name: string;
    originalName: string;
    parentId?: string | null;
  },
  context: any,
) => {
  const { projectId, companyId } = await resolvePortalProject(token, context.entities);

  const m = /^data:([a-zA-Z0-9.+/\-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'Format invalide');
  let mimeType = m[1];
  let buffer: Buffer<ArrayBufferLike> = Buffer.from(m[2], 'base64');
  if (buffer.length > MAX_FILE_BYTES) throw new HttpError(400, 'Fichier trop volumineux (max 20 Mo)');

  const isRasterImage = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff']
    .includes(mimeType);
  let ext: string;
  if (isRasterImage) {
    buffer = Buffer.from(await sharp(buffer)
      .rotate()
      .jpeg({ quality: IMAGE_JPEG_QUALITY, mozjpeg: true })
      .toBuffer());
    mimeType = 'image/jpeg';
    ext = 'jpg';
  } else {
    ext = originalName.includes('.') ? originalName.split('.').pop()!.toLowerCase() : 'bin';
  }

  const key = minioKey(companyId, projectId, `${uid()}.${ext}`);
  await putObject(key, buffer, mimeType);

  return context.entities.ProjectFile.create({
    data: {
      projectId,
      name: name.trim() || originalName,
      isFolder: false,
      parentId: parentId ?? null,
      key,
      mimeType,
      size: buffer.length,
    },
  });
};

// ─── createPortalFolder ───────────────────────────────────────────────────────

export const createPortalFolder = async (
  { token, name, parentId }: { token: string; name: string; parentId?: string | null },
  context: any,
) => {
  const { projectId } = await resolvePortalProject(token, context.entities);
  return context.entities.ProjectFile.create({
    data: { projectId, name: name.trim(), isFolder: true, parentId: parentId ?? null, key: null, mimeType: null, size: 0 },
  });
};

// ─── deletePortalFiles ────────────────────────────────────────────────────────

export const deletePortalFiles = async (
  { token, ids }: { token: string; ids: string[] },
  context: any,
) => {
  const { projectId } = await resolvePortalProject(token, context.entities);
  // Verify files belong to this project before deleting
  const files = await context.entities.ProjectFile.findMany({
    where: { id: { in: ids }, projectId },
  });
  const keys = files.map((f: any) => f.key).filter(Boolean);
  await context.entities.ProjectFile.deleteMany({ where: { id: { in: files.map((f: any) => f.id) } } });
  await Promise.allSettled(keys.map((key: string) => removeObject(key)));
};

// ─── renamePortalFile ─────────────────────────────────────────────────────────

export const renamePortalFile = async (
  { token, id, name }: { token: string; id: string; name: string },
  context: any,
) => {
  const { projectId } = await resolvePortalProject(token, context.entities);
  const file = await context.entities.ProjectFile.findUnique({ where: { id } });
  if (!file || file.projectId !== projectId) throw new HttpError(404);
  return context.entities.ProjectFile.update({ where: { id }, data: { name: name.trim() } });
};

// ─── movePortalFiles ──────────────────────────────────────────────────────────

export const movePortalFiles = async (
  { token, ids, targetParentId }: { token: string; ids: string[]; targetParentId?: string | null },
  context: any,
) => {
  const { projectId } = await resolvePortalProject(token, context.entities);
  const files = await context.entities.ProjectFile.findMany({ where: { id: { in: ids }, projectId } });
  const validIds = files.map((f: any) => f.id);
  if (!validIds.length) return;
  await context.entities.ProjectFile.updateMany({
    where: { id: { in: validIds } },
    data: { parentId: targetParentId ?? null },
  });
};

// ─── Editor content helpers ───────────────────────────────────────────────────

type EditorContent =
  | { type: 'text'; content: string }
  | { type: 'docx'; base64: string }
  | { type: 'spreadsheet'; workbook: any; sheets: { name: string; data: any[][] }[] };

// ─── SheetJS → Syncfusion workbook JSON converter ────────────────────────────

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
    if (pat && pat !== 'none') {
      const raw = s.fill.fgColor?.rgb ?? s.fill.bgColor?.rgb;
      if (raw) {
        const hex = raw.length === 8 ? raw.slice(2) : raw;
        if (!/^FF?FF?FF$/i.test(hex)) parts.push(`background-color:#${hex}`);
      }
    }
  }
  if (s.alignment) {
    const hMap: Record<string, string> = { left: 'left', center: 'center', right: 'right', justify: 'justify' };
    const h = hMap[s.alignment.horizontal ?? ''];
    if (h) parts.push(`text-align:${h}`);
    const vMap: Record<string, string> = { top: 'top', middle: 'middle', bottom: 'bottom', center: 'middle' };
    const v = vMap[s.alignment.vertical ?? ''];
    if (v) parts.push(`vertical-align:${v}`);
    if (s.alignment.wrapText) parts.push('white-space:pre-wrap');
  }
  return parts.join(';');
}

function xlsxToSyncfusionWorkbook(xlsxWb: XLSX.WorkBook): any {
  const sfSheets = xlsxWb.SheetNames.map((name) => {
    const sheet = xlsxWb.Sheets[name];
    if (!sheet['!ref']) return { name, rows: [] };

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const merges: XLSX.Range[] = (sheet['!merges'] as any) ?? [];

    const mergeInfo = new Map<string, { rowSpan: number; colSpan: number }>();
    const covered = new Set<string>();
    for (const m of merges) {
      mergeInfo.set(`${m.s.r},${m.s.c}`, { rowSpan: m.e.r - m.s.r + 1, colSpan: m.e.c - m.s.c + 1 });
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          if (r === m.s.r && c === m.s.c) continue;
          covered.add(`${r},${c}`);
        }
      }
    }

    const rowMap = new Map<number, any>();
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellKey = `${r},${c}`;
        if (covered.has(cellKey)) continue;
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (!cell && !mergeInfo.has(cellKey)) continue;

        if (!rowMap.has(r)) rowMap.set(r, { index: r, cells: [] });
        const cellObj: any = { index: c };
        if (cell) {
          if (cell.t === 'n' || cell.t === 'b') cellObj.value = cell.v;
          else if (cell.t === 'd') cellObj.value = cell.w ?? String(cell.v);
          else cellObj.value = cell.v !== undefined ? String(cell.v) : '';
          if (cell.f) cellObj.formula = cell.f;
          if (cell.z && cell.z !== 'General') cellObj.format = cell.z;
          if (cell.s) {
            const style = sheetjsStyleToCSS(cell.s);
            if (style) cellObj.style = style;
          }
        }
        const merge = mergeInfo.get(cellKey);
        if (merge) {
          if (merge.rowSpan > 1) cellObj.rowSpan = merge.rowSpan;
          if (merge.colSpan > 1) cellObj.colSpan = merge.colSpan;
        }
        rowMap.get(r)!.cells.push(cellObj);
      }
    }

    const rowHeights: any[] = (sheet['!rows'] as any) ?? [];
    const rows = Array.from(rowMap.values()).map((row) => {
      const h = rowHeights[row.index];
      if (h?.hpt) row.height = Math.round(h.hpt * 1.333);
      return row;
    });

    const colWidths: any[] = (sheet['!cols'] as any) ?? [];
    const columns = colWidths
      .map((col: any, i: number) => ({ index: i, width: col?.wch ? Math.round(col.wch * 7) : undefined }))
      .filter((c: any) => c.width != null);

    const sfSheet: any = { name, rows };
    if (columns.length) sfSheet.columns = columns;
    return sfSheet;
  });

  return { sheets: sfSheets };
}

async function buildEditorContent(file: any): Promise<EditorContent> {
  if (!file.key) throw new HttpError(400, 'Ce fichier n\'a pas de contenu');

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

// ─── getFileEditorContent ─────────────────────────────────────────────────────

export const getFileEditorContent = async (
  { id }: { id: string },
  context: any,
): Promise<EditorContent> => {
  const companyId = ensureCompany(context.user);
  const file = await context.entities.ProjectFile.findUnique({ where: { id } });
  if (!file || file.isFolder) throw new HttpError(404);
  await ensureProjectOwned(file.projectId, companyId, context.entities);
  return buildEditorContent(file);
};

// ─── updateProjectFileContent ─────────────────────────────────────────────────

export const updateProjectFileContent = async (
  { id, content, contentType }: {
    id: string;
    content: string;
    contentType: 'text' | 'spreadsheet';
  },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const file = await context.entities.ProjectFile.findUnique({ where: { id } });
  if (!file || file.isFolder || !file.key) throw new HttpError(404);
  await ensureProjectOwned(file.projectId, companyId, context.entities);
  const { buffer, mimeType } = await applyEditorContent(file, content, contentType);
  await putObject(file.key, buffer, mimeType);
  return context.entities.ProjectFile.update({
    where: { id },
    data: { size: buffer.length },
  });
};

// ─── getPortalFileEditorContent ───────────────────────────────────────────────

export const getPortalFileEditorContent = async (
  { token, id }: { token: string; id: string },
  context: any,
): Promise<EditorContent> => {
  const { projectId } = await resolvePortalProject(token, context.entities);
  const file = await context.entities.ProjectFile.findUnique({ where: { id } });
  if (!file || file.isFolder || file.projectId !== projectId) throw new HttpError(404);
  return buildEditorContent(file);
};

// ─── updatePortalFileContent ──────────────────────────────────────────────────

export const updatePortalFileContent = async (
  { token, id, content, contentType }: {
    token: string;
    id: string;
    content: string;
    contentType: 'text' | 'spreadsheet';
  },
  context: any,
) => {
  const { projectId } = await resolvePortalProject(token, context.entities);
  const file = await context.entities.ProjectFile.findUnique({ where: { id } });
  if (!file || file.isFolder || !file.key || file.projectId !== projectId) throw new HttpError(404);
  const { buffer, mimeType } = await applyEditorContent(file, content, contentType);
  await putObject(file.key, buffer, mimeType);
  return context.entities.ProjectFile.update({
    where: { id },
    data: { size: buffer.length },
  });
};

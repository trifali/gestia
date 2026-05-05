import { HttpError } from 'wasp/server';
import { randomBytes } from 'crypto';
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, TextRun } from 'docx';
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

type NewFileType = 'txt' | 'md' | 'json' | 'xlsx' | 'docx';

async function buildNewFileBuffer(type: NewFileType): Promise<{ buffer: Buffer; mimeType: string }> {
  switch (type) {
    case 'txt':
      return { buffer: Buffer.from(''), mimeType: 'text/plain' };
    case 'md':
      return { buffer: Buffer.from('# Nouveau document\n\n'), mimeType: 'text/markdown' };
    case 'json':
      return { buffer: Buffer.from('{}'), mimeType: 'application/json' };
    case 'xlsx': {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([['']]);
      XLSX.utils.book_append_sheet(wb, ws, 'Feuille1');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      return { buffer: Buffer.from(buf), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }
    case 'docx': {
      const doc = new Document({
        sections: [{ children: [new Paragraph('')] }],
      });
      const buf = await Packer.toBuffer(doc);
      return { buffer: buf, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    }
  }
}

export const createNewProjectFile = async (
  { projectId, name, type, parentId }: {
    projectId: string;
    name: string;
    type: NewFileType;
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

  const { buffer, mimeType } = await buildNewFileBuffer(type);
  const filename = `${name.trim()}.${type}`;
  const key = minioKey(companyId, projectId, `${uid()}.${type}`);
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

import mammoth from 'mammoth';

type EditorContent =
  | { type: 'text'; content: string }
  | { type: 'html'; content: string }
  | {
      type: 'spreadsheet';
      /** Full Syncfusion workbook JSON when sidecar exists (preserves styles, dimensions, formulas, merges). */
      workbook?: any;
      /** Plain 2D cell values (always populated as a fallback). */
      sheets: { name: string; data: any[][] }[];
    };

/** Sidecar key for the lossless Syncfusion workbook JSON. */
function sfjsonKey(key: string): string {
  return `${key}.sfjson`;
}

async function buildEditorContent(file: any): Promise<EditorContent> {
  if (!file.key) throw new HttpError(400, 'Ce fichier n\'a pas de contenu');

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  // Read directly from MinIO (no presigned URL / HTTP caching layer)
  const buffer = await getObjectBuffer(file.key);

  if (['txt', 'md', 'json', 'csv'].includes(ext)) {
    return { type: 'text', content: buffer.toString('utf-8') };
  }

  if (ext === 'docx') {
    const result = await mammoth.convertToHtml({ buffer });
    return { type: 'html', content: result.value || '' };
  }

  if (ext === 'xlsx') {
    // Try to load the lossless Syncfusion sidecar first
    let workbookJson: any | undefined;
    try {
      const sidecarBuf = await getObjectBuffer(sfjsonKey(file.key));
      workbookJson = JSON.parse(sidecarBuf.toString('utf-8'));
    } catch {
      // No sidecar — file uploaded externally or saved before sidecar support
    }
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheets = wb.SheetNames.map((name) => ({
      name,
      data: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) as any[][],
    }));
    return { type: 'spreadsheet', workbook: workbookJson, sheets };
  }

  throw new HttpError(400, 'Type de fichier non supporté pour l\'édition');
}

async function applyEditorContent(
  file: any,
  content: string,
  contentType: 'text' | 'html' | 'spreadsheet',
): Promise<{ buffer: Buffer; mimeType: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (contentType === 'text') {
    const mimeType =
      ext === 'json' ? 'application/json' :
      ext === 'md' ? 'text/markdown' :
      ext === 'csv' ? 'text/csv' :
      'text/plain';
    return { buffer: Buffer.from(content, 'utf-8'), mimeType };
  }

  if (contentType === 'html' && ext === 'docx') {
    // Strip HTML tags → plain paragraphs in a new DOCX
    const rawText = content
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#039;/g, "'")
      .trim();
    const paragraphs = rawText
      .split('\n')
      .map((line) => new Paragraph({ children: [new TextRun(line)] }));
    const doc = new Document({
      sections: [{ children: paragraphs.length ? paragraphs : [new Paragraph('')] }],
    });
    const buf = await Packer.toBuffer(doc);
    return {
      buffer: Buffer.from(buf),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }

  if (contentType === 'spreadsheet' && ext === 'xlsx') {
    // Client sends the full Syncfusion workbook JSON (lossless).
    // We do TWO things:
    //  1. Persist that JSON as a sidecar (`<key>.sfjson`) for lossless reload.
    //  2. Generate a real .xlsx from the cell values for Excel/download compatibility.
    const workbook: any = JSON.parse(content);

    // ── Build .xlsx from cell values (Syncfusion stores rows/cells sparsely with `index` props) ──
    const xlsxWb = XLSX.utils.book_new();
    const sheets: any[] = workbook?.sheets ?? [];
    if (!sheets.length) {
      const ws = XLSX.utils.aoa_to_sheet([['']]);
      XLSX.utils.book_append_sheet(xlsxWb, ws, 'Sheet1');
    } else {
      for (const s of sheets) {
        const data: any[][] = [];
        for (const rowObj of (s.rows ?? [])) {
          if (rowObj == null) continue;
          const ri: number = rowObj.index ?? data.length;
          while (data.length <= ri) data.push([]);
          const row = data[ri];
          for (const cellObj of (rowObj.cells ?? [])) {
            if (cellObj == null) continue;
            const ci: number = cellObj.index ?? row.length;
            while (row.length <= ci) row.push('');
            const v = cellObj.value;
            row[ci] = v === null || v === undefined ? '' : v;
          }
        }
        const ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(xlsxWb, ws, s.name || 'Sheet');
      }
    }
    const xlsxBuf = XLSX.write(xlsxWb, { type: 'buffer', bookType: 'xlsx' });

    // ── Persist the lossless sidecar (best-effort — don't fail the save if it errors) ──
    try {
      await putObject(sfjsonKey(file.key), Buffer.from(content, 'utf-8'), 'application/json');
    } catch (err) {
      console.warn('[updateFileContent] failed to write sfjson sidecar:', err);
    }

    return {
      buffer: Buffer.from(xlsxBuf),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
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
    contentType: 'text' | 'html' | 'spreadsheet';
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
    contentType: 'text' | 'html' | 'spreadsheet';
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

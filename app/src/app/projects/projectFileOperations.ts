import { HttpError } from 'wasp/server';
import { randomBytes } from 'crypto';
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph } from 'docx';
import sharp from 'sharp';
import { putObject, removeObject, getPresignedUrl } from '../../server/storage';

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

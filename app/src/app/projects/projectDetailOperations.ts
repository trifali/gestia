import { HttpError } from 'wasp/server';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import { putObject, removeObject, getPresignedUrl } from '../../server/storage';

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

function generateToken(): string {
  return randomBytes(24).toString('hex');
}

const MAX_MEDIA_BYTES = 20 * 1024 * 1024; // 20 MB
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'image/bmp', 'image/avif']);

async function processAndStoreMedia(
  dataUrl: string,
  projectId: string,
  originalName: string,
): Promise<{ key: string; mimeType: string; size: number }> {
  const m = /^data:([a-zA-Z0-9.+/\-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'Format de fichier invalide');
  const inputMime = m[1];
  const raw = Buffer.from(m[2], 'base64');
  if (raw.length > MAX_MEDIA_BYTES) throw new HttpError(400, 'Fichier trop volumineux (max 20 Mo)');

  const uid = randomBytes(12).toString('hex');

  if (IMAGE_TYPES.has(inputMime)) {
    // Compress and convert to JPEG
    const optimized = await sharp(raw, { failOn: 'none' })
      .rotate()
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer();
    const key = `projects/${projectId}/media/${uid}.jpg`;
    await putObject(key, optimized, 'image/jpeg');
    return { key, mimeType: 'image/jpeg', size: optimized.length };
  } else {
    // Store other file types as-is (PDF, etc.)
    const ext = originalName.includes('.') ? originalName.split('.').pop()!.toLowerCase() : 'bin';
    const key = `projects/${projectId}/media/${uid}.${ext}`;
    await putObject(key, raw, inputMime);
    return { key, mimeType: inputMime, size: raw.length };
  }
}

async function withPresignedUrls(mediaList: any[]): Promise<any[]> {
  return Promise.all(
    mediaList.map(async (m) => ({
      ...m,
      url: await getPresignedUrl(m.key).catch(() => null),
      tags: JSON.parse(m.tags || '[]'),
    })),
  );
}

// ─── getProjectDetail ─────────────────────────────────────────────────────────

type ProjectDetailResult = {
  project: any;
  tasks: any[];
  notes: any[];
  privateNotes: any[];
  media: any[];
  clientAccess: any[];
  links: any[];
};

export const getProjectDetail = async (
  { projectId }: { projectId: string },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const project = await context.entities.Project.findUnique({
    where: { id: projectId },
    include: { client: true },
  });
  if (!project || project.companyId !== companyId) throw new HttpError(404);

  const [tasks, allNotes, rawMedia, clientAccess, links] = await Promise.all([
    context.entities.ProjectTask.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    context.entities.ProjectNote.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { fullName: true, email: true } } },
    }),
    context.entities.ProjectMedia.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    }),
    context.entities.ProjectClientAccess.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    }),
    context.entities.ProjectLink.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);

  const notes = allNotes.filter((n: any) => !n.isPrivate);
  const privateNotes = allNotes.filter((n: any) => n.isPrivate);
  const media = await withPresignedUrls(rawMedia);

  return { project, tasks, notes, privateNotes, media, clientAccess, links };
};

// ─── getProjectByToken (public – no auth) ─────────────────────────────────────

type PublicProjectResult = {
  project: { id: string; name: string; description: string | null; status: string };
  tasks: any[];
  notes: any[];
  media: any[];
};

export const getProjectByToken = async (
  { token }: { token: string },
  context: any,
) => {
  const access = await context.entities.ProjectClientAccess.findUnique({ where: { token } });
  if (!access || access.isRevoked) throw new HttpError(403, 'Lien invalide ou révoqué');
  if (access.expiresAt && access.expiresAt < new Date()) throw new HttpError(403, 'Ce lien a expiré');

  // Update lastUsedAt
  await context.entities.ProjectClientAccess.update({
    where: { id: access.id },
    data: { lastUsedAt: new Date() },
  });

  const project = await context.entities.Project.findUnique({ where: { id: access.projectId } });
  if (!project) throw new HttpError(404);

  const [tasks, notes, rawMedia] = await Promise.all([
    context.entities.ProjectTask.findMany({
      where: { projectId: access.projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    context.entities.ProjectNote.findMany({
      where: { projectId: access.projectId, isPrivate: false },
      orderBy: { createdAt: 'desc' },
    }),
    context.entities.ProjectMedia.findMany({
      where: { projectId: access.projectId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const media = await withPresignedUrls(rawMedia);

  return {
    project: { id: project.id, name: project.name, description: project.description, status: project.status },
    tasks,
    notes,
    media,
  };
};

// ─── updateProjectDetail ──────────────────────────────────────────────────────

type UpdateProjectDetailArgs = {
  id: string;
  name?: string;
  description?: string;
  clientId?: string | null;
  status?: string;
};

export const updateProjectDetail = async (
  { id, ...rest }: UpdateProjectDetailArgs,
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureProjectOwned(id, companyId, context.entities);
  return context.entities.Project.update({
    where: { id },
    data: rest,
    include: { client: true },
  });
};

// ─── ProjectTask operations ───────────────────────────────────────────────────

type CreateTaskArgs = { projectId: string; title: string; description?: string; priority?: string };
export const createProjectTask = async (args: CreateTaskArgs, context: any) => {
  const companyId = ensureCompany(context.user);
  await ensureProjectOwned(args.projectId, companyId, context.entities);
  if (!args.title?.trim()) throw new HttpError(400, 'Le titre est requis');
  const count = await context.entities.ProjectTask.count({ where: { projectId: args.projectId } });
  return context.entities.ProjectTask.create({
    data: {
      projectId: args.projectId,
      title: args.title.trim(),
      description: args.description || null,
      priority: args.priority || 'medium',
      sortOrder: count,
    },
  });
};

type UpdateTaskArgs = { id: string; title?: string; description?: string; status?: string; priority?: string; sortOrder?: number };
export const updateProjectTask = async (
  { id, ...rest }: UpdateTaskArgs,
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const task = await context.entities.ProjectTask.findUnique({ where: { id } });
  if (!task) throw new HttpError(404);
  await ensureProjectOwned(task.projectId, companyId, context.entities);
  return context.entities.ProjectTask.update({
    where: { id },
    data: rest,
  });
};

export const deleteProjectTask = async ({ id }: { id: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  const task = await context.entities.ProjectTask.findUnique({ where: { id } });
  if (!task) throw new HttpError(404);
  await ensureProjectOwned(task.projectId, companyId, context.entities);
  await context.entities.ProjectTask.delete({ where: { id } });
  return { id };
};

// ─── ProjectNote operations ───────────────────────────────────────────────────

type CreateNoteArgs = { projectId: string; content: string; isPrivate?: boolean };
export const createProjectNote = async (args: CreateNoteArgs, context: any) => {
  const companyId = ensureCompany(context.user);
  await ensureProjectOwned(args.projectId, companyId, context.entities);
  if (!args.content?.trim()) throw new HttpError(400, 'Le contenu est requis');
  return context.entities.ProjectNote.create({
    data: {
      projectId: args.projectId,
      content: args.content.trim(),
      isPrivate: args.isPrivate ?? false,
      userId: context.user!.id,
    },
    include: { user: { select: { fullName: true, email: true } } },
  });
};

type UpdateNoteArgs = { id: string; content?: string; isPrivate?: boolean };
export const updateProjectNote = async ({ id, ...rest }: UpdateNoteArgs, context: any) => {
  const companyId = ensureCompany(context.user);
  const note = await context.entities.ProjectNote.findUnique({ where: { id } });
  if (!note) throw new HttpError(404);
  await ensureProjectOwned(note.projectId, companyId, context.entities);
  return context.entities.ProjectNote.update({
    where: { id },
    data: rest,
    include: { user: { select: { fullName: true, email: true } } },
  });
};

export const deleteProjectNote = async ({ id }: { id: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  const note = await context.entities.ProjectNote.findUnique({ where: { id } });
  if (!note) throw new HttpError(404);
  await ensureProjectOwned(note.projectId, companyId, context.entities);
  await context.entities.ProjectNote.delete({ where: { id } });
  return { id };
};

// ─── ProjectMedia operations ──────────────────────────────────────────────────

type UploadMediaArgs = { projectId: string; dataUrl: string; name: string; originalName: string };
export const uploadProjectMedia = async (args: UploadMediaArgs, context: any) => {
  const companyId = ensureCompany(context.user);
  await ensureProjectOwned(args.projectId, companyId, context.entities);
  const { key, mimeType, size } = await processAndStoreMedia(args.dataUrl, args.projectId, args.originalName);
  const record = await context.entities.ProjectMedia.create({
    data: {
      projectId: args.projectId,
      key,
      name: args.name || args.originalName,
      originalName: args.originalName,
      mimeType,
      size,
    },
  });
  return { ...record, url: await getPresignedUrl(key).catch(() => null), tags: [] };
};

type UpdateMediaArgs = { id: string; name?: string; tags?: string[] };
export const updateProjectMedia = async ({ id, name, tags }: UpdateMediaArgs, context: any) => {
  const companyId = ensureCompany(context.user);
  const media = await context.entities.ProjectMedia.findUnique({ where: { id } });
  if (!media) throw new HttpError(404);
  await ensureProjectOwned(media.projectId, companyId, context.entities);
  const updated = await context.entities.ProjectMedia.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(tags !== undefined ? { tags: JSON.stringify(tags) } : {}),
    },
  });
  return { ...updated, url: await getPresignedUrl(updated.key).catch(() => null), tags: JSON.parse(updated.tags || '[]') };
};

export const deleteProjectMedia = async ({ id }: { id: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  const media = await context.entities.ProjectMedia.findUnique({ where: { id } });
  if (!media) throw new HttpError(404);
  await ensureProjectOwned(media.projectId, companyId, context.entities);
  await removeObject(media.key);
  await context.entities.ProjectMedia.delete({ where: { id } });
  return { id };
};

// ─── ProjectClientAccess operations ───────────────────────────────────────────

type CreateAccessArgs = { projectId: string; label?: string; expiresAt?: string | null };
export const createProjectClientAccess = async (args: CreateAccessArgs, context: any) => {
  const companyId = ensureCompany(context.user);
  await ensureProjectOwned(args.projectId, companyId, context.entities);
  return context.entities.ProjectClientAccess.create({
    data: {
      projectId: args.projectId,
      token: generateToken(),
      label: args.label || null,
      expiresAt: args.expiresAt ? new Date(args.expiresAt) : null,
    },
  });
};

export const revokeProjectClientAccess = async ({ id }: { id: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  const access = await context.entities.ProjectClientAccess.findUnique({ where: { id } });
  if (!access) throw new HttpError(404);
  await ensureProjectOwned(access.projectId, companyId, context.entities);
  return context.entities.ProjectClientAccess.update({ where: { id }, data: { isRevoked: true } });
};

// ─── ProjectLink operations ───────────────────────────────────────────────────

type CreateLinkArgs = { projectId: string; title: string; url: string; description?: string; category?: string };
export const createProjectLink = async (args: CreateLinkArgs, context: any) => {
  const companyId = ensureCompany(context.user);
  await ensureProjectOwned(args.projectId, companyId, context.entities);
  if (!args.title?.trim() || !args.url?.trim()) throw new HttpError(400, 'Titre et URL sont requis');
  const count = await context.entities.ProjectLink.count({ where: { projectId: args.projectId } });
  return context.entities.ProjectLink.create({
    data: {
      projectId: args.projectId,
      title: args.title.trim(),
      url: args.url.trim(),
      description: args.description || null,
      category: args.category || 'autre',
      sortOrder: count,
    },
  });
};

type UpdateLinkArgs = { id: string; title?: string; url?: string; description?: string; category?: string };
export const updateProjectLink = async ({ id, ...rest }: UpdateLinkArgs, context: any) => {
  const companyId = ensureCompany(context.user);
  const link = await context.entities.ProjectLink.findUnique({ where: { id } });
  if (!link) throw new HttpError(404);
  await ensureProjectOwned(link.projectId, companyId, context.entities);
  return context.entities.ProjectLink.update({ where: { id }, data: rest });
};

export const deleteProjectLink = async ({ id }: { id: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  const link = await context.entities.ProjectLink.findUnique({ where: { id } });
  if (!link) throw new HttpError(404);
  await ensureProjectOwned(link.projectId, companyId, context.entities);
  await context.entities.ProjectLink.delete({ where: { id } });
  return { id };
};

// ─── Public portal actions (no auth) ─────────────────────────────────────────

async function validateToken(token: string, entities: any) {
  const access = await entities.ProjectClientAccess.findUnique({ where: { token } });
  if (!access || access.isRevoked) throw new HttpError(403, 'Lien invalide ou révoqué');
  if (access.expiresAt && access.expiresAt < new Date()) throw new HttpError(403, 'Ce lien a expiré');
  return access;
}

type SubmitClientMediaArgs = { token: string; dataUrl: string; name: string; originalName: string };
export const submitClientMedia = async (args: SubmitClientMediaArgs, context: any) => {
  const access = await validateToken(args.token, context.entities);
  const { key, mimeType, size } = await processAndStoreMedia(args.dataUrl, access.projectId, args.originalName);
  const record = await context.entities.ProjectMedia.create({
    data: {
      projectId: access.projectId,
      key,
      name: args.name || args.originalName,
      originalName: args.originalName,
      mimeType,
      size,
      isFromClient: true,
    },
  });
  return { ...record, url: await getPresignedUrl(key).catch(() => null), tags: [] };
};

type SubmitClientNoteArgs = { token: string; content: string; authorName?: string };
export const submitClientNote = async (args: SubmitClientNoteArgs, context: any) => {
  const access = await validateToken(args.token, context.entities);
  if (!args.content?.trim()) throw new HttpError(400, 'Le contenu est requis');
  return context.entities.ProjectNote.create({
    data: {
      projectId: access.projectId,
      content: args.content.trim(),
      isPrivate: false,
      isFromClient: true,
      authorName: args.authorName || 'Client',
    },
  });
};

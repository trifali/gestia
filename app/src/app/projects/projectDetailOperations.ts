import { HttpError } from 'wasp/server';
import { randomBytes } from 'crypto';
import { getPresignedUrl } from '../../server/storage';
import { logActivity } from '../activity/operations';

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

// ─── getProjectDetail ─────────────────────────────────────────────────────────

type ProjectDetailResult = {
  project: any;
  tasks: any[];
  notes: any[];
  privateNotes: any[];
  clientAccess: any[];
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

  const [tasks, allNotes, clientAccess] = await Promise.all([
    context.entities.ProjectTask.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    context.entities.ProjectNote.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { fullName: true, email: true } } },
    }),
    context.entities.ProjectClientAccess.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const notes = allNotes.filter((n: any) => !n.isPrivate);
  const privateNotes = allNotes.filter((n: any) => n.isPrivate);

  return { project, tasks, notes, privateNotes, clientAccess };
};

// ─── getProjectByToken (public – no auth) ─────────────────────────────────────

type PublicProjectResult = {
  project: { id: string; name: string; description: string | null; status: string };
  tasks: any[];
  notes: any[];
  files: any[];
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

  const [tasks, notes, rawFiles] = await Promise.all([
    context.entities.ProjectTask.findMany({
      where: { projectId: access.projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    context.entities.ProjectNote.findMany({
      where: { projectId: access.projectId, isPrivate: false },
      orderBy: { createdAt: 'desc' },
    }),
    context.entities.ProjectFile.findMany({
      where: { projectId: access.projectId, isFolder: false },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const files = await Promise.all(
    rawFiles.map(async (f: any) => ({
      ...f,
      url: f.key ? await getPresignedUrl(f.key).catch(() => null) : null,
    })),
  );

  return {
    project: { id: project.id, name: project.name, description: project.description, status: project.status },
    tasks,
    notes,
    files,
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
  const existing = await ensureProjectOwned(id, companyId, context.entities);
  const updated = await context.entities.Project.update({
    where: { id },
    data: rest,
    include: { client: true },
  });
  if (rest.status && rest.status !== existing.status) {
    await logActivity(context.entities, {
      companyId,
      userId: context.user?.id ?? null,
      clientId: existing.clientId,
      projectId: id,
      type: 'project.status_changed',
      message: `Statut du projet « ${existing.name} » : ${existing.status} → ${rest.status}`,
      metadata: { from: existing.status, to: rest.status },
    });
  }
  return updated;
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

// ─── Public portal actions (no auth) ─────────────────────────────────────────

async function validateToken(token: string, entities: any) {
  const access = await entities.ProjectClientAccess.findUnique({ where: { token } });
  if (!access || access.isRevoked) throw new HttpError(403, 'Lien invalide ou révoqué');
  if (access.expiresAt && access.expiresAt < new Date()) throw new HttpError(403, 'Ce lien a expiré');
  return access;
}

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

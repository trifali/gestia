import { HttpError } from 'wasp/server';
import type { GetProjects, CreateProject, UpdateProject, DeleteProject } from 'wasp/server/operations';
import type { Project, Client } from 'wasp/entities';
import { logActivity } from '../activity/operations';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

export type ProjectWithClient = Project & { client: Client | null };

export const getProjects: GetProjects<void, ProjectWithClient[]> = async (_args, context) => {
  const companyId = ensureCompany(context.user);
  return context.entities.Project.findMany({
    where: { companyId },
    include: { client: true },
    orderBy: { createdAt: 'desc' },
  });
};

type CreateProjectArgs = {
  name: string;
  description?: string;
  clientId?: string | null;
  status?: string;
};
export const createProject: CreateProject<CreateProjectArgs, Project> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  if (!args.name?.trim()) throw new HttpError(400, 'Le nom du projet est requis.');
  const project = await context.entities.Project.create({
    data: {
      companyId,
      name: args.name,
      description: args.description,
      clientId: args.clientId || null,
      status: args.status || 'en_cours',
    } as any,
  });
  await logActivity(context.entities, {
    companyId,
    userId: context.user?.id ?? null,
    clientId: args.clientId || null,
    projectId: project.id,
    type: 'project.created',
    message: `Projet créé : ${project.name}`,
    metadata: { status: project.status },
  });
  return project;
};

type UpdateProjectArgs = { id: string } & Partial<CreateProjectArgs>;
export const updateProject: UpdateProject<UpdateProjectArgs, Project> = async ({ id, ...rest }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Project.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  const updated = await context.entities.Project.update({
    where: { id },
    data: rest,
  });
  // Log status changes
  if (rest.status && rest.status !== existing.status) {
    await logActivity(context.entities, {
      companyId,
      userId: context.user?.id ?? null,
      clientId: (updated as any).clientId ?? existing.clientId,
      projectId: id,
      type: 'project.status_changed',
      message: `Statut du projet « ${existing.name} » : ${existing.status} → ${rest.status}`,
      metadata: { from: existing.status, to: rest.status },
    });
  } else if (rest.name || rest.description !== undefined) {
    await logActivity(context.entities, {
      companyId,
      userId: context.user?.id ?? null,
      clientId: (updated as any).clientId ?? existing.clientId,
      projectId: id,
      type: 'project.updated',
      message: `Projet modifié : ${rest.name ?? existing.name}`,
    });
  }
  return updated;
};

export const deleteProject: DeleteProject<{ id: string }, { id: string }> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Project.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  await logActivity(context.entities, {
    companyId,
    userId: context.user?.id ?? null,
    clientId: existing.clientId,
    projectId: id,
    type: 'project.deleted',
    message: `Projet supprimé : ${existing.name}`,
  });
  await context.entities.Project.delete({ where: { id } });
  return { id };
};

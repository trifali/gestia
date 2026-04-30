import { HttpError } from 'wasp/server';
import type { GetProjects, CreateProject, UpdateProject, DeleteProject } from 'wasp/server/operations';
import type { Project, Client } from 'wasp/entities';

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
  startDate?: string | null;
  dueDate?: string | null;
  budget?: number | null;
};
export const createProject: CreateProject<CreateProjectArgs, Project> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  if (!args.name?.trim()) throw new HttpError(400, 'Le nom du projet est requis.');
  return context.entities.Project.create({
    data: {
      companyId,
      name: args.name,
      description: args.description,
      clientId: args.clientId || null,
      status: args.status || 'en_cours',
      startDate: args.startDate ? new Date(args.startDate) : null,
      dueDate: args.dueDate ? new Date(args.dueDate) : null,
      budget: args.budget ?? null,
    } as any,
  });
};

type UpdateProjectArgs = { id: string } & Partial<CreateProjectArgs>;
export const updateProject: UpdateProject<UpdateProjectArgs, Project> = async ({ id, startDate, dueDate, ...rest }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Project.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  return context.entities.Project.update({
    where: { id },
    data: {
      ...rest,
      ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
      ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
    },
  });
};

export const deleteProject: DeleteProject<{ id: string }, { id: string }> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Project.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  await context.entities.Project.delete({ where: { id } });
  return { id };
};

import { HttpError } from 'wasp/server';
import type { GetAutomations, CreateAutomation, UpdateAutomation, DeleteAutomation } from 'wasp/server/operations';
import type { Automation } from 'wasp/entities';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

export const getAutomations: GetAutomations<void, Automation[]> = async (_args, context) => {
  const companyId = ensureCompany(context.user);
  return context.entities.Automation.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
  });
};

type CreateAutomationArgs = {
  name: string;
  description?: string;
  trigger: string;
  action: string;
  isActive?: boolean;
  config?: any;
};
export const createAutomation: CreateAutomation<CreateAutomationArgs, Automation> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  if (!args.name?.trim()) throw new HttpError(400, 'Nom requis');
  return context.entities.Automation.create({
    data: {
      companyId,
      name: args.name,
      description: args.description,
      trigger: args.trigger,
      action: args.action,
      isActive: args.isActive ?? true,
      config: args.config ?? null,
    } as any,
  });
};

type UpdateAutomationArgs = { id: string } & Partial<CreateAutomationArgs>;
export const updateAutomation: UpdateAutomation<UpdateAutomationArgs, Automation> = async ({ id, ...data }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Automation.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  return context.entities.Automation.update({ where: { id }, data: data as any });
};

export const deleteAutomation: DeleteAutomation<{ id: string }, { id: string }> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Automation.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  await context.entities.Automation.delete({ where: { id } });
  return { id };
};

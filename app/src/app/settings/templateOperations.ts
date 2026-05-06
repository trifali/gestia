import { HttpError } from 'wasp/server';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

// ─── getDocumentTemplates ─────────────────────────────────────────────────────

export const getDocumentTemplates = async (_args: void, context: any) => {
  const companyId = ensureCompany(context.user);
  return context.entities.DocumentTemplate.findMany({
    where: { companyId },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });
};

// ─── createDocumentTemplate ───────────────────────────────────────────────────

export const createDocumentTemplate = async (
  args: { name: string; type: string; description?: string; content?: string; isActive?: boolean },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  if (!args.name?.trim()) throw new HttpError(400, 'Nom requis');
  return context.entities.DocumentTemplate.create({
    data: {
      companyId,
      name: args.name.trim(),
      type: args.type || 'autre',
      description: args.description?.trim() || null,
      content: args.content || '',
      isActive: args.isActive ?? true,
    },
  });
};

// ─── updateDocumentTemplate ───────────────────────────────────────────────────

export const updateDocumentTemplate = async (
  args: { id: string; name?: string; type?: string; description?: string; content?: string; isActive?: boolean },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const tmpl = await context.entities.DocumentTemplate.findUnique({ where: { id: args.id } });
  if (!tmpl || tmpl.companyId !== companyId) throw new HttpError(404);
  const data: any = {};
  if (args.name !== undefined) data.name = args.name.trim();
  if (args.type !== undefined) data.type = args.type;
  if (args.description !== undefined) data.description = args.description?.trim() || null;
  if (args.content !== undefined) data.content = args.content;
  if (args.isActive !== undefined) data.isActive = args.isActive;
  return context.entities.DocumentTemplate.update({ where: { id: args.id }, data });
};

// ─── deleteDocumentTemplate ───────────────────────────────────────────────────

export const deleteDocumentTemplate = async (
  { id }: { id: string },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const tmpl = await context.entities.DocumentTemplate.findUnique({ where: { id } });
  if (!tmpl || tmpl.companyId !== companyId) throw new HttpError(404);
  await context.entities.DocumentTemplate.delete({ where: { id } });
  return { deleted: true };
};

import { HttpError } from 'wasp/server';
import type {
  GetPriceItems,
  CreatePriceItem,
  UpdatePriceItem,
  DeletePriceItem,
  GetPriceCategories,
  CreatePriceCategory,
  DeletePriceCategory,
} from 'wasp/server/operations';
import type { PriceItem, PriceCategory } from 'wasp/entities';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

function ensureAdmin(user: any) {
  if (!(user?.role === 'admin' || user?.isAdmin)) {
    throw new HttpError(403, 'Réservé aux administrateurs');
  }
}

export const getPriceItems: GetPriceItems<void, PriceItem[]> = async (_args, context) => {
  const companyId = ensureCompany(context.user);
  return context.entities.PriceItem.findMany({
    where: { companyId },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
};

type CreateArgs = {
  code?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  unit?: string;
  unitPrice: number;
  isActive?: boolean;
};

export const createPriceItem: CreatePriceItem<CreateArgs, PriceItem> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  ensureAdmin(context.user);
  if (!args.name?.trim()) throw new HttpError(400, 'Nom requis');
  const unitPrice = Number(args.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new HttpError(400, 'Prix invalide');

  let code = args.code?.trim() || null;
  if (!code) {
    // Generate a short unique code from the name + random suffix, e.g. SERV-4F2A
    const prefix = args.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'ART';
    const suffix = Math.random().toString(36).toUpperCase().slice(2, 6);
    code = `${prefix}-${suffix}`;
  }

  return context.entities.PriceItem.create({
    data: {
      companyId,
      code,
      name: args.name.trim(),
      description: args.description?.trim() || null,
      category: args.category?.trim() || null,
      unit: args.unit?.trim() || 'unite',
      unitPrice,
      isActive: args.isActive ?? true,
    },
  });
};

type UpdateArgs = { id: string } & Partial<CreateArgs>;
export const updatePriceItem: UpdatePriceItem<UpdateArgs, PriceItem> = async ({ id, ...data }, context) => {
  const companyId = ensureCompany(context.user);
  ensureAdmin(context.user);
  const existing = await context.entities.PriceItem.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  const patch: any = {};
  if (data.code !== undefined) patch.code = data.code?.trim() || null;
  if (data.name !== undefined) {
    if (!data.name.trim()) throw new HttpError(400, 'Nom requis');
    patch.name = data.name.trim();
  }
  if (data.description !== undefined) patch.description = data.description?.trim() || null;
  if (data.category !== undefined) patch.category = data.category?.trim() || null;
  if (data.unit !== undefined) patch.unit = data.unit?.trim() || 'unite';
  if (data.unitPrice !== undefined) {
    const unitPrice = Number(data.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new HttpError(400, 'Prix invalide');
    patch.unitPrice = unitPrice;
  }
  if (data.isActive !== undefined) patch.isActive = data.isActive;
  return context.entities.PriceItem.update({ where: { id }, data: patch });
};

export const deletePriceItem: DeletePriceItem<{ id: string }, { id: string }> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  ensureAdmin(context.user);
  const existing = await context.entities.PriceItem.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  await context.entities.PriceItem.delete({ where: { id } });
  return { id };
};

export const getPriceCategories: GetPriceCategories<void, PriceCategory[]> = async (_args, context) => {
  const companyId = ensureCompany(context.user);
  return context.entities.PriceCategory.findMany({
    where: { companyId },
    orderBy: { name: 'asc' },
  });
};

export const createPriceCategory: CreatePriceCategory<{ name: string }, PriceCategory> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  ensureAdmin(context.user);
  if (!args.name?.trim()) throw new HttpError(400, 'Nom requis');
  return context.entities.PriceCategory.upsert({
    where: { companyId_name: { companyId, name: args.name.trim() } },
    create: { companyId, name: args.name.trim() },
    update: {},
  });
};

export const deletePriceCategory: DeletePriceCategory<{ id: string }, PriceCategory> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  ensureAdmin(context.user);
  const existing = await context.entities.PriceCategory.findFirst({ where: { id, companyId } });
  if (!existing) throw new HttpError(404);
  return context.entities.PriceCategory.delete({ where: { id } });
};

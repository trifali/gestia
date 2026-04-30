import { HttpError } from 'wasp/server';
import type { GetQuotes, CreateQuote, UpdateQuoteStatus, DeleteQuote } from 'wasp/server/operations';
import type { Quote, QuoteItem, Client, Project } from 'wasp/entities';
import { computeTotals, nextDocNumber } from '../../server/tenant';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

export type QuoteWithDetails = Quote & { client: Client; project: Project | null; items: QuoteItem[] };

export const getQuotes: GetQuotes<void, QuoteWithDetails[]> = async (_args, context) => {
  const companyId = ensureCompany(context.user);
  return context.entities.Quote.findMany({
    where: { companyId },
    include: { client: true, project: true, items: true },
    orderBy: { createdAt: 'desc' },
  });
};

type ItemInput = { description: string; quantity: number; unitPrice: number };
type CreateQuoteArgs = {
  clientId: string;
  projectId?: string | null;
  title: string;
  description?: string;
  validUntil?: string | null;
  notes?: string;
  items: ItemInput[];
};
export const createQuote: CreateQuote<CreateQuoteArgs, Quote> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  if (!args.clientId) throw new HttpError(400, 'Client requis');
  if (!args.title?.trim()) throw new HttpError(400, 'Titre requis');
  if (!args.items?.length) throw new HttpError(400, 'Au moins un item est requis');
  const totals = computeTotals(args.items);
  const number = await nextDocNumber(context.entities as any, 'quote', companyId, 'S');
  return context.entities.Quote.create({
    data: {
      companyId,
      clientId: args.clientId,
      projectId: args.projectId || null,
      number,
      title: args.title,
      description: args.description,
      validUntil: args.validUntil ? new Date(args.validUntil) : null,
      notes: args.notes,
      ...totals,
      items: {
        create: args.items.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          amount: +(it.quantity * it.unitPrice).toFixed(2),
        })),
      },
    } as any,
  });
};

export const updateQuoteStatus: UpdateQuoteStatus<{ id: string; status: string }, Quote> = async ({ id, status }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Quote.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  return context.entities.Quote.update({ where: { id }, data: { status } });
};

export const deleteQuote: DeleteQuote<{ id: string }, { id: string }> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Quote.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  await context.entities.Quote.delete({ where: { id } });
  return { id };
};

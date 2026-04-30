import { HttpError } from 'wasp/server';
import type { GetInvoices, CreateInvoice, UpdateInvoiceStatus, DeleteInvoice } from 'wasp/server/operations';
import type { Invoice, InvoiceItem, Client, Project, Payment } from 'wasp/entities';
import { computeTotals, nextDocNumber } from '../../server/tenant';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

export type InvoiceWithDetails = Invoice & {
  client: Client;
  project: Project | null;
  items: InvoiceItem[];
  payments: Payment[];
};

export const getInvoices: GetInvoices<void, InvoiceWithDetails[]> = async (_args, context) => {
  const companyId = ensureCompany(context.user);
  return context.entities.Invoice.findMany({
    where: { companyId },
    include: { client: true, project: true, items: true, payments: true },
    orderBy: { createdAt: 'desc' },
  });
};

type ItemInput = { description: string; quantity: number; unitPrice: number };
type CreateInvoiceArgs = {
  clientId: string;
  projectId?: string | null;
  dueDate?: string | null;
  notes?: string;
  items: ItemInput[];
};
export const createInvoice: CreateInvoice<CreateInvoiceArgs, Invoice> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  if (!args.clientId) throw new HttpError(400, 'Client requis');
  if (!args.items?.length) throw new HttpError(400, 'Au moins un item est requis');
  const totals = computeTotals(args.items);
  const number = await nextDocNumber(context.entities as any, 'invoice', companyId, 'F');
  return context.entities.Invoice.create({
    data: {
      companyId,
      clientId: args.clientId,
      projectId: args.projectId || null,
      number,
      dueDate: args.dueDate ? new Date(args.dueDate) : null,
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

export const updateInvoiceStatus: UpdateInvoiceStatus<{ id: string; status: string }, Invoice> = async ({ id, status }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Invoice.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  return context.entities.Invoice.update({ where: { id }, data: { status } });
};

export const deleteInvoice: DeleteInvoice<{ id: string }, { id: string }> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Invoice.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  await context.entities.Invoice.delete({ where: { id } });
  return { id };
};

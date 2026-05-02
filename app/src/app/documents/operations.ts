import { HttpError } from 'wasp/server';
import type {
  GetDocuments,
  CreateDocument,
  UpdateDocument,
  UpdateDocumentStatus,
  SetDocumentType,
  DeleteDocument,
  DuplicateDocument,
} from 'wasp/server/operations';
import type { Document, DocumentItem, Client, Project, Payment } from 'wasp/entities';
import { computeTotals, nextDocNumber } from '../../server/tenant';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

export type DocumentType = 'quote' | 'invoice';

export type DocumentWithDetails = Document & {
  client: Client;
  project: Project | null;
  items: DocumentItem[];
  payments: Payment[];
};

const PREFIX: Record<DocumentType, string> = { quote: 'S', invoice: 'F' };

export const getDocuments: GetDocuments<void, DocumentWithDetails[]> = async (_args, context) => {
  const companyId = ensureCompany(context.user);
  return context.entities.Document.findMany({
    where: { companyId },
    include: { client: true, project: true, items: true, payments: true },
    orderBy: { createdAt: 'desc' },
  });
};

type ItemInput = { description: string; note?: string | null; quantity: number; unitPrice: number };
type CreateDocumentArgs = {
  type: DocumentType;
  clientId: string;
  projectId?: string | null;
  title?: string | null;
  description?: string | null;
  validUntil?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  items: ItemInput[];
  discountType?: 'percent' | 'amount';
  discountValue?: number;
};

export const createDocument: CreateDocument<CreateDocumentArgs, Document> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  if (!args.clientId) throw new HttpError(400, 'Client requis');
  if (args.type !== 'quote' && args.type !== 'invoice') throw new HttpError(400, 'Type invalide');
  if (args.type === 'quote' && !args.title?.trim()) throw new HttpError(400, 'Titre requis');
  if (!args.items?.length) throw new HttpError(400, 'Au moins un item est requis');

  const discountType = args.discountType ?? 'percent';
  const discountValue = args.discountValue ?? 0;
  const totals = computeTotals(args.items, { type: discountType, value: discountValue });
  const number = await nextDocNumber(context.entities as any, args.type, companyId, PREFIX[args.type]);

  return context.entities.Document.create({
    data: {
      companyId,
      clientId: args.clientId,
      projectId: args.projectId || null,
      type: args.type,
      number,
      title: args.title || null,
      description: args.description || null,
      validUntil: args.validUntil ? new Date(args.validUntil) : null,
      dueDate: args.dueDate ? new Date(args.dueDate) : null,
      notes: args.notes || null,
      discountType,
      discountValue,
      ...totals,
      items: {
        create: args.items.map((it) => ({
          description: it.description,
          note: it.note?.trim() || null,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          amount: +(it.quantity * it.unitPrice).toFixed(2),
        })),
      },
    } as any,
  });
};

export const updateDocumentStatus: UpdateDocumentStatus<{ id: string; status: string }, Document> = async (
  { id, status },
  context,
) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Document.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  return context.entities.Document.update({ where: { id }, data: { status } });
};

type UpdateDocumentArgs = {
  id: string;
  clientId?: string;
  projectId?: string | null;
  title?: string | null;
  description?: string | null;
  validUntil?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  items?: ItemInput[];
  discountType?: 'percent' | 'amount';
  discountValue?: number;
};

export const updateDocument: UpdateDocument<UpdateDocumentArgs, Document> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Document.findUnique({ where: { id: args.id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);

  const data: any = {};
  if (args.clientId !== undefined) data.clientId = args.clientId;
  if (args.projectId !== undefined) data.projectId = args.projectId || null;
  if (args.title !== undefined) data.title = args.title || null;
  if (args.description !== undefined) data.description = args.description || null;
  if (args.notes !== undefined) data.notes = args.notes || null;
  if (args.validUntil !== undefined)
    data.validUntil = args.validUntil ? new Date(args.validUntil) : null;
  if (args.dueDate !== undefined)
    data.dueDate = args.dueDate ? new Date(args.dueDate) : null;

  if (args.discountType !== undefined) data.discountType = args.discountType;
  if (args.discountValue !== undefined) data.discountValue = args.discountValue;

  if (args.items) {
    if (!args.items.length) throw new HttpError(400, 'Au moins un item est requis');
    const discountType = args.discountType ?? (existing.discountType as 'percent' | 'amount') ?? 'percent';
    const discountValue = args.discountValue ?? existing.discountValue ?? 0;
    const totals = computeTotals(args.items, { type: discountType, value: discountValue });
    Object.assign(data, totals);
    await context.entities.DocumentItem.deleteMany({ where: { documentId: args.id } });
    data.items = {
      create: args.items.map((it) => ({
        description: it.description,
        note: it.note?.trim() || null,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        amount: +(it.quantity * it.unitPrice).toFixed(2),
      })),
    };
  }

  return context.entities.Document.update({ where: { id: args.id }, data });
};

/**
 * Promote a quote into an invoice (or revert) on the same record.
 * When promoting to invoice, a new invoice-style number is assigned and the
 * status is reset to 'envoyee' if it was a quote-only status.
 */
export const setDocumentType: SetDocumentType<
  { id: string; type: DocumentType; dueDate?: string | null },
  Document
> = async ({ id, type, dueDate }, context) => {
  const companyId = ensureCompany(context.user);
  if (type !== 'quote' && type !== 'invoice') throw new HttpError(400, 'Type invalide');
  const existing = await context.entities.Document.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  if (existing.type === type) return existing;

  const number = await nextDocNumber(context.entities as any, type, companyId, PREFIX[type]);
  const allowedStatuses = ['brouillon', 'actif', 'expire'];
  const status = allowedStatuses.includes(existing.status) ? existing.status : 'actif';

  return context.entities.Document.update({
    where: { id },
    data: {
      type,
      number,
      status,
      dueDate: type === 'invoice' && dueDate ? new Date(dueDate) : type === 'quote' ? null : existing.dueDate,
    },
  });
};

export const deleteDocument: DeleteDocument<{ id: string }, { id: string }> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Document.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  await context.entities.Document.delete({ where: { id } });
  return { id };
};

export const duplicateDocument: DuplicateDocument<{ id: string }, Document> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Document.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);

  const type = existing.type as DocumentType;
  const number = await nextDocNumber(context.entities as any, type, companyId, PREFIX[type]);

  return context.entities.Document.create({
    data: {
      companyId,
      clientId: existing.clientId,
      projectId: existing.projectId,
      type: existing.type,
      number,
      title: existing.title ? `${existing.title} (copie)` : null,
      description: existing.description,
      validUntil: existing.validUntil,
      dueDate: existing.dueDate,
      notes: existing.notes,
      status: 'brouillon',
      discountType: existing.discountType,
      discountValue: existing.discountValue,
      subtotal: existing.subtotal,
      taxGst: existing.taxGst,
      taxQst: existing.taxQst,
      total: existing.total,
      amountPaid: 0,
      items: {
        create: (existing as any).items.map((it: any) => ({
          description: it.description,
          note: it.note,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          amount: it.amount,
        })),
      },
    } as any,
  });
};

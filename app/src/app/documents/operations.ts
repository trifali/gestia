import { HttpError } from 'wasp/server';
import type {
  GetDocuments,
  CreateDocument,
  UpdateDocument,
  UpdateDocumentStatus,
  SetDocumentType,
  DeleteDocument,
  DuplicateDocument,
  SendDocumentEmail,
  SaveDocumentEmailDraft,
} from 'wasp/server/operations';
import type { Document, DocumentItem, Client, Project, Payment } from 'wasp/entities';
import { computeTotals, nextDocNumber } from '../../server/tenant';
import { logActivity } from '../activity/operations';
import { sendEmailWithAttachment } from '../../server/mail';

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

// Allowed statuses per document type. Used for client-side dropdowns and
// server-side validation.
export const QUOTE_STATUSES = ['brouillon', 'envoyee', 'acceptee', 'refusee', 'expiree'] as const;
export const INVOICE_STATUSES = [
  'brouillon',
  'envoyee',
  'acompte_recu',
  'payee',
  'en_retard',
  'annulee',
] as const;

// Map legacy values created before the lifecycle refactor onto the new set,
// keeping read paths backwards-compatible.
export type GetDocumentsArgs = {
  search?: string;
  type?: string;
  status?: string;
  sortKey?: 'date' | 'number';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  clientId?: string;
};
export type GetDocumentsResult = { data: DocumentWithDetails[]; total: number };

export const getDocuments: GetDocuments<GetDocumentsArgs, GetDocumentsResult> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  const {
    search, type, status, sortKey = 'date', sortDir = 'desc',
    page = 1, pageSize = 25, clientId,
  } = args || {};

  const and: any[] = [{ companyId }];
  if (clientId) and.push({ clientId });
  if (type) and.push({ type });
  if (status) {
    const legacyMap: Record<string, string[]> = {
      envoyee: ['envoyee', 'actif'],
      expiree: ['expiree', 'expire'],
      en_retard: ['en_retard', 'expire'],
    };
    and.push({ status: { in: legacyMap[status] ?? [status] } });
  }
  if (search) {
    and.push({
      OR: [
        { number: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { client: { name: { contains: search, mode: 'insensitive' } } },
      ],
    });
  }
  const where = and.length === 1 ? and[0] : { AND: and };
  const orderBy = sortKey === 'number'
    ? { number: sortDir as 'asc' | 'desc' }
    : { createdAt: sortDir as 'asc' | 'desc' };

  const [docs, total] = await Promise.all([
    context.entities.Document.findMany({
      where,
      include: {
        client: true,
        project: true,
        items: true,
        payments: true,
        activities: {
          where: { type: 'document.email_sent' },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    context.entities.Document.count({ where }),
  ]);

  return { data: docs, total };
};

type ItemInput = { description: string; note?: string | null; quantity: number; unitPrice: number };
type CreateDocumentArgs = {
  type: DocumentType;
  clientId: string;
  projectId?: string | null;
  title?: string | null;
  description?: string | null;
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
      status: 'brouillon',
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
  const allowed: readonly string[] =
    existing.type === 'invoice' ? INVOICE_STATUSES : QUOTE_STATUSES;
  if (!allowed.includes(status)) throw new HttpError(400, 'Statut invalide');
  const updated = await context.entities.Document.update({ where: { id }, data: { status } });
  if (existing.status !== status) {
    await logActivity(context.entities, {
      companyId,
      userId: context.user!.id,
      clientId: existing.clientId,
      documentId: existing.id,
      type: 'document.status_changed',
      message: `Statut de ${existing.type === 'invoice' ? 'la facture' : 'la soumission'} ${existing.number} : ${existing.status} → ${status}`,
      metadata: { from: existing.status, to: status },
    });
  }
  return updated;
};

type UpdateDocumentArgs = {
  id: string;
  clientId?: string;
  projectId?: string | null;
  title?: string | null;
  description?: string | null;
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
  // Converting starts a new lifecycle on the new type, so reset to draft.
  const status = 'brouillon';

  const updated = await context.entities.Document.update({
    where: { id },
    data: {
      type,
      number,
      status,
      dueDate: type === 'invoice' && dueDate ? new Date(dueDate) : type === 'quote' ? null : existing.dueDate,
    },
  });
  await logActivity(context.entities, {
    companyId,
    userId: context.user!.id,
    clientId: existing.clientId,
    documentId: existing.id,
    type: type === 'invoice' ? 'document.converted_to_invoice' : 'document.reverted_to_quote',
    message:
      type === 'invoice'
        ? `Soumission ${existing.number} convertie en facture ${number}`
        : `Facture ${existing.number} repassée en soumission ${number}`,
    metadata: { fromType: existing.type, toType: type, fromNumber: existing.number, toNumber: number },
  });
  return updated;
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

type SendDocumentEmailArgs = {
  id: string;
  type: DocumentType;
  to: string;
  cc?: string | null;
  subject: string;
  message: string;
  /** Base64-encoded PDF (without data URL prefix). */
  pdfBase64: string;
  filename?: string;
};

export const sendDocumentEmail: SendDocumentEmail<SendDocumentEmailArgs, { ok: true }> = async (
  args,
  context,
) => {
  const companyId = ensureCompany(context.user);
  const [doc, company] = await Promise.all([
    context.entities.Document.findUnique({ where: { id: args.id }, include: { client: true } }),
    (context.entities as any).Company.findUnique({ where: { id: companyId }, select: { name: true } }),
  ]);
  if (!doc || (doc as any).companyId !== companyId) throw new HttpError(404);

  const to = (args.to || '').trim();
  if (!to) throw new HttpError(400, 'Destinataire requis');
  if (!args.subject?.trim()) throw new HttpError(400, 'Objet requis');
  if (!args.pdfBase64) throw new HttpError(400, 'PDF manquant');

  const message = args.message || '';
  const html = `<div style="font-family: Arial, sans-serif; font-size: 14px; color:#1a1a1a; white-space: pre-wrap;">${message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')}</div>`;

  await sendEmailWithAttachment({
    to,
    cc: args.cc?.trim() || undefined,
    subject: args.subject,
    text: message,
    html,
    fromName: company?.name ? `${company.name} via Gestia` : 'Gestia',
    replyTo: context.user?.email || undefined,
    attachments: [
      {
        filename: args.filename || `${doc.number}.pdf`,
        contentBase64: args.pdfBase64,
        contentType: 'application/pdf',
      },
    ],
  });

  // Sending the email always transitions the document to 'envoyee' (unless it
  // already is). The PDF generated client-side reflects this same status.
  const docAny = doc as any;
  const currentStatus = docAny.status as string;
  const updateData: any =
    args.type === 'invoice'
      ? { emailSubjectInvoice: args.subject, emailBodyInvoice: args.message }
      : { emailSubjectQuote: args.subject, emailBodyQuote: args.message };
  updateData.emailTo = args.to.trim() || null;
  updateData.emailCc = args.cc?.trim() || null;
  if (currentStatus !== 'envoyee') {
    updateData.status = 'envoyee';
  }
  await context.entities.Document.update({ where: { id: doc.id }, data: updateData });

  await logActivity(context.entities, {
    companyId,
    userId: context.user!.id,
    clientId: (doc as any).clientId,
    documentId: doc.id,
    type: 'document.email_sent',
    message: `Courriel envoy\u00e9 \u00e0 ${to}${args.cc?.trim() ? ` (cc ${args.cc.trim()})` : ''} \u2014 ${args.type === 'invoice' ? 'Facture' : 'Soumission'} ${doc.number}`,
    metadata: {
      to,
      cc: args.cc || null,
      subject: args.subject,      body: message,      number: doc.number,
      type: args.type,
    },
  });

  return { ok: true } as const;
};

export const saveDocumentEmailDraft: SaveDocumentEmailDraft<
  { id: string; type: DocumentType; subject?: string | null; body?: string | null; to?: string | null; cc?: string | null },
  { ok: true }
> = async ({ id, type, subject, body, to, cc }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Document.findUnique({ where: { id } });
  if (!existing || (existing as any).companyId !== companyId) throw new HttpError(404);
  const cleanSubject = subject?.trim() || null;
  const cleanBody = body ?? null;
  const emailFields: any =
    type === 'invoice'
      ? { emailSubjectInvoice: cleanSubject, emailBodyInvoice: cleanBody }
      : { emailSubjectQuote: cleanSubject, emailBodyQuote: cleanBody };
  if (to !== undefined) emailFields.emailTo = to?.trim() || null;
  if (cc !== undefined) emailFields.emailCc = cc?.trim() || null;
  await context.entities.Document.update({ where: { id }, data: emailFields });
  return { ok: true } as const;
};

export const getDocumentById = async (
  { id }: { id: string },
  context: any,
): Promise<DocumentWithDetails | null> => {
  const companyId = ensureCompany(context.user);
  const doc = await context.entities.Document.findUnique({
    where: { id },
    include: {
      client: true,
      project: true,
      items: true,
      payments: true,
      activities: {
        where: { type: 'document.email_sent' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });
  if (!doc || (doc as any).companyId !== companyId) return null;
  return doc as DocumentWithDetails;
};

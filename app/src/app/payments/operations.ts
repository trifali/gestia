import { HttpError } from 'wasp/server';
import type { GetPayments, CreatePayment, UpdatePayment, DeletePayment } from 'wasp/server/operations';
import type { Payment, Document, Client } from 'wasp/entities';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

export type PaymentWithDocument = Payment & { document: Document & { client: Client } };

export type GetPaymentsArgs = {
  search?: string;
  method?: string;
  sortKey?: 'date' | 'amount';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  clientId?: string;
};
export type GetPaymentsResult = {
  data: PaymentWithDocument[];
  total: number;
  totals: { amount: number; sub: number; gst: number; qst: number };
};

export const getPayments: GetPayments<GetPaymentsArgs, GetPaymentsResult> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  const {
    search, method, sortKey = 'date', sortDir = 'desc',
    page = 1, pageSize = 25, clientId,
  } = args || {};

  const and: any[] = [{ companyId }];
  if (clientId) and.push({ document: { clientId } });
  if (method) and.push({ method });
  if (search) {
    and.push({
      OR: [
        { document: { number: { contains: search, mode: 'insensitive' } } },
        { document: { client: { name: { contains: search, mode: 'insensitive' } } } },
        { reference: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  const where = and.length === 1 ? and[0] : { AND: and };
  const orderBy = sortKey === 'amount'
    ? { amount: sortDir as 'asc' | 'desc' }
    : { paidAt: sortDir as 'asc' | 'desc' };

  const [data, total, allForTotals] = await Promise.all([
    context.entities.Payment.findMany({
      where,
      include: { document: { include: { client: true } } },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    context.entities.Payment.count({ where }),
    context.entities.Payment.findMany({
      where,
      select: {
        amount: true,
        document: { select: { total: true, subtotal: true, taxGst: true, taxQst: true } },
      },
    }),
  ]);

  const totals = allForTotals.reduce(
    (acc, p) => {
      const doc = p.document as any;
      const ratio = doc.total ? p.amount / doc.total : 0;
      return {
        amount: acc.amount + p.amount,
        sub: acc.sub + doc.subtotal * ratio,
        gst: acc.gst + doc.taxGst * ratio,
        qst: acc.qst + doc.taxQst * ratio,
      };
    },
    { amount: 0, sub: 0, gst: 0, qst: 0 },
  );

  return { data, total, totals };
};

type CreatePaymentArgs = {
  documentId: string;
  amount: number;
  method?: string;
  paidAt?: string;
  reference?: string;
  notes?: string;
};
export const createPayment: CreatePayment<CreatePaymentArgs, Payment> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  if (!args.documentId) throw new HttpError(400);
  const doc = await context.entities.Document.findUnique({ where: { id: args.documentId } });
  if (!doc || doc.companyId !== companyId) throw new HttpError(404, 'Document introuvable');
  if (doc.type !== 'invoice') throw new HttpError(400, 'Seules les factures peuvent recevoir un paiement');
  if (!args.amount || args.amount <= 0) throw new HttpError(400, 'Montant invalide');

  const payment = await context.entities.Payment.create({
    data: {
      companyId,
      documentId: args.documentId,
      amount: args.amount,
      method: args.method || 'virement',
      paidAt: args.paidAt ? new Date(args.paidAt) : new Date(),
      reference: args.reference,
      notes: args.notes,
    } as any,
  });

  const newPaid = +(doc.amountPaid + args.amount).toFixed(2);
  // Recompute lifecycle status based on payment progress.
  // Manual states ('annulee') are preserved; otherwise:
  //   newPaid >= total           → 'payee'
  //   0 < newPaid < total        → 'acompte_recu'
  let status = doc.status;
  if (status !== 'annulee') {
    if (newPaid >= doc.total) status = 'payee';
    else if (newPaid > 0) status = 'acompte_recu';
  }
  await context.entities.Document.update({
    where: { id: doc.id },
    data: { amountPaid: newPaid, status },
  });

  return payment;
};

export const deletePayment: DeletePayment<{ id: string }, { id: string }> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Payment.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  const doc = await context.entities.Document.findUnique({ where: { id: existing.documentId } });
  await context.entities.Payment.delete({ where: { id } });
  if (doc) {
    const newPaid = +Math.max(0, doc.amountPaid - existing.amount).toFixed(2);
    let status = doc.status;
    if (status !== 'annulee') {
      if (newPaid >= doc.total && doc.total > 0) status = 'payee';
      else if (newPaid > 0) status = 'acompte_recu';
      else if (status === 'payee' || status === 'acompte_recu') status = 'envoyee';
    }
    await context.entities.Document.update({ where: { id: doc.id }, data: { amountPaid: newPaid, status } });
  }
  return { id };
};

type UpdatePaymentArgs = {
  id: string;
  documentId?: string;
  amount?: number;
  method?: string;
  paidAt?: string;
  reference?: string | null;
  notes?: string | null;
};
export const updatePayment: UpdatePayment<UpdatePaymentArgs, Payment> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Payment.findUnique({ where: { id: args.id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);

  const newDocId = args.documentId ?? existing.documentId;
  const newAmount = typeof args.amount === 'number' ? args.amount : existing.amount;
  if (newAmount <= 0) throw new HttpError(400, 'Montant invalide');

  const newDoc = await context.entities.Document.findUnique({ where: { id: newDocId } });
  if (!newDoc || newDoc.companyId !== companyId) throw new HttpError(404, 'Document introuvable');
  if (newDoc.type !== 'invoice') throw new HttpError(400, 'Seules les factures peuvent recevoir un paiement');

  const updated = await context.entities.Payment.update({
    where: { id: args.id },
    data: {
      documentId: newDocId,
      amount: newAmount,
      method: args.method ?? existing.method,
      paidAt: args.paidAt ? new Date(args.paidAt) : existing.paidAt,
      reference: args.reference !== undefined ? args.reference : existing.reference,
      notes: args.notes !== undefined ? args.notes : existing.notes,
    },
  });

  // Recompute amountPaid / status for the affected document(s).
  const recompute = async (docId: string) => {
    const doc = await context.entities.Document.findUnique({ where: { id: docId } });
    if (!doc) return;
    const totalPaid = await context.entities.Payment.aggregate({
      where: { documentId: docId },
      _sum: { amount: true },
    });
    const newPaid = +(totalPaid._sum.amount || 0).toFixed(2);
    let status = doc.status;
    if (status !== 'annulee') {
      if (newPaid >= doc.total && doc.total > 0) status = 'payee';
      else if (newPaid > 0) status = 'acompte_recu';
      else if (status === 'payee' || status === 'acompte_recu') status = 'envoyee';
    }
    await context.entities.Document.update({ where: { id: docId }, data: { amountPaid: newPaid, status } });
  };
  await recompute(newDocId);
  if (existing.documentId !== newDocId) await recompute(existing.documentId);

  return updated;
};

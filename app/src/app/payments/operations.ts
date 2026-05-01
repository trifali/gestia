import { HttpError } from 'wasp/server';
import type { GetPayments, CreatePayment, DeletePayment } from 'wasp/server/operations';
import type { Payment, Document, Client } from 'wasp/entities';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

export type PaymentWithDocument = Payment & { document: Document & { client: Client } };

export const getPayments: GetPayments<void, PaymentWithDocument[]> = async (_args, context) => {
  const companyId = ensureCompany(context.user);
  return context.entities.Payment.findMany({
    where: { companyId },
    include: { document: { include: { client: true } } },
    orderBy: { paidAt: 'desc' },
  });
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
  const status = newPaid >= doc.total ? 'payee' : doc.status;
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
    const status = doc.status === 'payee' && newPaid < doc.total ? 'envoyee' : doc.status;
    await context.entities.Document.update({ where: { id: doc.id }, data: { amountPaid: newPaid, status } });
  }
  return { id };
};

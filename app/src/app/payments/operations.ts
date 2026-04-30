import { HttpError } from 'wasp/server';
import type { GetPayments, CreatePayment, DeletePayment } from 'wasp/server/operations';
import type { Payment, Invoice, Client } from 'wasp/entities';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

export type PaymentWithInvoice = Payment & { invoice: Invoice & { client: Client } };

export const getPayments: GetPayments<void, PaymentWithInvoice[]> = async (_args, context) => {
  const companyId = ensureCompany(context.user);
  return context.entities.Payment.findMany({
    where: { companyId },
    include: { invoice: { include: { client: true } } },
    orderBy: { paidAt: 'desc' },
  });
};

type CreatePaymentArgs = {
  invoiceId: string;
  amount: number;
  method?: string;
  paidAt?: string;
  reference?: string;
  notes?: string;
};
export const createPayment: CreatePayment<CreatePaymentArgs, Payment> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  if (!args.invoiceId) throw new HttpError(400);
  const invoice = await context.entities.Invoice.findUnique({ where: { id: args.invoiceId } });
  if (!invoice || invoice.companyId !== companyId) throw new HttpError(404, 'Facture introuvable');
  if (!args.amount || args.amount <= 0) throw new HttpError(400, 'Montant invalide');

  const payment = await context.entities.Payment.create({
    data: {
      companyId,
      invoiceId: args.invoiceId,
      amount: args.amount,
      method: args.method || 'virement',
      paidAt: args.paidAt ? new Date(args.paidAt) : new Date(),
      reference: args.reference,
      notes: args.notes,
    } as any,
  });

  const newPaid = +(invoice.amountPaid + args.amount).toFixed(2);
  const status = newPaid >= invoice.total ? 'payee' : invoice.status;
  await context.entities.Invoice.update({
    where: { id: invoice.id },
    data: { amountPaid: newPaid, status },
  });

  return payment;
};

export const deletePayment: DeletePayment<{ id: string }, { id: string }> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Payment.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  const invoice = await context.entities.Invoice.findUnique({ where: { id: existing.invoiceId } });
  await context.entities.Payment.delete({ where: { id } });
  if (invoice) {
    const newPaid = +Math.max(0, invoice.amountPaid - existing.amount).toFixed(2);
    const status = invoice.status === 'payee' && newPaid < invoice.total ? 'envoyee' : invoice.status;
    await context.entities.Invoice.update({ where: { id: invoice.id }, data: { amountPaid: newPaid, status } });
  }
  return { id };
};

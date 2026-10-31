import { HttpError } from 'wasp/server';
import { getObjectBuffer } from '../../server/storage';
import { invoiceBalance, isPayable, formatRate, applyVars, buildSupplierContractVars } from '../../shared/supplier';
import { formatCurrency } from '../../shared/format';
import { notifyCompany, parseDate, round2, urlFor } from './serverUtils';
import { invoiceAmounts, storeInvoiceFile } from './operations';

// Portail fournisseur : un lien sans compte, comme le portail projet. Tout ce qui
// sort d'ici est choisi champ par champ — notes internes, coordonnées bancaires et
// raisons internes ne doivent jamais apparaître dans la réponse.

export async function resolvePortalAccess(token: string, entities: any) {
  if (!token) throw new HttpError(403, 'Lien invalide ou révoqué');
  const access = await entities.SupplierPortalAccess.findUnique({ where: { token }, include: { supplier: true } });
  if (!access || access.isRevoked) throw new HttpError(403, 'Lien invalide ou révoqué');
  if (access.expiresAt && access.expiresAt < new Date()) throw new HttpError(403, 'Ce lien a expiré');
  return { access, supplier: access.supplier };
}

export const getSupplierPortal = async ({ token }: { token: string }, context: any) => {
  const { access, supplier } = await resolvePortalAccess(token, context.entities);
  await context.entities.SupplierPortalAccess.update({ where: { id: access.id }, data: { lastUsedAt: new Date() } });

  const [company, contracts, invoices, notes] = await Promise.all([
    context.entities.Company.findUnique({ where: { id: supplier.companyId } }),
    context.entities.SupplierContract.findMany({
      where: { supplierId: supplier.id, sharedWithSupplier: true },
      orderBy: { createdAt: 'desc' },
    }),
    context.entities.SupplierInvoice.findMany({
      where: { supplierId: supplier.id },
      orderBy: { issueDate: 'desc' },
      include: { payments: { orderBy: { paidAt: 'desc' } } },
    }),
    context.entities.SupplierNote.findMany({
      where: { supplierId: supplier.id, isPrivate: false },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    supplier: { name: supplier.name, contactName: supplier.contactName, type: supplier.type },
    company: { name: company?.name ?? '', email: company?.email ?? null, phone: company?.phone ?? null },
    contracts: contracts.map((c: any) => ({
      id: c.id,
      title: c.title,
      // Une entente non signée est lue avec ses variables remplies ; une entente
      // signée, exactement telle qu'elle a été acceptée.
      content: c.signedAt || !company ? c.content : applyVars(c.content, buildSupplierContractVars(supplier, company, c)),
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate,
      rateLabel: formatRate(c.rate, c.rateType),
      signedAt: c.signedAt,
      signedByName: c.signedByName,
      createdAt: c.createdAt,
    })),
    invoices: await Promise.all(invoices.map(async (inv: any) => ({
      id: inv.id,
      number: inv.number,
      description: inv.description,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      subtotal: inv.subtotal,
      taxGst: inv.taxGst,
      taxQst: inv.taxQst,
      total: inv.total,
      amountPaid: inv.amountPaid,
      status: inv.status,
      rejectionReason: inv.rejectionReason,
      supplierNote: inv.supplierNote,
      fileName: inv.fileName,
      fileUrl: await urlFor(inv.fileKey),
      createdAt: inv.createdAt,
      payments: inv.payments.map((p: any) => ({ id: p.id, amount: p.amount, paidAt: p.paidAt, method: p.method })),
    }))),
    notes: notes.map((n: any) => ({
      id: n.id,
      content: n.content,
      isFromSupplier: n.isFromSupplier,
      authorName: n.authorName,
      createdAt: n.createdAt,
      editedAt: n.editedAt,
    })),
    stats: {
      totalInvoiced: round2(invoices.filter((i: any) => i.status !== 'rejetee').reduce((s: number, i: any) => s + i.total, 0)),
      totalPaid: round2(invoices.reduce((s: number, i: any) => s + i.amountPaid, 0)),
      pending: round2(invoices
        .filter((i: any) => i.status === 'a_approuver' || isPayable(i))
        .reduce((s: number, i: any) => s + invoiceBalance(i), 0)),
    },
  };
};

/** Logo et couleurs pour le PDF d'une entente, chargés seulement au téléchargement. */
export const getSupplierPortalBrand = async ({ token }: { token: string }, context: any) => {
  const { supplier } = await resolvePortalAccess(token, context.entities);
  const company = await context.entities.Company.findUnique({ where: { id: supplier.companyId } });
  if (!company) throw new HttpError(404);
  let logoDataUrl: string | null = null;
  if (company.brandLogoKey) {
    try {
      logoDataUrl = `data:image/jpeg;base64,${(await getObjectBuffer(company.brandLogoKey)).toString('base64')}`;
    } catch {
      logoDataUrl = null;
    }
  }
  return {
    companyName: company.name,
    brand: {
      logoDataUrl,
      primaryColor: company.brandPrimaryColor || '#0E0E0E',
      accentColor: company.brandAccentColor || '#D4A24C',
      textColor: company.brandTextColor || '#1A1A1A',
      tagline: company.brandTagline,
    },
  };
};

type PortalInvoiceArgs = {
  token: string;
  number?: string;
  description?: string;
  issueDate?: string;
  dueDate?: string;
  subtotal: number | string;
  taxGst?: number | string;
  taxQst?: number | string;
  note?: string;
  file: { dataUrl: string; name: string };
};

export const submitSupplierPortalInvoice = async (args: PortalInvoiceArgs, context: any) => {
  const { supplier } = await resolvePortalAccess(args.token, context.entities);
  if (!args.file?.dataUrl) throw new HttpError(400, 'Joignez le fichier de votre facture (PDF ou photo).');
  const amounts = invoiceAmounts({ subtotal: args.subtotal, taxGst: args.taxGst ?? 0, taxQst: args.taxQst ?? 0 });
  if (amounts.total <= 0) throw new HttpError(400, 'Indiquez le montant de la facture.');

  const issueDate = parseDate(args.issueDate) ?? new Date();
  let dueDate = parseDate(args.dueDate);
  if (!dueDate && supplier.paymentTermsDays != null) {
    dueDate = new Date(issueDate.getTime() + supplier.paymentTermsDays * 86400000);
  }
  const fileData = await storeInvoiceFile(supplier.companyId, supplier.id, args.file);
  const invoice = await context.entities.SupplierInvoice.create({
    data: {
      supplierId: supplier.id,
      number: args.number?.trim() || null,
      description: args.description?.trim() || null,
      issueDate,
      dueDate,
      ...amounts,
      status: 'a_approuver',
      source: 'portail',
      supplierNote: args.note?.trim() || null,
      ...fileData,
    },
  });

  await notifyCompany(context.entities, supplier, `Nouvelle facture de ${supplier.name}`, [
    `${supplier.name} a déposé une facture dans son portail fournisseur.`,
    `Numéro : ${invoice.number || '—'}`,
    `Montant : ${formatCurrency(invoice.total)}`,
    ...(invoice.supplierNote ? [`Message : ${invoice.supplierNote}`] : []),
  ]);
  return { id: invoice.id };
};

export const submitSupplierPortalNote = async (
  { token, content, authorName }: { token: string; content: string; authorName?: string },
  context: any,
) => {
  const { supplier } = await resolvePortalAccess(token, context.entities);
  if (!content?.trim()) throw new HttpError(400, 'Le message est vide.');
  const author = authorName?.trim() || supplier.contactName || supplier.name;
  const note = await context.entities.SupplierNote.create({
    data: { supplierId: supplier.id, content: content.trim(), isFromSupplier: true, authorName: author },
  });
  await notifyCompany(context.entities, supplier, `Nouveau message de ${supplier.name}`, [
    `${author} vous a écrit depuis le portail fournisseur :`,
    content.trim().slice(0, 500),
  ]);
  return { id: note.id };
};

export const signSupplierContract = async (
  { token, contractId, name }: { token: string; contractId: string; name: string },
  context: any,
) => {
  const { supplier } = await resolvePortalAccess(token, context.entities);
  const contract = await context.entities.SupplierContract.findUnique({ where: { id: contractId } });
  if (!contract || contract.supplierId !== supplier.id || !contract.sharedWithSupplier) {
    throw new HttpError(404, 'Entente introuvable');
  }
  if (contract.signedAt) throw new HttpError(400, 'Cette entente est déjà signée.');
  if (contract.status !== 'envoyee') throw new HttpError(400, "Cette entente n'est pas ouverte à la signature.");
  if (!name?.trim()) throw new HttpError(400, 'Inscrivez votre nom complet pour signer.');

  const updated = await context.entities.SupplierContract.update({
    where: { id: contractId },
    data: { status: 'signee', signedAt: new Date(), signedByName: name.trim() },
  });
  await notifyCompany(context.entities, supplier, `Entente signée par ${supplier.name}`, [
    `${name.trim()} a accepté l'entente « ${contract.title} » depuis le portail fournisseur.`,
  ]);
  return { id: updated.id, signedAt: updated.signedAt };
};

import { HttpError } from 'wasp/server';
import { removeObject } from '../../server/storage';
import { companySmtp, sendEmailWithAttachment } from '../../server/mail';
import { buildEmailHtml, linkifyEmailHtml } from '../../shared/mailThread';
import {
  invoiceBalance,
  invoiceDisplayStatus,
  isPayable,
  buildSupplierContractVars,
  applyVars,
  SIGNED_CONTRACT_STATUSES,
} from '../../shared/supplier';
import { BUILTIN_AGREEMENTS } from './serviceAgreement';
import {
  ensureCompany,
  ensureSupplierOwned,
  generateToken,
  storeDataUrl,
  supplierKey,
  urlFor,
  round2,
  parseAmount,
  parseDate,
} from './serverUtils';

// ─── Fournisseurs ─────────────────────────────────────────────────────────────

const SUPPLIER_FIELDS = [
  'type', 'name', 'contactName', 'email', 'phone', 'address', 'city', 'province', 'postalCode',
  'website', 'specialty', 'status', 'neq', 'taxNumberGst', 'taxNumberQst', 'rateType', 'rate',
  'paymentTermsDays', 'paymentMethod', 'paymentDetails', 'notes', 'notifyOnPortalActivity',
] as const;

type SupplierInput = Partial<Record<(typeof SUPPLIER_FIELDS)[number], any>>;

/** Ne garde que les colonnes modifiables, et normalise les nombres et les vides. */
function pickSupplierData(args: SupplierInput) {
  const data: Record<string, any> = {};
  for (const f of SUPPLIER_FIELDS) {
    if (!(f in args)) continue;
    let v = (args as any)[f];
    if (f === 'rate') v = v === '' || v == null ? null : parseAmount(v, 'Taux');
    else if (f === 'paymentTermsDays') v = v === '' || v == null ? null : Math.max(0, Math.round(Number(v)) || 0);
    else if (f === 'notifyOnPortalActivity') v = !!v;
    else if (typeof v === 'string') v = v.trim() || (f === 'province' ? 'QC' : null);
    data[f] = v;
  }
  return data;
}

function assertRate(rate: number | null | undefined, rateType: string | null | undefined) {
  if (rateType === 'commission' && rate != null && rate > 100) {
    throw new HttpError(400, 'Un taux de commission ne peut pas dépasser 100 %.');
  }
}

export const getSuppliers = async (_args: void, context: any) => {
  const companyId = ensureCompany(context.user);
  const suppliers = await context.entities.Supplier.findMany({
    where: { companyId },
    orderBy: { name: 'asc' },
    include: {
      invoices: { select: { status: true, total: true, amountPaid: true, dueDate: true } },
      contracts: { select: { status: true } },
      messages: { where: { isFromSupplier: true, readAt: null }, select: { id: true } },
    },
  });
  return suppliers.map(({ invoices, contracts, messages, ...s }: any) => ({
    ...s,
    stats: {
      invoiceCount: invoices.length,
      toApprove: invoices.filter((i: any) => i.status === 'a_approuver').length,
      overdue: invoices.filter((i: any) => invoiceDisplayStatus(i) === 'en_retard').length,
      balanceDue: round2(invoices.filter(isPayable).reduce((sum: number, i: any) => sum + invoiceBalance(i), 0)),
      activeContracts: contracts.filter((c: any) => c.status === 'signee' || c.status === 'envoyee').length,
      unreadMessages: messages.length,
    },
  }));
};

export const getSupplierDetail = async ({ supplierId }: { supplierId: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  const supplier = await context.entities.Supplier.findUnique({
    where: { id: supplierId },
    include: {
      contracts: { orderBy: { createdAt: 'desc' } },
      invoices: {
        orderBy: { issueDate: 'desc' },
        include: { payments: { orderBy: { paidAt: 'desc' } } },
      },
      messages: { orderBy: { createdAt: 'desc' } },
      access: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!supplier || supplier.companyId !== companyId) throw new HttpError(404, 'Fournisseur introuvable');
  const invoices = await Promise.all(
    supplier.invoices.map(async (inv: any) => ({ ...inv, fileUrl: await urlFor(inv.fileKey) })),
  );
  return { ...supplier, invoices };
};

export const createSupplier = async (args: SupplierInput, context: any) => {
  const companyId = ensureCompany(context.user);
  const data = pickSupplierData(args);
  if (!data.name) throw new HttpError(400, 'Le nom du fournisseur est requis.');
  assertRate(data.rate, data.rateType);
  return context.entities.Supplier.create({ data: { ...data, companyId } });
};

export const updateSupplier = async ({ id, ...args }: { id: string } & SupplierInput, context: any) => {
  const companyId = ensureCompany(context.user);
  const existing = await ensureSupplierOwned(id, companyId, context.entities);
  const data = pickSupplierData(args);
  if ('name' in data && !data.name) throw new HttpError(400, 'Le nom du fournisseur est requis.');
  assertRate(data.rate ?? existing.rate, data.rateType ?? existing.rateType);
  return context.entities.Supplier.update({ where: { id }, data });
};

export const deleteSupplier = async ({ id }: { id: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  await ensureSupplierOwned(id, companyId, context.entities);
  // Les lignes partent en cascade ; les objets MinIO, eux, doivent être retirés à la main.
  const [files, invoices] = await Promise.all([
    context.entities.SupplierFile.findMany({ where: { supplierId: id, key: { not: null } }, select: { key: true } }),
    context.entities.SupplierInvoice.findMany({ where: { supplierId: id, fileKey: { not: null } }, select: { fileKey: true } }),
  ]);
  await context.entities.Supplier.delete({ where: { id } });
  const keys = [...files.map((f: any) => f.key), ...invoices.map((i: any) => i.fileKey)];
  await Promise.all(keys.map((k: string) => removeObject(k).catch(() => {})));
  return { id };
};

// ─── Ententes ─────────────────────────────────────────────────────────────────

async function ensureContractOwned(id: string, companyId: string, entities: any) {
  const contract = await entities.SupplierContract.findUnique({ where: { id }, include: { supplier: true } });
  if (!contract || contract.supplier.companyId !== companyId) throw new HttpError(404, 'Entente introuvable');
  return contract;
}

type CreateContractArgs = {
  supplierId: string;
  title?: string;
  /** Un id de BUILTIN_AGREEMENTS ('builtin', 'builtin:commission'), un id de modèle de Paramètres, ou null = page blanche. */
  templateId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  rate?: number | string | null;
  rateType?: string | null;
  /** Commission fixe selon le type de client. Écrite dans le texte, pas stockée à part. */
  commissionTiers?: { label: string; amount: number | string }[] | null;
};

function parseTiers(raw: CreateContractArgs['commissionTiers']) {
  const tiers = (raw ?? [])
    .filter((t) => t && (String(t.label ?? '').trim() || String(t.amount ?? '').trim()))
    .map((t) => {
      const label = String(t.label ?? '').trim();
      if (!label) throw new HttpError(400, 'Chaque type de client du barème doit avoir un nom.');
      return { label, amount: parseAmount(t.amount, `Montant pour « ${label} »`) };
    });
  if (tiers.length > 20) throw new HttpError(400, 'Le barème est limité à 20 types de client.');
  return tiers;
}

export const createSupplierContract = async (args: CreateContractArgs, context: any) => {
  const companyId = ensureCompany(context.user);
  const supplier = await ensureSupplierOwned(args.supplierId, companyId, context.entities);
  const company = await context.entities.Company.findUnique({ where: { id: companyId } });
  if (!company) throw new HttpError(404);

  let body = '';
  let defaultTitle = 'Entente de services';
  let sourceTemplateId: string | null = null;
  const builtin = BUILTIN_AGREEMENTS.find((b) => b.id === args.templateId);
  if (builtin) {
    body = builtin.content;
    defaultTitle = builtin.name;
  } else if (args.templateId) {
    const tmpl = await context.entities.DocumentTemplate.findUnique({ where: { id: args.templateId } });
    if (!tmpl || tmpl.companyId !== companyId) throw new HttpError(404, 'Modèle introuvable');
    body = tmpl.content;
    defaultTitle = tmpl.name;
    sourceTemplateId = tmpl.id;
  }
  const title = args.title?.trim() || `${defaultTitle} — ${supplier.name}`;

  const rateType = args.rateType || supplier.rateType || null;
  const tiers = rateType === 'commission_fixe' ? parseTiers(args.commissionTiers) : [];
  const contractFields = {
    startDate: parseDate(args.startDate),
    endDate: parseDate(args.endDate),
    // Avec un barème, il n'y a plus de montant unique : la fiche de l'entente
    // affiche alors « Commission fixe selon le type de client ».
    rate: tiers.length ? null : args.rate === '' || args.rate == null ? supplier.rate : parseAmount(args.rate, 'Taux'),
    rateType,
  };
  assertRate(contractFields.rate, contractFields.rateType);
  const content = applyVars(body, buildSupplierContractVars(supplier, company, { ...contractFields, commissionTiers: tiers }));

  return context.entities.SupplierContract.create({
    data: { supplierId: supplier.id, title, content, sourceTemplateId, ...contractFields },
  });
};

type UpdateContractArgs = {
  id: string;
  title?: string;
  content?: string;
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  rate?: number | string | null;
  rateType?: string | null;
  sharedWithSupplier?: boolean;
};

const CONTRACT_STATUSES = ['brouillon', 'envoyee', 'signee', 'terminee', 'annulee'];

export const updateSupplierContract = async ({ id, ...args }: UpdateContractArgs, context: any) => {
  const companyId = ensureCompany(context.user);
  const existing = await ensureContractOwned(id, companyId, context.entities);
  const data: Record<string, any> = {};

  // Le texte d'une entente signée est celui que le fournisseur a accepté : on ne
  // le réécrit pas en douce. On la duplique pour en faire une nouvelle version.
  if (args.content !== undefined && args.content !== existing.content) {
    if (existing.signedAt) throw new HttpError(400, 'Cette entente a été signée : dupliquez-la pour en modifier le texte.');
    data.content = args.content;
  }
  if (args.title !== undefined) {
    if (!args.title.trim()) throw new HttpError(400, 'Le titre est requis.');
    data.title = args.title.trim();
  }
  if (args.startDate !== undefined) data.startDate = parseDate(args.startDate);
  if (args.endDate !== undefined) data.endDate = parseDate(args.endDate);
  if (args.rate !== undefined) data.rate = args.rate === '' || args.rate == null ? null : parseAmount(args.rate, 'Taux');
  if (args.rateType !== undefined) data.rateType = args.rateType || null;
  assertRate(data.rate !== undefined ? data.rate : existing.rate, data.rateType !== undefined ? data.rateType : existing.rateType);
  if (args.status !== undefined) {
    if (!CONTRACT_STATUSES.includes(args.status)) throw new HttpError(400, 'Statut invalide');
    if (existing.signedAt && !SIGNED_CONTRACT_STATUSES.includes(args.status)) {
      throw new HttpError(400, 'Une entente signée peut seulement être terminée ou annulée. Pour la modifier, créez-en une nouvelle version.');
    }
    data.status = args.status;
  }
  if (args.sharedWithSupplier !== undefined) {
    data.sharedWithSupplier = args.sharedWithSupplier;
    // Partager un brouillon, c'est l'envoyer pour signature.
    if (args.sharedWithSupplier && existing.status === 'brouillon' && args.status === undefined) data.status = 'envoyee';
  }
  return context.entities.SupplierContract.update({ where: { id }, data });
};

/** « Entente — X » → « Entente — X (v2) » → « Entente — X (v3) ». */
function nextVersionTitle(title: string): string {
  const m = / \(v(\d+)\)$/.exec(title);
  const base = m ? title.slice(0, m.index) : title;
  return `${base} (v${m ? Number(m[1]) + 1 : 2})`;
}

/**
 * Copie modifiable d'une entente. `asNewVersion` : elle remplace une entente
 * signée puis annulée — titre numéroté plutôt que « (copie) ».
 */
export const duplicateSupplierContract = async ({ id, asNewVersion }: { id: string; asNewVersion?: boolean }, context: any) => {
  const companyId = ensureCompany(context.user);
  const c = await ensureContractOwned(id, companyId, context.entities);
  return context.entities.SupplierContract.create({
    data: {
      supplierId: c.supplierId,
      title: asNewVersion ? nextVersionTitle(c.title) : `${c.title} (copie)`,
      content: c.content,
      startDate: c.startDate,
      endDate: c.endDate,
      rate: c.rate,
      rateType: c.rateType,
      sourceTemplateId: c.sourceTemplateId,
    },
  });
};

export const deleteSupplierContract = async ({ id }: { id: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  await ensureContractOwned(id, companyId, context.entities);
  await context.entities.SupplierContract.delete({ where: { id } });
  return { id };
};

// ─── Factures ─────────────────────────────────────────────────────────────────

async function ensureInvoiceOwned(id: string, companyId: string, entities: any) {
  const inv = await entities.SupplierInvoice.findUnique({ where: { id }, include: { supplier: true } });
  if (!inv || inv.supplier.companyId !== companyId) throw new HttpError(404, 'Facture introuvable');
  return inv;
}

type InvoiceFileArg = { dataUrl: string; name: string } | null | undefined;

type InvoiceArgs = {
  number?: string | null;
  description?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  subtotal?: number | string;
  taxGst?: number | string;
  taxQst?: number | string;
  notes?: string | null;
  file?: InvoiceFileArg;
  removeFile?: boolean;
};

/** Champs communs à la saisie interne et au dépôt par le portail. */
export function invoiceAmounts(args: Pick<InvoiceArgs, 'subtotal' | 'taxGst' | 'taxQst'>) {
  const subtotal = parseAmount(args.subtotal, 'Sous-total');
  const taxGst = parseAmount(args.taxGst, 'TPS');
  const taxQst = parseAmount(args.taxQst, 'TVQ');
  return { subtotal, taxGst, taxQst, total: round2(subtotal + taxGst + taxQst) };
}

export async function storeInvoiceFile(companyId: string, supplierId: string, file: { dataUrl: string; name: string }) {
  const stored = await storeDataUrl(file.dataUrl, file.name, (fn) => supplierKey(companyId, supplierId, 'invoices', fn));
  return { fileKey: stored.key, fileMime: stored.mimeType, fileSize: stored.size, fileName: file.name };
}

export const createSupplierInvoice = async ({ supplierId, ...args }: { supplierId: string } & InvoiceArgs, context: any) => {
  const companyId = ensureCompany(context.user);
  const supplier = await ensureSupplierOwned(supplierId, companyId, context.entities);
  const amounts = invoiceAmounts(args);
  const issueDate = parseDate(args.issueDate) ?? new Date();
  // Sans échéance saisie, celle des conditions du fournisseur.
  let dueDate = parseDate(args.dueDate);
  if (!dueDate && supplier.paymentTermsDays != null) {
    dueDate = new Date(issueDate.getTime() + supplier.paymentTermsDays * 86400000);
  }
  const fileData = args.file ? await storeInvoiceFile(companyId, supplierId, args.file) : {};
  return context.entities.SupplierInvoice.create({
    data: {
      supplierId,
      number: args.number?.trim() || null,
      description: args.description?.trim() || null,
      issueDate,
      dueDate,
      ...amounts,
      notes: args.notes?.trim() || null,
      status: 'approuvee',
      source: 'interne',
      ...fileData,
    },
  });
};

export const updateSupplierInvoice = async ({ id, ...args }: { id: string } & InvoiceArgs, context: any) => {
  const companyId = ensureCompany(context.user);
  const inv = await ensureInvoiceOwned(id, companyId, context.entities);
  const data: Record<string, any> = {};
  if (args.number !== undefined) data.number = args.number?.trim() || null;
  if (args.description !== undefined) data.description = args.description?.trim() || null;
  if (args.issueDate !== undefined) data.issueDate = parseDate(args.issueDate) ?? inv.issueDate;
  if (args.dueDate !== undefined) data.dueDate = parseDate(args.dueDate);
  if (args.notes !== undefined) data.notes = args.notes?.trim() || null;
  if (args.subtotal !== undefined || args.taxGst !== undefined || args.taxQst !== undefined) {
    Object.assign(data, invoiceAmounts({
      subtotal: args.subtotal ?? inv.subtotal,
      taxGst: args.taxGst ?? inv.taxGst,
      taxQst: args.taxQst ?? inv.taxQst,
    }));
    if (data.total + 0.005 < inv.amountPaid) {
      throw new HttpError(400, 'Le total ne peut pas être inférieur aux paiements déjà enregistrés.');
    }
  }
  const oldKey = inv.fileKey;
  if (args.file) Object.assign(data, await storeInvoiceFile(companyId, inv.supplierId, args.file));
  else if (args.removeFile) Object.assign(data, { fileKey: null, fileName: null, fileMime: null, fileSize: 0 });
  const updated = await context.entities.SupplierInvoice.update({ where: { id }, data });
  if (oldKey && (args.file || args.removeFile)) await removeObject(oldKey).catch(() => {});
  return updated;
};

export const setSupplierInvoiceStatus = async (
  { id, status, rejectionReason }: { id: string; status: string; rejectionReason?: string },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const inv = await ensureInvoiceOwned(id, companyId, context.entities);
  if (!['a_approuver', 'approuvee', 'rejetee'].includes(status)) throw new HttpError(400, 'Statut invalide');
  if (status === 'rejetee' && inv.amountPaid > 0) {
    throw new HttpError(400, 'Cette facture a déjà des paiements : supprimez-les avant de la rejeter.');
  }
  return context.entities.SupplierInvoice.update({
    where: { id },
    data: { status, rejectionReason: status === 'rejetee' ? rejectionReason?.trim() || null : null },
  });
};

export const deleteSupplierInvoice = async ({ id }: { id: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  const inv = await ensureInvoiceOwned(id, companyId, context.entities);
  await context.entities.SupplierInvoice.delete({ where: { id } });
  if (inv.fileKey) await removeObject(inv.fileKey).catch(() => {});
  return { id };
};

/** Toutes les factures fournisseurs de l'entreprise — la vue « à payer ». */
export const getSupplierInvoices = async (_args: void, context: any) => {
  const companyId = ensureCompany(context.user);
  const invoices = await context.entities.SupplierInvoice.findMany({
    where: { supplier: { companyId } },
    orderBy: { issueDate: 'desc' },
    include: {
      supplier: { select: { id: true, name: true, type: true, paymentMethod: true } },
      payments: { orderBy: { paidAt: 'desc' } },
    },
  });
  return Promise.all(invoices.map(async (inv: any) => ({ ...inv, fileUrl: await urlFor(inv.fileKey) })));
};

// ─── Paiements ────────────────────────────────────────────────────────────────

async function recomputeAmountPaid(invoiceId: string, entities: any) {
  const payments = await entities.SupplierPayment.findMany({ where: { invoiceId }, select: { amount: true } });
  const amountPaid = round2(payments.reduce((s: number, p: any) => s + p.amount, 0));
  await entities.SupplierInvoice.update({ where: { id: invoiceId }, data: { amountPaid } });
}

export const createSupplierPayment = async (
  args: { invoiceId: string; amount: number | string; method?: string; paidAt?: string; reference?: string; notes?: string },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const inv = await ensureInvoiceOwned(args.invoiceId, companyId, context.entities);
  if (inv.status === 'rejetee') throw new HttpError(400, 'Une facture rejetée ne peut pas être payée.');
  const amount = parseAmount(args.amount, 'Montant');
  if (amount <= 0) throw new HttpError(400, 'Le montant doit être supérieur à 0.');
  if (amount > invoiceBalance(inv) + 0.005) {
    throw new HttpError(400, `Le montant dépasse le solde de la facture (${invoiceBalance(inv).toFixed(2)} $).`);
  }
  const payment = await context.entities.SupplierPayment.create({
    data: {
      invoiceId: inv.id,
      amount,
      method: args.method || 'virement',
      paidAt: parseDate(args.paidAt) ?? new Date(),
      reference: args.reference?.trim() || null,
      notes: args.notes?.trim() || null,
    },
  });
  // Payer une facture, c'est l'approuver.
  if (inv.status === 'a_approuver') {
    await context.entities.SupplierInvoice.update({ where: { id: inv.id }, data: { status: 'approuvee' } });
  }
  await recomputeAmountPaid(inv.id, context.entities);
  return payment;
};

export const deleteSupplierPayment = async ({ id }: { id: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  const payment = await context.entities.SupplierPayment.findUnique({ where: { id } });
  if (!payment) throw new HttpError(404);
  await ensureInvoiceOwned(payment.invoiceId, companyId, context.entities);
  await context.entities.SupplierPayment.delete({ where: { id } });
  await recomputeAmountPaid(payment.invoiceId, context.entities);
  return { id };
};

// ─── Messages ─────────────────────────────────────────────────────────────────

export const createSupplierNote = async (
  { supplierId, content, isPrivate }: { supplierId: string; content: string; isPrivate?: boolean },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureSupplierOwned(supplierId, companyId, context.entities);
  if (!content?.trim()) throw new HttpError(400, 'Le message est vide.');
  return context.entities.SupplierNote.create({
    data: {
      supplierId,
      content: content.trim(),
      isPrivate: !!isPrivate,
      authorName: context.user.fullName || context.user.email || null,
    },
  });
};

/** Ses propres messages seulement : ceux du fournisseur restent tels qu'il les a écrits. */
export const updateSupplierNote = async ({ id, content }: { id: string; content: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  const note = await context.entities.SupplierNote.findUnique({ where: { id } });
  if (!note) throw new HttpError(404);
  await ensureSupplierOwned(note.supplierId, companyId, context.entities);
  if (note.isFromSupplier) throw new HttpError(403, 'Un message du fournisseur ne peut pas être modifié.');
  if (!content?.trim()) throw new HttpError(400, 'Le message est vide.');
  if (content.trim() === note.content) return note;
  return context.entities.SupplierNote.update({ where: { id }, data: { content: content.trim(), editedAt: new Date() } });
};

export const deleteSupplierNote = async ({ id }: { id: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  const note = await context.entities.SupplierNote.findUnique({ where: { id } });
  if (!note) throw new HttpError(404);
  await ensureSupplierOwned(note.supplierId, companyId, context.entities);
  await context.entities.SupplierNote.delete({ where: { id } });
  return { id };
};

export const markSupplierNotesRead = async ({ supplierId }: { supplierId: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  await ensureSupplierOwned(supplierId, companyId, context.entities);
  const { count } = await context.entities.SupplierNote.updateMany({
    where: { supplierId, isFromSupplier: true, readAt: null },
    data: { readAt: new Date() },
  });
  return { count };
};

// ─── Accès au portail ─────────────────────────────────────────────────────────

export const createSupplierPortalAccess = async (
  { supplierId, label }: { supplierId: string; label?: string },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureSupplierOwned(supplierId, companyId, context.entities);
  return context.entities.SupplierPortalAccess.create({
    data: { supplierId, token: generateToken(), label: label?.trim() || null },
  });
};

/**
 * Envoie le lien du portail au fournisseur depuis le courriel de l'entreprise
 * (Paramètres → Intégrations). Comme pour une facture client : Reply-To et copie
 * en Cci éventuelle viennent de la configuration de l'entreprise, et sans SMTP
 * configuré on refuse plutôt que d'emprunter le serveur de la plateforme.
 *
 * Le corps est celui que l'aperçu a montré : texte saisi, échappé, adresses
 * rendues cliquables. Une trace reste dans les notes internes du fil.
 */
export const sendSupplierPortalLink = async (
  { accessId, to, cc, subject, body }: { accessId: string; to: string; cc?: string; subject: string; body: string },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const access = await context.entities.SupplierPortalAccess.findUnique({ where: { id: accessId } });
  if (!access) throw new HttpError(404);
  const supplier = await ensureSupplierOwned(access.supplierId, companyId, context.entities);
  if (access.isRevoked) throw new HttpError(400, 'Ce lien a été révoqué : générez-en un nouveau.');
  if (!to?.trim()) throw new HttpError(400, 'Destinataire requis');
  if (!subject?.trim()) throw new HttpError(400, 'Objet requis');
  // Le message est modifiable : on s'assure que le lien, lui, y est toujours.
  if (!body?.includes(access.token)) throw new HttpError(400, "Le lien du portail n'est plus dans le message : remettez-le avant d'envoyer.");

  const company = await context.entities.Company.findUnique({ where: { id: companyId } });
  const smtp = companySmtp(company);
  if (!smtp) throw new HttpError(400, 'Courriel non configuré. Ajoutez votre serveur SMTP dans Paramètres → Intégrations.');

  try {
    await sendEmailWithAttachment({
      smtp,
      to: to.trim(),
      cc: cc?.trim() || undefined,
      subject: subject.trim(),
      text: body,
      html: linkifyEmailHtml(buildEmailHtml(body, { html: '' })),
      clientFacing: true,
    });
  } catch (err: any) {
    throw new HttpError(502, `Envoi impossible : ${err?.message || 'erreur SMTP'}`);
  }

  await context.entities.SupplierNote.create({
    data: {
      supplierId: supplier.id,
      isPrivate: true,
      authorName: context.user.fullName || context.user.email || null,
      content: `Lien du portail${access.label ? ` « ${access.label} »` : ''} envoyé par courriel à ${to.trim()}${cc?.trim() ? ` (cc ${cc.trim()})` : ''}.`,
    },
  });
  return { sent: true };
};

export const revokeSupplierPortalAccess = async ({ id }: { id: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  const access = await context.entities.SupplierPortalAccess.findUnique({ where: { id } });
  if (!access) throw new HttpError(404);
  await ensureSupplierOwned(access.supplierId, companyId, context.entities);
  return context.entities.SupplierPortalAccess.update({ where: { id }, data: { isRevoked: true } });
};

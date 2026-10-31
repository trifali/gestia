// Fournisseurs : libellés, état de paiement d'une facture et variables d'entente.
// Partagé entre le serveur (création d'une entente, portail) et l'interface.

import { formatCurrency, formatDate } from './format';

export const SUPPLIER_TYPES: { value: string; label: string }[] = [
  { value: 'consultant', label: 'Consultant' },
  { value: 'travailleur_autonome', label: 'Travailleur autonome' },
  { value: 'sous_traitant', label: 'Sous-traitant' },
  { value: 'fournisseur', label: 'Fournisseur' },
  { value: 'agence', label: 'Agence' },
  { value: 'autre', label: 'Autre' },
];

export function supplierTypeLabel(type: string | null | undefined): string {
  return SUPPLIER_TYPES.find((t) => t.value === type)?.label ?? 'Autre';
}

export const SUPPLIER_STATUS: Record<string, { label: string; className: string }> = {
  actif: { label: 'Actif', className: 'badge-success' },
  inactif: { label: 'Inactif', className: 'badge-neutral' },
};

export const RATE_TYPES: { value: string; label: string; unit: string }[] = [
  { value: 'horaire', label: 'Taux horaire', unit: 'heure' },
  { value: 'journalier', label: 'Taux journalier', unit: 'jour' },
  { value: 'mensuel', label: 'Forfait mensuel', unit: 'mois' },
  { value: 'forfait', label: 'Prix forfaitaire', unit: '' },
  { value: 'commission', label: 'Commission (% des ventes)', unit: '' },
  { value: 'commission_fixe', label: 'Commission fixe ($ par client)', unit: 'client' },
];

/** Un taux de commission (« 10 % »), ou un montant en dollars pour tout le reste. */
export function isPercentRate(rateType: string | null | undefined): boolean {
  return rateType === 'commission';
}

export function isCommissionRate(rateType: string | null | undefined): boolean {
  return rateType === 'commission' || rateType === 'commission_fixe';
}

function formatPercent(rate: number): string {
  return `${new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2 }).format(rate)} %`;
}

/** « 95,00 $ / heure », « 4 500,00 $ (forfait) », « 10 % de commission », ou '' sans taux. */
export function formatRate(rate: number | null | undefined, rateType: string | null | undefined): string {
  // Sans montant unique, une commission fixe suit un barème défini dans l'entente.
  if (rate == null && rateType === 'commission_fixe') return 'Commission fixe selon le type de client';
  if (rate == null || !Number.isFinite(rate)) return '';
  if (isPercentRate(rateType)) return `${formatPercent(rate)} de commission`;
  if (rateType === 'commission_fixe') return `${formatCurrency(rate)} par client (commission)`;
  const unit = RATE_TYPES.find((r) => r.value === rateType)?.unit;
  if (rateType === 'forfait') return `${formatCurrency(rate)} (forfait)`;
  return unit ? `${formatCurrency(rate)} / ${unit}` : formatCurrency(rate);
}

// ─── Ententes ────────────────────────────────────────────────────────────────

export const CONTRACT_STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  envoyee: { label: 'En attente de signature', className: 'badge-info' },
  signee: { label: 'Signée', className: 'badge-success' },
  terminee: { label: 'Terminée', className: 'badge-neutral' },
  annulee: { label: 'Annulée', className: 'badge-danger' },
};

/**
 * Les statuts permis une fois l'entente signée. Revenir à « Brouillon » ou « En
 * attente de signature » afficherait une entente à signer qui ne peut plus l'être
 * — et une signature est la preuve de ce qui a été accepté : elle ne s'efface pas.
 */
export const SIGNED_CONTRACT_STATUSES = ['signee', 'terminee', 'annulee'];

/** « 31 octobre 2026 à 14 h 05 », à l'heure de Montréal, où que le texte soit rendu. */
export function formatSignedAt(d: Date | string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('fr-CA', {
      timeZone: 'America/Toronto', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(d)).map((p) => [p.type, p.value]),
  );
  const day = parts.day === '1' ? '1er' : parts.day;
  return `${day} ${parts.month} ${parts.year} à ${parts.hour} h ${parts.minute}`;
}

/**
 * Le texte d'une entente signée tel qu'on l'affiche et l'imprime : les lignes
 * « Date : ______ » et « Signature : ______ » du bloc du Prestataire reçoivent la
 * date et la mention de signature électronique.
 *
 * Calculé à l'affichage, jamais enregistré : `content` reste exactement le texte
 * présenté au fournisseur au moment où il l'a accepté.
 *
 * Le bloc est la section dont le titre contient « signature ». Dans les ententes
 * créées avant que le Client ne signe plus, cette section porte aussi des lignes
 * pour le Client : seules celles qui suivent la mention du Prestataire sont
 * remplies. Sans bloc de signature (texte rédigé à la main ou par l'IA), une
 * section d'acceptation est ajoutée à la fin.
 */
export function withSignature(content: string, signedByName: string | null | undefined, signedAt: Date | string | null | undefined): string {
  if (!signedAt) return content;
  const name = signedByName?.trim() || 'le Prestataire';
  const when = formatSignedAt(signedAt);
  const date = formatDate(signedAt).replace(/^1 /, '1er ');
  const stamp = `*${name}* — signé électroniquement le ${when}, depuis le portail fournisseur`;

  const lines = content.split('\n');
  const start = lines.findIndex((l) => /^##\s.*signature/i.test(l));
  if (start >= 0) {
    let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
    if (end < 0) end = lines.length;
    // Dans un bloc à deux parties, on commence après la dernière mention du Prestataire.
    let from = start + 1;
    for (let i = start + 1; i < end; i++) if (/prestataire/i.test(lines[i])) from = i;
    let dated = false;
    let signed = false;
    for (let i = from; i < end; i++) {
      if (!dated && /Date\s*:\s*_{3,}/.test(lines[i])) {
        lines[i] = lines[i].replace(/Date\s*:\s*_{3,}/, `Date : ${date}`);
        dated = true;
      }
      if (!signed && /Signature\s*:\s*_{3,}/.test(lines[i])) {
        lines[i] = lines[i].replace(/Signature\s*:\s*_{3,}/, `Signature : ${stamp}`);
        signed = true;
      }
    }
    if (signed) return lines.join('\n');
  }
  return `${content.trimEnd()}\n\n## Acceptation du Prestataire\n\nSignature : ${stamp}.\n`;
}

// ─── Factures ────────────────────────────────────────────────────────────────

/** Décision de l'entreprise, la seule chose enregistrée dans `status`. */
export const INVOICE_REVIEW_STATUS = ['a_approuver', 'approuvee', 'rejetee'] as const;

/**
 * Ce qu'on affiche : la décision, puis l'état du paiement qui en découle.
 * Toujours calculé, jamais stocké (voir le commentaire de SupplierInvoice).
 */
export type InvoiceDisplayStatus = 'a_approuver' | 'rejetee' | 'a_payer' | 'en_retard' | 'partielle' | 'payee';

export const INVOICE_DISPLAY_STATUS: Record<InvoiceDisplayStatus, { label: string; className: string; hint: string }> = {
  a_approuver: { label: 'À approuver', className: 'badge-warning', hint: 'Reçue, en attente de votre vérification' },
  a_payer: { label: 'À payer', className: 'badge-info', hint: 'Approuvée, aucun paiement encore' },
  en_retard: { label: 'En retard', className: 'badge-danger', hint: "Date d'échéance dépassée" },
  partielle: { label: 'Payée en partie', className: 'badge-accent', hint: 'Un ou plusieurs paiements, solde restant' },
  payee: { label: 'Payée', className: 'badge-success', hint: 'Entièrement réglée' },
  rejetee: { label: 'Rejetée', className: 'badge-neutral', hint: 'Refusée, ne sera pas payée' },
};

type InvoiceLike = { status: string; total: number; amountPaid: number; dueDate?: Date | string | null };

/** Un cent de tolérance : 0,1 + 0,2 ne doit pas laisser un solde de 0,00 $. */
export function invoiceBalance(inv: Pick<InvoiceLike, 'total' | 'amountPaid'>): number {
  const b = Math.round((inv.total - inv.amountPaid) * 100) / 100;
  return b > 0.005 ? b : 0;
}

export function invoiceDisplayStatus(inv: InvoiceLike, now: Date = new Date()): InvoiceDisplayStatus {
  if (inv.status === 'rejetee') return 'rejetee';
  if (inv.status === 'a_approuver') return 'a_approuver';
  const balance = invoiceBalance(inv);
  if (balance === 0 && inv.total > 0) return 'payee';
  if (inv.dueDate && new Date(inv.dueDate) < startOfDay(now)) return 'en_retard';
  return inv.amountPaid > 0 ? 'partielle' : 'a_payer';
}

/** Ce qui reste dû : factures ni rejetées ni encore à approuver. */
export function isPayable(inv: InvoiceLike): boolean {
  return inv.status === 'approuvee' && invoiceBalance(inv) > 0;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export const TPS_RATE = 0.05;
export const TVQ_RATE = 0.09975;

export function computeTaxes(subtotal: number): { taxGst: number; taxQst: number } {
  return {
    taxGst: Math.round(subtotal * TPS_RATE * 100) / 100,
    taxQst: Math.round(subtotal * TVQ_RATE * 100) / 100,
  };
}

// ─── Variables d'entente ─────────────────────────────────────────────────────

export type SupplierVar = { key: string; label: string };
export type SupplierVarGroup = { group: string; vars: SupplierVar[] };

export const SUPPLIER_VARIABLE_GROUPS: SupplierVarGroup[] = [
  {
    group: 'Date',
    vars: [{ key: '{{date}}', label: 'Date du jour' }],
  },
  {
    group: 'Fournisseur',
    vars: [
      { key: '{{supplier.name}}', label: 'Nom (personne)' },
      { key: '{{supplier.company}}', label: 'Nom / raison sociale' },
      { key: '{{supplier.email}}', label: 'Courriel' },
      { key: '{{supplier.phone}}', label: 'Téléphone' },
      { key: '{{supplier.address}}', label: 'Adresse' },
      { key: '{{supplier.specialty}}', label: 'Expertise' },
      { key: '{{supplier.neq}}', label: 'NEQ' },
      { key: '{{supplier.tps}}', label: 'N° TPS' },
      { key: '{{supplier.tvq}}', label: 'N° TVQ' },
    ],
  },
  {
    group: 'Entente',
    vars: [
      { key: '{{contract.start}}', label: 'Date de début' },
      { key: '{{contract.end}}', label: 'Date de fin' },
      { key: '{{contract.rate}}', label: 'Rémunération' },
      { key: '{{contract.commission}}', label: 'Commission' },
      { key: '{{contract.commission_terms}}', label: 'Clause de commission' },
      { key: '{{contract.payment_terms}}', label: 'Délai de paiement' },
    ],
  },
  {
    group: 'Entreprise',
    vars: [
      { key: '{{company.name}}', label: 'Nom' },
      { key: '{{company.email}}', label: 'Courriel' },
      { key: '{{company.phone}}', label: 'Téléphone' },
      { key: '{{company.address}}', label: 'Adresse' },
      { key: '{{company.neq}}', label: 'NEQ' },
    ],
  },
];

type SupplierForVars = {
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  specialty?: string | null;
  neq?: string | null;
  taxNumberGst?: string | null;
  taxNumberQst?: string | null;
  paymentTermsDays?: number | null;
};

type CompanyForVars = {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  neq?: string | null;
  taxNumberGst?: string | null;
  taxNumberQst?: string | null;
};

/** Une ligne du barème d'une commission fixe : « Client A — contrat annuel : 100 $ ». */
export type CommissionTier = { label: string; amount: number };

type ContractForVars = {
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  rate?: number | null;
  rateType?: string | null;
  /** Commission fixe qui varie selon le type de client. Remplace alors `rate`. */
  commissionTiers?: CommissionTier[] | null;
};

/** « le 1er novembre 2026 » — la préposition fait partie de la valeur, pour que le
 *  texte se lise aussi bien avec une date qu'avec la formule de repli. */
function onDate(d: Date | string): string {
  return `le ${formatDate(d).replace(/^1 /, '1er ')}`;
}

function joinAddress(p: { address?: string | null; city?: string | null; province?: string | null; postalCode?: string | null }): string {
  return [p.address, p.city, p.province, p.postalCode].filter(Boolean).join(', ');
}

/**
 * Valeurs des variables d'une entente. Les `{{client.*}}` y figurent aussi,
 * renvoyées vers le fournisseur : un modèle écrit pour les clients dans
 * Paramètres → Modèles se remplit alors correctement, sans réécriture.
 */
export function buildSupplierContractVars(
  supplier: SupplierForVars,
  company: CompanyForVars,
  contract: ContractForVars,
): Record<string, string> {
  const today = new Date().toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });
  const supplierAddress = joinAddress(supplier);
  const person = supplier.contactName || supplier.name;
  const terms = supplier.paymentTermsDays != null ? `${supplier.paymentTermsDays} jours` : '30 jours';
  const vars: Record<string, string> = {
    '{{date}}': today,
    '{{supplier.name}}': person,
    '{{supplier.company}}': supplier.name,
    '{{supplier.email}}': supplier.email ?? '',
    '{{supplier.phone}}': supplier.phone ?? '',
    '{{supplier.address}}': supplierAddress,
    '{{supplier.specialty}}': supplier.specialty ?? '',
    '{{supplier.neq}}': supplier.neq ?? '',
    '{{supplier.tps}}': supplier.taxNumberGst ?? '',
    '{{supplier.tvq}}': supplier.taxNumberQst ?? '',
    '{{client.name}}': person,
    '{{client.company}}': supplier.name,
    '{{client.email}}': supplier.email ?? '',
    '{{client.phone}}': supplier.phone ?? '',
    '{{client.address}}': supplierAddress,
    '{{contract.start}}': contract.startDate ? onDate(contract.startDate) : 'à la date de sa signature',
    '{{contract.end}}': contract.endDate ? onDate(contract.endDate) : 'à la fin des services convenus',
    '{{contract.rate}}': formatRate(contract.rate, contract.rateType) || 'selon les modalités convenues entre les parties',
    '{{contract.commission}}': commissionAmount(contract),
    '{{contract.commission_terms}}': commissionTerms(contract),
    '{{contract.payment_terms}}': terms,
    '{{company.name}}': company.name,
    '{{company.email}}': company.email ?? '',
    '{{company.phone}}': company.phone ?? '',
    '{{company.address}}': joinAddress(company),
    '{{company.neq}}': company.neq ?? '',
    '{{company.tps}}': company.taxNumberGst ?? '',
    '{{company.tvq}}': company.taxNumberQst ?? '',
    // Variable des modèles client : la fin de l'entente en tient lieu.
    '{{date_expiry}}': contract.endDate ? formatDate(contract.endDate) : '',
  };
  // Une coordonnée manquante laisse une ligne à remplir plutôt qu'un trou dans la phrase.
  for (const k of Object.keys(vars)) if (!vars[k].trim()) vars[k] = BLANK;
  return vars;
}

/** « 10 % » ou « 100,00 $ » — le blanc à compléter quand rien n'est encore convenu. */
function commissionAmount(c: ContractForVars): string {
  if (c.rateType === 'commission_fixe' && c.commissionTiers?.length) return "selon le type de client (barème de l'article 5)";
  if (c.rate == null) return c.rateType === 'commission_fixe' ? '______ $' : '____ %';
  return c.rateType === 'commission_fixe' ? formatCurrency(c.rate) : formatPercent(c.rate);
}

/**
 * Le cœur de l'article sur la commission, qui change selon qu'elle est un
 * pourcentage des ventes ou un montant fixe par client. Un seul modèle couvre
 * ainsi les deux cas : c'est la rémunération choisie à la création qui décide.
 * Une commission fixe peut porter un barème par type de client, saisi à la
 * création de l'entente : il est alors écrit en liste dans l'article.
 */
function commissionTerms(c: ContractForVars): string {
  const amount = commissionAmount(c);
  if (c.rateType === 'commission_fixe') {
    const tiers = c.commissionTiers ?? [];
    const amountLines = tiers.length
      ? [
          '**Montant :** une commission fixe est versée une seule fois par client admissible, peu importe le nombre ou la valeur de ses achats. Son montant dépend du type de client :',
          '',
          ...tiers.map((t) => `- ${t.label} : ${formatCurrency(t.amount)}`),
          '',
          "Le type d'un client est établi d'après la première vente qu'il conclut avec le Client. Un client qui ne correspond à aucun de ces types fait l'objet d'une entente écrite entre les parties avant le versement.",
        ]
      : [
          `**Montant :** ${amount} par client admissible, versé une seule fois par client, peu importe le nombre ou la valeur de ses achats.`,
        ];
    return [
      ...amountLines,
      '',
      "**Commission acquise :** la commission est acquise lorsque le client admissible a conclu une première vente avec le Client et en a payé la première facture. Si cette vente est annulée ou remboursée dans les quatre-vingt-dix (90) jours, la commission versée est déduite des commissions suivantes.",
    ].join('\n');
  }
  return [
    `**Taux :** ${amount} du montant, avant taxes, de chaque vente conclue par le Client avec un client admissible.`,
    '',
    "**Commission acquise :** la commission n'est due que sur les sommes effectivement encaissées par le Client. Si une somme est remboursée, créditée ou annulée, la commission correspondante est déduite des commissions suivantes.",
  ].join('\n');
}

/** Ce qu'on écrit à la place d'une information absente : une ligne à compléter. */
export const BLANK = '______';

/** Les `{{…}}` qui restent après remplacement — à signaler, jamais à imprimer. */
export function findUnresolvedVars(content: string): string[] {
  return [...new Set(content.match(/\{\{[^{}]+\}\}/g) ?? [])];
}

export function applyVars(content: string, vars: Record<string, string>): string {
  let out = content;
  for (const [key, value] of Object.entries(vars)) out = out.split(key).join(value);
  return out;
}

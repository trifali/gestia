import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import {
  LuPaperclip, LuExternalLink, LuWallet, LuCheck, LuBan, LuPencil, LuTrash2, LuX, LuUpload, LuRotateCcw,
} from 'react-icons/lu';
import {
  createSupplierInvoice,
  updateSupplierInvoice,
  deleteSupplierInvoice,
  setSupplierInvoiceStatus,
  createSupplierPayment,
  deleteSupplierPayment,
} from 'wasp/client/operations';
import { Modal, useConfirm, IconBtn } from '../../client/ui';
import { formatCurrency, formatDate, formatDateForInput } from '../../shared/format';
import {
  INVOICE_DISPLAY_STATUS,
  invoiceDisplayStatus,
  invoiceBalance,
  computeTaxes,
  type InvoiceDisplayStatus,
} from '../../shared/supplier';
import { PAYMENT_METHOD_OPTIONS, PAYMENT_METHODS } from '../payments/PaymentForm';

export type SupplierInvoiceRow = {
  id: string;
  supplierId: string;
  number: string | null;
  description: string | null;
  issueDate: string | Date;
  dueDate: string | Date | null;
  subtotal: number;
  taxGst: number;
  taxQst: number;
  total: number;
  amountPaid: number;
  status: string;
  rejectionReason: string | null;
  source: string;
  fileName: string | null;
  fileUrl: string | null;
  supplierNote: string | null;
  notes: string | null;
  payments: { id: string; amount: number; method: string; paidAt: string | Date; reference: string | null; notes: string | null }[];
  supplier?: { id: string; name: string; paymentMethod?: string | null };
};

export type SupplierForInvoice = {
  id: string;
  name: string;
  taxNumberGst?: string | null;
  taxNumberQst?: string | null;
  paymentMethod?: string | null;
  paymentTermsDays?: number | null;
};

// ─── Utilitaires ─────────────────────────────────────────────────────────────

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
    reader.readAsDataURL(file);
  });
}

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Aujourd'hui pour un <input type='date'>, au fuseau local et non en UTC. */
export function todayInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function InvoiceStatusBadge({ invoice }: { invoice: Pick<SupplierInvoiceRow, 'status' | 'total' | 'amountPaid' | 'dueDate'> }) {
  const s = INVOICE_DISPLAY_STATUS[invoiceDisplayStatus(invoice)];
  return <span className={s.className} title={s.hint}>{s.label}</span>;
}

/** Barre de progression du paiement : lisible d'un coup d'œil, même sur cellulaire. */
export function PaidBar({ total, amountPaid }: { total: number; amountPaid: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((amountPaid / total) * 100)) : 0;
  return (
    <div className='h-1.5 w-full rounded-full bg-canvas-200 overflow-hidden' title={`${pct} % payé`}>
      <div className={`h-full rounded-full ${pct >= 100 ? 'bg-success' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Saisie d'une facture ────────────────────────────────────────────────────

export function SupplierInvoiceForm({
  supplier,
  invoice,
  onClose,
}: {
  supplier: SupplierForInvoice;
  invoice?: SupplierInvoiceRow;
  onClose: () => void;
}) {
  const registered = !!(supplier.taxNumberGst || supplier.taxNumberQst);
  const [form, setForm] = useState(() => ({
    number: invoice?.number ?? '',
    description: invoice?.description ?? '',
    issueDate: invoice ? formatDateForInput(invoice.issueDate) : todayInput(),
    dueDate: invoice?.dueDate ? formatDateForInput(invoice.dueDate) : '',
    subtotal: invoice ? String(invoice.subtotal) : '',
    taxGst: invoice ? String(invoice.taxGst) : '',
    taxQst: invoice ? String(invoice.taxQst) : '',
    notes: invoice?.notes ?? '',
  }));
  // Taxes calculées tant qu'on ne les a pas touchées à la main.
  const [autoTaxes, setAutoTaxes] = useState(() => (invoice ? false : registered));
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const setSubtotal = (v: string) => {
    const next = { ...form, subtotal: v };
    if (autoTaxes) {
      const t = computeTaxes(parseFloat(v) || 0);
      next.taxGst = t.taxGst ? String(t.taxGst) : '';
      next.taxQst = t.taxQst ? String(t.taxQst) : '';
    }
    setForm(next);
  };

  const toggleAuto = (on: boolean) => {
    setAutoTaxes(on);
    if (on) {
      const t = computeTaxes(parseFloat(form.subtotal) || 0);
      setForm({ ...form, taxGst: String(t.taxGst), taxQst: String(t.taxQst) });
    } else {
      setForm({ ...form, taxGst: '', taxQst: '' });
    }
  };

  const total = (parseFloat(form.subtotal) || 0) + (parseFloat(form.taxGst) || 0) + (parseFloat(form.taxQst) || 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (file && file.size > MAX_UPLOAD_BYTES) { toast.error('Fichier trop volumineux (max 20 Mo)'); return; }
    setSaving(true);
    try {
      const filePayload = file ? { dataUrl: await readFileAsDataUrl(file), name: file.name } : undefined;
      const payload = {
        number: form.number,
        description: form.description,
        issueDate: form.issueDate || null,
        dueDate: form.dueDate || null,
        subtotal: form.subtotal || 0,
        taxGst: form.taxGst || 0,
        taxQst: form.taxQst || 0,
        notes: form.notes,
        file: filePayload,
      };
      if (invoice) {
        await updateSupplierInvoice({ id: invoice.id, ...payload, removeFile: removeFile && !file });
        toast.success('Facture modifiée');
      } else {
        await createSupplierInvoice({ supplierId: supplier.id, ...payload });
        toast.success('Facture ajoutée');
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de l’enregistrement');
    } finally {
      setSaving(false);
    }
  };

  const currentFileName = file?.name ?? (!removeFile ? invoice?.fileName : null);

  return (
    <Modal
      open
      onClose={onClose}
      title={invoice ? 'Modifier la facture' : `Nouvelle facture — ${supplier.name}`}
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='supplier-invoice-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form id='supplier-invoice-form' onSubmit={submit} className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
        <div className='sm:col-span-2'>
          <label className='label'>Pièce jointe (PDF ou photo)</label>
          <input
            ref={fileInput}
            type='file'
            accept='application/pdf,image/*'
            className='hidden'
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRemoveFile(false); }}
          />
          {currentFileName ? (
            <div className='flex items-center gap-2 rounded-lg border border-line bg-canvas-100 px-3 py-2 text-sm'>
              <LuPaperclip size={14} className='text-muted shrink-0' />
              <span className='flex-1 truncate'>{currentFileName}</span>
              <button type='button' className='text-xs text-muted hover:text-ink' onClick={() => fileInput.current?.click()}>Remplacer</button>
              <button type='button' className='text-muted hover:text-danger' title='Retirer' onClick={() => { setFile(null); setRemoveFile(true); if (fileInput.current) fileInput.current.value = ''; }}>
                <LuX size={14} />
              </button>
            </div>
          ) : (
            <button
              type='button'
              onClick={() => fileInput.current?.click()}
              className='w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line px-3 py-4 text-sm text-muted hover:border-ink/30 hover:text-ink transition-colors'
            >
              <LuUpload size={16} /> Choisir un fichier
            </button>
          )}
        </div>

        <div>
          <label className='label'>N° de facture du fournisseur</label>
          <input className='input' value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder='Ex. F-2026-014' />
        </div>
        <div>
          <label className='label'>Date de la facture</label>
          <input type='date' className='input' value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
        </div>
        <div className='sm:col-span-2'>
          <label className='label'>Description</label>
          <input className='input' value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder='Ex. Services de consultation — octobre 2026' />
        </div>
        <div>
          <label className='label'>Montant avant taxes *</label>
          <input type='number' step='0.01' min='0' required className='input' value={form.subtotal} onChange={(e) => setSubtotal(e.target.value)} />
        </div>
        <div>
          <label className='label'>Échéance</label>
          <input type='date' className='input' value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          {!form.dueDate && supplier.paymentTermsDays != null && (
            <p className='text-xs text-muted mt-1'>Vide : {supplier.paymentTermsDays} jours après la date de facture.</p>
          )}
        </div>

        <div className='sm:col-span-2 rounded-lg border border-line p-3 space-y-3'>
          <label className='flex items-center gap-2 text-sm cursor-pointer'>
            <input type='checkbox' className='accent-ink' checked={autoTaxes} onChange={(e) => toggleAuto(e.target.checked)} />
            Calculer la TPS (5 %) et la TVQ (9,975 %)
          </label>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='block text-xs text-muted mb-1'>TPS</label>
              <input type='number' step='0.01' min='0' className='input' value={form.taxGst} onChange={(e) => { setAutoTaxes(false); setForm({ ...form, taxGst: e.target.value }); }} />
            </div>
            <div>
              <label className='block text-xs text-muted mb-1'>TVQ</label>
              <input type='number' step='0.01' min='0' className='input' value={form.taxQst} onChange={(e) => { setAutoTaxes(false); setForm({ ...form, taxQst: e.target.value }); }} />
            </div>
          </div>
          <div className='flex items-center justify-between text-sm pt-1 border-t border-line'>
            <span className='text-muted'>Total</span>
            <span className='font-semibold text-ink'>{formatCurrency(total)}</span>
          </div>
        </div>

        <div className='sm:col-span-2'>
          <label className='label'>Notes internes</label>
          <textarea className='input' rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder='Jamais visibles par le fournisseur' />
        </div>
      </form>
    </Modal>
  );
}

// ─── Paiement ────────────────────────────────────────────────────────────────

export function SupplierPaymentModal({
  invoice,
  defaultMethod,
  onClose,
}: {
  invoice: SupplierInvoiceRow;
  defaultMethod?: string | null;
  onClose: () => void;
}) {
  const balance = invoiceBalance(invoice);
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState(defaultMethod || 'virement');
  const [paidAt, setPaidAt] = useState(todayInput());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) { toast.error('Montant invalide'); return; }
    setSaving(true);
    try {
      await createSupplierPayment({ invoiceId: invoice.id, amount: parsed, method, paidAt, reference, notes });
      toast.success(parsed + 0.005 >= balance ? 'Facture payée en entier' : 'Paiement partiel enregistré');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de l’enregistrement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size='sm'
      title={`Payer — ${invoice.number ? `facture ${invoice.number}` : 'facture'}`}
      footer={
        <>
          <button className='btn-secondary' onClick={onClose} disabled={saving}>Annuler</button>
          <button className='btn-primary' onClick={submit} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer le paiement'}</button>
        </>
      }
    >
      <div className='space-y-4 text-sm'>
        <div className='grid grid-cols-3 gap-2 p-3 bg-canvas rounded-lg text-xs'>
          <div><p className='text-muted'>Total</p><p className='font-medium text-ink'>{formatCurrency(invoice.total)}</p></div>
          <div><p className='text-muted'>Déjà payé</p><p className='font-medium text-ink'>{formatCurrency(invoice.amountPaid)}</p></div>
          <div><p className='text-muted'>Solde</p><p className='font-semibold text-ink'>{formatCurrency(balance)}</p></div>
        </div>
        <div>
          <label className='block text-xs text-muted mb-1'>Montant payé *</label>
          <input type='number' step='0.01' min='0.01' max={balance} className='input' value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          <div className='flex gap-2 mt-2'>
            <button type='button' className='btn-secondary px-2 py-1 text-xs' onClick={() => setAmount(String(balance))}>Solde complet</button>
            <button type='button' className='btn-secondary px-2 py-1 text-xs' onClick={() => setAmount(String(Math.round(balance * 50) / 100))}>La moitié</button>
          </div>
        </div>
        <div className='grid grid-cols-2 gap-3'>
          <div>
            <label className='block text-xs text-muted mb-1'>Méthode</label>
            <select className='input' value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHOD_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className='block text-xs text-muted mb-1'>Date</label>
            <input type='date' className='input' value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
        </div>
        <div>
          <label className='block text-xs text-muted mb-1'>Référence (optionnel)</label>
          <input className='input' value={reference} onChange={(e) => setReference(e.target.value)} placeholder='N° de virement, de chèque…' />
        </div>
        <div>
          <label className='block text-xs text-muted mb-1'>Notes (optionnel)</label>
          <textarea className='input' rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

// ─── Détail d'une facture ────────────────────────────────────────────────────

export function SupplierInvoiceDetailModal({
  invoice,
  supplier,
  onClose,
}: {
  invoice: SupplierInvoiceRow;
  supplier: SupplierForInvoice;
  onClose: () => void;
}) {
  const { ask, Dialog } = useConfirm();
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const balance = invoiceBalance(invoice);
  const display = invoiceDisplayStatus(invoice);

  const setStatus = async (status: string, rejectionReason?: string) => {
    try {
      await setSupplierInvoiceStatus({ id: invoice.id, status, rejectionReason });
      toast.success(status === 'approuvee' ? 'Facture approuvée' : status === 'rejetee' ? 'Facture rejetée' : 'Statut mis à jour');
      setRejecting(false);
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const remove = async () => {
    if (!(await ask('Supprimer cette facture ?', { description: 'La pièce jointe et les paiements enregistrés seront supprimés.' }))) return;
    try {
      await deleteSupplierInvoice({ id: invoice.id });
      toast.success('Facture supprimée');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const removePayment = async (id: string) => {
    if (!(await ask('Supprimer ce paiement ?'))) return;
    try {
      await deleteSupplierPayment({ id });
      toast.success('Paiement supprimé');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={invoice.number ? `Facture ${invoice.number}` : 'Facture'}
        headerRight={<InvoiceStatusBadge invoice={invoice} />}
        footer={
          <div className='flex flex-wrap gap-2 justify-end w-full'>
            <button className='btn-danger mr-auto' onClick={remove}><LuTrash2 size={14} /> Supprimer</button>
            <button className='btn-secondary' onClick={() => setEditing(true)}><LuPencil size={14} /> Modifier</button>
            {invoice.status === 'a_approuver' && (
              <>
                <button className='btn-secondary' onClick={() => setRejecting(true)}><LuBan size={14} /> Rejeter</button>
                <button className='btn-secondary' onClick={() => setStatus('approuvee')}><LuCheck size={14} /> Approuver</button>
              </>
            )}
            {invoice.status === 'rejetee' && (
              <button className='btn-secondary' onClick={() => setStatus('a_approuver')}><LuRotateCcw size={14} /> Remettre à approuver</button>
            )}
            {invoice.status !== 'rejetee' && balance > 0 && (
              <button className='btn-primary' onClick={() => setPaying(true)}><LuWallet size={14} /> Enregistrer un paiement</button>
            )}
          </div>
        }
      >
        <div className='space-y-5 text-sm'>
          {invoice.supplier && (
            <p className='text-muted'>
              Fournisseur : <Link className='font-medium text-ink hover:underline' to={`/fournisseurs/${invoice.supplier.id}?tab=factures`}>{invoice.supplier.name}</Link>
            </p>
          )}

          <div className='grid grid-cols-3 gap-2 p-3 bg-canvas rounded-lg'>
            <div><p className='text-xs text-muted'>Total</p><p className='font-semibold text-ink'>{formatCurrency(invoice.total)}</p></div>
            <div><p className='text-xs text-muted'>Payé</p><p className='font-semibold text-ink'>{formatCurrency(invoice.amountPaid)}</p></div>
            <div><p className='text-xs text-muted'>Solde</p><p className={`font-semibold ${display === 'en_retard' ? 'text-danger' : 'text-ink'}`}>{formatCurrency(balance)}</p></div>
            <div className='col-span-3'><PaidBar total={invoice.total} amountPaid={invoice.amountPaid} /></div>
          </div>

          <dl className='grid grid-cols-2 gap-x-6 gap-y-2'>
            <dt className='text-muted'>Date</dt><dd className='text-ink'>{formatDate(invoice.issueDate)}</dd>
            <dt className='text-muted'>Échéance</dt><dd className='text-ink'>{invoice.dueDate ? formatDate(invoice.dueDate) : '—'}</dd>
            <dt className='text-muted'>Sous-total</dt><dd className='text-ink'>{formatCurrency(invoice.subtotal)}</dd>
            <dt className='text-muted'>TPS / TVQ</dt><dd className='text-ink'>{formatCurrency(invoice.taxGst)} / {formatCurrency(invoice.taxQst)}</dd>
            <dt className='text-muted'>Reçue par</dt><dd className='text-ink'>{invoice.source === 'portail' ? 'Portail fournisseur' : 'Saisie interne'}</dd>
          </dl>

          {invoice.description && <p className='text-ink'>{invoice.description}</p>}

          {invoice.fileUrl && (
            <a href={invoice.fileUrl} target='_blank' rel='noreferrer' className='flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 hover:bg-canvas-100 transition-colors'>
              <LuPaperclip size={15} className='text-muted shrink-0' />
              <span className='flex-1 truncate font-medium'>{invoice.fileName || 'Pièce jointe'}</span>
              <LuExternalLink size={14} className='text-muted shrink-0' />
            </a>
          )}

          {invoice.supplierNote && (
            <div className='rounded-lg bg-sky-50 border border-sky-100 px-3 py-2'>
              <p className='text-xs text-sky-700 font-medium mb-0.5'>Message du fournisseur</p>
              <p className='text-ink whitespace-pre-wrap'>{invoice.supplierNote}</p>
            </div>
          )}
          {invoice.status === 'rejetee' && invoice.rejectionReason && (
            <div className='rounded-lg bg-red-50 border border-red-100 px-3 py-2'>
              <p className='text-xs text-red-700 font-medium mb-0.5'>Motif du rejet (visible par le fournisseur)</p>
              <p className='text-ink whitespace-pre-wrap'>{invoice.rejectionReason}</p>
            </div>
          )}
          {invoice.notes && (
            <div className='rounded-lg bg-amber-50 border border-amber-100 px-3 py-2'>
              <p className='text-xs text-amber-700 font-medium mb-0.5'>Notes internes</p>
              <p className='text-ink whitespace-pre-wrap'>{invoice.notes}</p>
            </div>
          )}

          {rejecting && (
            <div className='rounded-lg border border-line p-3 space-y-2'>
              <label className='label'>Motif du rejet (le fournisseur le verra dans son portail)</label>
              <textarea className='input' rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder='Ex. Heures non conformes à l’entente, merci de corriger.' autoFocus />
              <div className='flex justify-end gap-2'>
                <button className='btn-secondary text-xs' onClick={() => setRejecting(false)}>Annuler</button>
                <button className='btn-danger text-xs' onClick={() => setStatus('rejetee', reason)}>Rejeter la facture</button>
              </div>
            </div>
          )}

          <div>
            <h3 className='text-xs font-semibold uppercase tracking-wide text-muted mb-2'>Paiements ({invoice.payments.length})</h3>
            {invoice.payments.length === 0 ? (
              <p className='text-muted'>Aucun paiement enregistré.</p>
            ) : (
              <ul className='divide-y divide-line rounded-lg border border-line'>
                {invoice.payments.map((p) => (
                  <li key={p.id} className='flex items-center gap-3 px-3 py-2'>
                    <div className='flex-1 min-w-0'>
                      <p className='font-medium text-ink'>{formatCurrency(p.amount)} <span className='text-muted font-normal'>· {PAYMENT_METHODS[p.method] || p.method}</span></p>
                      <p className='text-xs text-muted truncate'>{formatDate(p.paidAt)}{p.reference ? ` · ${p.reference}` : ''}{p.notes ? ` · ${p.notes}` : ''}</p>
                    </div>
                    <IconBtn variant='danger' title='Supprimer ce paiement' onClick={() => removePayment(p.id)}><LuTrash2 size={14} /></IconBtn>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>
      {paying && <SupplierPaymentModal invoice={invoice} defaultMethod={supplier.paymentMethod} onClose={() => setPaying(false)} />}
      {editing && <SupplierInvoiceForm supplier={supplier} invoice={invoice} onClose={() => setEditing(false)} />}
      {Dialog}
    </>
  );
}

// ─── Liste ───────────────────────────────────────────────────────────────────

const FILTERS: { id: 'all' | 'unpaid' | InvoiceDisplayStatus; label: string }[] = [
  { id: 'unpaid', label: 'À régler' },
  { id: 'a_approuver', label: 'À approuver' },
  { id: 'en_retard', label: 'En retard' },
  { id: 'partielle', label: 'Partielles' },
  { id: 'payee', label: 'Payées' },
  { id: 'rejetee', label: 'Rejetées' },
  { id: 'all', label: 'Toutes' },
];

const UNPAID: InvoiceDisplayStatus[] = ['a_approuver', 'a_payer', 'en_retard', 'partielle'];

/**
 * Factures en tableau sur grand écran, en cartes sur cellulaire. `suppliers`
 * fournit la fiche utile au détail (méthode de paiement, taxes) quand la liste
 * mélange plusieurs fournisseurs.
 */
export function SupplierInvoiceList({
  invoices,
  suppliers,
  showSupplier = false,
  defaultFilter = 'unpaid',
  emptyMessage,
}: {
  invoices: SupplierInvoiceRow[];
  suppliers: Record<string, SupplierForInvoice>;
  showSupplier?: boolean;
  defaultFilter?: (typeof FILTERS)[number]['id'];
  emptyMessage: string;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>(defaultFilter);
  const [openId, setOpenId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const withStatus = useMemo(() => invoices.map((i) => ({ ...i, display: invoiceDisplayStatus(i) })), [invoices]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: withStatus.length, unpaid: 0 };
    for (const i of withStatus) {
      c[i.display] = (c[i.display] ?? 0) + 1;
      if (UNPAID.includes(i.display)) c.unpaid++;
    }
    return c;
  }, [withStatus]);

  const q = search.trim().toLowerCase();
  const filtered = withStatus.filter((i) => {
    if (filter === 'unpaid' ? !UNPAID.includes(i.display) : filter !== 'all' && i.display !== filter) return false;
    if (q && ![i.number, i.description, i.supplier?.name].some((v) => (v || '').toLowerCase().includes(q))) return false;
    return true;
  });
  const filteredBalance = filtered.filter((i) => i.status === 'approuvee').reduce((s, i) => s + invoiceBalance(i), 0);

  const open = withStatus.find((i) => i.id === openId);
  const paying = withStatus.find((i) => i.id === payingId);
  const supplierOf = (i: SupplierInvoiceRow) => suppliers[i.supplierId] ?? { id: i.supplierId, name: i.supplier?.name ?? '' };

  return (
    <>
      <div className='flex gap-1.5 overflow-x-auto pb-1 mb-3 -mx-1 px-1'>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
              filter === f.id ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line hover:bg-canvas-200'
            }`}
          >
            {f.label}
            {!!counts[f.id] && <span className={`ml-1.5 ${filter === f.id ? 'text-white/70' : 'text-muted'}`}>{counts[f.id]}</span>}
          </button>
        ))}
      </div>

      <div className='flex flex-col sm:flex-row sm:items-center gap-2 mb-4'>
        <input className='input sm:max-w-xs' placeholder='Rechercher (n°, description, fournisseur)…' value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className='text-sm text-muted sm:ml-auto'>
          {filtered.length} facture(s){filteredBalance > 0 && <> · solde approuvé <span className='font-semibold text-ink'>{formatCurrency(filteredBalance)}</span></>}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className='card p-8 text-center text-sm text-muted'>{invoices.length === 0 ? emptyMessage : 'Aucune facture ne correspond à ce filtre.'}</div>
      ) : (
        <>
          {/* Cellulaire */}
          <div className='md:hidden space-y-2'>
            {filtered.map((i) => (
              <button key={i.id} onClick={() => setOpenId(i.id)} className='card w-full text-left p-4 space-y-2 active:bg-canvas-100'>
                <div className='flex items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    {showSupplier && <p className='text-xs text-muted truncate'>{i.supplier?.name}</p>}
                    <p className='font-medium text-ink truncate'>{i.number ? `N° ${i.number}` : i.description || 'Facture'}</p>
                    <p className='text-xs text-muted'>{formatDate(i.issueDate)}{i.dueDate ? ` · échéance ${formatDate(i.dueDate)}` : ''}</p>
                  </div>
                  <InvoiceStatusBadge invoice={i} />
                </div>
                <div className='flex items-center justify-between text-sm'>
                  <span className='text-muted'>Payé {formatCurrency(i.amountPaid)} / {formatCurrency(i.total)}</span>
                  {i.fileUrl && <LuPaperclip size={14} className='text-muted' />}
                </div>
                <PaidBar total={i.total} amountPaid={i.amountPaid} />
              </button>
            ))}
          </div>

          {/* Grand écran */}
          <div className='table-wrap hidden md:block'>
            <table>
              <thead>
                <tr>
                  {showSupplier && <th>Fournisseur</th>}
                  <th>Facture</th>
                  <th>Date</th>
                  <th>Échéance</th>
                  <th className='text-right'>Total</th>
                  <th className='w-40'>Payé</th>
                  <th>Statut</th>
                  <th className='text-right'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.id} className='cursor-pointer' onClick={() => setOpenId(i.id)}>
                    {showSupplier && <td className='font-medium'>{i.supplier?.name}</td>}
                    <td>
                      <div className='flex items-center gap-1.5'>
                        <span className={showSupplier ? 'text-ink' : 'font-medium text-ink'}>{i.number ? `N° ${i.number}` : '—'}</span>
                        {i.fileUrl && <LuPaperclip size={12} className='text-muted' />}
                        {i.source === 'portail' && <span className='badge-neutral'>Portail</span>}
                      </div>
                      {i.description && <p className='text-xs text-muted truncate max-w-xs'>{i.description}</p>}
                    </td>
                    <td className='text-muted whitespace-nowrap'>{formatDate(i.issueDate)}</td>
                    <td className={`whitespace-nowrap ${i.display === 'en_retard' ? 'text-danger font-medium' : 'text-muted'}`}>{i.dueDate ? formatDate(i.dueDate) : '—'}</td>
                    <td className='text-right font-medium whitespace-nowrap'>{formatCurrency(i.total)}</td>
                    <td>
                      <p className='text-xs text-muted mb-1'>{formatCurrency(i.amountPaid)}</p>
                      <PaidBar total={i.total} amountPaid={i.amountPaid} />
                    </td>
                    <td><InvoiceStatusBadge invoice={i} /></td>
                    <td className='text-right' onClick={(e) => e.stopPropagation()}>
                      {i.status !== 'rejetee' && invoiceBalance(i) > 0 && (
                        <IconBtn title='Enregistrer un paiement' onClick={() => setPayingId(i.id)}><LuWallet size={16} /></IconBtn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {open && <SupplierInvoiceDetailModal invoice={open} supplier={supplierOf(open)} onClose={() => setOpenId(null)} />}
      {paying && <SupplierPaymentModal invoice={paying} defaultMethod={supplierOf(paying).paymentMethod} onClose={() => setPayingId(null)} />}
    </>
  );
}

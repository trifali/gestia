import { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import { createPayment, updatePayment } from 'wasp/client/operations';
import { Modal } from '../../client/ui';
import { MagicTextarea } from '../../client/magic';
import { formatCurrency, formatDateForInput } from '../../shared/format';

/** All supported payment methods (matches modality settings options). */
export const PAYMENT_METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'interac', label: 'Interac' },
  { value: 'virement', label: 'Virement bancaire' },
  { value: 'stripe', label: 'Carte de crédit (Stripe)' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'cash', label: 'Argent comptant' },
  { value: 'financement', label: 'Financement' },
  { value: 'autre', label: 'Autre' },
];

/** Fast label lookup — used in table display. */
export const PAYMENT_METHODS: Record<string, string> = Object.fromEntries(
  PAYMENT_METHOD_OPTIONS.map(({ value, label }) => [value, label])
);

export type InvoiceLite = {
  id: string;
  number: string;
  total: number;
  amountPaid: number;
  status?: string;
  client?: { name?: string } | null;
};

export type PaymentLite = {
  id: string;
  documentId: string;
  amount: number;
  method: string;
  paidAt: string | Date;
  reference?: string | null;
  notes?: string | null;
};

export function PaymentForm({
  payment,
  invoices,
  defaultDocumentId,
  lockDocument = false,
  availableMethods,
  onClose,
}: {
  payment?: PaymentLite;
  invoices: InvoiceLite[];
  defaultDocumentId?: string;
  lockDocument?: boolean;
  /** Keys enabled in company modalities. Falls back to all methods if empty/undefined. */
  availableMethods?: string[];
  onClose: () => void;
}) {
  const methodOptions =
    availableMethods && availableMethods.length > 0
      ? PAYMENT_METHOD_OPTIONS.filter((o) => availableMethods.includes(o.value))
      : PAYMENT_METHOD_OPTIONS;
  const isEdit = !!payment;

  // All non-cancelled invoices are selectable (multiple payments per bill is allowed).
  // For edit, also include current invoice even if cancelled.
  const selectable = invoices.filter(
    (i) => i.status !== 'annulee' || (isEdit && i.id === payment!.documentId)
  );

  const initialDocId = payment?.documentId || defaultDocumentId || selectable[0]?.id || '';
  const [documentId, setDocumentId] = useState(initialDocId);
  const selected = invoices.find((i) => i.id === documentId);
  // Remaining balance: add back current payment amount when editing the same invoice
  const remaining = selected
    ? +(selected.total - selected.amountPaid + (isEdit && payment!.documentId === selected.id ? payment!.amount : 0)).toFixed(2)
    : 0;

  const [amount, setAmount] = useState(
    payment ? payment.amount.toString() : remaining.toString()
  );
  const [method, setMethod] = useState(() => {
    if (payment?.method) return payment.method;
    const opts = availableMethods && availableMethods.length > 0
      ? PAYMENT_METHOD_OPTIONS.filter((o) => availableMethods.includes(o.value))
      : PAYMENT_METHOD_OPTIONS;
    return opts[0]?.value || 'virement';
  });
  const [paidAt, setPaidAt] = useState(formatDateForInput(payment?.paidAt || new Date()));
  const [reference, setReference] = useState(payment?.reference || '');
  const [notes, setNotes] = useState(payment?.notes || '');
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!documentId) return;
    setSaving(true);
    try {
      const payload = {
        documentId,
        amount: parseFloat(amount),
        method,
        paidAt,
        reference,
        notes,
      };
      if (isEdit) {
        await updatePayment({ id: payment!.id, ...payload });
        toast.success('Paiement modifié');
      } else {
        await createPayment(payload);
        toast.success('Paiement enregistré');
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Une erreur est survenue');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Modifier le paiement' : 'Enregistrer un paiement'}
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='payment-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form id='payment-form' onSubmit={onSubmit} className='space-y-4'>
        <div>
          <label className='label'>Facture *</label>
          {lockDocument ? (
            <input className='input bg-canvas' disabled value={
              selected ? `${selected.number}${selected.client?.name ? ` — ${selected.client.name}` : ''}` : '—'
            } />
          ) : (
            <InvoiceCombobox
              invoices={selectable}
              value={documentId}
              onChange={(id, inv) => {
                setDocumentId(id);
                if (inv && !isEdit) setAmount((+(inv.total - inv.amountPaid).toFixed(2)).toString());
              }}
            />
          )}
        </div>
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <div>
            <label className='label'>Montant (CAD) *</label>
            <input type='number' step='0.01' className='input' required value={amount} onChange={(e) => setAmount(e.target.value)} />
            {selected && <p className='text-xs text-muted mt-1'>Solde restant : {formatCurrency(remaining)}</p>}
          </div>
          <div>
            <label className='label'>Date du paiement *</label>
            <input type='date' className='input' required value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
          <div>
            <label className='label'>Méthode</label>
            <select className='input' value={method} onChange={(e) => setMethod(e.target.value)}>
              {methodOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className='label'>Référence</label>
            <input className='input' value={reference} onChange={(e) => setReference(e.target.value)} placeholder='Ex. # transaction' />
          </div>
          <div className='col-span-2'>
            <label className='label'>Notes</label>
            <MagicTextarea className='input' rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ─── Searchable invoice combobox ──────────────────────────────────────────────

function InvoiceCombobox({
  invoices,
  value,
  onChange,
}: {
  invoices: InvoiceLite[];
  value: string;
  onChange: (id: string, invoice: InvoiceLite | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = invoices.find((i) => i.id === value);

  const filtered = search.trim()
    ? invoices.filter((i) => {
        const q = search.toLowerCase();
        return (
          i.number.toLowerCase().includes(q) ||
          (i.client?.name || '').toLowerCase().includes(q)
        );
      })
    : invoices;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (inv: InvoiceLite) => {
    onChange(inv.id, inv);
    setOpen(false);
    setSearch('');
  };

  const label = selected
    ? `${selected.number}${selected.client?.name ? ` — ${selected.client.name}` : ''}`
    : '— Sélectionner —';

  return (
    <div ref={containerRef} className='relative'>
      {/* Trigger button */}
      <button
        type='button'
        className='input text-left flex items-center justify-between gap-2 w-full'
        onClick={() => {
          setOpen((v) => !v);
          if (!open) setTimeout(() => inputRef.current?.focus(), 50);
        }}
      >
        <span className={selected ? 'text-ink' : 'text-muted'}>{label}</span>
        <svg className='w-4 h-4 text-muted shrink-0' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
          <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M19 9l-7 7-7-7' />
        </svg>
      </button>

      {open && (
        <div className='absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden'>
          {/* Search input */}
          <div className='p-2 border-b border-gray-100'>
            <input
              ref={inputRef}
              className='input py-1.5 text-sm w-full'
              placeholder='Rechercher par n° facture ou client…'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Option list */}
          <ul className='max-h-52 overflow-y-auto'>
            {filtered.length === 0 ? (
              <li className='px-3 py-2 text-sm text-muted'>Aucun résultat</li>
            ) : (
              filtered.map((i) => {
                const balance = i.total - i.amountPaid;
                const isSelected = i.id === value;
                return (
                  <li
                    key={i.id}
                    onMouseDown={(e) => { e.preventDefault(); select(i); }}
                    className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between gap-3 hover:bg-canvas ${isSelected ? 'bg-accent/10 text-accent font-medium' : 'text-ink'}`}
                  >
                    <span>
                      <span className='font-mono'>{i.number}</span>
                      {i.client?.name && <span className='text-muted ml-2'>{i.client.name}</span>}
                    </span>
                    <span className='text-xs text-muted whitespace-nowrap'>
                      solde {formatCurrency(balance)}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

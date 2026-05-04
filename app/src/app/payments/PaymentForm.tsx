import { useState } from 'react';
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
  // For new payments only show open invoices; for edits, also include current
  // doc even if already fully paid so it remains selectable.
  const open = invoices.filter((i) => i.status !== 'payee' && i.status !== 'annulee');
  const selectable = isEdit
    ? Array.from(new Map([...open, ...invoices.filter((i) => i.id === payment!.documentId)].map((i) => [i.id, i])).values())
    : open;

  const initialDocId = payment?.documentId || defaultDocumentId || selectable[0]?.id || '';
  const [documentId, setDocumentId] = useState(initialDocId);
  const selected = invoices.find((i) => i.id === documentId);
  const remaining = selected ? +(selected.total - selected.amountPaid + (payment?.documentId === selected.id ? payment.amount : 0)).toFixed(2) : 0;

  const [amount, setAmount] = useState(
    payment ? payment.amount.toString() : remaining.toString()
  );
  const [method, setMethod] = useState(() => {
    if (payment?.method) return payment.method;
    // default to first available method
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
          <select
            className='input'
            required
            disabled={lockDocument}
            value={documentId}
            onChange={(e) => {
              setDocumentId(e.target.value);
              const inv = invoices.find((i) => i.id === e.target.value);
              if (inv && !isEdit) {
                setAmount((+(inv.total - inv.amountPaid).toFixed(2)).toString());
              }
            }}
          >
            <option value=''>— Sélectionner —</option>
            {selectable.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number}{i.client?.name ? ` — ${i.client.name}` : ''} (solde {formatCurrency(i.total - i.amountPaid)})
              </option>
            ))}
          </select>
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

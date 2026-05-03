import { useState } from 'react';
import toast from 'react-hot-toast';
import { createPayment } from 'wasp/client/operations';
import { Modal } from '../../client/ui';
import { formatCurrency } from '../../shared/format';

type Props = {
  doc: {
    id: string;
    number: string;
    total: number;
    amountPaid: number;
  };
  /**
   * 'deposit' pre-fills the amount with 30% of the total (rounded to 2 dp),
   * 'final' pre-fills with the remaining balance.
   */
  preset?: 'deposit' | 'final';
  onClose: () => void;
};

const METHODS: { value: string; label: string }[] = [
  { value: 'virement', label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'comptant', label: 'Comptant' },
  { value: 'carte', label: 'Carte' },
  { value: 'autre', label: 'Autre' },
];

export function PaymentModal({ doc, preset, onClose }: Props) {
  const balance = +(doc.total - doc.amountPaid).toFixed(2);
  const defaultAmount =
    preset === 'deposit'
      ? +(doc.total * 0.3).toFixed(2)
      : preset === 'final'
        ? balance
        : balance;
  const [amount, setAmount] = useState<string>(String(defaultAmount));
  const [method, setMethod] = useState('virement');
  const [paidAt, setPaidAt] = useState<string>(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) {
      toast.error('Montant invalide');
      return;
    }
    setSaving(true);
    try {
      await createPayment({
        documentId: doc.id,
        amount: parsed,
        method,
        paidAt,
        reference: reference || undefined,
        notes: notes || undefined,
      });
      toast.success('Paiement enregistré');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  const title =
    preset === 'deposit'
      ? `Acompte — Facture ${doc.number}`
      : preset === 'final'
        ? `Solde final — Facture ${doc.number}`
        : `Enregistrer un paiement — Facture ${doc.number}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className='btn-secondary' onClick={onClose} disabled={saving}>
            Annuler
          </button>
          <button className='btn-primary' onClick={submit} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <div className='space-y-4 text-sm'>
        <div className='grid grid-cols-2 gap-3 p-3 bg-canvas rounded-lg text-xs'>
          <div>
            <p className='text-muted'>Total facture</p>
            <p className='font-medium text-ink'>{formatCurrency(doc.total)}</p>
          </div>
          <div>
            <p className='text-muted'>Solde restant</p>
            <p className='font-medium text-ink'>{formatCurrency(balance)}</p>
          </div>
        </div>

        <div>
          <label className='block text-xs text-muted mb-1'>Montant *</label>
          <input
            type='number'
            step='0.01'
            min='0.01'
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className='input w-full'
            autoFocus
          />
          {preset === 'deposit' && (
            <p className='text-xs text-muted mt-1'>Pré-rempli à 30 % du total (acompte typique).</p>
          )}
        </div>

        <div className='grid grid-cols-2 gap-3'>
          <div>
            <label className='block text-xs text-muted mb-1'>Méthode</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className='input w-full'
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className='block text-xs text-muted mb-1'>Date</label>
            <input
              type='date'
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className='input w-full'
            />
          </div>
        </div>

        <div>
          <label className='block text-xs text-muted mb-1'>Référence (optionnel)</label>
          <input
            type='text'
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder='N° de chèque, transaction…'
            className='input w-full'
          />
        </div>

        <div>
          <label className='block text-xs text-muted mb-1'>Notes (optionnel)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className='input w-full'
          />
        </div>
      </div>
    </Modal>
  );
}

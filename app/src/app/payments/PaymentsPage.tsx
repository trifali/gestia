import { useState } from 'react';
import {
  useQuery,
  getPayments,
  getInvoices,
  createPayment,
  deletePayment,
} from 'wasp/client/operations';
import { PageHeader, EmptyState, Modal } from '../../client/ui';
import { formatCurrency, formatDate, formatDateForInput } from '../../shared/format';

const METHODS: Record<string, string> = {
  virement: 'Virement bancaire',
  carte: 'Carte de crédit',
  cheque: 'Chèque',
  comptant: 'Comptant',
  autre: 'Autre',
};

export default function PaymentsPage() {
  const { data: payments, isLoading } = useQuery(getPayments);
  const { data: invoices } = useQuery(getInvoices);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title='Paiements'
        subtitle='Enregistrez les paiements reçus et suivez vos encaissements.'
        actions={<button className='btn-primary' onClick={() => setCreating(true)}>Enregistrer un paiement</button>}
      />

      {isLoading ? (
        <div className='text-muted'>Chargement…</div>
      ) : !payments || payments.length === 0 ? (
        <EmptyState
          title='Aucun paiement'
          description='Enregistrez votre premier paiement reçu.'
          action={<button className='btn-primary' onClick={() => setCreating(true)}>Enregistrer un paiement</button>}
        />
      ) : (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Facture</th>
                <th>Client</th>
                <th>Méthode</th>
                <th>Référence</th>
                <th className='text-right'>Montant</th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p: any) => (
                <tr key={p.id}>
                  <td className='text-muted'>{formatDate(p.paidAt)}</td>
                  <td className='font-mono text-xs'>{p.invoice.number}</td>
                  <td>{p.invoice.client.name}</td>
                  <td className='text-muted'>{METHODS[p.method] || p.method}</td>
                  <td className='text-muted'>{p.reference || '—'}</td>
                  <td className='text-right font-medium'>{formatCurrency(p.amount)}</td>
                  <td className='text-right'>
                    <button
                      className='btn-ghost text-xs text-danger'
                      onClick={async () => {
                        if (confirm('Supprimer ce paiement ?')) {
                          await deletePayment({ id: p.id });
                        }
                      }}
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <PaymentForm invoices={invoices || []} onClose={() => setCreating(false)} />
      )}
    </>
  );
}

function PaymentForm({ invoices, onClose }: { invoices: any[]; onClose: () => void }) {
  const open = invoices.filter((i: any) => i.status !== 'payee' && i.status !== 'annulee');
  const [invoiceId, setInvoiceId] = useState(open[0]?.id || '');
  const selected = invoices.find((i: any) => i.id === invoiceId);
  const balance = selected ? +(selected.total - selected.amountPaid).toFixed(2) : 0;
  const [amount, setAmount] = useState(balance.toString());
  const [method, setMethod] = useState('virement');
  const [paidAt, setPaidAt] = useState(formatDateForInput(new Date()));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceId) return;
    setSaving(true);
    try {
      await createPayment({
        invoiceId,
        amount: parseFloat(amount),
        method,
        paidAt,
        reference,
        notes,
      });
      onClose();
    } catch (err: any) {
      alert(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title='Enregistrer un paiement'
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
            className='input' required
            value={invoiceId}
            onChange={(e) => {
              setInvoiceId(e.target.value);
              const inv = invoices.find((i: any) => i.id === e.target.value);
              if (inv) setAmount((+(inv.total - inv.amountPaid).toFixed(2)).toString());
            }}
          >
            <option value=''>— Sélectionner —</option>
            {open.map((i: any) => (
              <option key={i.id} value={i.id}>
                {i.number} — {i.client.name} (solde {formatCurrency(i.total - i.amountPaid)})
              </option>
            ))}
          </select>
        </div>
        <div className='grid grid-cols-2 gap-4'>
          <div>
            <label className='label'>Montant (CAD) *</label>
            <input type='number' step='0.01' className='input' required value={amount} onChange={(e) => setAmount(e.target.value)} />
            {selected && <p className='text-xs text-muted mt-1'>Solde actuel : {formatCurrency(balance)}</p>}
          </div>
          <div>
            <label className='label'>Date du paiement *</label>
            <input type='date' className='input' required value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
          <div>
            <label className='label'>Méthode</label>
            <select className='input' value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className='label'>Référence</label>
            <input className='input' value={reference} onChange={(e) => setReference(e.target.value)} placeholder='Ex. # transaction' />
          </div>
          <div className='col-span-2'>
            <label className='label'>Notes</label>
            <textarea className='input' rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </form>
    </Modal>
  );
}

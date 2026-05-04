import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { LuPencil } from 'react-icons/lu';
import { useQuery, deletePayment, getCurrentCompany } from 'wasp/client/operations';
import { IconBtn, TrashIcon, useConfirm } from '../../client/ui';
import { formatCurrency, formatDate } from '../../shared/format';
import { PaymentForm, PAYMENT_METHODS } from './PaymentForm';
import type { InvoiceLite, PaymentLite } from './PaymentForm';

export type PaymentRow = PaymentLite & {
  document: {
    id: string;
    number: string;
    total: number;
    subtotal: number;
    taxGst: number;
    taxQst: number;
    client?: { name?: string } | null;
  };
};

/**
 * Allocate a payment proportionally to subtotal / GST / QST based on the
 * underlying invoice's totals — gives a useful approximation of "how much
 * tax you have collected" from partial / multi-payment flows.
 */
function allocate(p: PaymentRow) {
  const total = p.document.total;
  if (!total) return { sub: p.amount, gst: 0, qst: 0 };
  const ratio = p.amount / total;
  return {
    sub: p.document.subtotal * ratio,
    gst: p.document.taxGst * ratio,
    qst: p.document.taxQst * ratio,
  };
}

type Stat = { label: string; value: string; sub?: string };

export function PaymentsSection({
  payments,
  invoices,
  showClientColumn = false,
  scopeLabel,
  emptyMessage,
  defaultDocumentId,
}: {
  payments: PaymentRow[];
  invoices: InvoiceLite[];
  showClientColumn?: boolean;
  scopeLabel?: string;
  emptyMessage?: string;
  defaultDocumentId?: string;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PaymentRow | null>(null);
  const { ask, Dialog: ConfirmDialog } = useConfirm();

  const { data: company } = useQuery(getCurrentCompany);
  const availableMethods: string[] = useMemo(() => {
    try { return JSON.parse((company as any)?.modalityPaymentMethods || '[]'); } catch { return []; }
  }, [(company as any)?.modalityPaymentMethods]);

  const totals = useMemo(() => {
    let total = 0, sub = 0, gst = 0, qst = 0;
    for (const p of payments) {
      total += p.amount;
      const a = allocate(p);
      sub += a.sub;
      gst += a.gst;
      qst += a.qst;
    }
    return { total, sub, gst, qst };
  }, [payments]);

  const stats: Stat[] = [
    { label: 'Total reçu', value: formatCurrency(totals.total), sub: `${payments.length} paiement(s)` },
    { label: 'Sous-total (HT)', value: formatCurrency(totals.sub) },
    { label: 'TPS perçue', value: formatCurrency(totals.gst) },
    { label: 'TVQ perçue', value: formatCurrency(totals.qst) },
  ];

  return (
    <>
      <div className='flex items-center justify-between mb-4 gap-3 flex-wrap'>
        <p className='text-sm text-muted'>
          {scopeLabel || `${payments.length} paiement(s)`}
        </p>
        <button className='btn-primary' onClick={() => setCreating(true)}>
          Enregistrer un paiement
        </button>
      </div>

      {/* Summary cards */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-4 mb-6'>
        {stats.map((s) => (
          <div key={s.label} className='bg-white border border-gray-100 rounded-xl p-4 shadow-sm'>
            <p className='text-xs text-muted uppercase tracking-wide mb-1'>{s.label}</p>
            <p className='text-2xl font-bold text-ink'>{s.value}</p>
            {s.sub && <p className='text-xs text-muted mt-0.5'>{s.sub}</p>}
          </div>
        ))}
      </div>

      {payments.length === 0 ? (
        <p className='text-muted text-sm'>
          {emptyMessage || 'Aucun paiement enregistré.'}
        </p>
      ) : (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Facture</th>
                {showClientColumn && <th>Client</th>}
                <th>Méthode</th>
                <th>Référence</th>
                <th className='text-right'>Montant</th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className='text-muted'>{formatDate(p.paidAt)}</td>
                  <td className='font-mono text-xs'>{p.document.number}</td>
                  {showClientColumn && <td>{p.document.client?.name || '—'}</td>}
                  <td className='text-muted'>{PAYMENT_METHODS[p.method] || p.method}</td>
                  <td className='text-muted'>{p.reference || '—'}</td>
                  <td className='text-right font-medium'>{formatCurrency(p.amount)}</td>
                  <td className='text-right'>
                    <div className='flex items-center justify-end gap-1'>
                      <IconBtn title='Modifier' onClick={() => setEditing(p)}>
                        <LuPencil size={14} />
                      </IconBtn>
                      <IconBtn variant='danger' title='Supprimer' onClick={async () => {
                        if (await ask('Supprimer ce paiement ?')) {
                          try {
                            await deletePayment({ id: p.id });
                            toast.success('Paiement supprimé');
                          } catch (err: any) {
                            toast.error(err?.message || 'Erreur lors de la suppression');
                          }
                        }
                      }}>
                        <TrashIcon />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <PaymentForm
          invoices={invoices}
          defaultDocumentId={defaultDocumentId}
          availableMethods={availableMethods}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <PaymentForm
          payment={editing}
          invoices={invoices}
          availableMethods={availableMethods}
          onClose={() => setEditing(null)}
        />
      )}
      {ConfirmDialog}
    </>
  );
}

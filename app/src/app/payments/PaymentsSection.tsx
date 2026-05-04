import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { LuPencil, LuArrowUpDown, LuArrowUp, LuArrowDown, LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import {
  useQuery,
  deletePayment,
  getCurrentCompany,
  getPayments as getPaymentsOp,
  getDocuments,
} from 'wasp/client/operations';
import { IconBtn, TrashIcon, useConfirm } from '../../client/ui';
import { formatCurrency, formatDate } from '../../shared/format';
import { PaymentForm, PAYMENT_METHODS } from './PaymentForm';
import type { InvoiceLite, PaymentLite } from './PaymentForm';

export type PaymentRow = PaymentLite & {
  document: {
    id: string; number: string; type: string;
    total: number; amountPaid: number;
    subtotal: number; taxGst: number; taxQst: number;
    client?: { name?: string } | null;
  };
};

const PAGE_SIZE = 25;
type SortKey = 'date' | 'amount';

export function PaymentsSection({
  clientId,
  showClientColumn = false,
  emptyMessage,
}: {
  clientId?: string;
  showClientColumn?: boolean;
  emptyMessage?: string;
}) {
  const { ask, Dialog: ConfirmDialog } = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PaymentLite | null>(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterMethod, setFilterMethod] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(1); }, [filterMethod, sortKey, sortDir]);

  const queryArgs = useMemo(() => ({
    search: debouncedSearch || undefined,
    method: filterMethod || undefined,
    sortKey, sortDir, page, pageSize: PAGE_SIZE, clientId,
  }), [debouncedSearch, filterMethod, sortKey, sortDir, page, clientId]);

  const { data: result, isLoading }: { data: any; isLoading: boolean } = useQuery(getPaymentsOp, queryArgs) as any;
  const payments = result?.data ?? [];
  const totalCount = result?.total ?? 0;
  const totals = result?.totals ?? { amount: 0, sub: 0, gst: 0, qst: 0 };
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const { data: docResult }: { data: any } = useQuery(getDocuments, { type: 'invoice', clientId, pageSize: 1000 });
  const invoices: InvoiceLite[] = useMemo(
    () => (docResult?.data ?? []).map((d: any) => ({
      id: d.id, number: d.number, total: d.total, amountPaid: d.amountPaid,
      status: d.status, client: d.client,
    })),
    [docResult],
  );

  const { data: company } = useQuery(getCurrentCompany);
  const availableMethods: string[] = useMemo(() => {
    try { return JSON.parse((company as any)?.modalityPaymentMethods || '[]'); } catch { return []; }
  }, [(company as any)?.modalityPaymentMethods]);
  const methodOptions = availableMethods.length > 0 ? availableMethods : Object.keys(PAYMENT_METHODS);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  }
  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <LuArrowUpDown size={12} className='ml-0.5 text-muted/60 inline' />;
    return sortDir === 'desc'
      ? <LuArrowDown size={12} className='ml-0.5 inline' />
      : <LuArrowUp size={12} className='ml-0.5 inline' />;
  }

  return (
    <>
      {/* Summary cards */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-3 mb-5'>
        {[
          { label: 'Total reçu', value: formatCurrency(totals.amount), sub: `${totalCount} paiement(s)` },
          { label: 'Sous-total (HT)', value: formatCurrency(totals.sub) },
          { label: 'TPS perçue', value: formatCurrency(totals.gst) },
          { label: 'TVQ perçue', value: formatCurrency(totals.qst) },
        ].map((s) => (
          <div key={s.label} className='bg-white border border-gray-100 rounded-xl p-4 shadow-sm'>
            <p className='text-xs text-muted uppercase tracking-wide mb-1'>{s.label}</p>
            <p className='text-2xl font-bold text-ink'>{s.value}</p>
            {s.sub && <p className='text-xs text-muted mt-0.5'>{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className='flex flex-wrap items-center gap-2 mb-4'>
        <input
          type='text'
          className='input h-9 text-sm !w-64 shrink-0'
          placeholder='Rechercher…'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className='input h-9 text-sm !w-auto shrink-0'
          value={filterMethod}
          onChange={(e) => { setFilterMethod(e.target.value); setPage(1); }}
        >
          <option value=''>Toutes les méthodes</option>
          {methodOptions.map((m) => (
            <option key={m} value={m}>{PAYMENT_METHODS[m] || m}</option>
          ))}
        </select>
        <div className='flex-1 min-w-0' />
        <button className='btn-primary h-8 text-sm px-3 whitespace-nowrap shrink-0' onClick={() => setCreating(true)}>
          + Enregistrer un paiement
        </button>
      </div>

      {isLoading ? (
        <p className='text-muted text-sm py-4'>Chargement…</p>
      ) : payments.length === 0 ? (
        <p className='text-muted text-sm py-4'>
          {search || filterMethod ? 'Aucun résultat pour ces filtres.' : (emptyMessage || 'Aucun paiement enregistré.')}
        </p>
      ) : (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th className='cursor-pointer select-none whitespace-nowrap' onClick={() => toggleSort('date')}>
                  Date <SortIcon k='date' />
                </th>
                <th>Facture</th>
                {showClientColumn && <th>Client</th>}
                <th>Méthode</th>
                <th>Référence</th>
                <th className='text-right cursor-pointer select-none whitespace-nowrap' onClick={() => toggleSort('amount')}>
                  Montant <SortIcon k='amount' />
                </th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p: any) => {
                const isQuote = p.document.type !== 'invoice';
                const lockedTitle = 'Ce paiement est lié à un document repassé en soumission — convertissez-le à nouveau en facture pour le modifier.';
                return (
                  <tr key={p.id}>
                    <td className='text-muted whitespace-nowrap'>{formatDate(p.paidAt)}</td>
                    <td>
                      <span className='font-mono text-xs'>{p.document.number}</span>
                      <br />
                      {isQuote
                        ? <span className='text-xs text-warning'>Soumission (repassé)</span>
                        : <span className='text-xs text-muted'>{formatCurrency(p.document.amountPaid)} sur {formatCurrency(p.document.total)} payé</span>
                      }
                    </td>
                    {showClientColumn && <td>{p.document.client?.name || '—'}</td>}
                    <td className='text-muted'>{PAYMENT_METHODS[p.method] || p.method}</td>
                    <td className='text-muted'>{p.reference || '—'}</td>
                    <td className='text-right font-medium whitespace-nowrap'>{formatCurrency(p.amount)}</td>
                    <td className='text-right'>
                      <div className='flex items-center justify-end gap-1'>
                        <IconBtn
                          title={isQuote ? lockedTitle : 'Modifier'}
                          disabled={isQuote}
                          onClick={() => !isQuote && setEditing({
                            id: p.id, documentId: p.documentId, amount: p.amount,
                            method: p.method, paidAt: p.paidAt, reference: p.reference, notes: p.notes,
                          })}
                        >
                          <LuPencil size={14} />
                        </IconBtn>
                        <IconBtn variant='danger'
                          title={isQuote ? lockedTitle : 'Supprimer'}
                          disabled={isQuote}
                          onClick={async () => {
                            if (isQuote) return;
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className='flex items-center justify-center gap-3 mt-4 text-sm text-muted'>
          <button
            className='btn-secondary h-7 w-7 p-0 flex items-center justify-center disabled:opacity-40'
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <LuChevronLeft size={15} />
          </button>
          <span>Page {page} / {totalPages} <span className='text-muted/60'>({totalCount})</span></span>
          <button
            className='btn-secondary h-7 w-7 p-0 flex items-center justify-center disabled:opacity-40'
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <LuChevronRight size={15} />
          </button>
        </div>
      )}

      {creating && (
        <PaymentForm
          invoices={invoices}
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

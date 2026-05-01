import { useState } from 'react';
import {
  useQuery,
  getInvoices,
  getClients,
  getProjects,
  updateInvoiceStatus,
  deleteInvoice,
} from 'wasp/client/operations';
import { PageHeader, EmptyState, useConfirm, IconBtn, TrashIcon } from '../../client/ui';
import { formatCurrency, formatDate } from '../../shared/format';
import { InvoiceForm } from './InvoiceForm';

const STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  envoyee: { label: 'Envoyée', className: 'badge-info' },
  payee: { label: 'Payée', className: 'badge-success' },
  en_retard: { label: 'En retard', className: 'badge-danger' },
  annulee: { label: 'Annulée', className: 'badge-neutral' },
};

export default function InvoicesPage() {
  const { data: invoices, isLoading } = useQuery(getInvoices);
  const { data: clients } = useQuery(getClients);
  const { data: projects } = useQuery(getProjects);
  const [creating, setCreating] = useState(false);
  const { ask, Dialog: ConfirmDialog } = useConfirm();

  return (
    <>
      <PageHeader
        title='Factures'
        subtitle='Émettez vos factures, suivez leur statut et leurs paiements.'
        actions={<button className='btn-primary' onClick={() => setCreating(true)}>Nouvelle facture</button>}
      />

      {isLoading ? (
        <div className='text-muted'>Chargement…</div>
      ) : !invoices || invoices.length === 0 ? (
        <EmptyState
          title='Aucune facture'
          description='Émettez votre première facture pour commencer à être payé.'
          action={<button className='btn-primary' onClick={() => setCreating(true)}>Créer une facture</button>}
        />
      ) : (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Client</th>
                <th>Émise</th>
                <th>Échéance</th>
                <th>Statut</th>
                <th className='text-right'>Total</th>
                <th className='text-right'>Solde</th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv: any) => {
                const balance = +(inv.total - inv.amountPaid).toFixed(2);
                return (
                  <tr key={inv.id}>
                    <td className='font-mono text-xs'>{inv.number}</td>
                    <td className='font-medium'>{inv.client.name}</td>
                    <td className='text-muted'>{formatDate(inv.issueDate)}</td>
                    <td className='text-muted'>{inv.dueDate ? formatDate(inv.dueDate) : '—'}</td>
                    <td>
                      <select
                        className={`text-xs px-2 py-1 rounded-md border-0 cursor-pointer ${STATUS[inv.status]?.className || 'badge-neutral'}`}
                        value={inv.status}
                        onChange={async (e) => { await updateInvoiceStatus({ id: inv.id, status: e.target.value }); }}
                      >
                        {Object.entries(STATUS).map(([key, val]) => (
                          <option key={key} value={key}>{val.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className='text-right font-medium'>{formatCurrency(inv.total)}</td>
                    <td className='text-right'>
                      <span className={balance > 0 ? 'text-danger font-medium' : 'text-success'}>
                        {formatCurrency(balance)}
                      </span>
                    </td>
                    <td className='text-right'>
                      <IconBtn variant='danger' title='Supprimer' onClick={async () => {
                        if (await ask(`Supprimer la facture ${inv.number} ?`)) await deleteInvoice({ id: inv.id });
                      }}><TrashIcon /></IconBtn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <InvoiceForm clients={clients || []} projects={projects || []} onClose={() => setCreating(false)} />
      )}
      {ConfirmDialog}
    </>
  );
}

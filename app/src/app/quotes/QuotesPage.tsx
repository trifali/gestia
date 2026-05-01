import { useState } from 'react';
import {
  useQuery,
  getQuotes,
  getClients,
  getProjects,
  updateQuoteStatus,
  deleteQuote,
} from 'wasp/client/operations';
import { PageHeader, EmptyState, useConfirm, IconBtn, TrashIcon } from '../../client/ui';
import { formatCurrency, formatDate } from '../../shared/format';
import { QuoteForm } from './QuoteForm';

const STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  envoyee: { label: 'Envoyée', className: 'badge-info' },
  acceptee: { label: 'Acceptée', className: 'badge-success' },
  refusee: { label: 'Refusée', className: 'badge-danger' },
  expiree: { label: 'Expirée', className: 'badge-warning' },
};

export default function QuotesPage() {
  const { data: quotes, isLoading } = useQuery(getQuotes);
  const { data: clients } = useQuery(getClients);
  const { data: projects } = useQuery(getProjects);
  const [creating, setCreating] = useState(false);
  const { ask, Dialog: ConfirmDialog } = useConfirm();

  return (
    <>
      <PageHeader
        title='Soumissions'
        subtitle='Préparez et envoyez vos soumissions avec calculs de taxes intégrés.'
        actions={<button className='btn-primary' onClick={() => setCreating(true)}>Nouvelle soumission</button>}
      />

      {isLoading ? (
        <div className='text-muted'>Chargement…</div>
      ) : !quotes || quotes.length === 0 ? (
        <EmptyState
          title='Aucune soumission'
          description='Créez votre première soumission. La TPS (5 %) et la TVQ (9,975 %) seront calculées automatiquement.'
          action={<button className='btn-primary' onClick={() => setCreating(true)}>Créer une soumission</button>}
        />
      ) : (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Titre</th>
                <th>Client</th>
                <th>Émise</th>
                <th>Valide jusqu'au</th>
                <th>Statut</th>
                <th className='text-right'>Total</th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q: any) => (
                <tr key={q.id}>
                  <td className='font-mono text-xs'>{q.number}</td>
                  <td className='font-medium'>{q.title}</td>
                  <td className='text-muted'>{q.client.name}</td>
                  <td className='text-muted'>{formatDate(q.issueDate)}</td>
                  <td className='text-muted'>{q.validUntil ? formatDate(q.validUntil) : '—'}</td>
                  <td>
                    <select
                      className={`text-xs px-2 py-1 rounded-md border-0 cursor-pointer ${STATUS[q.status]?.className || 'badge-neutral'}`}
                      value={q.status}
                      onChange={async (e) => { await updateQuoteStatus({ id: q.id, status: e.target.value }); }}
                    >
                      {Object.entries(STATUS).map(([key, val]) => (
                        <option key={key} value={key}>{val.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className='text-right font-medium'>{formatCurrency(q.total)}</td>
                  <td className='text-right'>
                    <IconBtn variant='danger' title='Supprimer' onClick={async () => {
                      if (await ask(`Supprimer la soumission ${q.number} ?`)) await deleteQuote({ id: q.id });
                    }}><TrashIcon /></IconBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <QuoteForm clients={clients || []} projects={projects || []} onClose={() => setCreating(false)} />
      )}
      {ConfirmDialog}
    </>
  );
}

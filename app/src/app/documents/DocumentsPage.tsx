import { useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { LuFileCheck, LuUndo2, LuPencil } from 'react-icons/lu';
import toast from 'react-hot-toast';
import {
  useQuery,
  getDocuments,
  getClients,
  getProjects,
  updateDocumentStatus,
  setDocumentType,
  deleteDocument,
} from 'wasp/client/operations';
import { PageHeader, EmptyState, useConfirm, IconBtn, TrashIcon } from '../../client/ui';
import { formatCurrency, formatDate } from '../../shared/format';
import { DocumentForm } from '../shared/DocumentForm';

const QUOTE_STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  envoyee: { label: 'Envoyée', className: 'badge-info' },
  acceptee: { label: 'Acceptée', className: 'badge-success' },
  refusee: { label: 'Refusée', className: 'badge-danger' },
  expiree: { label: 'Expirée', className: 'badge-warning' },
};

const INVOICE_STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  envoyee: { label: 'Envoyée', className: 'badge-info' },
  payee: { label: 'Payée', className: 'badge-success' },
  en_retard: { label: 'En retard', className: 'badge-danger' },
  annulee: { label: 'Annulée', className: 'badge-neutral' },
};

type Filter = 'all' | 'quote' | 'invoice';

export default function DocumentsPage() {
  const { search } = useLocation();
  const initial = (new URLSearchParams(search).get('type') as Filter) || 'all';
  const [filter, setFilter] = useState<Filter>(
    initial === 'quote' || initial === 'invoice' ? initial : 'all',
  );

  const { data: documents, isLoading } = useQuery(getDocuments);
  const { data: clients } = useQuery(getClients);
  const { data: projects } = useQuery(getProjects);
  const [creating, setCreating] = useState<{ mode: 'quote' | 'invoice' } | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const { ask, Dialog: ConfirmDialog } = useConfirm();

  const docs = useMemo(() => {
    if (!documents) return [];
    if (filter === 'all') return documents;
    return documents.filter((d: any) => d.type === filter);
  }, [documents, filter]);

  return (
    <>
      <PageHeader
        title='Facturation'
        subtitle='Soumissions et factures regroupées. Convertissez une soumission en facture en un clic.'
        actions={
          <div className='flex gap-2'>
            <button className='btn-secondary' onClick={() => setCreating({ mode: 'quote' })}>
              Nouvelle soumission
            </button>
            <button className='btn-primary' onClick={() => setCreating({ mode: 'invoice' })}>
              Nouvelle facture
            </button>
          </div>
        }
      />

      <div className='inline-flex rounded-lg border border-line p-0.5 bg-canvas mb-4'>
        {([
          { v: 'all', l: 'Tous' },
          { v: 'quote', l: 'Soumissions' },
          { v: 'invoice', l: 'Factures' },
        ] as const).map((opt) => (
          <button
            key={opt.v}
            onClick={() => setFilter(opt.v)}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              filter === opt.v ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            {opt.l}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className='text-muted'>Chargement…</div>
      ) : docs.length === 0 ? (
        <EmptyState
          title={filter === 'invoice' ? 'Aucune facture' : filter === 'quote' ? 'Aucune soumission' : 'Aucune soumission ni facture'}
          description="Créez une soumission ou une facture pour commencer. La TPS (5 %) et la TVQ (9,975 %) sont calculées automatiquement."
          action={<button className='btn-primary' onClick={() => setCreating({ mode: 'quote' })}>Créer une soumission</button>}
        />
      ) : (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Numéro</th>
                <th>Titre</th>
                <th>Client</th>
                <th>Émis</th>
                <th>Statut</th>
                <th className='text-right'>Total</th>
                <th className='text-right'>Solde</th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d: any) => {
                const statusMap = d.type === 'invoice' ? INVOICE_STATUS : QUOTE_STATUS;
                const balance = d.type === 'invoice'
                  ? +(d.total - d.amountPaid).toFixed(2)
                  : null;
                return (
                  <tr key={d.id}>
                    <td>
                      <span className={d.type === 'invoice' ? 'badge-info' : 'badge-neutral'}>
                        {d.type === 'invoice' ? 'Facture' : 'Soumission'}
                      </span>
                    </td>
                    <td className='font-mono text-xs'>{d.number}</td>
                    <td className='font-medium'>{d.title || '—'}</td>
                    <td className='text-muted'>{d.client.name}</td>
                    <td className='text-muted'>{formatDate(d.issueDate)}</td>
                    <td>
                      <select
                        className={`text-xs px-2 py-1 rounded-md border-0 cursor-pointer ${statusMap[d.status]?.className || 'badge-neutral'}`}
                        value={d.status}
                        onChange={async (e) => {
                          try {
                            await updateDocumentStatus({ id: d.id, status: e.target.value });
                            toast.success('Statut mis à jour');
                          } catch (err: any) {
                            toast.error(err?.message || 'Erreur lors de la mise à jour');
                          }
                        }}
                      >
                        {Object.entries(statusMap).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className='text-right font-medium'>{formatCurrency(d.total)}</td>
                    <td className='text-right'>
                      {balance !== null ? (
                        <span className={balance > 0 ? 'text-danger font-medium' : 'text-success'}>
                          {formatCurrency(balance)}
                        </span>
                      ) : (
                        <span className='text-muted'>—</span>
                      )}
                    </td>
                    <td className='text-right'>
                      <div className='flex items-center justify-end gap-1'>
                        <IconBtn title='Modifier' onClick={() => setEditing(d)}>
                          <LuPencil size={14} />
                        </IconBtn>
                        {d.type === 'quote' ? (
                          <IconBtn title='Convertir en facture' onClick={async () => {
                            if (await ask(`Convertir la soumission ${d.number} en facture ?`, { confirmLabel: 'Convertir', variant: 'primary' })) {
                              try {
                                await setDocumentType({ id: d.id, type: 'invoice' });
                                toast.success('Converti en facture');
                              } catch (err: any) {
                                toast.error(err?.message || 'Erreur lors de la conversion');
                              }
                            }
                          }}>
                            <LuFileCheck size={14} />
                          </IconBtn>
                        ) : (
                          <IconBtn title='Repasser en soumission' onClick={async () => {
                            if (await ask(`Repasser la facture ${d.number} en soumission ?`, { confirmLabel: 'Repasser en soumission', variant: 'primary' })) {
                              try {
                                await setDocumentType({ id: d.id, type: 'quote' });
                                toast.success('Repassé en soumission');
                              } catch (err: any) {
                                toast.error(err?.message || 'Erreur lors de la conversion');
                              }
                            }
                          }}>
                            <LuUndo2 size={14} />
                          </IconBtn>
                        )}
                        <IconBtn variant='danger' title='Supprimer' onClick={async () => {
                          if (await ask(`Supprimer ${d.number} ?`)) {
                            try {
                              await deleteDocument({ id: d.id });
                              toast.success('Document supprimé');
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

      {creating && (
        <DocumentForm
          defaultMode={creating.mode}
          clients={clients || []}
          projects={projects || []}
          onClose={() => setCreating(null)}
        />
      )}
      {editing && (
        <DocumentForm
          clients={clients || []}
          projects={projects || []}
          document={editing}
          allowModeToggle={false}
          onClose={() => setEditing(null)}
        />
      )}
      {ConfirmDialog}
    </>
  );
}

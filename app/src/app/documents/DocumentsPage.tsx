import { useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import toast from 'react-hot-toast';
import {
  useQuery,
  getDocuments,
  getClients,
  getProjects,
} from 'wasp/client/operations';
import { PageHeader, EmptyState } from '../../client/ui';
import { DocumentForm } from '../shared/DocumentForm';
import { DocumentTable } from '../shared/DocumentTable';

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

  const docs = useMemo(() => {
    if (!documents) return [];
    if (filter === 'all') return documents;
    return documents.filter((d: any) => d.type === filter);
  }, [documents, filter]);

  return (
    <>
      <PageHeader
        title='Facturation'
        subtitle="Soumissions et factures regroupées. Cliquez le statut pour le changer (Brouillon → Envoyée → Acceptée/Refusée pour les soumissions; Brouillon → Envoyée → Acompte reçu → Payée pour les factures). Une fois la date d'échéance dépassée, les soumissions envoyées passent « Expirée » et les factures impayées passent « En retard » automatiquement."
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
          description="Créez une soumission ou une facture pour commencer. Les statuts (Brouillon, Envoyée, Acceptée, Refusée, Acompte reçu, Payée…) avancent automatiquement à l'envoi du courriel et à l'enregistrement d'un paiement."
          action={<button className='btn-primary' onClick={() => setCreating({ mode: 'quote' })}>Créer une soumission</button>}
        />
      ) : (
        <DocumentTable
          docs={docs}
          showClient
          showBalance
          clients={clients || []}
          projects={projects || []}
        />
      )}

      {creating && (
        <DocumentForm
          defaultMode={creating.mode}
          clients={clients || []}
          projects={projects || []}
          onClose={() => setCreating(null)}
        />
      )}
    </>
  );
}


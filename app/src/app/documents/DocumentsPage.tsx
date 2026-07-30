import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import {
  useQuery,
  getClients,
  getProjects,
} from 'wasp/client/operations';
import { PageHeader } from '../../client/ui';
import { DocumentForm } from '../shared/DocumentForm';
import { DocumentTable } from '../shared/DocumentTable';

export default function DocumentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawType = searchParams.get('type');
  // Par défaut on affiche les factures ; 'all' dans l'URL pour tous les types.
  const initialType =
    rawType === 'quote' || rawType === 'invoice' ? rawType : rawType === 'all' ? '' : 'invoice';
  const initialStatus = searchParams.get('status') ?? '';

  const handleFiltersChange = useCallback((type: string, status: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('type', type || 'all');
      if (status) next.set('status', status); else next.delete('status');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const { data: clients } = useQuery(getClients);
  const { data: projects } = useQuery(getProjects);
  const [creating, setCreating] = useState<{ mode: 'quote' | 'invoice' } | null>(null);

  return (
    <>
      <PageHeader
        title='Facturation'
        subtitle="Soumissions et factures regroupées. Cliquez le statut pour le changer manuellement (Brouillon → Envoyée → Acceptée/Refusée pour les soumissions; Brouillon → Envoyée → Acompte reçu → Payée pour les factures). Une tâche automatique s'exécute toutes les heures : les soumissions envoyées dont la date d'échéance est dépassée passent automatiquement à « Expirée », et les factures impayées passent à « En retard »."
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

      <DocumentTable
        showClient
        initialType={initialType as any}
        initialStatus={initialStatus}
        onFiltersChange={handleFiltersChange}
        clients={clients || []}
        projects={projects || []}
      />

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


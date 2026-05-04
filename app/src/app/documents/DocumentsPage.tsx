import { useState } from 'react';
import { useLocation } from 'react-router';
import {
  useQuery,
  getClients,
  getProjects,
} from 'wasp/client/operations';
import { PageHeader } from '../../client/ui';
import { DocumentForm } from '../shared/DocumentForm';
import { DocumentTable } from '../shared/DocumentTable';

export default function DocumentsPage() {
  const { search } = useLocation();
  const rawType = new URLSearchParams(search).get('type');
  const initialType = rawType === 'quote' || rawType === 'invoice' ? rawType : '';

  const { data: clients } = useQuery(getClients);
  const { data: projects } = useQuery(getProjects);
  const [creating, setCreating] = useState<{ mode: 'quote' | 'invoice' } | null>(null);

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

      <DocumentTable
        showClient
        initialType={initialType as any}
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


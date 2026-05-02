import { useState } from 'react';
import { LuFileCheck, LuUndo2, LuPencil, LuDownload, LuCopy, LuLoader } from 'react-icons/lu';
import toast from 'react-hot-toast';
import {
  useQuery,
  getCurrentCompany,
  getCompanyBrandAssets,
  setDocumentType,
  deleteDocument,
  duplicateDocument,
} from 'wasp/client/operations';
import { useConfirm, IconBtn, TrashIcon } from '../../client/ui';
import { formatCurrency, formatDate } from '../../shared/format';
import { DocumentForm } from './DocumentForm';
import { downloadDocumentPdf } from '../documents/pdf';

export const DOCUMENT_STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  actif: { label: 'Actif', className: 'badge-success' },
  expire: { label: 'Expiré', className: 'badge-warning' },
};

export function statusLabel(status: string) {
  return DOCUMENT_STATUS[status]?.label ?? status.charAt(0).toUpperCase() + status.slice(1);
}

export function statusClassName(status: string) {
  return DOCUMENT_STATUS[status]?.className ?? 'badge-neutral';
}

type Props = {
  docs: any[];
  /** Show the "Client" column (DocumentsPage). Hidden on client detail page. */
  showClient?: boolean;
  /** Show the "Solde" column (DocumentsPage). Hidden on client detail page. */
  showBalance?: boolean;
  /** When editing, lock the doc to this clientId (ClientDetailPage). */
  clientId?: string;
  /** When the doc objects don't embed a `client` field, supply it here for PDF generation. */
  clientForPdf?: any;
  /** Available clients for the edit form. */
  clients?: any[];
  /** Available projects for the edit form. */
  projects: any[];
};

export function DocumentTable({
  docs,
  showClient = false,
  showBalance = false,
  clientId,
  clientForPdf,
  clients,
  projects,
}: Props) {
  const { data: company } = useQuery(getCurrentCompany);
  const { data: brand } = useQuery(getCompanyBrandAssets);
  const [editing, setEditing] = useState<any | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const { ask, Dialog: ConfirmDialog } = useConfirm();

  return (
    <>
      <div className='table-wrap'>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Numéro</th>
              <th>Titre</th>
              {showClient && <th>Client</th>}
              <th>Émis</th>
              <th>Statut</th>
              <th className='text-right'>Total</th>
              {showBalance && <th className='text-right'>Solde</th>}
              <th className='text-right'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d: any) => {
              const balance = d.type === 'invoice' ? +(d.total - d.amountPaid).toFixed(2) : null;
              const docForPdf = clientForPdf ? { ...d, client: clientForPdf } : d;

              return (
                <tr key={d.id}>
                  <td>
                    <span className={d.type === 'invoice' ? 'badge-info' : 'badge-neutral'}>
                      {d.type === 'invoice' ? 'Facture' : 'Soumission'}
                    </span>
                  </td>
                  <td className='font-mono text-xs'>{d.number}</td>
                  <td className='font-medium'>{d.title || '—'}</td>
                  {showClient && <td className='text-muted'>{d.client?.name ?? '—'}</td>}
                  <td className='text-muted'>{formatDate(d.issueDate)}</td>
                  <td>
                    <span className={statusClassName(d.status)}>
                      {statusLabel(d.status)}
                    </span>
                  </td>
                  <td className='text-right font-medium'>{formatCurrency(d.total)}</td>
                  {showBalance && (
                    <td className='text-right'>
                      {balance !== null ? (
                        <span className={balance > 0 ? 'text-danger font-medium' : 'text-success'}>
                          {formatCurrency(balance)}
                        </span>
                      ) : (
                        <span className='text-muted'>—</span>
                      )}
                    </td>
                  )}
                  <td className='text-right'>
                    <div className='flex items-center justify-end gap-1'>
                      <IconBtn title='Modifier' onClick={() => setEditing(d)}>
                        <LuPencil size={14} />
                      </IconBtn>
                      <IconBtn
                        title='Télécharger en PDF'
                        onClick={() => {
                          try {
                            downloadDocumentPdf(docForPdf, company || null, brand || null);
                          } catch (err: any) {
                            toast.error(err?.message || 'Erreur lors de la génération du PDF');
                          }
                        }}
                      >
                        <LuDownload size={14} />
                      </IconBtn>
                      <IconBtn
                        title='Dupliquer'
                        disabled={duplicating === d.id}
                        onClick={async () => {
                          setDuplicating(d.id);
                          try {
                            await duplicateDocument({ id: d.id });
                            toast.success('Document dupliqué');
                          } catch (err: any) {
                            toast.error(err?.message || 'Erreur lors de la duplication');
                          } finally {
                            setDuplicating(null);
                          }
                        }}
                      >
                        {duplicating === d.id
                          ? <LuLoader size={14} className='animate-spin' />
                          : <LuCopy size={14} />}
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

      {editing && (
        <DocumentForm
          clientId={clientId}
          clients={clients}
          projects={projects}
          document={editing}
          allowModeToggle={false}
          onClose={() => setEditing(null)}
        />
      )}
      {ConfirmDialog}
    </>
  );
}

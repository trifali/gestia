import { useState } from 'react';
import { LuFileCheck, LuUndo2, LuPencil, LuDownload, LuCopy, LuLoader, LuMail, LuEye, LuWallet } from 'react-icons/lu';
import toast from 'react-hot-toast';
import {
  useQuery,
  getCurrentCompany,
  getCompanyBrandAssets,
  setDocumentType,
  deleteDocument,
  duplicateDocument,
  updateDocumentStatus,
} from 'wasp/client/operations';
import { useConfirm, IconBtn, TrashIcon } from '../../client/ui';
import { formatCurrency, formatDate } from '../../shared/format';
import { DocumentForm } from './DocumentForm';
import { downloadDocumentPdf } from '../documents/pdf';
import { SendDocumentEmailModal } from './SendDocumentEmailModal';
import { PdfPreviewModal } from './PdfPreviewModal';
import { PaymentModal } from './PaymentModal';

type StatusMeta = { label: string; className: string };

// Quote lifecycle.
export const QUOTE_STATUS: Record<string, StatusMeta> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  envoyee: { label: 'Envoyée', className: 'badge-info' },
  acceptee: { label: 'Acceptée', className: 'badge-success' },
  refusee: { label: 'Refusée', className: 'badge-danger' },
  expiree: { label: 'Expirée', className: 'badge-warning' },
};

// Invoice lifecycle.
export const INVOICE_STATUS: Record<string, StatusMeta> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  envoyee: { label: 'Envoyée', className: 'badge-info' },
  acompte_recu: { label: 'Acompte reçu', className: 'badge-accent' },
  payee: { label: 'Payée', className: 'badge-success' },
  en_retard: { label: 'En retard', className: 'badge-danger' },
  annulee: { label: 'Annulée', className: 'badge-neutral' },
};

// Map legacy values still surfacing from old rows onto the new vocabulary.
function normalizeStatus(type: string, status: string): string {
  if (type === 'invoice') {
    if (status === 'actif') return 'envoyee';
    if (status === 'expire') return 'en_retard';
    return status;
  }
  if (status === 'actif') return 'envoyee';
  if (status === 'expire') return 'expiree';
  return status;
}

function statusMap(type: string) {
  return type === 'invoice' ? INVOICE_STATUS : QUOTE_STATUS;
}

export function statusLabel(type: string, status: string) {
  const norm = normalizeStatus(type, status);
  return statusMap(type)[norm]?.label ?? norm.charAt(0).toUpperCase() + norm.slice(1);
}

export function statusClassName(type: string, status: string) {
  const norm = normalizeStatus(type, status);
  return statusMap(type)[norm]?.className ?? 'badge-neutral';
}

// Backwards-compatible alias for any caller still importing the old name.
export const DOCUMENT_STATUS = QUOTE_STATUS;

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
  const [sending, setSending] = useState<any | null>(null);
  const [previewing, setPreviewing] = useState<any | null>(null);
  const [recordingPayment, setRecordingPayment] = useState<{ doc: any; preset?: 'deposit' | 'final' } | null>(null);
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
              <th className='text-right whitespace-nowrap w-px'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d: any) => {
              const balance = d.type === 'invoice' ? +(d.total - d.amountPaid).toFixed(2) : null;
              const docForPdf = clientForPdf ? { ...d, client: clientForPdf } : d;
              const sentActivities = ((d as any).activities || []) as Array<{ createdAt: string | Date; metadata?: any }>;
              const lastSentForType = sentActivities.find((a) => (a.metadata?.type === 'invoice' ? 'invoice' : 'quote') === d.type) || null;
              const wasSent = !!lastSentForType;

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
                    <StatusSelect doc={d} />
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
                  <td className='text-right whitespace-nowrap w-px'>
                    <div className='flex items-center justify-end gap-1'>
                      <IconBtn title='Modifier' onClick={() => setEditing(d)}>
                        <LuPencil size={14} />
                      </IconBtn>
                      <IconBtn
                        title='Aperçu du PDF'
                        onClick={() => setPreviewing(docForPdf)}
                      >
                        <LuEye size={14} />
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
                        title={wasSent ? `Renvoyer (envoyé le ${formatDate(lastSentForType.createdAt)})` : 'Envoyer par courriel'}
                        onClick={() => setSending({ doc: docForPdf, activities: sentActivities })}
                      >
                        <LuMail size={14} className={wasSent ? 'text-success' : ''} />
                      </IconBtn>                      {d.type === 'invoice' && d.amountPaid < d.total && (
                        <IconBtn
                          title={d.amountPaid > 0 ? 'Enregistrer le solde' : 'Enregistrer un acompte ou un paiement'}
                          onClick={() =>
                            setRecordingPayment({
                              doc: d,
                              preset: d.amountPaid > 0 ? 'final' : 'deposit',
                            })
                          }
                        >
                          <LuWallet size={14} />
                        </IconBtn>
                      )}                      <IconBtn
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
      {sending && (
        <SendDocumentEmailModal
          doc={sending.doc}
          activities={sending.activities}
          company={company || null}
          brand={brand || null}
          onClose={() => setSending(null)}
        />
      )}
      {previewing && (
        <PdfPreviewModal
          doc={previewing}
          company={company || null}
          brand={brand || null}
          onClose={() => setPreviewing(null)}
        />
      )}
      {recordingPayment && (
        <PaymentModal
          doc={recordingPayment.doc}
          preset={recordingPayment.preset}
          onClose={() => setRecordingPayment(null)}
        />
      )}
      {ConfirmDialog}
    </>
  );
}

// Inline status pill that doubles as a dropdown for changing the lifecycle
// state. Options depend on the document type. Auto-derived states
// (`expiree`, `en_retard`, `payee`, `acompte_recu`) are still listed so the
// user can manually override when needed.
function StatusSelect({ doc }: { doc: any }) {
  const [saving, setSaving] = useState(false);
  const map = doc.type === 'invoice' ? INVOICE_STATUS : QUOTE_STATUS;
  const norm = normalizeStatus(doc.type, doc.status);
  const className = (map[norm]?.className ?? 'badge-neutral') + ' cursor-pointer pr-1';

  const onChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    if (next === norm) return;
    setSaving(true);
    try {
      await updateDocumentStatus({ id: doc.id, status: next });
      toast.success('Statut mis \u00e0 jour');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <select
      value={norm}
      onChange={onChange}
      disabled={saving}
      className={className}
      style={{
        appearance: 'none',
        WebkitAppearance: 'none',
        MozAppearance: 'none',
        border: 'none',
        outline: 'none',
      }}
    >
      {Object.entries(map).map(([value, meta]) => (
        <option key={value} value={value}>
          {meta.label}
        </option>
      ))}
    </select>
  );
}

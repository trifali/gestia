import { useEffect, useMemo, useRef, useState } from 'react';
import { LuFileCheck, LuUndo2, LuPencil, LuCopy, LuLoader, LuMail, LuEye, LuWallet, LuArrowUpDown, LuArrowUp, LuArrowDown, LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import toast from 'react-hot-toast';
import {
  useQuery,
  getCurrentCompany,
  getCompanyBrandAssets,
  getDocuments,
  setDocumentType,
  deleteDocument,
  duplicateDocument,
  updateDocumentStatus,
} from 'wasp/client/operations';
import { useConfirm, IconBtn, TrashIcon } from '../../client/ui';
import { formatCurrency, formatDate } from '../../shared/format';
import { DocumentForm } from './DocumentForm';
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

const DOC_PAGE_SIZE = 25;
type DocSortKey = 'date' | 'number';

type Props = {
  /** Show the "Client" column (DocumentsPage). Hidden on client detail page. */
  showClient?: boolean;
  /** @deprecated no longer used — Total and Solde columns were removed. */
  showBalance?: boolean;
  /** Scope to a specific client. */
  clientId?: string;
  /** Initial type filter (from URL param). */
  initialType?: 'quote' | 'invoice' | '';
  /** Initial status filter (from URL param). */
  initialStatus?: string;
  /** Called when type or status filter changes, so parents can sync the URL. */
  onFiltersChange?: (type: string, status: string) => void;
  /** When the doc objects don't embed a `client` field, supply it here for PDF generation. */
  clientForPdf?: any;
  /** Available clients for the edit form. */
  clients?: any[];
  /** Available projects for the edit form. */
  projects: any[];
};

export function DocumentTable({
  showClient = false,
  clientId,
  initialType = '',
  initialStatus = '',
  onFiltersChange,
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

  // Filter / sort / page state
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterType, setFilterType] = useState(initialType);
  const [filterStatus, setFilterStatus] = useState(initialStatus);
  const [sortKey, setSortKey] = useState<DocSortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(1); }, [filterType, filterStatus, sortKey, sortDir]);

  // Sync filters back to parent (for URL updates) whenever they change
  const isFirstFilterSync = useRef(true);
  const externalSyncRef = useRef(false);
  useEffect(() => {
    if (isFirstFilterSync.current) { isFirstFilterSync.current = false; return; }
    if (externalSyncRef.current) { externalSyncRef.current = false; return; }
    onFiltersChange?.(filterType, filterStatus);
  }, [filterType, filterStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync state when initialType/initialStatus props change externally (URL pasted or navigated to)
  useEffect(() => {
    if (initialType === filterType && initialStatus === filterStatus) return;
    externalSyncRef.current = true;
    setFilterType(initialType);
    setFilterStatus(initialStatus);
  }, [initialType, initialStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const docQueryArgs = useMemo(() => ({
    search: debouncedSearch || undefined,
    type: filterType || undefined,
    status: filterStatus || undefined,
    sortKey, sortDir,
    page, pageSize: DOC_PAGE_SIZE,
    clientId,
  }), [debouncedSearch, filterType, filterStatus, sortKey, sortDir, page, clientId]);

  const { data: docResult, isLoading: docsLoading }: { data: any; isLoading: boolean } = useQuery(getDocuments, docQueryArgs) as any;
  const docs = docResult?.data ?? [];
  const totalDocCount = docResult?.total ?? 0;
  const totalDocPages = Math.max(1, Math.ceil(totalDocCount / DOC_PAGE_SIZE));

  // Status options depend on selected type filter
  const statusOptions = useMemo(() => {
    if (filterType === 'invoice') return Object.entries(INVOICE_STATUS);
    if (filterType === 'quote') return Object.entries(QUOTE_STATUS);
    const combined = { ...QUOTE_STATUS, ...INVOICE_STATUS };
    return Object.entries(combined);
  }, [filterType]);

  function toggleDocSort(key: DocSortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  }
  function SortIcon({ k }: { k: DocSortKey }) {
    if (sortKey !== k) return <LuArrowUpDown size={12} className='ml-0.5 text-muted/60 inline' />;
    return sortDir === 'desc'
      ? <LuArrowDown size={12} className='ml-0.5 inline' />
      : <LuArrowUp size={12} className='ml-0.5 inline' />;
  }
  const [recordingPayment, setRecordingPayment] = useState<{ doc: any; preset?: 'deposit' | 'final' } | null>(null);
  const { ask, Dialog: ConfirmDialog } = useConfirm();

  return (
    <>
      {/* Toolbar */}
      <div className='flex flex-wrap items-center gap-2 mb-4'>
        <input
          type='text'
          className='input h-9 text-sm !w-64 shrink-0'
          placeholder='Rechercher…'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {/* Type — pill tabs */}
        <div className='inline-flex rounded-lg border border-line p-0.5 bg-canvas shrink-0'>
          {(['', 'quote', 'invoice'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setFilterType(t); if (t !== filterType) setFilterStatus(''); }}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                filterType === t ? 'bg-white text-ink shadow-sm font-medium' : 'text-muted hover:text-ink'
              }`}
            >
              {t === '' ? 'Tous' : t === 'quote' ? 'Soumissions' : 'Factures'}
            </button>
          ))}
        </div>
        {/* Status */}
        <select
          className='input h-9 text-sm !w-auto shrink-0'
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value=''>Tous les statuts</option>
          {statusOptions.map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {docsLoading ? (
        <p className='text-muted text-sm py-4'>Chargement…</p>
      ) : docs.length === 0 ? (
        <p className='text-muted text-sm py-4'>
          {search || filterType || filterStatus ? 'Aucun résultat pour ces filtres.' : 'Aucun document.'}
        </p>
      ) : (
      <div className='table-wrap'>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th className='cursor-pointer select-none whitespace-nowrap' onClick={() => toggleDocSort('number')}>
                Numéro <SortIcon k='number' />
              </th>
              <th>Titre</th>
              {showClient && <th>Client</th>}
              <th className='cursor-pointer select-none whitespace-nowrap' onClick={() => toggleDocSort('date')}>
                Émis <SortIcon k='date' />
              </th>
              <th>Statut</th>
              <th className='text-right whitespace-nowrap w-px'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d: any) => {
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
                  <td>
                    <span className='font-mono text-xs'>{d.number}</span>
                    {d.type === 'invoice' && (
                      <><br /><span className='text-xs text-muted'>{formatCurrency(d.amountPaid)} sur {formatCurrency(d.total)} payé</span></>
                    )}
                  </td>
                  <td className='font-medium'>{d.title || '—'}</td>
                  {showClient && <td className='text-muted'>{d.client?.name ?? '—'}</td>}
                  <td className='text-muted'>{formatDate(d.issueDate)}</td>
                  <td>
                    <StatusSelect doc={d} />
                  </td>
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
      )}

      {totalDocPages > 1 && (
        <div className='flex items-center justify-center gap-3 mt-4 text-sm text-muted'>
          <button
            className='btn-secondary h-7 w-7 p-0 flex items-center justify-center disabled:opacity-40'
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <LuChevronLeft size={15} />
          </button>
          <span>Page {page} / {totalDocPages} <span className='text-muted/60'>({totalDocCount})</span></span>
          <button
            className='btn-secondary h-7 w-7 p-0 flex items-center justify-center disabled:opacity-40'
            disabled={page >= totalDocPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <LuChevronRight size={15} />
          </button>
        </div>
      )}

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

import {
  useQuery,
  getPipelineDocuments,
  getActivityFeed,
  getClients,
  addActivityNote,
  getCurrentCompany,
  getCompanyBrandAssets,
  getProjects,
  updateDocumentStatus,
} from 'wasp/client/operations';
// @ts-ignore — generated after Wasp restart
import { getDocumentById } from 'wasp/client/operations';
import { useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import {
  LuPhone,
  LuMail,
  LuPlus,
  LuLoader,
  LuStickyNote,
  LuFilePlus2,
  LuArrowRightLeft,
  LuCircleCheck,
  LuRefreshCw,
  LuActivity,
  LuX,
  LuUser,
  LuExternalLink,
  LuInfo,
} from 'react-icons/lu';
import { PageHeader, Modal } from '../../client/ui';
import { formatCurrency, formatDate, formatDateTime } from '../../shared/format';
import { SendDocumentEmailModal } from '../shared/SendDocumentEmailModal';
import { DocumentForm } from '../shared/DocumentForm';
import type { PipelineDocument, ActivityFeedItem } from './operations';

// ─── Status definitions ────────────────────────────────────────────────────

const QUOTE_COLUMNS: { status: string; label: string; headerCls: string; badgeCls: string }[] = [
  {
    status: 'brouillon',
    label: 'Brouillon',
    headerCls: 'bg-gray-100 border-gray-200',
    badgeCls: 'badge-neutral',
  },
  {
    status: 'envoyee',
    label: 'Envoyée',
    headerCls: 'bg-blue-50 border-blue-200',
    badgeCls: 'badge-info',
  },
  {
    status: 'acceptee',
    label: 'Acceptée',
    headerCls: 'bg-green-50 border-green-200',
    badgeCls: 'badge-success',
  },
  {
    status: 'expiree',
    label: 'Expirée',
    headerCls: 'bg-amber-50 border-amber-200',
    badgeCls: 'badge-warning',
  },
  {
    status: 'refusee',
    label: 'Refusée',
    headerCls: 'bg-red-50 border-red-200',
    badgeCls: 'badge-danger',
  },
];

const INVOICE_COLUMNS: { status: string; label: string; headerCls: string; badgeCls: string }[] = [
  {
    status: 'brouillon',
    label: 'Brouillon',
    headerCls: 'bg-gray-100 border-gray-200',
    badgeCls: 'badge-neutral',
  },
  {
    status: 'envoyee',
    label: 'Envoyée',
    headerCls: 'bg-blue-50 border-blue-200',
    badgeCls: 'badge-info',
  },
  {
    status: 'acompte_recu',
    label: 'Acompte reçu',
    headerCls: 'bg-purple-50 border-purple-200',
    badgeCls: 'badge-accent',
  },
  {
    status: 'en_retard',
    label: 'En retard',
    headerCls: 'bg-red-50 border-red-200',
    badgeCls: 'badge-danger',
  },
];

// Activity type labels and badge classes (mirrors ClientDetailPage)
const ACTIVITY_TYPE_META: Record<string, { label: string; badgeCls: string }> = {
  'document.email_sent': { label: 'Courriel envoyé', badgeCls: 'badge-info' },
  'document.status_changed': { label: 'Statut modifié', badgeCls: 'badge-neutral' },
  'document.converted_to_invoice': { label: 'Soumission → Facture', badgeCls: 'badge-success' },
  'document.reverted_to_quote': { label: 'Facture → Soumission', badgeCls: 'badge-warning' },
  'project.created': { label: 'Projet créé', badgeCls: 'badge-info' },
  'project.updated': { label: 'Projet modifié', badgeCls: 'badge-neutral' },
  'project.status_changed': { label: 'Statut projet', badgeCls: 'badge-accent' },
  'project.deleted': { label: 'Projet supprimé', badgeCls: 'badge-danger' },
  note: { label: 'Note', badgeCls: 'badge-accent' },
};

function activityIcon(type: string) {
  if (type === 'note') return <LuStickyNote size={14} />;
  if (type === 'document.email_sent') return <LuMail size={14} />;
  if (type === 'document.status_changed') return <LuRefreshCw size={14} />;
  if (type === 'document.converted_to_invoice') return <LuArrowRightLeft size={14} />;
  if (type.startsWith('project')) return <LuFilePlus2 size={14} />;
  if (type.includes('payment') || type.includes('paid')) return <LuCircleCheck size={14} />;
  return <LuActivity size={14} />;
}

// ─── Main page ──────────────────────────────────────────────────────────────

type Tab = 'pipeline' | 'journal';
type PipelineTab = 'quotes' | 'invoices';

export default function PipelinePage() {
  const [tab, setTab] = useState<Tab>('pipeline');
  const [pipelineTab, setPipelineTab] = useState<PipelineTab>('quotes');

  const { data: docs, isLoading: docsLoading } = useQuery(getPipelineDocuments);
  const [clientFilter, setClientFilter] = useState('');
  const { data: feedData, isLoading: feedLoading } = useQuery(getActivityFeed, {
    clientId: clientFilter || undefined,
    limit: 100,
  });
  const { data: clients } = useQuery(getClients);

  const quotes = (docs || []).filter((d) => d.type === 'quote');
  const invoices = (docs || []).filter((d) => d.type === 'invoice');

  return (
    <>
      <PageHeader
        title='Suivi'
        subtitle='Tableau de bord opérationnel — état de vos soumissions et factures, et journal de toutes les activités.'
      />

      {/* Main tabs */}
      <div className='flex gap-1 border-b border-gray-200 mb-6'>
        {(
          [
            { id: 'pipeline', label: 'Pipeline' },
            { id: 'journal', label: "Journal d'activité" },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pipeline' && (
        <>
          {/* Soumissions / Factures sub-toggle */}
          <div className='flex items-center gap-2 mb-5'>
            <button
              onClick={() => setPipelineTab('quotes')}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                pipelineTab === 'quotes'
                  ? 'bg-accent text-white'
                  : 'bg-canvas text-muted hover:text-ink border border-line'
              }`}
            >
              Soumissions
              {quotes.length > 0 && (
                <span className='ml-2 text-xs opacity-80'>{quotes.length}</span>
              )}
            </button>
            <button
              onClick={() => setPipelineTab('invoices')}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                pipelineTab === 'invoices'
                  ? 'bg-accent text-white'
                  : 'bg-canvas text-muted hover:text-ink border border-line'
              }`}
            >
              Factures non payées
              {invoices.length > 0 && (
                <span className='ml-2 text-xs opacity-80'>{invoices.length}</span>
              )}
            </button>
          </div>

          {docsLoading ? (
            <div className='flex items-center gap-2 text-muted text-sm'>
              <LuLoader size={16} className='animate-spin' />
              Chargement…
            </div>
          ) : (
            <KanbanBoard
              docs={(pipelineTab === 'quotes' ? quotes : invoices) as any}
              columns={pipelineTab === 'quotes' ? QUOTE_COLUMNS : INVOICE_COLUMNS}
            />
          )}
        </>
      )}

      {tab === 'journal' && (
        <JournalTab
          feed={feedData || []}
          isLoading={feedLoading}
          clients={clients || []}
          clientFilter={clientFilter}
          onClientFilterChange={setClientFilter}
        />
      )}
    </>
  );
}

// ─── Kanban Board ───────────────────────────────────────────────────────────

function KanbanBoard({
  docs,
  columns,
}: {
  docs: PipelineDocument[];
  columns: typeof QUOTE_COLUMNS;
}) {
  const [noteDoc, setNoteDoc] = useState<PipelineDocument | null>(null);
  const [emailDocId, setEmailDocId] = useState<string | null>(null);
  const [editDocId, setEditDocId] = useState<string | null>(null);

  // Drag-and-drop state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);

  // Optimistic local override so the card moves instantly before the server
  // confirms (reverted on error).
  const [optimisticStatus, setOptimisticStatus] = useState<Record<string, string>>({});

  function effectiveStatus(doc: PipelineDocument): string {
    return optimisticStatus[doc.id] ?? doc.status;
  }

  const byStatus = new Map<string, PipelineDocument[]>();
  for (const col of columns) byStatus.set(col.status, []);
  for (const doc of docs) {
    const s = effectiveStatus(doc);
    if (byStatus.has(s)) byStatus.get(s)!.push(doc);
  }

  async function handleDrop(targetStatus: string) {
    setDragOverStatus(null);
    if (!draggingId) return;
    const doc = docs.find((d) => d.id === draggingId);
    if (!doc || effectiveStatus(doc) === targetStatus) {
      setDraggingId(null);
      return;
    }
    const previousStatus = effectiveStatus(doc);
    setOptimisticStatus((prev) => ({ ...prev, [draggingId]: targetStatus }));
    setDraggingId(null);
    try {
      await (updateDocumentStatus as any)({ id: draggingId, status: targetStatus });
      toast.success(`Statut mis à jour : ${statusLabel(targetStatus)}`);
    } catch (err: any) {
      setOptimisticStatus((prev) => ({ ...prev, [draggingId!]: previousStatus }));
      toast.error(err?.message || 'Impossible de modifier le statut');
    }
  }

  if (docs.length === 0) {
    return (
      <div className='rounded-xl border border-line bg-canvas px-6 py-10 text-center text-sm text-muted'>
        Aucun document dans ce pipeline pour le moment.
      </div>
    );
  }

  return (
    <>
      {/* Drag-and-drop tip */}
      <div className='flex items-center gap-2 text-xs text-muted mb-4 px-1'>
        <LuInfo size={13} className='shrink-0 text-accent' />
        <span>
          Glissez une carte vers une autre colonne pour changer son statut. Le changement est
          enregistré immédiatement.
        </span>
      </div>

      <div className='overflow-x-auto pb-4'>
        <div className='flex gap-4 min-w-max'>
          {columns.map((col) => {
            const cards = byStatus.get(col.status) || [];
            const isOver = dragOverStatus === col.status;
            return (
              <div
                key={col.status}
                className='w-72 flex flex-col'
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverStatus(col.status);
                }}
                onDragLeave={(e) => {
                  // Only clear if leaving the column entirely (not entering a child)
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragOverStatus(null);
                  }
                }}
                onDrop={() => handleDrop(col.status)}
              >
                {/* Column header */}
                <div
                  className={`flex items-center justify-between px-3 py-2 rounded-t-lg border ${col.headerCls} transition-colors ${isOver ? 'ring-2 ring-accent ring-inset' : ''}`}
                >
                  <span className='text-sm font-semibold text-ink'>{col.label}</span>
                  <span className='text-xs text-muted font-medium'>
                    {cards.length} {cards.length === 1 ? 'doc' : 'docs'}
                  </span>
                </div>

                {/* Cards drop zone */}
                <div
                  className={`flex flex-col gap-2 p-2 rounded-b-lg border border-t-0 min-h-24 ${col.headerCls} bg-opacity-30 transition-colors ${
                    isOver ? 'ring-2 ring-accent ring-inset bg-accent/5' : ''
                  }`}
                >
                  {cards.length === 0 ? (
                    <div className={`text-xs text-muted text-center py-4 ${isOver ? 'opacity-100 text-accent' : 'opacity-60'}`}>
                      {isOver ? 'Déposer ici' : '—'}
                    </div>
                  ) : (
                    cards.map((doc) => (
                      <PipelineCard
                        key={doc.id}
                        doc={{ ...doc, status: effectiveStatus(doc) }}
                        badgeCls={col.badgeCls}
                        isDragging={draggingId === doc.id}
                        onDragStart={() => setDraggingId(doc.id)}
                        onDragEnd={() => { setDraggingId(null); setDragOverStatus(null); }}
                        onOpenNotes={() => setNoteDoc(doc)}
                        onOpenEmail={() => setEmailDocId(doc.id)}
                        onEdit={() => setEditDocId(doc.id)}
                      />
                    ))
                  )}
                  {/* Show drop target placeholder when dragging over non-empty column */}
                  {isOver && cards.length > 0 && (
                    <div className='h-14 rounded-lg border-2 border-dashed border-accent/40 bg-accent/5' />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {noteDoc && (
        <DocumentNoteModal doc={noteDoc} onClose={() => setNoteDoc(null)} />
      )}

      {emailDocId && (
        <DocumentEmailModal docId={emailDocId} onClose={() => setEmailDocId(null)} />
      )}

      {editDocId && (
        <DocumentEditModal docId={editDocId} onClose={() => setEditDocId(null)} />
      )}
    </>
  );
}

// ─── Pipeline Card ──────────────────────────────────────────────────────────

function PipelineCard({
  doc,
  badgeCls,
  isDragging,
  onDragStart,
  onDragEnd,
  onOpenNotes,
  onOpenEmail,
  onEdit,
}: {
  doc: PipelineDocument;
  badgeCls: string;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpenNotes: () => void;
  onOpenEmail: () => void;
  onEdit: () => void;
}) {
  const now = new Date();
  const due = doc.dueDate ? new Date(doc.dueDate) : null;
  const isOverdue = due ? due < now : false;
  const daysUntilDue = due
    ? Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const rawPhone = doc.clientPhone?.replace(/\s/g, '') || '';

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`bg-white rounded-lg border border-line shadow-sm p-3 flex flex-col gap-2 hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing select-none ${
        isDragging ? 'opacity-40 scale-95' : ''
      }`}
    >
      {/* Header: number + status */}
      <div className='flex items-start justify-between gap-2'>
        <div className='flex flex-col gap-0.5 min-w-0'>
          <button
            type='button'
            onClick={onEdit}
            className='font-mono text-xs font-semibold text-ink hover:text-accent transition-colors leading-tight text-left'
          >
            {doc.number}
          </button>
          {doc.title && (
            <button
              type='button'
              onClick={onEdit}
              className='text-xs text-muted hover:text-accent transition-colors leading-tight truncate text-left'
              title={doc.title}
            >
              {doc.title}
            </button>
          )}
        </div>
        <span className={`${badgeCls} text-[10px] shrink-0`}>{statusLabel(doc.status)}</span>
      </div>

      {/* Client */}
      <Link
        to={`/clients/${doc.clientId}`}
        className='flex items-center gap-1.5 text-sm font-medium text-ink hover:text-accent transition-colors leading-tight group'
      >
        <LuUser size={13} className='text-muted shrink-0' />
        <span className='truncate'>{doc.clientName}</span>
        <LuExternalLink size={11} className='text-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity' />
      </Link>

      {/* Contact actions */}
      <div className='flex flex-col gap-1'>
        {doc.clientPhone ? (
          <a
            href={`tel:${rawPhone}`}
            className='flex items-center gap-1.5 text-xs text-muted hover:text-accent transition-colors'
          >
            <LuPhone size={12} className='shrink-0' />
            <span className='truncate'>{doc.clientPhone}</span>
          </a>
        ) : (
          <span className='flex items-center gap-1.5 text-xs text-muted opacity-40'>
            <LuPhone size={12} />
            <span>—</span>
          </span>
        )}
        {doc.clientEmail ? (
          <a
            href={`mailto:${doc.clientEmail}`}
            className='flex items-center gap-1.5 text-xs text-muted hover:text-accent transition-colors'
          >
            <LuMail size={12} className='shrink-0' />
            <span className='truncate'>{doc.clientEmail}</span>
          </a>
        ) : (
          <span className='flex items-center gap-1.5 text-xs text-muted opacity-40'>
            <LuMail size={12} />
            <span>—</span>
          </span>
        )}
      </div>

      {/* Amount + due date + note button */}
      <div className='pt-1 border-t border-line/60 flex items-end justify-between gap-2'>
        <div>
          <div className='font-semibold text-sm text-ink'>{formatCurrency(doc.total)}</div>
          {doc.amountPaid > 0 && (
            <div className='text-xs text-muted'>
              Solde : {formatCurrency(doc.total - doc.amountPaid)}
            </div>
          )}
        </div>
        <div className='flex items-end gap-2'>
          {due && (
            <div
              className={`text-right text-[10px] leading-tight ${
                isOverdue
                  ? 'text-red-600 font-semibold'
                  : daysUntilDue !== null && daysUntilDue <= 7
                  ? 'text-amber-600 font-medium'
                  : 'text-muted'
              }`}
            >
              {isOverdue ? 'En retard' : daysUntilDue === 0 ? "Auj." : null}
              <br />
              {formatDate(doc.dueDate)}
            </div>
          )}
          {/* Note button with badge */}
          <button
            type='button'
            onClick={onOpenNotes}
            title={doc.noteCount > 0 ? `${doc.noteCount} note${doc.noteCount > 1 ? 's' : ''}` : 'Ajouter une note'}
            className='relative flex items-center justify-center w-7 h-7 rounded-lg text-muted hover:text-accent hover:bg-canvas transition-colors shrink-0'
          >
            <LuStickyNote size={15} />
            {doc.noteCount > 0 && (
              <span className='absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center px-0.5 leading-none'>
                {doc.noteCount > 9 ? '9+' : doc.noteCount}
              </span>
            )}
          </button>
          {/* Email button with badge */}
          <button
            type='button'
            onClick={onOpenEmail}
            title={doc.emailSentCount > 0 ? `${doc.emailSentCount} courriel${doc.emailSentCount > 1 ? 's' : ''} envoyé${doc.emailSentCount > 1 ? 's' : ''} — Relancer` : 'Envoyer par courriel'}
            className='relative flex items-center justify-center w-7 h-7 rounded-lg text-muted hover:text-accent hover:bg-canvas transition-colors shrink-0'
          >
            <LuMail size={15} className={doc.emailSentCount > 0 ? 'text-success' : ''} />
            {doc.emailSentCount > 0 && (
              <span className='absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-success text-white text-[9px] font-bold flex items-center justify-center px-0.5 leading-none'>
                {doc.emailSentCount > 9 ? '9+' : doc.emailSentCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    brouillon: 'Brouillon',
    envoyee: 'Envoyée',
    acceptee: 'Acceptée',
    refusee: 'Refusée',
    expiree: 'Expirée',
    acompte_recu: 'Acompte reçu',
    payee: 'Payée',
    en_retard: 'En retard',
    annulee: 'Annulée',
  };
  return map[s] || s;
}

// ─── Document Edit Modal ──────────────────────────────────────────────────

function DocumentEditModal({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { data: doc, isLoading: docLoading } = useQuery(getDocumentById, { id: docId });
  const { data: clients, isLoading: clientsLoading } = useQuery(getClients);
  const { data: projects, isLoading: projectsLoading } = useQuery(getProjects);

  const isLoading = docLoading || clientsLoading || projectsLoading;

  if (isLoading || !doc) {
    return (
      <Modal open onClose={onClose} title='Modifier le document'>
        <div className='flex items-center gap-2 text-muted text-sm py-4'>
          <LuLoader size={16} className='animate-spin' />
          Chargement…
        </div>
      </Modal>
    );
  }

  return (
    <DocumentForm
      document={doc as any}
      clients={clients as any}
      projects={(projects as any) ?? []}
      allowModeToggle={false}
      onClose={onClose}
    />
  );
}

// ─── Document Email Modal ─────────────────────────────────────────────────

function DocumentEmailModal({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { data: doc, isLoading: docLoading } = useQuery(getDocumentById, { id: docId });
  const { data: company, isLoading: companyLoading } = useQuery(getCurrentCompany);
  const { data: brand, isLoading: brandLoading } = useQuery(getCompanyBrandAssets);

  const isLoading = docLoading || companyLoading || brandLoading;

  if (isLoading || !doc || !company) {
    return (
      <Modal open onClose={onClose} title='Envoi par courriel'>
        <div className='flex items-center gap-2 text-muted text-sm py-4'>
          <LuLoader size={16} className='animate-spin' />
          Chargement…
        </div>
      </Modal>
    );
  }

  const sentActivities = ((doc as any).activities || []) as Array<{
    createdAt: string | Date;
    metadata?: any;
  }>;

  return (
    <SendDocumentEmailModal
      doc={doc as any}
      company={company as any}
      brand={(brand as any) ?? null}
      activities={sentActivities}
      onClose={onClose}
    />
  );
}

// ─── Document Note Modal ──────────────────────────────────────────────────

function DocumentNoteModal({
  doc,
  onClose,
}: {
  doc: PipelineDocument;
  onClose: () => void;
}) {
  const { data: notes, isLoading } = useQuery(getActivityFeed, {
    documentId: doc.id,
    limit: 50,
  });
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSaving(true);
    try {
      await addActivityNote({
        documentId: doc.id,
        clientId: doc.clientId,
        message: message.trim(),
      });
      toast.success('Note ajoutée');
      setMessage('');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const docNotes = (notes || []).filter((n) => n.type === 'note');

  return (
    <Modal
      open
      onClose={onClose}
      title={`Notes — ${doc.number}`}
    >
      <div className='flex flex-col gap-5'>
        {/* Client context */}
        <div className='text-xs text-muted flex items-center gap-1.5'>
          <LuUser size={12} />
          <Link to={`/clients/${doc.clientId}`} className='hover:text-accent hover:underline' onClick={onClose}>
            {doc.clientName}
          </Link>
          <span>·</span>
          <span className='badge-neutral text-[10px]'>{statusLabel(doc.status)}</span>
          <span>·</span>
          <span>{formatCurrency(doc.total)}</span>
        </div>

        {/* Add note form */}
        <form onSubmit={handleSubmit} className='flex flex-col gap-2'>
          <label className='label'>Nouvelle note</label>
          <textarea
            className='input'
            rows={3}
            placeholder="Ex: Relancé Jean par téléphone — intéressé, rappellera cette semaine…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            autoFocus
          />
          <div className='flex justify-end'>
            <button type='submit' className='btn-primary' disabled={saving || !message.trim()}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>

        {/* Existing notes */}
        <div>
          <p className='text-xs font-semibold text-muted uppercase tracking-wide mb-3'>
            Historique des notes
            {docNotes.length > 0 && <span className='ml-1 font-normal'>({docNotes.length})</span>}
          </p>
          {isLoading ? (
            <div className='flex items-center gap-2 text-muted text-sm'>
              <LuLoader size={14} className='animate-spin' />
              Chargement…
            </div>
          ) : docNotes.length === 0 ? (
            <p className='text-sm text-muted'>Aucune note pour ce document.</p>
          ) : (
            <ol className='space-y-3'>
              {docNotes.map((n) => (
                <li key={n.id} className='flex items-start gap-3 text-sm'>
                  <div className='mt-0.5 shrink-0 w-6 h-6 rounded-full bg-canvas border border-line flex items-center justify-center text-muted'>
                    <LuStickyNote size={12} />
                  </div>
                  <div className='flex-1 min-w-0'>
                    <p className='text-ink leading-snug'>{n.message}</p>
                    <p className='text-xs text-muted mt-0.5'>
                      {formatDateTime(n.createdAt)}{n.userName ? ` · ${n.userName}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── Journal Tab ─────────────────────────────────────────────────────────────

function JournalTab({
  feed,
  isLoading,
  clients,
  clientFilter,
  onClientFilterChange,
}: {
  feed: ActivityFeedItem[];
  isLoading: boolean;
  clients: any[];
  clientFilter: string;
  onClientFilterChange: (id: string) => void;
}) {
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteMessage, setNoteMessage] = useState('');
  const [noteClientId, setNoteClientId] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteMessage.trim()) return;
    setSaving(true);
    try {
      await addActivityNote({
        message: noteMessage.trim(),
        clientId: noteClientId || undefined,
      });
      toast.success('Note ajoutée');
      setNoteMessage('');
      setNoteClientId('');
      setShowNoteForm(false);
    } catch (err: any) {
      toast.error(err?.message || "Erreur lors de l'ajout");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='max-w-3xl'>
      {/* Toolbar */}
      <div className='flex flex-wrap items-center justify-between gap-3 mb-5'>
        <div className='flex items-center gap-2'>
          <select
            className='input w-auto min-w-[200px]'
            value={clientFilter}
            onChange={(e) => onClientFilterChange(e.target.value)}
          >
            <option value=''>Tous les clients</option>
            {clients.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {clientFilter && (
            <button
              type='button'
              onClick={() => onClientFilterChange('')}
              className='p-1.5 rounded-lg text-muted hover:text-ink hover:bg-canvas transition-colors'
              title='Effacer le filtre'
            >
              <LuX size={15} />
            </button>
          )}
        </div>
        <button
          type='button'
          className='btn-primary flex items-center gap-1.5'
          onClick={() => setShowNoteForm((v) => !v)}
        >
          <LuPlus size={15} />
          Ajouter une note
        </button>
      </div>

      {/* Add note form */}
      {showNoteForm && (
        <form
          onSubmit={handleAddNote}
          className='mb-6 rounded-xl border border-line bg-canvas p-4 flex flex-col gap-3'
        >
          <div className='flex items-center justify-between'>
            <p className='text-sm font-semibold'>Nouvelle note</p>
            <button
              type='button'
              onClick={() => setShowNoteForm(false)}
              className='p-1 rounded text-muted hover:text-ink'
            >
              <LuX size={15} />
            </button>
          </div>
          <div>
            <label className='label'>Client (optionnel)</label>
            <select
              className='input'
              value={noteClientId}
              onChange={(e) => setNoteClientId(e.target.value)}
            >
              <option value=''>Sans client spécifique</option>
              {clients.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className='label'>Note *</label>
            <textarea
              className='input'
              rows={3}
              placeholder='Ex: Appelé Jean Duval pour relancer la soumission S-2025-014…'
              required
              value={noteMessage}
              onChange={(e) => setNoteMessage(e.target.value)}
            />
          </div>
          <div className='flex justify-end gap-2'>
            <button
              type='button'
              className='btn-secondary'
              onClick={() => setShowNoteForm(false)}
            >
              Annuler
            </button>
            <button type='submit' className='btn-primary' disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer la note'}
            </button>
          </div>
        </form>
      )}

      {/* Feed */}
      {isLoading ? (
        <div className='flex items-center gap-2 text-muted text-sm'>
          <LuLoader size={16} className='animate-spin' />
          Chargement…
        </div>
      ) : feed.length === 0 ? (
        <div className='rounded-xl border border-line bg-canvas px-6 py-10 text-center text-sm text-muted'>
          {clientFilter ? 'Aucune activité pour ce client.' : 'Aucune activité enregistrée.'}
        </div>
      ) : (
        <ol className='space-y-1'>
          {feed.map((item) => (
            <FeedItem key={item.id} item={item} />
          ))}
        </ol>
      )}
    </div>
  );
}

function FeedItem({ item }: { item: ActivityFeedItem }) {
  const meta = ACTIVITY_TYPE_META[item.type] || { label: item.type, badgeCls: 'badge-neutral' };
  const who = item.userName || 'Système';

  return (
    <li className='flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-canvas transition-colors text-sm'>
      <div className='mt-0.5 shrink-0 w-7 h-7 rounded-full bg-canvas border border-line flex items-center justify-center text-muted'>
        {activityIcon(item.type)}
      </div>
      <div className='flex-1 min-w-0'>
        <div className='flex items-start flex-wrap gap-x-2 gap-y-0.5'>
          <span className={`${meta.badgeCls} text-[10px]`}>{meta.label}</span>
          {item.clientName && (
            <Link
              to={`/clients/${item.clientId}`}
              className='text-xs text-accent hover:underline font-medium'
            >
              {item.clientName}
            </Link>
          )}
        </div>
        <p className='text-ink mt-0.5 leading-snug'>{item.message}</p>
        <p className='text-xs text-muted mt-0.5'>
          {formatDate(item.createdAt)} · {who}
        </p>
      </div>
    </li>
  );
}

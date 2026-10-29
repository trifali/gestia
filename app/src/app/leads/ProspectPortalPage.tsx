// Le tableau d'un lien de partage : ce que voit l'équipe, sans compte.
//
// Même tableau, même fiche à droite, mêmes cartes — l'employé qui reçoit le lien
// travaille sur le même écran que son patron. Seuls changent les appels (les
// opérations `…ByToken`) et ce que le lien permet, réglé à sa création (voir
// shared/leadShare). Ce que le lien ne permet pas disparaît de l'écran ; le
// serveur, lui, le refuse de toute façon.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import {
  useQuery,
  // @ts-ignore
  getLeadSearchByToken,
  // @ts-ignore
  updateLeadByToken,
  // @ts-ignore
  reorderLeadsByToken,
  // @ts-ignore
  deleteLeadByToken,
  // @ts-ignore
  createLeadByToken,
  // @ts-ignore
  markLeadViewedByToken,
  // @ts-ignore
  addLeadNoteByToken,
  // @ts-ignore
  getLeadNotesByToken,
  // @ts-ignore
  deleteLeadNoteByToken,
} from 'wasp/client/operations';
import type { Lead, LeadStatusConfig } from 'wasp/entities';
import {
  LuUsers,
  LuLock,
  LuTrash2,
  LuNotebook,
  LuSearch,
  LuX,
  LuPanelRightOpen,
  LuPlus,
  LuPhone,
  LuMail,
  LuSlidersHorizontal,
  LuIdCard,
  LuFilePen,
  LuDownload,
  LuLoader,
  LuEye,
} from 'react-icons/lu';
import { Modal } from '../../client/ui';
import {
  LeadChip,
  LeadDeleteConfirmModal,
  leadExtras,
  leadSourceLabel,
  FALLBACK_SOURCE_KEY,
  type CardFieldConfig,
  type LeadSourceOption,
} from './leads.shared';
import { LeadKanbanBoard, KanbanMenu, type KanbanMenuItem } from './LeadKanbanBoard';
import {
  boardKind,
  FetchMoreLeadsModal,
  ManageCardFieldsModal,
  ManageStatusesModal,
  TemplatesModal,
} from './LeadSearchPage';
import { IntakePanel } from './intake/IntakePanel';
import { SearchForm, defaultForm } from './GoogleSearchForm';
import { ShareTokenProvider, useBoardOps, downloadCsv } from './boardOps';
import { LeadDetailView } from './LeadDetailPanel';
import { AddLeadModal } from './AddLeadModal';
import { normalizeSharePermissions, type LeadSharePermissions } from '../../shared/leadShare';

// ─── Shell ────────────────────────────────────────────────────────────────────

function PortalShell({ children, searchTitle }: { children: React.ReactNode; searchTitle?: string }) {
  return (
    <div className='min-h-screen bg-canvas-100'>
      <header className='bg-white border-b border-line sticky top-0 z-10'>
        <div className='max-w-screen-2xl mx-auto px-4 py-3 flex items-center gap-3'>
          <LuUsers size={20} className='text-accent shrink-0' />
          <span className='font-semibold text-ink truncate'>
            {searchTitle ? `Prospection — ${searchTitle}` : 'Portail prospection'}
          </span>
          <span className='ml-auto shrink-0 text-xs text-muted flex items-center gap-1'>
            <LuLock size={12} /> Accès sécurisé
          </span>
        </div>
      </header>
      <main className='max-w-screen-2xl mx-auto px-4 py-6'>{children}</main>
    </div>
  );
}

// ─── Fiche ────────────────────────────────────────────────────────────────────

/** La fiche de l'application, nourrie par les opérations du lien. */
function PortalDetailPanel({
  token,
  lead: incomingLead,
  statusConfigs,
  sources,
  cardFields,
  perms,
  onClose,
  onRefetch,
  onDelete,
}: {
  token: string;
  lead: Lead | null;
  statusConfigs: LeadStatusConfig[];
  sources: LeadSourceOption[];
  cardFields: CardFieldConfig[];
  perms: LeadSharePermissions;
  onClose: () => void;
  onRefetch: () => void;
  onDelete: (lead: Lead) => void;
}) {
  // Gardé pendant la fermeture, comme dans l'application.
  const lastLead = useRef<Lead | null>(incomingLead);
  if (incomingLead) lastLead.current = incomingLead;
  const leadId = lastLead.current?.id ?? null;

  const { data: notes = [], refetch: refetchNotes } = useQuery(
    getLeadNotesByToken as any,
    { token, leadId },
    { enabled: perms.notes && !!leadId, retry: false } as any,
  );

  // Ouvrir la fiche vaut « vu », exactement comme dans l'application : c'est ce
  // qui annule l'alerte d'arrivée.
  const openedId = incomingLead?.id ?? null;
  useEffect(() => {
    if (!openedId) return;
    (markLeadViewedByToken as any)({ token, leadId: openedId })
      .then((res: any) => { if (res?.marked) onRefetch(); })
      .catch(() => undefined);
  }, [openedId]);

  const notesDirty = useRef(false);

  return (
    <LeadDetailView
      lead={incomingLead}
      statusConfigs={statusConfigs}
      sources={sources}
      cardFields={cardFields}
      notes={notes as any[]}
      access={{ status: perms.move, edit: perms.edit, notes: perms.notes, writeNotes: perms.writeNotes }}
      clearChatBubble={false}
      onClose={() => {
        if (notesDirty.current) {
          notesDirty.current = false;
          onRefetch();
        }
        onClose();
      }}
      onStatus={async (l, status) => {
        await (updateLeadByToken as any)({ token, leadId: l.id, status });
        onRefetch();
      }}
      onSource={async (l, source) => {
        await (updateLeadByToken as any)({ token, leadId: l.id, source });
        onRefetch();
      }}
      onSaveInfo={async (l, values, extras) => {
        await (updateLeadByToken as any)({
          token,
          leadId: l.id,
          name: values.name || undefined,
          phone: values.phone,
          email: values.email,
          website: values.website,
          address: values.address,
          category: values.category,
          extras,
        });
        onRefetch();
      }}
      onAddNote={async (l, text) => {
        await (addLeadNoteByToken as any)({ token, leadId: l.id, text });
        notesDirty.current = true;
        refetchNotes();
      }}
      onDeleteNote={async noteId => {
        await (deleteLeadNoteByToken as any)({ token, noteId });
        notesDirty.current = true;
        refetchNotes();
      }}
      // Pas d'envoi de courriel ni de SMS au nom de l'entreprise depuis un lien
      // public : l'employé appelle et écrit depuis son propre téléphone.
      footer={l => (
        <>
          {l.phone ? (
            <a href={`tel:${l.phone}`} className='btn-primary flex-1 justify-center gap-1.5 text-sm'>
              <LuPhone size={14} />
              Appeler
            </a>
          ) : (
            <button className='btn-secondary flex-1 justify-center gap-1.5 text-sm' disabled title='Aucun téléphone pour ce prospect'>
              <LuPhone size={14} />
              Appeler
            </button>
          )}
          {l.email ? (
            <a href={`mailto:${l.email}`} className='btn-secondary gap-1.5 text-sm'>
              <LuMail size={14} />
              Courriel
            </a>
          ) : (
            <button className='btn-secondary gap-1.5 text-sm' disabled title='Aucun courriel pour ce prospect'>
              <LuMail size={14} />
              Courriel
            </button>
          )}
          {perms.delete && (
            <button className='btn-danger gap-1.5 text-sm' onClick={() => onDelete(l)} title='Supprimer ce prospect' aria-label='Supprimer ce prospect'>
              <LuTrash2 size={14} />
            </button>
          )}
        </>
      )}
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProspectPortalPage() {
  const { token } = useParams<{ token: string }>();
  // Les écrans de réglage partagés avec l'application passent par les
  // opérations du lien dès qu'ils sont sous ce fournisseur.
  return (
    <ShareTokenProvider token={token!}>
      <PortalBoard token={token!} />
    </ShareTokenProvider>
  );
}

function PortalBoard({ token }: { token: string }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading, error, refetch } = useQuery(
    getLeadSearchByToken as any,
    { token: token! },
    { retry: false },
  );

  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showAddLead, setShowAddLead] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [settings, setSettings] = useState<'details' | 'statuses' | 'cardFields' | 'templates' | null>(null);
  const [showFetchMore, setShowFetchMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const ops = useBoardOps();

  // La fiche ouverte vit dans l'adresse, comme dans l'application : elle survit
  // au rechargement et se transmet avec le lien.
  const detailLeadId = searchParams.get('lead');
  function setDetailLeadId(id: string | null) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (id) next.set('lead', id); else next.delete('lead');
      return next;
    }, { replace: true });
  }

  // Le tableau s'écarte juste assez pour laisser la fiche à sa droite (même
  // mesure que dans l'application).
  const contentRef = useRef<HTMLDivElement>(null);
  const [panelInset, setPanelInset] = useState(0);
  useEffect(() => {
    function measure() {
      const el = contentRef.current;
      if (!el) return;
      const panelWidth = window.innerWidth >= 1024 ? 420 : window.innerWidth >= 640 ? 380 : 0;
      if (!detailLeadId || !panelWidth) {
        setPanelInset(0);
        return;
      }
      const free = window.innerWidth - el.getBoundingClientRect().right;
      setPanelInset(Math.max(0, panelWidth + 28 - free));
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [detailLeadId, !!data]);

  const rawLeads: any[] = (data as any)?.leads ?? [];
  const sourceConfigs: LeadSourceOption[] = (data as any)?.sourceConfigs ?? [];

  const leadsBeforeSource = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rawLeads;
    return rawLeads.filter(l => [
      l.name, l.email, l.phone, l.website, l.address, l.category,
      ...leadExtras(l).map(e => `${e.label} ${e.value}`),
    ].some((v: any) => v?.toLowerCase().includes(q)));
  }, [rawLeads, searchQuery]);

  const filteredLeads = useMemo(
    () => sourceFilter
      ? leadsBeforeSource.filter(l => (l.source || FALLBACK_SOURCE_KEY) === sourceFilter)
      : leadsBeforeSource,
    [leadsBeforeSource, sourceFilter],
  );

  const sourceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of leadsBeforeSource) {
      const key = l.source || FALLBACK_SOURCE_KEY;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (sourceFilter && !counts.has(sourceFilter)) counts.set(sourceFilter, 0);
    const orderOf = (key: string) => {
      const i = sourceConfigs.findIndex(s => s.key === key);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count, label: leadSourceLabel(key, sourceConfigs) }))
      .sort((a, b) => orderOf(a.key) - orderOf(b.key) || b.count - a.count || a.label.localeCompare(b.label, 'fr'));
  }, [leadsBeforeSource, sourceConfigs, sourceFilter]);

  if (isLoading) {
    return (
      <PortalShell>
        <div className='flex items-center justify-center h-64 text-muted'>Chargement…</div>
      </PortalShell>
    );
  }

  if (error || !data) {
    return (
      <PortalShell>
        <div className='card p-8 text-center max-w-md mx-auto'>
          <LuLock size={40} className='mx-auto mb-4 text-muted' />
          <h2 className='font-semibold text-ink text-lg mb-2'>Lien invalide ou révoqué</h2>
          <p className='text-muted text-sm'>
            Ce lien d'accès n'est plus valide. Veuillez contacter votre responsable pour obtenir un
            nouveau lien.
          </p>
        </div>
      </PortalShell>
    );
  }

  // `sourceConfigs` arrive avec la charge : le portail n'est pas authentifié et ne
  // peut pas interroger le registre lui-même.
  const { search, statusConfigs, cardFields = [] } = data as any;
  const perms = normalizeSharePermissions((data as any).permissions);
  const detailLead: Lead | null = detailLeadId ? rawLeads.find(l => l.id === detailLeadId) ?? null : null;
  const isFiltered = !!searchQuery.trim() || !!sourceFilter;

  async function updateStatus(leadId: string, newStatus: string) {
    await (updateLeadByToken as any)({ token: token!, leadId, status: newStatus });
  }

  async function reorder(status: string, orderedIds: string[]) {
    await (reorderLeadsByToken as any)({ token: token!, status, orderedIds });
  }

  async function handleDeleteLead() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await (deleteLeadByToken as any)({ token: token!, leadId: deleteTarget.id });
      if (detailLeadId === deleteTarget.id) setDetailLeadId(null);
      setDeleteTarget(null);
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const { csv } = await ops.exportCsv({ searchId: search.id });
      downloadCsv(csv, search.title);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur lors de l'export");
    } finally {
      setExporting(false);
    }
  }

  const kind = boardKind(search);
  const filters: any = search.filters ?? {};
  // « Source » sur un tableau alimenté par webhook, « Critères » sur une recherche
  // Google : le même bouton que dans l'application, selon la nature du tableau.
  const canDetails = kind === 'webhook' ? perms.source : kind === 'google_maps' ? perms.criteria : false;

  // Les réglages que ce lien ouvre, dans l'ordre de l'application.
  const boardSettings: (KanbanMenuItem & { short: string; title: string })[] = [
    ...(canDetails ? [{
      key: 'details',
      label: kind === 'webhook' ? 'Source de prospects' : 'Critères de la recherche',
      short: kind === 'webhook' ? 'Source' : 'Critères',
      title: kind === 'webhook' ? 'Source de prospects' : 'Détails de la recherche',
      icon: <LuEye size={15} />,
      onSelect: () => setSettings('details'),
    }] : []),
    ...(perms.statuses ? [{ key: 'statuses', label: 'Statuts', short: 'Statuts', title: 'Statuts de ce tableau', icon: <LuSlidersHorizontal size={15} />, onSelect: () => setSettings('statuses') }] : []),
    ...(perms.cardFields ? [{ key: 'fields', label: 'Champs des cartes', short: 'Cartes', title: 'Champs affichés sur les cartes', icon: <LuIdCard size={15} />, onSelect: () => setSettings('cardFields') }] : []),
    ...(perms.templates ? [{ key: 'templates', label: 'Modèles courriel / SMS', short: 'Modèles', title: 'Modèles de courriels et de SMS', icon: <LuFilePen size={15} />, onSelect: () => setSettings('templates') }] : []),
    ...(perms.export ? [{ key: 'export', label: 'Exporter en CSV', short: 'Exporter', title: 'Exporter les prospects en CSV', icon: exporting ? <LuLoader size={15} className='animate-spin' /> : <LuDownload size={15} />, onSelect: () => handleExport(), disabled: exporting }] : []),
  ];

  function cardMenu(lead: any): KanbanMenuItem[] {
    const items: KanbanMenuItem[] = [
      { key: 'open', label: 'Ouvrir la fiche', icon: <LuPanelRightOpen size={15} />, onSelect: () => setDetailLeadId(lead.id) },
    ];
    if (perms.notes) {
      items.push({
        key: 'notes',
        label: lead.noteCount > 0 ? `Notes (${lead.noteCount})` : perms.writeNotes ? 'Ajouter une note' : 'Notes',
        icon: <LuNotebook size={15} />,
        onSelect: () => setDetailLeadId(lead.id),
      });
    }
    if (perms.delete) {
      items.push({ key: 'delete', label: 'Supprimer', icon: <LuTrash2 size={15} />, danger: true, onSelect: () => setDeleteTarget(lead) });
    }
    return items;
  }

  const toolbar = (
    <div className='mb-3 space-y-2.5'>
      <div className='flex flex-wrap items-center gap-2'>
        <div className='relative min-w-[12rem] flex-1 sm:max-w-xs'>
          <LuSearch size={16} className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted' />
          <input
            type='search'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Rechercher un prospect…'
            aria-label='Rechercher un prospect'
            className='input h-10 pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden'
          />
          {searchQuery && (
            <button
              type='button'
              onClick={() => setSearchQuery('')}
              className='absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-canvas-200 hover:text-ink'
              aria-label='Effacer la recherche'
            >
              <LuX size={15} />
            </button>
          )}
        </div>

        {sourceOptions.length > 1 && (
          <select
            value={sourceFilter ?? ''}
            onChange={e => setSourceFilter(e.target.value || null)}
            aria-label='Provenance'
            className='input h-10 w-auto max-w-full py-0 pr-8 text-sm'
          >
            <option value=''>Toutes les provenances ({leadsBeforeSource.length})</option>
            {sourceOptions.map(o => (
              <option key={o.key} value={o.key}>{o.label} ({o.count})</option>
            ))}
          </select>
        )}

        {perms.add && (
          <div className='ml-auto flex items-center gap-2'>
            <button type='button' className='btn-accent h-10 px-3' onClick={() => setShowAddLead(true)} title='Ajouter un prospect'>
              <LuPlus size={16} />
              <span className='hidden sm:inline'>Ajouter</span>
            </button>
          </div>
        )}
      </div>

      {isFiltered && (
        <div className='flex items-center gap-2 text-sm text-muted'>
          <span>
            {filteredLeads.length} sur {rawLeads.length} prospect{rawLeads.length !== 1 ? 's' : ''}
          </span>
          <button
            type='button'
            className='font-medium text-accent-700 hover:underline'
            onClick={() => { setSearchQuery(''); setSourceFilter(null); }}
          >
            Réinitialiser
          </button>
        </div>
      )}
    </div>
  );

  return (
    <PortalShell searchTitle={search.title}>
      <PortalDetailPanel
        token={token!}
        lead={detailLead}
        statusConfigs={statusConfigs as LeadStatusConfig[]}
        sources={sourceConfigs}
        cardFields={cardFields as CardFieldConfig[]}
        perms={perms}
        onClose={() => setDetailLeadId(null)}
        onRefetch={refetch}
        onDelete={setDeleteTarget}
      />

      {/* Delete confirmation */}
      <Modal
        open={deleteTarget !== null}
        title={deleteTarget ? `Supprimer — ${deleteTarget.name}` : 'Supprimer'}
        onClose={() => setDeleteTarget(null)}
      >
        <LeadDeleteConfirmModal
          lead={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDeleteLead}
          deleting={deleting}
        />
      </Modal>

      <Modal open={showAddLead} title='Ajouter un prospect' onClose={() => setShowAddLead(false)}>
        {showAddLead && (
          <AddLeadModal
            statusConfigs={statusConfigs}
            sources={sourceConfigs}
            cardFields={cardFields}
            leads={rawLeads}
            canPickColumn={perms.move}
            create={input => (createLeadByToken as any)({ token: token!, ...input })}
            onClose={() => setShowAddLead(false)}
            onCreated={lead => { refetch(); setDetailLeadId(lead.id); }}
          />
        )}
      </Modal>

      <Modal
        open={settings === 'details'}
        title={kind === 'webhook' ? 'Source de prospects' : 'Détails de la recherche'}
        onClose={() => setSettings(null)}
        size={kind === 'webhook' ? 'xl' : 'md'}
      >
        {settings === 'details' && (kind === 'webhook' ? (
          // Le droit « Source » vaut les réglages d'administrateur de la source.
          <IntakePanel searchId={search.id} isAdmin onLeadsCreated={refetch} />
        ) : (
          <SearchForm
            readOnly
            onClose={() => setSettings(null)}
            onDone={() => setSettings(null)}
            initialValues={{
              ...defaultForm(),
              title: search.title,
              description: search.description ?? '',
              purpose: search.purpose ?? '',
              businessType: filters.businessType ?? '',
              city: filters.city ?? '',
              province: filters.province ?? 'QC',
              radius: filters.radius ?? 10000,
              minRating: filters.minRating ?? 0,
              requireWebsite: filters.requireWebsite ?? false,
              maxResults: filters.maxResults ?? 20,
              language: filters.language ?? 'fr',
            }}
            footerExtra={
              <button className='btn-primary gap-1.5 mr-auto' onClick={() => { setSettings(null); setShowFetchMore(true); }}>
                <LuSearch size={14} />
                Chercher plus de prospects
              </button>
            }
          />
        ))}
      </Modal>
      {kind === 'google_maps' && perms.criteria && (
        <FetchMoreLeadsModal
          open={showFetchMore}
          searchId={search.id}
          searchFilters={filters}
          searchTitle={search.title}
          searchPurpose={search.purpose ?? undefined}
          onClose={() => setShowFetchMore(false)}
          onAdded={refetch}
        />
      )}
      <Modal open={settings === 'statuses'} title='Statuts de ce tableau' onClose={() => setSettings(null)}>
        {settings === 'statuses' && (
          <ManageStatusesModal
            configs={statusConfigs as LeadStatusConfig[]}
            searchId={search.id}
            onRefresh={refetch}
            onClose={() => setSettings(null)}
          />
        )}
      </Modal>
      <Modal open={settings === 'cardFields'} title='Cartes de ce tableau' onClose={() => setSettings(null)}>
        {settings === 'cardFields' && (
          <ManageCardFieldsModal
            configs={cardFields as CardFieldConfig[]}
            searchId={search.id}
            onRefresh={refetch}
            onClose={() => setSettings(null)}
          />
        )}
      </Modal>
      <Modal open={settings === 'templates'} title='Modèles de messages' onClose={() => setSettings(null)}>
        {settings === 'templates' && (
          <TemplatesModal
            searchId={search.id}
            searchTitle={search.title}
            statusConfigs={statusConfigs as LeadStatusConfig[]}
            onClose={() => setSettings(null)}
          />
        )}
      </Modal>

      <div ref={contentRef} style={{ paddingRight: panelInset }} className='transition-[padding] duration-200'>
        {/* Page header — mêmes réglages que dans l'application, ceux que le lien ouvre. */}
        <div className='mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3'>
          <div className='min-w-0 flex-1 basis-[18rem]'>
            <div className='flex items-start gap-2'>
              <h1 className='min-w-0 flex-1 text-xl font-bold text-ink break-words'>{search.title}</h1>
              {boardSettings.length > 0 && (
                <div className='sm:hidden'>
                  <KanbanMenu
                    label='Réglages du tableau'
                    sheetTitle={search.title}
                    vertical={false}
                    sections={() => [{ items: boardSettings }]}
                  />
                </div>
              )}
            </div>
            {search.description && <p className='text-sm text-muted mt-1'>{search.description}</p>}
            <p className='text-xs text-muted mt-1'>
              {rawLeads.length} prospect{rawLeads.length !== 1 ? 's' : ''}
            </p>
          </div>
          {boardSettings.length > 0 && (
            <div className='hidden flex-wrap items-center gap-2 sm:flex'>
              {boardSettings.map(item => (
                <button
                  key={item.key}
                  className='btn-secondary h-9 px-3 text-sm'
                  title={item.title}
                  onClick={item.onSelect}
                  disabled={item.disabled}
                >
                  {item.icon}
                  {item.short}
                </button>
              ))}
            </div>
          )}
        </div>

        <LeadKanbanBoard
          leads={filteredLeads}
          statusConfigs={statusConfigs}
          sources={sourceConfigs}
          cardFields={cardFields}
          updateStatus={updateStatus}
          reorder={reorder}
          refetch={refetch}
          canMove={perms.move}
          onCardClick={lead => setDetailLeadId(lead.id)}
          selectedLeadId={detailLeadId}
          cardMenu={cardMenu}
          cardBadges={lead => perms.notes && lead.noteCount > 0 ? (
            <LeadChip icon={<LuNotebook size={11} />}>
              {lead.noteCount} note{lead.noteCount > 1 ? 's' : ''}
            </LeadChip>
          ) : null}
          toolbar={toolbar}
        />
      </div>
    </PortalShell>
  );
}

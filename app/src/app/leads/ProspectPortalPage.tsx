import { useState, useMemo } from 'react';
import { useParams } from 'react-router';
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
  addLeadNoteByToken,
  // @ts-ignore
  getLeadNotesByToken,
  // @ts-ignore
  deleteLeadNoteByToken,
} from 'wasp/client/operations';
import {
  LuUsers,
  LuLoader,
  LuLock,
  LuPencil,
  LuTrash2,
  LuNotebook,
  LuSearch,
  LuX,
} from 'react-icons/lu';
import { Modal } from '../../client/ui';
import {
  NoteThread,
  LeadEditForm,
  LeadChip,
  LeadDeleteConfirmModal,
  leadExtras,
  type LeadFormValues,
} from './leads.shared';
import { LeadKanbanBoard } from './LeadKanbanBoard';

// ─── Shell ────────────────────────────────────────────────────────────────────

function PortalShell({ children, searchTitle }: { children: React.ReactNode; searchTitle?: string }) {
  return (
    <div className='min-h-screen bg-canvas-100'>
      <header className='bg-white border-b border-line sticky top-0 z-10'>
        <div className='max-w-screen-2xl mx-auto px-4 py-3 flex items-center gap-3'>
          <LuUsers size={20} className='text-accent' />
          <span className='font-semibold text-ink'>
            {searchTitle ? `Prospection — ${searchTitle}` : 'Portail prospection'}
          </span>
          <span className='ml-auto text-xs text-muted flex items-center gap-1'>
            <LuLock size={12} /> Accès sécurisé
          </span>
        </div>
      </header>
      <main className='max-w-screen-2xl mx-auto px-4 py-6'>{children}</main>
    </div>
  );
}

// ─── Note modal ────────────────────────────────────────────────────────────────

function NoteModal({ token, lead, onClose }: { token: string; lead: any; onClose: () => void }) {
  const leadId = lead.id;
  const { data: notes = [], refetch } = useQuery(
    getLeadNotesByToken as any,
    { token, leadId },
    { retry: false },
  );
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    try {
      await (addLeadNoteByToken as any)({ token, leadId, text });
      setText('');
      refetch();
    } catch {
      toast.error("Erreur lors de l'ajout");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await (deleteLeadNoteByToken as any)({ token, noteId: id });
      refetch();
    } catch {
      toast.error('Erreur lors de la suppression');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <NoteThread
      notes={notes as any[]}
      text={text}
      setText={setText}
      onSubmit={handleAdd}
      onDelete={handleDelete}
      saving={saving}
      deletingId={deletingId}
    />
  );
}

// ─── Edit lead modal ───────────────────────────────────────────────────────────

function EditLeadModal({ token, lead, onClose }: { token: string; lead: any; onClose: () => void }) {
  async function handleSave(values: LeadFormValues) {
    await (updateLeadByToken as any)({
      token,
      leadId: lead.id,
      name: values.name || undefined,
      phone: values.phone,
      email: values.email,
      website: values.website,
      address: values.address,
      category: values.category,
    });
    toast.success('Prospect mis à jour');
    onClose();
  }

  return (
    <LeadEditForm
      initialValues={{
        name: lead.name ?? '',
        phone: lead.phone ?? '',
        email: lead.email ?? '',
        website: lead.website ?? '',
        address: lead.address ?? '',
        category: lead.category ?? '',
      }}
      onSave={handleSave}
      onCancel={onClose}
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProspectPortalPage() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error, refetch } = useQuery(
    getLeadSearchByToken as any,
    { token: token! },
    { retry: false },
  );

  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [noteTarget, setNoteTarget] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const rawLeads: any[] = (data as any)?.leads ?? [];
  const filteredLeads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rawLeads;
    return rawLeads.filter(l => [
      l.name, l.email, l.phone, l.website, l.address, l.category,
      ...leadExtras(l).map(e => `${e.label} ${e.value}`),
    ].some((v: any) => v?.toLowerCase().includes(q)));
  }, [rawLeads, searchQuery]);

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
  const { search, statusConfigs, sourceConfigs = [], cardFields = [] } = data as any;

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
      setDeleteTarget(null);
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <PortalShell searchTitle={search.title}>
      {/* Edit modal */}
      <Modal
        open={editTarget !== null}
        title={editTarget ? `Modifier — ${editTarget.name}` : 'Modifier'}
        onClose={() => setEditTarget(null)}
      >
        {editTarget && (
          <EditLeadModal
            token={token!}
            lead={editTarget}
            onClose={() => { setEditTarget(null); refetch(); }}
          />
        )}
      </Modal>

      {/* Note modal */}
      <Modal
        open={noteTarget !== null}
        title={noteTarget ? `Notes — ${noteTarget.name}` : 'Notes'}
        onClose={() => setNoteTarget(null)}
      >
        {noteTarget && (
          <NoteModal token={token!} lead={noteTarget} onClose={() => setNoteTarget(null)} />
        )}
      </Modal>

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

      {/* Page header */}
      <div className='mb-5'>
        <h1 className='text-xl font-bold text-ink'>{search.title}</h1>
        {search.description && <p className='text-sm text-muted mt-1'>{search.description}</p>}
        <p className='text-xs text-muted mt-1'>
          {rawLeads.length} prospect{rawLeads.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Kanban */}
      <LeadKanbanBoard
        leads={filteredLeads}
        statusConfigs={statusConfigs}
        sources={sourceConfigs}
        cardFields={cardFields}
        updateStatus={updateStatus}
        reorder={reorder}
        refetch={refetch}
        onCardClick={setEditTarget}
        cardMenu={lead => [
          {
            key: 'notes',
            label: lead.noteCount > 0 ? `Notes (${lead.noteCount})` : 'Ajouter une note',
            icon: <LuNotebook size={15} />,
            onSelect: () => setNoteTarget(lead),
          },
          { key: 'edit', label: 'Modifier', icon: <LuPencil size={15} />, onSelect: () => setEditTarget(lead) },
          { key: 'delete', label: 'Supprimer', icon: <LuTrash2 size={15} />, danger: true, onSelect: () => setDeleteTarget(lead) },
        ]}
        cardBadges={lead => lead.noteCount > 0 ? (
          <LeadChip icon={<LuNotebook size={11} />}>
            {lead.noteCount} note{lead.noteCount > 1 ? 's' : ''}
          </LeadChip>
        ) : null}
        toolbar={
          <div className='mb-3 space-y-2'>
            <div className='relative sm:max-w-xs'>
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
            {searchQuery.trim() && (
              <p className='text-sm text-muted'>
                {filteredLeads.length} sur {rawLeads.length} prospect{rawLeads.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        }
      />
    </PortalShell>
  );
}

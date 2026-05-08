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
} from 'react-icons/lu';
import { Modal } from '../../client/ui';
import {
  NoteThread,
  LeadEditForm,
  LeadKanbanBoard,
  LeadDeleteConfirmModal,
  type LeadFormValues,
} from './leads.shared';

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
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  function toggleFilter(key: string) {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function getEmailDomain(email: string): string {
    return email.split('@')[1]?.toLowerCase() ?? '';
  }
  function getWebsiteDomain(url: string): string {
    try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase(); }
    catch { return url.toLowerCase().replace(/^www\./, ''); }
  }
  function emailMatchesDomain(l: any): boolean {
    if (!l.email || !l.website) return true;
    const eDomain = getEmailDomain(l.email);
    const wDomain = getWebsiteDomain(l.website);
    return eDomain === wDomain || wDomain.endsWith(`.${eDomain}`) || eDomain.endsWith(`.${wDomain}`);
  }

  const rawLeads: any[] = (data as any)?.leads ?? [];
  const filteredLeads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rawLeads.filter(l => {
      if (q && ![l.name, l.email, l.phone, l.website, l.address, l.category].some((v: any) => v?.toLowerCase().includes(q))) return false;
      for (const f of activeFilters) {
        if (f === 'no_email' && !!l.email) return false;
        if (f === 'no_website' && !!l.website) return false;
        if (f === 'email_mismatch' && (!l.email || !l.website || emailMatchesDomain(l))) return false;
      }
      return true;
    });
  }, [rawLeads, searchQuery, activeFilters]);

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

  const { search, statusConfigs } = data as any;

  async function updateStatus(leadId: string, newStatus: string) {
    await (updateLeadByToken as any)({ token: token!, leadId, status: newStatus });
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
        updateStatus={updateStatus}
        refetch={refetch}
        cardActions={lead => (
          <div className='flex items-center gap-1'>
            <button
              className='w-6 h-6 rounded flex items-center justify-center hover:bg-canvas text-muted hover:text-ink transition-colors relative'
              title={lead.noteCount > 0 ? 'Voir les notes' : 'Ajouter une note'}
              onClick={e => { e.stopPropagation(); setNoteTarget(lead); }}
            >
              <LuNotebook size={11} />
              {lead.noteCount > 0 && (
                <span className='absolute -top-1 -right-1 min-w-[14px] h-3.5 rounded-full bg-accent-500 text-white text-[8px] font-bold flex items-center justify-center px-0.5 pointer-events-none leading-none'>
                  {lead.noteCount}
                </span>
              )}
            </button>
            <button
              className='w-6 h-6 rounded flex items-center justify-center hover:bg-canvas text-muted hover:text-ink transition-colors'
              title='Modifier'
              onClick={e => { e.stopPropagation(); setEditTarget(lead); }}
            >
              <LuPencil size={11} />
            </button>
            <button
              className='w-6 h-6 rounded flex items-center justify-center hover:bg-red-50 text-muted hover:text-red-500 transition-colors'
              title='Supprimer ce prospect'
              onClick={e => { e.stopPropagation(); setDeleteTarget(lead); }}
            >
              <LuTrash2 size={11} />
            </button>
          </div>
        )}
        searchBarSlot={
          <div className='flex items-center gap-2 flex-wrap pb-3'>
            <div className='relative'>
              <LuSearch
                size={13}
                className='absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none'
              />
              <input
                type='text'
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder='Rechercher…'
                className='text-xs pl-7 pr-2.5 py-1 rounded-full border border-line bg-canvas text-ink placeholder-muted focus:outline-none focus:border-accent-400 w-40'
              />
            </div>
            {([
              { key: 'no_email',       label: '✉ Sans courriel',         title: 'Prospects sans adresse courriel' },
              { key: 'no_website',     label: '🌐 Sans site web',        title: 'Prospects sans site web' },
              { key: 'email_mismatch', label: '⚠ Courriel hors domaine', title: 'Courriel dont le domaine ne correspond pas au site web' },
            ] as const).map(c => (
              <button
                key={c.key}
                title={c.title}
                onClick={() => toggleFilter(c.key)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  activeFilters.has(c.key)
                    ? 'bg-accent-600 border-accent-600 text-white'
                    : 'bg-canvas border-line text-muted hover:border-accent-400 hover:text-ink'
                }`}
              >
                {c.label}
              </button>
            ))}
            {(activeFilters.size > 0 || searchQuery.trim()) && (
              <button
                onClick={() => { setActiveFilters(new Set()); setSearchQuery(''); }}
                className='text-xs px-2 py-1 text-muted hover:text-ink transition-colors'
              >
                Réinitialiser
              </button>
            )}
            {(activeFilters.size > 0 || searchQuery.trim()) && (
              <span className='text-xs text-muted ml-auto'>
                {filteredLeads.length} / {rawLeads.length} prospect{rawLeads.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        }
        cssClass='kanban-portal'
      />
    </PortalShell>
  );
}

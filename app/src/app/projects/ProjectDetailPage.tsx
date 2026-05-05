import { useState, useRef, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import {
  useQuery,
  useAction,
  getProjectDetail,
  getClients,
  updateProjectDetail,
  createProjectTask,
  updateProjectTask,
  deleteProjectTask,
  createProjectNote,
  updateProjectNote,
  deleteProjectNote,
  createProjectClientAccess,
  revokeProjectClientAccess,
} from 'wasp/client/operations';
import {
  LuLayoutDashboard,
  LuSquareCheck,
  LuFileText,
  LuLock,
  LuUsers,
  LuArrowLeft,
  LuPlus,
  LuPencil,
  LuTrash2,
  LuCheck,
  LuClock,
  LuCircle,
  LuChevronDown,
  LuChevronUp,
  LuCopy,
  LuEyeOff,
  LuEye,
  LuCircleAlert,
  LuExternalLink,
  LuRefreshCw,
  LuX,
  LuFlag,
  LuFolderOpen,
} from 'react-icons/lu';
import { useConfirm, IconBtn, Modal } from '../../client/ui';
import { ProjectFileManagerTab } from './ProjectFileManagerTab';
import { formatDate } from '../../shared/format';

// ─── Status & priority maps ───────────────────────────────────────────────────

const PROJECT_STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  en_cours: { label: 'En cours', className: 'badge-info' },
  en_pause: { label: 'En pause', className: 'badge-warning' },
  termine: { label: 'Terminé', className: 'badge-success' },
  annule: { label: 'Annulé', className: 'badge-danger' },
};

const TASK_STATUS: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  todo: { label: 'À faire', icon: <LuCircle size={16} />, className: 'text-muted' },
  in_progress: { label: 'En cours', icon: <LuClock size={16} />, className: 'text-blue-500' },
  done: { label: 'Terminée', icon: <LuCheck size={16} />, className: 'text-green-500' },
};

const TASK_PRIORITY: Record<string, { label: string; className: string; color: string }> = {
  low: { label: 'Basse', className: 'text-muted', color: '#9ca3af' },
  medium: { label: 'Moyenne', className: 'text-amber-500', color: '#f59e0b' },
  high: { label: 'Haute', className: 'text-red-500', color: '#ef4444' },
};

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'apercu', label: 'Aperçu', icon: <LuLayoutDashboard size={16} /> },
  { id: 'taches', label: 'Tâches', icon: <LuSquareCheck size={16} /> },
  { id: 'notes', label: 'Notes', icon: <LuFileText size={16} /> },
  { id: 'privees', label: 'Notes privées', icon: <LuLock size={16} /> },
  { id: 'portail', label: 'Portail client', icon: <LuUsers size={16} /> },
  { id: 'fichiers', label: 'Fichiers', icon: <LuFolderOpen size={16} /> },
] as const;

type TabId = (typeof TABS)[number]['id'];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') as TabId | null;
  const activeTab: TabId = TABS.some((t) => t.id === rawTab) ? rawTab! : 'apercu';
  const setActiveTab = (id: TabId) => setSearchParams({ tab: id }, { replace: true });
  const { data, isLoading, error } = useQuery(getProjectDetail, { projectId: projectId! });

  if (isLoading) {
    return (
      <div className='flex items-center justify-center h-64 text-muted'>
        Chargement du projet…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className='card p-8 text-center'>
        <LuCircleAlert size={32} className='mx-auto mb-3 text-danger' />
        <p className='text-ink font-medium'>Projet introuvable</p>
        <Link to='/projets' className='btn-secondary mt-4 inline-flex items-center gap-2'>
          <LuArrowLeft size={16} /> Retour aux projets
        </Link>
      </div>
    );
  }

  const { project, tasks, notes, privateNotes, clientAccess } = data as any;
  const doneTasks = tasks.filter((t: any) => t.status === 'done').length;

  return (
    <div className='flex flex-col gap-0'>
      {/* Breadcrumb + header */}
      <div className='flex items-center gap-3 mb-5'>
        <Link
          to='/projets'
          className='flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors'
        >
          <LuArrowLeft size={15} /> Projets
        </Link>
        <span className='text-muted'>/</span>
        <span className='text-sm font-medium text-ink truncate max-w-xs'>{project.name}</span>
        <span className={`${PROJECT_STATUS[project.status]?.className || 'badge-neutral'} ml-1`}>
          {PROJECT_STATUS[project.status]?.label || project.status}
        </span>
      </div>

      {/* Quick stats bar */}
      <div className='grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5'>
        <StatCard label='Tâches' value={`${doneTasks} / ${tasks.length}`} sub='terminées' />
        <StatCard label='Notes' value={String(notes.length + privateNotes.length)} sub='au total' />
        <StatCard label='Accès client' value={String(clientAccess.filter((a: any) => !a.isRevoked).length)} sub='liens actifs' />
      </div>

      {/* Tabs */}
      <div className='flex gap-1 border-b border-line mb-6 overflow-x-auto'>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === 'privees' && privateNotes.length > 0 && (
              <span className='badge-neutral text-xs px-1.5 py-0.5 rounded-full'>{privateNotes.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div>
        {activeTab === 'apercu' && <OverviewTab project={project} />}
        {activeTab === 'taches' && <TasksTab projectId={projectId!} tasks={tasks} />}
        {activeTab === 'notes' && <NotesTab projectId={projectId!} notes={notes} isPrivate={false} />}
        {activeTab === 'privees' && <NotesTab projectId={projectId!} notes={privateNotes} isPrivate={true} />}
        {activeTab === 'portail' && <PortalTab projectId={projectId!} clientAccess={clientAccess} />}
        {activeTab === 'fichiers' && <ProjectFileManagerTab projectId={projectId!} />}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className='card p-4'>
      <div className='text-xs text-muted mb-1'>{label}</div>
      <div className='text-2xl font-bold text-ink'>{value}</div>
      <div className='text-xs text-muted mt-0.5'>{sub}</div>
    </div>
  );
}

// ─── Tab: Aperçu ──────────────────────────────────────────────────────────────

function OverviewTab({ project }: { project: any }) {
  const [editing, setEditing] = useState(false);
  const { data: clients } = useQuery(getClients);
  const [form, setForm] = useState({
    name: project.name,
    description: project.description || '',
    clientId: project.clientId || '',
    status: project.status,
  });
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProjectDetail({
        id: project.id,
        name: form.name,
        description: form.description || undefined,
        clientId: form.clientId || null,
        status: form.status,
      });
      toast.success('Projet mis à jour');
      setEditing(false);
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className='card p-6 max-w-2xl'>
        <h2 className='font-semibold text-ink mb-5'>Modifier les détails</h2>
        <form onSubmit={save} className='flex flex-col gap-4'>
          <div>
            <label className='label'>Titre *</label>
            <input className='input' required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className='label'>Description</label>
            <textarea className='input' rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className='grid grid-cols-2 gap-4'>
            <div>
              <label className='label'>Client</label>
              <select className='input' value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                <option value=''>— Aucun —</option>
                {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className='label'>Statut</label>
              <select className='input' value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {Object.entries(PROJECT_STATUS).map(([v, { label }]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </div>
          </div>
          <div className='flex justify-end gap-2 pt-2'>
            <button type='button' className='btn-secondary' onClick={() => setEditing(false)}>Annuler</button>
            <button type='submit' className='btn-primary' disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className='card p-6 max-w-2xl'>
      <div className='flex items-start justify-between mb-4'>
        <h2 className='font-bold text-xl text-ink'>{project.name}</h2>
        <button className='btn-secondary flex items-center gap-2 text-sm' onClick={() => setEditing(true)}>
          <LuPencil size={14} /> Modifier
        </button>
      </div>
      {project.description && <p className='text-muted text-sm leading-relaxed mb-5'>{project.description}</p>}
      <dl className='grid grid-cols-2 gap-x-8 gap-y-3 text-sm'>
        <dt className='text-muted'>Client</dt>
        <dd className='text-ink font-medium'>{project.client?.name || '—'}</dd>
        <dt className='text-muted'>Statut</dt>
        <dd>
          <span className={PROJECT_STATUS[project.status]?.className || 'badge-neutral'}>
            {PROJECT_STATUS[project.status]?.label || project.status}
          </span>
        </dd>
      </dl>
    </div>
  );
}

// ─── Tab: Tâches ──────────────────────────────────────────────────────────────

function TasksTab({ projectId, tasks }: { projectId: string; tasks: any[] }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const { ask, Dialog } = useConfirm();

  const columns = [
    { status: 'todo', label: 'À faire' },
    { status: 'in_progress', label: 'En cours' },
    { status: 'done', label: 'Terminées' },
  ] as const;

  const byStatus = (s: string) => tasks.filter((t) => t.status === s);

  const remove = async (task: any) => {
    if (await ask(`Supprimer « ${task.title} » ?`)) {
      try {
        await deleteProjectTask({ id: task.id });
        toast.success('Tâche supprimée');
      } catch (err: any) {
        toast.error(err?.message);
      }
    }
  };

  const moveTask = async (taskId: string, newStatus: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;
    try {
      await updateProjectTask({ id: taskId, status: newStatus });
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const onDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggingId(taskId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
  };

  const onDragEnd = () => {
    setDraggingId(null);
    setDragOverCol(null);
  };

  const onDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(status);
  };

  const onDrop = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) moveTask(taskId, status);
    setDragOverCol(null);
    setDraggingId(null);
  };

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex justify-end'>
        <button className='btn-primary flex items-center gap-2' onClick={() => setAdding(true)}>
          <LuPlus size={16} /> Ajouter une tâche
        </button>
      </div>

      <div className='grid grid-cols-3 gap-4'>
        {columns.map(({ status, label }) => {
          const items = byStatus(status);
          const isOver = dragOverCol === status;
          return (
            <div
              key={status}
              onDragOver={(e) => onDragOver(e, status)}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => onDrop(e, status)}
              className={`rounded-xl p-3 flex flex-col gap-2 min-h-[200px] transition-colors ${
                isOver ? 'bg-accent/10 ring-2 ring-accent/40' : 'bg-canvas-100'
              }`}
            >
              <div className='flex items-center justify-between mb-1'>
                <h3 className='text-xs font-semibold uppercase tracking-wider text-muted'>{label}</h3>
                <span className='text-xs text-muted bg-canvas-200 rounded-full px-2 py-0.5'>{items.length}</span>
              </div>

              {items.map((t) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={(e) => onDragStart(e, t.id)}
                  onDragEnd={onDragEnd}
                  className={`card px-3 py-2.5 flex flex-col gap-1.5 group cursor-grab active:cursor-grabbing transition-opacity ${
                    draggingId === t.id ? 'opacity-40' : ''
                  }`}
                >
                  {editingId === t.id ? (
                    <TaskEditInline task={t} onClose={() => setEditingId(null)} />
                  ) : (
                    <>
                      <div className='flex items-start justify-between gap-2'>
                        <span className={`text-sm font-medium leading-snug ${t.status === 'done' ? 'line-through text-muted' : 'text-ink'}`}>
                          {t.title}
                        </span>
                        <div className='flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0'>
                          <IconBtn title='Modifier' onClick={() => setEditingId(t.id)}><LuPencil size={13} /></IconBtn>
                          <IconBtn variant='danger' title='Supprimer' onClick={() => remove(t)}><LuTrash2 size={13} /></IconBtn>
                        </div>
                      </div>
                      {t.description && <p className='text-xs text-muted leading-snug'>{t.description}</p>}
                      <span className={`text-xs font-medium flex items-center gap-1 ${TASK_PRIORITY[t.priority]?.className}`}>
                        <LuFlag size={11} />
                        {TASK_PRIORITY[t.priority]?.label}
                      </span>
                    </>
                  )}
                </div>
              ))}

              {items.length === 0 && !isOver && (
                <p className='text-xs text-muted italic text-center mt-4'>Glisser une tâche ici</p>
              )}
            </div>
          );
        })}
      </div>

      {Dialog}
      <TaskAddModal open={adding} projectId={projectId} onClose={() => setAdding(false)} />
    </div>
  );
}

function TaskAddModal({ open, projectId, onClose }: { open: boolean; projectId: string; onClose: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium' });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createProjectTask({
        projectId,
        title: form.title,
        description: form.description || undefined,
        priority: form.priority,
      });
      toast.success('Tâche ajoutée');
      setForm({ title: '', description: '', priority: 'medium' });
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title='Nouvelle tâche'
      footer={
        <>
          <button type='button' className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='task-add-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Ajout…' : 'Ajouter'}
          </button>
        </>
      }
    >
      <form id='task-add-form' onSubmit={submit} className='flex flex-col gap-4'>
        <div>
          <label className='label'>Titre *</label>
          <input
            autoFocus
            className='input'
            required
            placeholder='Titre de la tâche…'
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>
        <div>
          <label className='label'>Description</label>
          <textarea
            className='input'
            rows={3}
            placeholder='Description (optionnel)'
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div>
          <label className='label'>Priorité</label>
          <select className='input' value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {Object.entries(TASK_PRIORITY).map(([v, { label }]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>
      </form>
    </Modal>
  );
}

function TaskEditInline({ task, onClose }: { task: any; onClose: () => void }) {
  const [form, setForm] = useState({ title: task.title, description: task.description || '', priority: task.priority });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProjectTask({ id: task.id, ...form });
      toast.success('Tâche modifiée');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className='flex flex-col gap-2'>
      <input autoFocus className='input text-sm' required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <textarea className='input text-sm' rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <select className='input text-sm' value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
        {Object.entries(TASK_PRIORITY).map(([v, { label }]) => <option key={v} value={v}>{label}</option>)}
      </select>
      <div className='flex gap-2'>
        <button type='button' className='btn-secondary text-xs' onClick={onClose}>Annuler</button>
        <button type='submit' className='btn-primary text-xs' disabled={saving}>Enregistrer</button>
      </div>
    </form>
  );
}

// ─── Tab: Notes ───────────────────────────────────────────────────────────────

function NotesTab({ projectId, notes, isPrivate }: { projectId: string; notes: any[]; isPrivate: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const { ask, Dialog } = useConfirm();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    try {
      await createProjectNote({ projectId, content, isPrivate });
      toast.success('Note ajoutée');
      setContent('');
      setAdding(false);
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (note: any) => {
    if (await ask('Supprimer cette note ?')) {
      try {
        await deleteProjectNote({ id: note.id });
        toast.success('Note supprimée');
      } catch (err: any) {
        toast.error(err?.message);
      }
    }
  };

  return (
    <div className='flex flex-col gap-4 max-w-2xl'>
      {isPrivate && (
        <div className='flex items-center gap-2 text-sm text-muted bg-amber-50 border border-amber-200 rounded-lg px-4 py-3'>
          <LuLock size={15} className='text-amber-500 shrink-0' />
          Ces notes sont <strong>strictement privées</strong> — elles ne sont jamais partagées avec le client.
        </div>
      )}

      <button
        className='btn-primary self-start flex items-center gap-2'
        onClick={() => setAdding(!adding)}
      >
        <LuPlus size={16} />
        {isPrivate ? 'Nouvelle note privée' : 'Nouvelle note'}
      </button>

      {adding && (
        <form onSubmit={submit} className='card p-4 flex flex-col gap-3 border-2 border-accent/30'>
          <textarea
            autoFocus
            className='input'
            rows={4}
            placeholder={isPrivate ? 'Note personnelle, mémo, contexte interne…' : 'Ajouter une note ou un commentaire…'}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className='flex justify-end gap-2'>
            <button type='button' className='btn-secondary text-sm' onClick={() => { setAdding(false); setContent(''); }}>Annuler</button>
            <button type='submit' className='btn-primary text-sm' disabled={saving || !content.trim()}>
              {saving ? '…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      )}

      {notes.length === 0 ? (
        <div className='text-center py-10 text-muted text-sm'>
          {isPrivate ? 'Aucune note privée pour ce projet.' : 'Aucune note pour ce projet.'}
        </div>
      ) : (
        notes.map((note) =>
          editingId === note.id ? (
            <NoteEditCard key={note.id} note={note} onClose={() => setEditingId(null)} />
          ) : (
            <div key={note.id} className='card p-4 group relative'>
              {note.isFromClient && (
                <span className='absolute top-3 right-3 text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full'>
                  {note.authorName || 'Client'}
                </span>
              )}
              <p className='text-sm text-ink whitespace-pre-wrap leading-relaxed'>{note.content}</p>
              <div className='flex items-center justify-between mt-3'>
                <div className='text-xs text-muted'>
                  {note.user?.fullName || note.user?.email || note.authorName || 'Utilisateur'} · {formatDate(note.createdAt)}
                </div>
                {!note.isFromClient && (
                  <div className='flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
                    <IconBtn title='Modifier' onClick={() => setEditingId(note.id)}><LuPencil size={14} /></IconBtn>
                    <IconBtn variant='danger' title='Supprimer' onClick={() => remove(note)}><LuTrash2 size={14} /></IconBtn>
                  </div>
                )}
              </div>
            </div>
          )
        )
      )}
      {Dialog}
    </div>
  );
}

function NoteEditCard({ note, onClose }: { note: any; onClose: () => void }) {
  const [content, setContent] = useState(note.content);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await updateProjectNote({ id: note.id, content });
      toast.success('Note modifiée');
      onClose();
    } catch (err: any) {
      toast.error(err?.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='card p-4 border-2 border-accent/30'>
      <textarea autoFocus className='input w-full' rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
      <div className='flex justify-end gap-2 mt-3'>
        <button className='btn-secondary text-sm' onClick={onClose}>Annuler</button>
        <button className='btn-primary text-sm' onClick={save} disabled={saving || !content.trim()}>Enregistrer</button>
      </div>
    </div>
  );
}

// ─── Tab: Portail client ──────────────────────────────────────────────────────

function PortalTab({ projectId, clientAccess }: { projectId: string; clientAccess: any[] }) {
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const { ask, Dialog } = useConfirm();

  const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/portail/` : '/portail/';

  const create = async () => {
    setCreating(true);
    try {
      await createProjectClientAccess({ projectId, label: label.trim() || undefined });
      toast.success('Lien client créé');
      setLabel('');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (access: any) => {
    if (await ask(`Révoquer ce lien ? Le client ne pourra plus y accéder.`)) {
      try {
        await revokeProjectClientAccess({ id: access.id });
        toast.success('Lien révoqué');
      } catch (err: any) {
        toast.error(err?.message);
      }
    }
  };

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${baseUrl}${token}`);
    toast.success('Lien copié dans le presse-papiers');
  };

  const active = clientAccess.filter((a) => !a.isRevoked);
  const revoked = clientAccess.filter((a) => a.isRevoked);

  return (
    <div className='flex flex-col gap-6 max-w-2xl'>
      {/* Explanation */}
      <div className='card p-5 bg-blue-50 border-blue-200'>
        <h3 className='font-semibold text-ink mb-2 flex items-center gap-2'>
          <LuUsers size={18} className='text-blue-500' />
          Portail client
        </h3>
        <p className='text-sm text-muted leading-relaxed'>
          Générez un lien sécurisé à partager avec votre client. Via ce lien, le client peut consulter l'avancement du projet, téléverser des fichiers médias, et laisser des commentaires — sans créer de compte.
        </p>
      </div>

      {/* Create link */}
      <div className='card p-5'>
        <h3 className='font-semibold text-ink mb-3'>Créer un nouveau lien</h3>
        <div className='flex gap-3'>
          <input
            className='input flex-1'
            placeholder='Étiquette (ex. Lien client V2) — optionnel'
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button className='btn-primary whitespace-nowrap' onClick={create} disabled={creating}>
            <LuPlus size={16} className='inline mr-1' />
            {creating ? 'Création…' : 'Générer'}
          </button>
        </div>
      </div>

      {/* Active links */}
      {active.length > 0 && (
        <div>
          <h3 className='text-xs font-semibold uppercase tracking-wider text-muted mb-2'>Liens actifs ({active.length})</h3>
          <div className='flex flex-col gap-3'>
            {active.map((access) => (
              <div key={access.id} className='card p-4'>
                <div className='flex items-start justify-between gap-3'>
                  <div className='flex-1 min-w-0'>
                    <p className='text-sm font-medium text-ink'>{access.label || 'Lien sans étiquette'}</p>
                    <p className='text-xs text-muted mt-0.5 truncate font-mono'>{baseUrl}{access.token}</p>
                    <div className='flex items-center gap-3 mt-1.5 text-xs text-muted'>
                      <span>Créé le {formatDate(access.createdAt)}</span>
                      {access.lastUsedAt && <span>· Dernière visite {formatDate(access.lastUsedAt)}</span>}
                      {access.expiresAt && <span>· Expire le {formatDate(access.expiresAt)}</span>}
                    </div>
                  </div>
                  <div className='flex gap-2 shrink-0'>
                    <button
                      className='btn-secondary text-sm flex items-center gap-1.5'
                      onClick={() => copyLink(access.token)}
                    >
                      <LuCopy size={14} /> Copier
                    </button>
                    <a
                      href={`/portail/${access.token}`}
                      target='_blank'
                      rel='noreferrer'
                      className='btn-secondary text-sm flex items-center gap-1.5'
                    >
                      <LuExternalLink size={14} /> Voir
                    </a>
                    <button
                      className='btn-danger text-sm flex items-center gap-1.5'
                      onClick={() => revoke(access)}
                    >
                      <LuX size={14} /> Révoquer
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Revoked links */}
      {revoked.length > 0 && (
        <div>
          <h3 className='text-xs font-semibold uppercase tracking-wider text-muted mb-2'>Liens révoqués ({revoked.length})</h3>
          <div className='flex flex-col gap-2'>
            {revoked.map((access) => (
              <div key={access.id} className='card p-3 opacity-50'>
                <p className='text-sm text-muted'>{access.label || 'Lien sans étiquette'} — révoqué le {formatDate(access.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {clientAccess.length === 0 && (
        <p className='text-muted text-sm text-center py-6'>Aucun lien client généré pour ce projet.</p>
      )}

      {Dialog}
    </div>
  );
}

import { useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router';
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
  uploadProjectMedia,
  updateProjectMedia,
  deleteProjectMedia,
  createProjectClientAccess,
  revokeProjectClientAccess,
  createProjectLink,
  updateProjectLink,
  deleteProjectLink,
} from 'wasp/client/operations';
import {
  LuLayoutDashboard,
  LuSquareCheck,
  LuImage,
  LuFileText,
  LuLock,
  LuLink,
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
  LuDownload,
  LuTag,
  LuCopy,
  LuEyeOff,
  LuEye,
  LuCircleAlert,
  LuCalendar,
  LuExternalLink,
  LuRefreshCw,
  LuUpload,
  LuX,
  LuFlag,
} from 'react-icons/lu';
import { useConfirm, IconBtn } from '../../client/ui';
import { formatDate, formatDateForInput } from '../../shared/format';

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

const LINK_CATEGORIES: Record<string, { label: string; emoji: string }> = {
  design: { label: 'Design', emoji: '🎨' },
  dev: { label: 'Développement', emoji: '💻' },
  doc: { label: 'Document', emoji: '📄' },
  credential: { label: 'Accès / Identifiants', emoji: '🔑' },
  reference: { label: 'Référence', emoji: '📎' },
  autre: { label: 'Autre', emoji: '🔗' },
};

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'apercu', label: 'Aperçu', icon: <LuLayoutDashboard size={16} /> },
  { id: 'taches', label: 'Tâches', icon: <LuSquareCheck size={16} /> },
  { id: 'medias', label: 'Médias', icon: <LuImage size={16} /> },
  { id: 'notes', label: 'Notes', icon: <LuFileText size={16} /> },
  { id: 'privees', label: 'Notes privées', icon: <LuLock size={16} /> },
  { id: 'ressources', label: 'Ressources', icon: <LuLink size={16} /> },
  { id: 'portail', label: 'Portail client', icon: <LuUsers size={16} /> },
] as const;

type TabId = (typeof TABS)[number]['id'];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [activeTab, setActiveTab] = useState<TabId>('apercu');
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

  const { project, tasks, notes, privateNotes, media, clientAccess, links } = data as any;
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
        <StatCard label='Médias' value={String(media.length)} sub='fichiers' />
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
        {activeTab === 'medias' && <MediaTab projectId={projectId!} media={media} />}
        {activeTab === 'notes' && <NotesTab projectId={projectId!} notes={notes} isPrivate={false} />}
        {activeTab === 'privees' && <NotesTab projectId={projectId!} notes={privateNotes} isPrivate={true} />}
        {activeTab === 'ressources' && <LinksTab projectId={projectId!} links={links} />}
        {activeTab === 'portail' && <PortalTab projectId={projectId!} clientAccess={clientAccess} />}
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
  const { ask, Dialog } = useConfirm();

  const todo = tasks.filter((t) => t.status === 'todo');
  const inProgress = tasks.filter((t) => t.status === 'in_progress');
  const done = tasks.filter((t) => t.status === 'done');

  const toggleStatus = async (task: any) => {
    const next = task.status === 'todo' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'todo';
    try {
      await updateProjectTask({ id: task.id, status: next });
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

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

  const TaskGroup = ({ label, items, emptyText }: { label: string; items: any[]; emptyText: string }) => (
    <div>
      <h3 className='text-xs font-semibold uppercase tracking-wider text-muted mb-2'>{label} ({items.length})</h3>
      {items.length === 0 ? (
        <p className='text-sm text-muted italic pl-1'>{emptyText}</p>
      ) : (
        <div className='flex flex-col gap-2'>
          {items.map((t) => (
            <div key={t.id} className='card px-4 py-3 flex items-start gap-3 group'>
              <button
                onClick={() => toggleStatus(t)}
                className={`mt-0.5 shrink-0 transition-colors ${TASK_STATUS[t.status]?.className}`}
                title={`Statut : ${TASK_STATUS[t.status]?.label}`}
              >
                {TASK_STATUS[t.status]?.icon}
              </button>
              <div className='flex-1 min-w-0'>
                {editingId === t.id ? (
                  <TaskEditInline task={t} onClose={() => setEditingId(null)} />
                ) : (
                  <>
                    <span className={`text-sm font-medium ${t.status === 'done' ? 'line-through text-muted' : 'text-ink'}`}>
                      {t.title}
                    </span>
                    {t.description && <p className='text-xs text-muted mt-0.5'>{t.description}</p>}
                    <div className='flex items-center gap-3 mt-1'>
                      <span className={`text-xs font-medium flex items-center gap-1 ${TASK_PRIORITY[t.priority]?.className}`}>
                        <LuFlag size={11} />
                        {TASK_PRIORITY[t.priority]?.label}
                      </span>
                      {t.dueDate && (
                        <span className='text-xs text-muted flex items-center gap-1'>
                          <LuCalendar size={11} />
                          {formatDate(t.dueDate)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
              {editingId !== t.id && (
                <div className='flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
                  <IconBtn title='Modifier' onClick={() => setEditingId(t.id)}><LuPencil size={14} /></IconBtn>
                  <IconBtn variant='danger' title='Supprimer' onClick={() => remove(t)}><LuTrash2 size={14} /></IconBtn>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex justify-end'>
        <button className='btn-primary flex items-center gap-2' onClick={() => setAdding(true)}>
          <LuPlus size={16} /> Ajouter une tâche
        </button>
      </div>

      {adding && <TaskAddForm projectId={projectId} onClose={() => setAdding(false)} />}

      <TaskGroup label='À faire' items={todo} emptyText='Aucune tâche à faire' />
      <TaskGroup label='En cours' items={inProgress} emptyText='Aucune tâche en cours' />
      <TaskGroup label='Terminées' items={done} emptyText='Aucune tâche terminée' />

      {Dialog}
    </div>
  );
}

function TaskAddForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', dueDate: '' });
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
        dueDate: form.dueDate || null,
      });
      toast.success('Tâche ajoutée');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='card p-4 border-2 border-accent/30'>
      <form onSubmit={submit} className='flex flex-col gap-3'>
        <input autoFocus className='input' required placeholder='Titre de la tâche…' value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <textarea className='input text-sm' rows={2} placeholder='Description (optionnel)' value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className='flex gap-3'>
          <select className='input flex-1' value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {Object.entries(TASK_PRIORITY).map(([v, { label }]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <input type='date' className='input flex-1' value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
        </div>
        <div className='flex justify-end gap-2'>
          <button type='button' className='btn-secondary text-sm' onClick={onClose}>Annuler</button>
          <button type='submit' className='btn-primary text-sm' disabled={saving}>{saving ? '…' : 'Ajouter'}</button>
        </div>
      </form>
    </div>
  );
}

function TaskEditInline({ task, onClose }: { task: any; onClose: () => void }) {
  const [form, setForm] = useState({ title: task.title, description: task.description || '', priority: task.priority, dueDate: formatDateForInput(task.dueDate) });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProjectTask({ id: task.id, ...form, dueDate: form.dueDate || null });
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
      <div className='flex gap-2'>
        <select className='input text-sm flex-1' value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
          {Object.entries(TASK_PRIORITY).map(([v, { label }]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <input type='date' className='input text-sm flex-1' value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
      </div>
      <div className='flex gap-2'>
        <button type='button' className='btn-secondary text-xs' onClick={onClose}>Annuler</button>
        <button type='submit' className='btn-primary text-xs' disabled={saving}>Enregistrer</button>
      </div>
    </form>
  );
}

// ─── Tab: Médias ──────────────────────────────────────────────────────────────

function MediaTab({ projectId, media }: { projectId: string; media: any[] }) {
  const { ask, Dialog } = useConfirm();
  const [uploading, setUploading] = useState(false);
  const [tagFilter, setTagFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const allTags = Array.from(new Set(media.flatMap((m) => m.tags || [])));

  const displayMedia = tagFilter
    ? media.filter((m) => (m.tags || []).includes(tagFilter))
    : media;

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    let ok = 0;
    let fail = 0;
    for (const file of arr) {
      try {
        const dataUrl = await fileToDataUrl(file);
        await uploadProjectMedia({ projectId, dataUrl, name: stripExt(file.name), originalName: file.name });
        ok++;
      } catch {
        fail++;
      }
    }
    setUploading(false);
    if (ok > 0) toast.success(`${ok} fichier${ok > 1 ? 's' : ''} ajouté${ok > 1 ? 's' : ''}`);
    if (fail > 0) toast.error(`${fail} fichier${fail > 1 ? 's' : ''} échoué${fail > 1 ? 's' : ''}`);
  }, [projectId]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  const remove = async (m: any) => {
    if (await ask(`Supprimer « ${m.name} » ?`)) {
      try {
        await deleteProjectMedia({ id: m.id });
        toast.success('Fichier supprimé');
      } catch (err: any) {
        toast.error(err?.message);
      }
    }
  };

  return (
    <div className='flex flex-col gap-5'>
      {/* Upload zone */}
      <div
        ref={dropRef}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileRef.current?.click()}
        className='border-2 border-dashed border-line hover:border-accent cursor-pointer rounded-xl p-8 text-center transition-colors'
      >
        <LuUpload size={28} className='mx-auto mb-2 text-muted' />
        <p className='text-sm font-medium text-ink'>Déposer ou cliquer pour téléverser</p>
        <p className='text-xs text-muted mt-1'>Images (PNG, JPG, WEBP…) et PDF — max 50 Mo par fichier</p>
        <p className='text-xs text-muted'>Les images sont automatiquement converties et compressées en JPEG</p>
        {uploading && <p className='text-sm text-accent mt-2 font-medium'>Traitement en cours…</p>}
        <input
          ref={fileRef}
          type='file'
          multiple
          accept='image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt'
          className='hidden'
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className='flex flex-wrap gap-2'>
          <button
            onClick={() => setTagFilter('')}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${tagFilter === '' ? 'bg-accent text-white border-accent' : 'border-line text-muted hover:border-accent'}`}
          >
            Tout
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setTagFilter(tag === tagFilter ? '' : tag)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${tagFilter === tag ? 'bg-accent text-white border-accent' : 'border-line text-muted hover:border-accent'}`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      {displayMedia.length === 0 ? (
        <p className='text-muted text-sm text-center py-10'>Aucun fichier {tagFilter && `avec le tag « ${tagFilter} »`}</p>
      ) : (
        <div className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4'>
          {displayMedia.map((m) => (
            <MediaCard key={m.id} media={m} onDelete={() => remove(m)} />
          ))}
        </div>
      )}
      {Dialog}
    </div>
  );
}

function MediaCard({ media, onDelete }: { media: any; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(media.name);
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>(media.tags || []);
  const [saving, setSaving] = useState(false);
  const isImage = media.mimeType?.startsWith('image/');

  const save = async () => {
    setSaving(true);
    try {
      await updateProjectMedia({ id: media.id, name, tags });
      toast.success('Mis à jour');
      setEditing(false);
    } catch (err: any) {
      toast.error(err?.message);
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };

  const removeTag = (tag: string) => setTags(tags.filter((t) => t !== tag));

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
    return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  };

  return (
    <div className='card overflow-hidden flex flex-col group'>
      {/* Thumbnail */}
      <div className='aspect-video bg-canvas-200 relative overflow-hidden'>
        {isImage && media.url ? (
          <img src={media.url} alt={media.name} className='w-full h-full object-cover' />
        ) : (
          <div className='w-full h-full flex items-center justify-center text-muted'>
            <LuFileText size={32} />
          </div>
        )}
        {media.isFromClient && (
          <span className='absolute top-1.5 left-1.5 bg-blue-500 text-white text-xs px-1.5 py-0.5 rounded'>Client</span>
        )}
        {/* Hover actions */}
        <div className='absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2'>
          {media.url && (
            <a href={media.url} download={media.name} target='_blank' rel='noreferrer' className='bg-white/90 p-2 rounded-lg hover:bg-white' title='Télécharger'>
              <LuDownload size={16} />
            </a>
          )}
          <button onClick={() => setEditing(!editing)} className='bg-white/90 p-2 rounded-lg hover:bg-white' title='Modifier'>
            <LuPencil size={16} />
          </button>
          <button onClick={onDelete} className='bg-red-500/90 p-2 rounded-lg hover:bg-red-500 text-white' title='Supprimer'>
            <LuTrash2 size={16} />
          </button>
        </div>
      </div>

      {/* Info */}
      <div className='p-3 flex-1'>
        {editing ? (
          <div className='flex flex-col gap-2'>
            <input
              autoFocus
              className='input text-xs'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Nom du fichier'
            />
            <div className='flex flex-wrap gap-1'>
              {tags.map((t) => (
                <span key={t} className='flex items-center gap-1 text-xs bg-canvas-200 text-ink px-2 py-0.5 rounded-full'>
                  {t}
                  <button onClick={() => removeTag(t)} className='text-muted hover:text-danger'><LuX size={10} /></button>
                </span>
              ))}
            </div>
            <div className='flex gap-1'>
              <input
                className='input text-xs flex-1'
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                placeholder='Ajouter un tag…'
              />
              <button type='button' onClick={addTag} className='btn-secondary text-xs px-2'><LuTag size={12} /></button>
            </div>
            <div className='flex gap-1'>
              <button className='btn-secondary text-xs flex-1' onClick={() => setEditing(false)}>Annuler</button>
              <button className='btn-primary text-xs flex-1' onClick={save} disabled={saving}>OK</button>
            </div>
          </div>
        ) : (
          <>
            <p className='text-sm font-medium text-ink truncate'>{media.name}</p>
            <p className='text-xs text-muted mt-0.5'>{formatSize(media.size)}</p>
            {(tags.length > 0) && (
              <div className='flex flex-wrap gap-1 mt-2'>
                {tags.map((t) => (
                  <span key={t} className='text-xs bg-canvas-200 text-muted px-1.5 py-0.5 rounded-full'>{t}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
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

// ─── Tab: Ressources ──────────────────────────────────────────────────────────

function LinksTab({ projectId, links }: { projectId: string; links: any[] }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { ask, Dialog } = useConfirm();

  const remove = async (link: any) => {
    if (await ask(`Supprimer « ${link.title} » ?`)) {
      try {
        await deleteProjectLink({ id: link.id });
        toast.success('Lien supprimé');
      } catch (err: any) {
        toast.error(err?.message);
      }
    }
  };

  const grouped: Record<string, any[]> = {};
  for (const cat of Object.keys(LINK_CATEGORIES)) {
    const items = links.filter((l) => l.category === cat);
    if (items.length > 0) grouped[cat] = items;
  }

  return (
    <div className='flex flex-col gap-5 max-w-2xl'>
      <div className='flex justify-end'>
        <button className='btn-primary flex items-center gap-2' onClick={() => setAdding(!adding)}>
          <LuPlus size={16} /> Ajouter un lien
        </button>
      </div>

      {adding && <LinkAddForm projectId={projectId} onClose={() => setAdding(false)} />}

      {links.length === 0 ? (
        <p className='text-muted text-sm text-center py-10'>Aucune ressource ajoutée.</p>
      ) : (
        Object.entries(grouped).map(([cat, items]) => (
          <div key={cat}>
            <h3 className='text-xs font-semibold uppercase tracking-wider text-muted mb-2'>
              {LINK_CATEGORIES[cat]?.emoji} {LINK_CATEGORIES[cat]?.label}
            </h3>
            <div className='flex flex-col gap-2'>
              {items.map((link) =>
                editingId === link.id ? (
                  <LinkEditCard key={link.id} link={link} onClose={() => setEditingId(null)} />
                ) : (
                  <div key={link.id} className='card px-4 py-3 flex items-start gap-3 group'>
                    <LuLink size={16} className='text-muted shrink-0 mt-0.5' />
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-center gap-2'>
                        <a
                          href={link.url}
                          target='_blank'
                          rel='noreferrer'
                          className='text-sm font-medium text-accent hover:underline truncate'
                        >
                          {link.title}
                        </a>
                        <LuExternalLink size={12} className='text-muted shrink-0' />
                      </div>
                      {link.description && <p className='text-xs text-muted mt-0.5 truncate'>{link.description}</p>}
                      <p className='text-xs text-muted/60 truncate'>{link.url}</p>
                    </div>
                    <div className='flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
                      <IconBtn title='Copier' onClick={() => { navigator.clipboard.writeText(link.url); toast.success('URL copiée'); }}>
                        <LuCopy size={14} />
                      </IconBtn>
                      <IconBtn title='Modifier' onClick={() => setEditingId(link.id)}><LuPencil size={14} /></IconBtn>
                      <IconBtn variant='danger' title='Supprimer' onClick={() => remove(link)}><LuTrash2 size={14} /></IconBtn>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        ))
      )}
      {Dialog}
    </div>
  );
}

function LinkAddForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [form, setForm] = useState({ title: '', url: '', description: '', category: 'autre' });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createProjectLink({ projectId, ...form });
      toast.success('Lien ajouté');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='card p-4 border-2 border-accent/30'>
      <form onSubmit={submit} className='flex flex-col gap-3'>
        <input autoFocus className='input' required placeholder='Titre *' value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <input className='input' required placeholder='URL * (https://…)' type='url' value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        <input className='input' placeholder='Description' value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <select className='input' value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {Object.entries(LINK_CATEGORIES).map(([v, { label, emoji }]) => (
            <option key={v} value={v}>{emoji} {label}</option>
          ))}
        </select>
        <div className='flex justify-end gap-2'>
          <button type='button' className='btn-secondary text-sm' onClick={onClose}>Annuler</button>
          <button type='submit' className='btn-primary text-sm' disabled={saving}>Ajouter</button>
        </div>
      </form>
    </div>
  );
}

function LinkEditCard({ link, onClose }: { link: any; onClose: () => void }) {
  const [form, setForm] = useState({ title: link.title, url: link.url, description: link.description || '', category: link.category });
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProjectLink({ id: link.id, ...form });
      toast.success('Lien modifié');
      onClose();
    } catch (err: any) {
      toast.error(err?.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='card p-4 border-2 border-accent/30'>
      <form onSubmit={save} className='flex flex-col gap-3'>
        <input autoFocus className='input' required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <input className='input' required type='url' value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        <input className='input' value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <select className='input' value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {Object.entries(LINK_CATEGORIES).map(([v, { label, emoji }]) => (
            <option key={v} value={v}>{emoji} {label}</option>
          ))}
        </select>
        <div className='flex justify-end gap-2'>
          <button type='button' className='btn-secondary text-sm' onClick={onClose}>Annuler</button>
          <button type='submit' className='btn-primary text-sm' disabled={saving}>Enregistrer</button>
        </div>
      </form>
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

// ─── Utility helpers ──────────────────────────────────────────────────────────

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function stripExt(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

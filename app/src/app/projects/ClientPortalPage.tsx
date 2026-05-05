import { useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { MediaUploadZone } from './MediaUploadZone';
import {
  useQuery,
  getProjectByToken,
  submitClientMedia,
  submitClientNote,
} from 'wasp/client/operations';
import {
  LuFolderOpen,
  LuSquareCheck,
  LuImage,
  LuMessageSquare,
  LuCircleAlert,
  LuCheck,
  LuClock,
  LuCircle,
  LuDownload,
  LuFileText,
  LuSend,
  LuUser,
  LuLock,
} from 'react-icons/lu';
import { formatDate } from '../../shared/format';

const TASK_STATUS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  todo: { label: 'À faire', icon: <LuCircle size={14} />, color: 'text-muted' },
  in_progress: { label: 'En cours', icon: <LuClock size={14} />, color: 'text-blue-500' },
  done: { label: 'Terminée', icon: <LuCheck size={14} />, color: 'text-green-500' },
};

const PORTAL_TABS = [
  { id: 'overview', label: 'Aperçu', icon: <LuFolderOpen size={16} /> },
  { id: 'tasks', label: 'Tâches', icon: <LuSquareCheck size={16} /> },
  { id: 'media', label: 'Médias', icon: <LuImage size={16} /> },
  { id: 'notes', label: 'Notes', icon: <LuMessageSquare size={16} /> },
] as const;

type PortalTab = (typeof PORTAL_TABS)[number]['id'];

const PROJECT_STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  en_cours: { label: 'En cours', className: 'badge-info' },
  en_pause: { label: 'En pause', className: 'badge-warning' },
  termine: { label: 'Terminé', className: 'badge-success' },
  annule: { label: 'Annulé', className: 'badge-danger' },
};

export default function ClientPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') as PortalTab | null;
  const activeTab: PortalTab = PORTAL_TABS.some((t) => t.id === rawTab) ? rawTab! : 'overview';
  const setActiveTab = (id: PortalTab) => setSearchParams({ tab: id }, { replace: true });
  const { data, isLoading, error } = useQuery(getProjectByToken, { token: token! });

  if (isLoading) {
    return (
      <PortalShell>
        <div className='flex items-center justify-center h-64 text-muted'>
          Chargement du projet…
        </div>
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
            Ce lien d'accès n'est plus valide. Veuillez contacter votre chargé de projet pour obtenir un nouveau lien.
          </p>
        </div>
      </PortalShell>
    );
  }

  const { project, tasks, notes, media } = data;
  const doneTasks = tasks.filter((t: any) => t.status === 'done').length;

  return (
    <PortalShell projectName={project.name}>
      {/* Header */}
      <div className='mb-6'>
        <div className='flex items-center gap-3 flex-wrap'>
          <h1 className='text-2xl font-bold text-ink'>{project.name}</h1>
          <span className={PROJECT_STATUS[project.status]?.className || 'badge-neutral'}>
            {PROJECT_STATUS[project.status]?.label || project.status}
          </span>
        </div>
        {project.description && (
          <p className='text-muted text-sm mt-2 leading-relaxed max-w-2xl'>{project.description}</p>
        )}
      </div>

      {/* Quick stats */}
      <div className='grid grid-cols-3 gap-3 mb-6'>
        <div className='card p-3 text-center'>
          <div className='text-xl font-bold text-ink'>{doneTasks} / {tasks.length}</div>
          <div className='text-xs text-muted'>tâches terminées</div>
        </div>
        <div className='card p-3 text-center'>
          <div className='text-xl font-bold text-ink'>{media.length}</div>
          <div className='text-xs text-muted'>fichiers</div>
        </div>
        <div className='card p-3 text-center'>
          <div className='text-xl font-bold text-ink'>{notes.length}</div>
          <div className='text-xs text-muted'>notes</div>
        </div>
      </div>

      {/* Tabs */}
      <div className='flex gap-1 border-b border-line mb-6 overflow-x-auto'>
        {PORTAL_TABS.map((tab) => (
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
          </button>
        ))}
      </div>

      {activeTab === 'overview' && <PortalOverview project={project} tasks={tasks} media={media} />}
      {activeTab === 'tasks' && <PortalTasks tasks={tasks} />}
      {activeTab === 'media' && <PortalMedia media={media} token={token!} />}
      {activeTab === 'notes' && <PortalNotes notes={notes} token={token!} />}
    </PortalShell>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function PortalShell({ children, projectName }: { children: React.ReactNode; projectName?: string }) {
  return (
    <div className='min-h-screen bg-canvas-100'>
      <header className='bg-white border-b border-line sticky top-0 z-10'>
        <div className='max-w-4xl mx-auto px-4 py-3 flex items-center gap-3'>
          <LuFolderOpen size={20} className='text-accent' />
          <span className='font-semibold text-ink'>
            {projectName ? `Portail — ${projectName}` : 'Portail client'}
          </span>
          <span className='ml-auto text-xs text-muted flex items-center gap-1'>
            <LuLock size={12} /> Accès sécurisé
          </span>
        </div>
      </header>
      <main className='max-w-4xl mx-auto px-4 py-8'>{children}</main>
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function PortalOverview({ project, tasks, media }: { project: any; tasks: any[]; media: any[] }) {
  const recent = media.slice(0, 4);
  const doneTasks = tasks.filter((t: any) => t.status === 'done').length;
  const progress = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;

  return (
    <div className='flex flex-col gap-6'>
      {/* Progress */}
      {tasks.length > 0 && (
        <div className='card p-5'>
          <div className='flex justify-between text-sm mb-2'>
            <span className='font-medium text-ink'>Avancement global</span>
            <span className='text-muted'>{progress}%</span>
          </div>
          <div className='h-2.5 bg-canvas-200 rounded-full overflow-hidden'>
            <div
              className='h-full bg-accent rounded-full transition-all'
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className='text-xs text-muted mt-2'>{doneTasks} sur {tasks.length} tâches terminées</p>
        </div>
      )}

      {/* Recent media */}
      {recent.length > 0 && (
        <div>
          <h3 className='font-semibold text-ink mb-3'>Fichiers récents</h3>
          <div className='grid grid-cols-2 sm:grid-cols-4 gap-3'>
            {recent.map((m: any) => (
              <PortalMediaThumb key={m.id} media={m} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

function PortalTasks({ tasks }: { tasks: any[] }) {
  if (tasks.length === 0) {
    return <p className='text-muted text-sm text-center py-10'>Aucune tâche pour ce projet.</p>;
  }

  const groups: Record<string, any[]> = { todo: [], in_progress: [], done: [] };
  for (const t of tasks) {
    if (groups[t.status]) groups[t.status].push(t);
  }

  return (
    <div className='flex flex-col gap-6'>
      {(['todo', 'in_progress', 'done'] as const).map((status) =>
        groups[status].length > 0 ? (
          <div key={status}>
            <h3 className='text-xs font-semibold uppercase tracking-wider text-muted mb-2'>
              {TASK_STATUS[status].label} ({groups[status].length})
            </h3>
            <div className='flex flex-col gap-2'>
              {groups[status].map((t: any) => (
                <div key={t.id} className='card px-4 py-3 flex items-start gap-3'>
                  <span className={`mt-0.5 shrink-0 ${TASK_STATUS[t.status].color}`}>
                    {TASK_STATUS[t.status].icon}
                  </span>
                  <div>
                    <p className={`text-sm font-medium ${t.status === 'done' ? 'line-through text-muted' : 'text-ink'}`}>
                      {t.title}
                    </p>
                    {t.description && <p className='text-xs text-muted mt-0.5'>{t.description}</p>}
                    {t.dueDate && <p className='text-xs text-muted mt-1'>Échéance : {formatDate(t.dueDate)}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null
      )}
    </div>
  );
}

// ─── Media ────────────────────────────────────────────────────────────────────

function PortalMedia({ media, token }: { media: any[]; token: string }) {
  const [uploading, setUploading] = useState(false);

  const handleFiles = useCallback(async (files: FileList) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    let ok = 0;
    let fail = 0;
    for (const file of arr) {
      try {
        const dataUrl = await fileToDataUrl(file);
        await submitClientMedia({ token, dataUrl, name: stripExt(file.name), originalName: file.name });
        ok++;
      } catch {
        fail++;
      }
    }
    setUploading(false);
    if (ok > 0) toast.success(`${ok} fichier${ok > 1 ? 's' : ''} envoyé${ok > 1 ? 's' : ''}`);
    if (fail > 0) toast.error(`${fail} fichier${fail > 1 ? 's' : ''} échoué${fail > 1 ? 's' : ''}`);
  }, [token]);

  return (
    <div className='flex flex-col gap-5'>
      <MediaUploadZone
        onFiles={handleFiles}
        uploading={uploading}
        title='Déposer ou cliquer pour envoyer vos fichiers'
        busyLabel='Envoi en cours…'
        accept='image/*,.pdf,.doc,.docx,.zip,.txt'
      />

      {/* Grid */}
      {media.length === 0 ? (
        <p className='text-muted text-sm text-center py-6'>Aucun fichier partagé pour ce projet.</p>
      ) : (
        <div className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4'>
          {media.map((m: any) => (
            <PortalMediaThumb key={m.id} media={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function PortalMediaThumb({ media }: { media: any }) {
  const isImage = media.mimeType?.startsWith('image/');
  const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`;

  return (
    <div className='card overflow-hidden'>
      <div className='aspect-video bg-canvas-200 relative overflow-hidden'>
        {isImage && media.url ? (
          <img src={media.url} alt={media.name} className='w-full h-full object-cover' />
        ) : (
          <div className='w-full h-full flex items-center justify-center text-muted'>
            <LuFileText size={32} />
          </div>
        )}
        {media.isFromClient && (
          <span className='absolute top-1.5 left-1.5 bg-blue-500 text-white text-xs px-1.5 py-0.5 rounded'>
            Vous
          </span>
        )}
      </div>
      <div className='p-3 flex items-center justify-between gap-2'>
        <p className='text-xs font-medium text-ink truncate'>
          {media.name}<span className='text-muted font-normal'>{getExt(media)}</span>
        </p>
        {media.url && (
          <button
            onClick={() => downloadFile(media.url, media.name + getExt(media))}
            title='Télécharger'
            className='text-muted hover:text-ink shrink-0'
          >
            <LuDownload size={14} />
          </button>
        )}
      </div>
      <p className='text-xs text-muted px-3 pb-3 -mt-1'>{formatSize(media.size)}</p>
    </div>
  );
}

// ─── Notes ────────────────────────────────────────────────────────────────────

function PortalNotes({ notes, token }: { notes: any[]; token: string }) {
  const [content, setContent] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    try {
      await submitClientNote({ token, content, authorName: authorName.trim() || undefined });
      toast.success('Message envoyé');
      setContent('');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='flex flex-col gap-5 max-w-2xl'>
      {/* Send a note */}
      <div className='card p-5'>
        <h3 className='font-semibold text-ink mb-3 flex items-center gap-2'>
          <LuSend size={16} className='text-accent' />
          Laisser un message
        </h3>
        <form onSubmit={submit} className='flex flex-col gap-3'>
          <input
            className='input'
            placeholder='Votre nom (optionnel)'
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
          />
          <textarea
            className='input'
            rows={4}
            required
            placeholder='Votre message, question ou commentaire…'
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <button type='submit' className='btn-primary self-end' disabled={saving || !content.trim()}>
            {saving ? 'Envoi…' : 'Envoyer'}
          </button>
        </form>
      </div>

      {/* Notes list */}
      {notes.length > 0 && (
        <div>
          <h3 className='text-xs font-semibold uppercase tracking-wider text-muted mb-3'>Fil de discussion ({notes.length})</h3>
          <div className='flex flex-col gap-3'>
            {notes.map((note: any) => (
              <div key={note.id} className={`card p-4 ${note.isFromClient ? 'bg-blue-50 border-blue-200' : ''}`}>
                <div className='flex items-center gap-2 mb-2'>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold ${note.isFromClient ? 'bg-blue-500' : 'bg-accent'}`}>
                    {note.isFromClient ? (note.authorName?.[0] || 'C').toUpperCase() : 'P'}
                  </div>
                  <span className='text-sm font-medium text-ink'>
                    {note.isFromClient ? (note.authorName || 'Client') : 'Chargé de projet'}
                  </span>
                  <span className='text-xs text-muted ml-auto'>{formatDate(note.createdAt)}</span>
                </div>
                <p className='text-sm text-ink leading-relaxed whitespace-pre-wrap'>{note.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {notes.length === 0 && (
        <p className='text-muted text-sm text-center py-6'>Aucune note partagée pour ce projet. Soyez le premier à laisser un message !</p>
      )}
    </div>
  );
}

// ─── Utility ─────────────────────────────────────────────────────────────────

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

function getExt(media: any): string {
  if (media.mimeType?.startsWith('image/')) return '.jpg';
  const orig: string = media.originalName ?? '';
  const dot = orig.lastIndexOf('.');
  return dot >= 0 ? orig.slice(dot) : '';
}

async function downloadFile(url: string, filename: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

import { useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import {
  useQuery,
  getProjects,
  getClients,
  createProject,
  updateProject,
  deleteProject,
} from 'wasp/client/operations';
import { PageHeader, EmptyState, Modal, useConfirm, IconBtn, TrashIcon, EditIcon } from '../../client/ui';
import { LuFolderOpen, LuExternalLink } from 'react-icons/lu';

const STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  en_cours: { label: 'En cours', className: 'badge-info' },
  en_pause: { label: 'En pause', className: 'badge-warning' },
  termine: { label: 'Terminé', className: 'badge-success' },
  annule: { label: 'Annulé', className: 'badge-danger' },
};

export default function ProjectsPage() {
  const { data: projects, isLoading } = useQuery(getProjects);
  const { data: clients } = useQuery(getClients);
  const { ask, Dialog: ConfirmDialog } = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterClient, setFilterClient] = useState('');

  const filtered = (projects || []).filter((p: any) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus && p.status !== filterStatus) return false;
    if (filterClient && p.clientId !== filterClient) return false;
    return true;
  });

  return (
    <>
      <PageHeader
        title='Projets'
        subtitle='Suivez vos mandats et accédez aux détails de chaque projet.'
        actions={<button className='btn-primary' onClick={() => setCreating(true)}>Nouveau projet</button>}
      />

      <div className='mb-4 flex flex-wrap items-center gap-3'>
        <input
          className='input max-w-xs'
          placeholder='Rechercher un projet…'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className='input w-auto' value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value=''>Tous les statuts</option>
          {Object.entries(STATUS).map(([val, { label }]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <select className='input w-auto' value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
          <option value=''>Tous les clients</option>
          {(clients || []).map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <span className='text-sm text-muted'>{filtered.length} projet(s)</span>
      </div>

      {isLoading ? (
        <div className='text-muted'>Chargement…</div>
      ) : !projects || projects.length === 0 ? (
        <EmptyState
          title='Aucun projet'
          description='Créez votre premier projet et associez-le à un client.'
          action={<button className='btn-primary' onClick={() => setCreating(true)}>Créer un projet</button>}
        />
      ) : filtered.length === 0 ? (
        <p className='text-muted text-sm'>Aucun projet ne correspond aux filtres.</p>
      ) : (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Projet</th>
                <th>Client</th>
                <th>Statut</th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p: any) => (
                <tr key={p.id} className='group'>
                  <td className='font-medium'>
                    <a
                      href={`/projets/${p.id}`}
                      target='_blank'
                      rel='noreferrer'
                      className='flex items-center gap-2 hover:text-accent transition-colors'
                    >
                      <LuFolderOpen size={16} className='text-muted shrink-0' />
                      {p.name}
                      <LuExternalLink size={12} className='text-muted opacity-0 group-hover:opacity-100 transition-opacity' />
                    </a>
                  </td>
                  <td className='text-muted'>{p.client?.name || '—'}</td>
                  <td>
                    <span className={STATUS[p.status]?.className || 'badge-neutral'}>
                      {STATUS[p.status]?.label || p.status}
                    </span>
                  </td>
                  <td className='text-right'>
                    <div className='flex items-center justify-end gap-1'>
                      <IconBtn title='Modifier' onClick={() => setEditing(p)}><EditIcon /></IconBtn>
                      <IconBtn
                        variant='danger'
                        title='Supprimer'
                      onClick={async () => {
                        if (
                          await ask(`Supprimer le projet « ${p.name} » ?`, {
                            description: 'Toutes les tâches, notes, médias et accès clients seront supprimés.',
                          })
                        ) {
                          try {
                            await deleteProject({ id: p.id });
                            toast.success('Projet supprimé');
                          } catch (err: any) {
                            toast.error(err?.message || 'Erreur lors de la suppression');
                          }
                        }
                      }}
                      >
                        <TrashIcon />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateProjectModal
          clients={clients || []}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <EditProjectModal
          project={editing}
          clients={clients || []}
          onClose={() => setEditing(null)}
        />
      )}
      {ConfirmDialog}
    </>
  );
}

function CreateProjectModal({ clients, onClose }: { clients: any[]; onClose: () => void }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    clientId: '',
    status: 'en_cours',
  });
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createProject({
        name: form.name,
        description: form.description || undefined,
        clientId: form.clientId || null,
        status: form.status,
      });
      toast.success('Projet créé');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Une erreur est survenue');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title='Nouveau projet'
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='create-project-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Création…' : 'Créer le projet'}
          </button>
        </>
      }
    >
      <form id='create-project-form' onSubmit={onSubmit} className='flex flex-col gap-4'>
        <div>
          <label className='label'>Titre du projet *</label>
          <input
            className='input'
            required
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder='ex. Refonte site web'
          />
        </div>
        <div>
          <label className='label'>Description</label>
          <textarea
            className='input'
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder='Résumé du projet…'
          />
        </div>
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <div>
            <label className='label'>Client</label>
            <select
              className='input'
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            >
              <option value=''>— Aucun —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className='label'>Statut</label>
            <select
              className='input'
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {Object.entries(STATUS).map(([val, { label }]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function EditProjectModal({ project, clients, onClose }: { project: any; clients: any[]; onClose: () => void }) {
  const [form, setForm] = useState({
    name: project.name || '',
    description: project.description || '',
    clientId: project.clientId || '',
    status: project.status || 'en_cours',
  });
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProject({
        id: project.id,
        name: form.name,
        description: form.description || undefined,
        clientId: form.clientId || null,
        status: form.status,
      });
      toast.success('Projet modifié');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Une erreur est survenue');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title='Modifier le projet'
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='edit-project-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form id='edit-project-form' onSubmit={onSubmit} className='flex flex-col gap-4'>
        <div>
          <label className='label'>Titre du projet *</label>
          <input
            className='input'
            required
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className='label'>Description</label>
          <textarea
            className='input'
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <div>
            <label className='label'>Client</label>
            <select
              className='input'
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            >
              <option value=''>— Aucun —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className='label'>Statut</label>
            <select
              className='input'
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {Object.entries(STATUS).map(([val, { label }]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </form>
    </Modal>
  );
}

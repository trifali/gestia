import { useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import {
  useQuery,
  getProjects,
  getClients,
  createProject,
  deleteProject,
} from 'wasp/client/operations';
import { PageHeader, EmptyState, Modal, useConfirm, IconBtn, TrashIcon } from '../../client/ui';
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

  return (
    <>
      <PageHeader
        title='Projets'
        subtitle='Suivez vos mandats et accédez aux détails de chaque projet.'
        actions={<button className='btn-primary' onClick={() => setCreating(true)}>Nouveau projet</button>}
      />

      {isLoading ? (
        <div className='text-muted'>Chargement…</div>
      ) : !projects || projects.length === 0 ? (
        <EmptyState
          title='Aucun projet'
          description='Créez votre premier projet et associez-le à un client.'
          action={<button className='btn-primary' onClick={() => setCreating(true)}>Créer un projet</button>}
        />
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
              {projects.map((p: any) => (
                <tr key={p.id} className='group'>
                  <td className='font-medium'>
                    <Link
                      to={`/projets/${p.id}`}
                      className='flex items-center gap-2 hover:text-accent transition-colors'
                    >
                      <LuFolderOpen size={16} className='text-muted shrink-0' />
                      {p.name}
                      <LuExternalLink size={12} className='text-muted opacity-0 group-hover:opacity-100 transition-opacity' />
                    </Link>
                  </td>
                  <td className='text-muted'>{p.client?.name || '—'}</td>
                  <td>
                    <span className={STATUS[p.status]?.className || 'badge-neutral'}>
                      {STATUS[p.status]?.label || p.status}
                    </span>
                  </td>
                  <td className='text-right'>
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

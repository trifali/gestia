import { useState } from 'react';
import toast from 'react-hot-toast';
import {
  useQuery,
  getProjects,
  getClients,
  createProject,
  updateProject,
  deleteProject,
} from 'wasp/client/operations';
import { PageHeader, EmptyState, Modal, useConfirm, IconBtn, EditIcon, TrashIcon } from '../../client/ui';
import { formatCurrency, formatDate, formatDateForInput } from '../../shared/format';

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

  return (
    <>
      <PageHeader
        title='Projets'
        subtitle='Suivez vos mandats, échéances et budgets.'
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
                <th>Échéance</th>
                <th>Budget</th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p: any) => (
                <tr key={p.id}>
                  <td className='font-medium'>{p.name}</td>
                  <td className='text-muted'>{p.client?.name || '—'}</td>
                  <td>
                    <span className={STATUS[p.status]?.className || 'badge-neutral'}>
                      {STATUS[p.status]?.label || p.status}
                    </span>
                  </td>
                  <td className='text-muted'>{p.dueDate ? formatDate(p.dueDate) : '—'}</td>
                  <td className='text-muted'>{p.budget ? formatCurrency(p.budget) : '—'}</td>
                  <td className='text-right'>
                    <div className='flex items-center justify-end gap-1'>
                      <IconBtn title='Modifier' onClick={() => setEditing(p)}><EditIcon /></IconBtn>
                      <IconBtn variant='danger' title='Supprimer' onClick={async () => {
                        if (await ask(`Supprimer le projet « ${p.name} » ?`)) {
                          try {
                            await deleteProject({ id: p.id });
                            toast.success('Projet supprimé');
                          } catch (err: any) {
                            toast.error(err?.message || 'Erreur lors de la suppression');
                          }
                        }
                      }}><TrashIcon /></IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <ProjectForm
          project={editing}
          clients={clients || []}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {ConfirmDialog}
    </>
  );
}

function ProjectForm({ project, clients, onClose }: { project?: any; clients: any[]; onClose: () => void }) {
  const [form, setForm] = useState({
    name: project?.name || '',
    description: project?.description || '',
    clientId: project?.clientId || '',
    status: project?.status || 'en_cours',
    startDate: formatDateForInput(project?.startDate),
    dueDate: formatDateForInput(project?.dueDate),
    budget: project?.budget?.toString() || '',
  });
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        clientId: form.clientId || null,
        status: form.status,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        budget: form.budget ? parseFloat(form.budget) : null,
      };
      if (project) {
        await updateProject({ id: project.id, ...payload });
        toast.success('Projet modifié');
      } else {
        await createProject(payload);
        toast.success('Projet créé');
      }
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
      title={project ? 'Modifier le projet' : 'Nouveau projet'}
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='project-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form id='project-form' onSubmit={onSubmit} className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
        <div className='col-span-2'>
          <label className='label'>Nom du projet *</label>
          <input className='input' required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className='label'>Client</label>
          <select className='input' value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
            <option value=''>— Aucun —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className='label'>Statut</label>
          <select className='input' value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value='brouillon'>Brouillon</option>
            <option value='en_cours'>En cours</option>
            <option value='en_pause'>En pause</option>
            <option value='termine'>Terminé</option>
            <option value='annule'>Annulé</option>
          </select>
        </div>
        <div>
          <label className='label'>Date de début</label>
          <input type='date' className='input' value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </div>
        <div>
          <label className='label'>Échéance</label>
          <input type='date' className='input' value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
        </div>
        <div className='col-span-2'>
          <label className='label'>Budget (CAD)</label>
          <input type='number' step='0.01' className='input' value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
        </div>
        <div className='col-span-2'>
          <label className='label'>Description</label>
          <textarea className='input' rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </form>
    </Modal>
  );
}

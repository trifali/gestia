import { useState } from 'react';
import toast from 'react-hot-toast';
import {
  useQuery,
  getAutomations,
  createAutomation,
  updateAutomation,
  deleteAutomation,
} from 'wasp/client/operations';
import { PageHeader, EmptyState, Modal, useConfirm, IconBtn, EditIcon, TrashIcon } from '../../client/ui';

const TRIGGERS: Record<string, string> = {
  facture_creee: 'Lorsqu\'une facture est créée',
  facture_en_retard: 'Lorsqu\'une facture est en retard',
  rencontre_a_venir: 'Avant une rencontre planifiée',
  client_inactif: 'Lorsqu\'un client devient inactif',
  soumission_envoyee: 'Lorsqu\'une soumission est envoyée',
};

const ACTIONS: Record<string, string> = {
  envoyer_courriel: 'Envoyer un courriel',
  creer_tache: 'Créer une tâche',
  notifier_admin: 'Notifier l\'administrateur',
  changer_statut: 'Changer le statut',
};

export default function AutomationsPage() {
  const { data: automations, isLoading } = useQuery(getAutomations);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const { ask, Dialog: ConfirmDialog } = useConfirm();

  return (
    <>
      <PageHeader
        title='Automatisations'
        subtitle='Réduisez le travail répétitif avec des règles intelligentes.'
        actions={<button className='btn-primary' onClick={() => setCreating(true)}>Nouvelle automatisation</button>}
      />

      {isLoading ? (
        <div className='text-muted'>Chargement…</div>
      ) : !automations || automations.length === 0 ? (
        <EmptyState
          title='Aucune automatisation'
          description='Créez des règles « Quand X se produit, faire Y ».'
          action={<button className='btn-primary' onClick={() => setCreating(true)}>Créer une règle</button>}
        />
      ) : (
        <div className='grid md:grid-cols-2 gap-4'>
          {automations.map((a: any) => (
            <div key={a.id} className='card p-5'>
              <div className='flex items-start justify-between gap-3'>
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2'>
                    <h3 className='font-semibold truncate'>{a.name}</h3>
                    <span className={a.isActive ? 'badge-success' : 'badge-neutral'}>
                      {a.isActive ? 'Actif' : 'Désactivé'}
                    </span>
                  </div>
                  {a.description && <p className='text-sm text-muted mt-1'>{a.description}</p>}
                </div>
                <div className='flex items-center gap-1'>
                  <button className='btn-ghost text-xs' onClick={() => setEditing(a)}>Modifier</button>
                </div>
              </div>
              <div className='mt-4 text-sm space-y-1.5'>
                <div className='flex items-start gap-2'>
                  <span className='w-20 shrink-0 text-muted text-xs uppercase tracking-wide pt-0.5'>Quand</span>
                  <span>{TRIGGERS[a.trigger] || a.trigger}</span>
                </div>
                <div className='flex items-start gap-2'>
                  <span className='w-20 shrink-0 text-muted text-xs uppercase tracking-wide pt-0.5'>Alors</span>
                  <span>{ACTIONS[a.action] || a.action}</span>
                </div>
              </div>
              <div className='mt-4 flex items-center gap-2 pt-4 border-t border-line'>
                <button
                  className='btn-secondary text-xs'
                  onClick={async () => {
                    try {
                      await updateAutomation({ id: a.id, isActive: !a.isActive });
                      toast.success(a.isActive ? 'Automatisation désactivée' : 'Automatisation activée');
                    } catch (err: any) {
                      toast.error(err?.message || 'Une erreur est survenue');
                    }
                  }}
                >
                  {a.isActive ? 'Désactiver' : 'Activer'}
                </button>
                <div className='ml-auto flex gap-1'>
                  <IconBtn title='Modifier' onClick={() => setEditing(a)}><EditIcon /></IconBtn>
                  <IconBtn variant='danger' title='Supprimer' onClick={async () => {
                    if (await ask('Supprimer cette automatisation ?')) {
                      try {
                        await deleteAutomation({ id: a.id });
                        toast.success('Automatisation supprimée');
                      } catch (err: any) {
                        toast.error(err?.message || 'Erreur lors de la suppression');
                      }
                    }
                  }}><TrashIcon /></IconBtn>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <AutomationForm automation={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      )}
      {ConfirmDialog}
    </>
  );
}

function AutomationForm({ automation, onClose }: { automation?: any; onClose: () => void }) {
  const [form, setForm] = useState({
    name: automation?.name || '',
    description: automation?.description || '',
    trigger: automation?.trigger || 'facture_creee',
    action: automation?.action || 'envoyer_courriel',
    isActive: automation?.isActive ?? true,
  });
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (automation) {
        await updateAutomation({ id: automation.id, ...form });
        toast.success('Automatisation modifiée');
      } else {
        await createAutomation(form);
        toast.success('Automatisation créée');
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
      title={automation ? 'Modifier l\'automatisation' : 'Nouvelle automatisation'}
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='automation-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form id='automation-form' onSubmit={onSubmit} className='space-y-4'>
        <div>
          <label className='label'>Nom *</label>
          <input className='input' required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder='Ex. Rappel automatique de facture' />
        </div>
        <div>
          <label className='label'>Description</label>
          <textarea className='input' rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <div>
            <label className='label'>Quand</label>
            <select className='input' value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>
              {Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className='label'>Alors</label>
            <select className='input' value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
              {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <label className='flex items-center gap-2 text-sm'>
          <input type='checkbox' checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Activer immédiatement
        </label>
      </form>
    </Modal>
  );
}

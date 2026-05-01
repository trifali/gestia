import { useMemo, useState } from 'react';
import { createInvoice } from 'wasp/client/operations';
import { Modal } from '../../client/ui';
import {
  ItemsEditor,
  TotalsDisplay,
  prepareItemsForSubmit,
  type LineItem,
} from '../shared/ItemsEditor';

type Props = {
  /** Pre-filled client id (hides the client selector). */
  clientId?: string;
  /** Required when `clientId` is not provided. */
  clients?: any[];
  projects: any[];
  onClose: () => void;
};

export function InvoiceForm({ clientId: presetClientId, clients, projects, onClose }: Props) {
  const [clientId, setClientId] = useState(presetClientId || '');
  const [projectId, setProjectId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<LineItem[]>([{ description: '', quantity: 1, unitPrice: 0 }]);
  const [saving, setSaving] = useState(false);

  const filteredProjects = useMemo(
    () => projects.filter((p) => !clientId || p.clientId === clientId),
    [projects, clientId],
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) {
      alert('Sélectionnez un client.');
      return;
    }
    const safeItems = prepareItemsForSubmit(items);
    if (!safeItems) return;

    setSaving(true);
    try {
      await createInvoice({
        clientId,
        projectId: projectId || null,
        dueDate: dueDate || null,
        notes,
        items: safeItems,
      });
      onClose();
    } catch (err: any) {
      alert(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title='Nouvelle facture'
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='invoice-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Création…' : 'Créer la facture'}
          </button>
        </>
      }
    >
      <form id='invoice-form' onSubmit={onSubmit} className='space-y-4'>
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          {!presetClientId && (
            <div>
              <label className='label'>Client *</label>
              <select
                className='input'
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value=''>— Sélectionner —</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className='label'>Projet (optionnel)</label>
            <select className='input' value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value=''>— Aucun —</option>
              {filteredProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className='label'>Date d'échéance</label>
            <input
              type='date'
              className='input'
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <ItemsEditor items={items} setItems={setItems} />
        <TotalsDisplay items={items} />

        <div>
          <label className='label'>Notes</label>
          <textarea
            className='input'
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </form>
    </Modal>
  );
}

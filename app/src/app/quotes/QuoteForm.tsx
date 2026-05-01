import { useMemo, useState } from 'react';
import { createQuote } from 'wasp/client/operations';
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

export function QuoteForm({ clientId: presetClientId, clients, projects, onClose }: Props) {
  const [clientId, setClientId] = useState(presetClientId || '');
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [validUntil, setValidUntil] = useState('');
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
      alert('Veuillez sélectionner un client.');
      return;
    }
    const safeItems = prepareItemsForSubmit(items);
    if (!safeItems) return;

    setSaving(true);
    try {
      await createQuote({
        clientId,
        projectId: projectId || null,
        title,
        description,
        validUntil: validUntil || null,
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
      title='Nouvelle soumission'
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='quote-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Création…' : 'Créer la soumission'}
          </button>
        </>
      }
    >
      <form id='quote-form' onSubmit={onSubmit} className='space-y-4'>
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
          <div className='col-span-2'>
            <label className='label'>Titre *</label>
            <input
              className='input'
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='Ex. Refonte du site web'
            />
          </div>
          <div className='col-span-2'>
            <label className='label'>Description</label>
            <textarea
              className='input'
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className='label'>Valide jusqu'au</label>
            <input
              type='date'
              className='input'
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
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

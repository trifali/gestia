import { useMemo, useState } from 'react';
import { createDocument, updateDocument } from 'wasp/client/operations';
import { Modal } from '../../client/ui';
import {
  ItemsEditor,
  TotalsDisplay,
  prepareItemsForSubmit,
  type LineItem,
} from './ItemsEditor';

export type DocumentMode = 'quote' | 'invoice';

type Props = {
  /** Initial mode of the form. Defaults to `'quote'`. Ignored when editing. */
  defaultMode?: DocumentMode;
  /** When false, the Soumission/Facture toggle is hidden. Defaults to true. */
  allowModeToggle?: boolean;
  /** Pre-filled client id. Hides the client selector. */
  clientId?: string;
  /** Required when `clientId` is not provided. */
  clients?: any[];
  projects: any[];
  /** Pass an existing document to switch the form into edit mode. */
  document?: {
    id: string;
    type: DocumentMode;
    clientId: string;
    projectId?: string | null;
    title?: string | null;
    description?: string | null;
    validUntil?: string | Date | null;
    dueDate?: string | Date | null;
    notes?: string | null;
    items: LineItem[];
  };
  /** Optional initial values used when prefilling a new document. */
  initial?: {
    projectId?: string | null;
    title?: string;
    description?: string;
    notes?: string;
    items?: LineItem[];
  };
  onClose: () => void;
};

const CREATE_TITLES: Record<DocumentMode, string> = {
  quote: 'Nouvelle soumission',
  invoice: 'Nouvelle facture',
};
const EDIT_TITLES: Record<DocumentMode, string> = {
  quote: 'Modifier la soumission',
  invoice: 'Modifier la facture',
};

const CREATE_LABELS: Record<DocumentMode, { idle: string; busy: string }> = {
  quote: { idle: 'Créer la soumission', busy: 'Création…' },
  invoice: { idle: 'Créer la facture', busy: 'Création…' },
};
const EDIT_LABELS = { idle: 'Enregistrer', busy: 'Enregistrement…' };

function toDateInput(d: string | Date | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function DocumentForm({
  defaultMode = 'quote',
  allowModeToggle = true,
  clientId: presetClientId,
  clients,
  projects,
  document,
  initial,
  onClose,
}: Props) {
  const isEdit = !!document;
  const [mode, setMode] = useState<DocumentMode>(document?.type ?? defaultMode);
  const [clientId, setClientId] = useState(document?.clientId || presetClientId || '');
  const [projectId, setProjectId] = useState(document?.projectId || initial?.projectId || '');
  const [title, setTitle] = useState(document?.title || initial?.title || '');
  const [description, setDescription] = useState(document?.description || initial?.description || '');
  const [validUntil, setValidUntil] = useState(toDateInput(document?.validUntil));
  const [dueDate, setDueDate] = useState(toDateInput(document?.dueDate));
  const [notes, setNotes] = useState(document?.notes || initial?.notes || '');
  const [items, setItems] = useState<LineItem[]>(
    document?.items?.length
      ? document.items.map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        }))
      : initial?.items?.length
        ? initial.items
        : [{ description: '', quantity: 1, unitPrice: 0 }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredProjects = useMemo(
    () => projects.filter((p) => !clientId || p.clientId === clientId),
    [projects, clientId],
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!clientId) {
      setError('Veuillez sélectionner un client.');
      return;
    }
    if (!title.trim()) {
      setError('Le titre est requis.');
      return;
    }
    const safeItems = prepareItemsForSubmit(items);
    if (!safeItems) {
      setError('Chaque item doit avoir une description.');
      return;
    }

    setSaving(true);
    try {
      if (isEdit && document) {
        await updateDocument({
          id: document.id,
          clientId,
          projectId: projectId || null,
          title: title || null,
          description: description || null,
          validUntil: validUntil || null,
          dueDate: dueDate || null,
          notes,
          items: safeItems,
        });
      } else {
        await createDocument({
          type: mode,
          clientId,
          projectId: projectId || null,
          title: title || null,
          description: description || null,
          validUntil: validUntil || null,
          dueDate: dueDate || null,
          notes,
          items: safeItems,
        });
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={(isEdit ? EDIT_TITLES : CREATE_TITLES)[mode]}
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='document-form' type='submit' className='btn-primary' disabled={saving}>
            {saving
              ? (isEdit ? EDIT_LABELS.busy : CREATE_LABELS[mode].busy)
              : (isEdit ? EDIT_LABELS.idle : CREATE_LABELS[mode].idle)}
          </button>
        </>
      }
    >
      <form id='document-form' onSubmit={onSubmit} className='space-y-4'>
        {allowModeToggle && !isEdit && (
          <ModeToggle mode={mode} onChange={setMode} />
        )}

        {error && (
          <div className='rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger'>
            {error}
          </div>
        )}

        <p className='text-xs text-muted'>Les champs marqués d’un <span className='text-danger'>*</span> sont requis.</p>

        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          {!presetClientId && (
            <div>
              <label className='label'>Client <span className='text-danger'>*</span></label>
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
            <label className='label'>Titre <span className='text-danger'>*</span></label>
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

function ModeToggle({ mode, onChange }: { mode: DocumentMode; onChange: (m: DocumentMode) => void }) {
  const options: { value: DocumentMode; label: string }[] = [
    { value: 'quote', label: 'Soumission' },
    { value: 'invoice', label: 'Facture' },
  ];
  return (
    <div className='inline-flex rounded-lg border border-line p-0.5 bg-canvas'>
      {options.map((opt) => {
        const active = mode === opt.value;
        return (
          <button
            key={opt.value}
            type='button'
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              active ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

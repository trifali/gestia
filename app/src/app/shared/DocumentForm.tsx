import { useMemo, useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import { LuWand, LuX } from 'react-icons/lu';
import {
  createDocument,
  updateDocument,
  updateDocumentStatus,
  useQuery,
  getPriceItems,
  createPriceItem,
  generateDocumentDraft,
} from 'wasp/client/operations';
import { Modal } from '../../client/ui';
import { MagicInput, MagicTextarea } from '../../client/magic';
import {
  ItemsEditor,
  TotalsDisplay,
  prepareItemsForSubmit,
  type LineItem,
  type PriceItemLike,
} from './ItemsEditor';

export type DocumentMode = 'quote' | 'invoice';

// Status options offered in the edit form, per document type. Auto-derived
// states (`expiree`, `en_retard`, `payee`, `acompte_recu`) remain selectable
// in case a user wants to override them manually.
const QUOTE_STATUSES = [
  { value: 'brouillon', label: 'Brouillon' },
  { value: 'envoyee', label: 'Envoyée' },
  { value: 'en_discussion', label: 'En discussion' },
  { value: 'acceptee', label: 'Acceptée' },
  { value: 'refusee', label: 'Refusée' },
  { value: 'expiree', label: 'Expirée' },
];

const INVOICE_STATUSES = [
  { value: 'brouillon', label: 'Brouillon' },
  { value: 'envoyee', label: 'Envoyée' },
  { value: 'acompte_recu', label: 'Acompte reçu' },
  { value: 'payee', label: 'Payée' },
  { value: 'en_retard', label: 'En retard' },
  { value: 'annulee', label: 'Annulée' },
];

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
    status?: string;
    clientId: string;
    projectId?: string | null;
    title?: string | null;
    description?: string | null;
    dueDate?: string | Date | null;
    notes?: string | null;
    items: LineItem[];
    discountType?: 'percent' | 'amount' | null;
    discountValue?: number | null;
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
  const [dueDate, setDueDate] = useState(toDateInput(document?.dueDate));
  const [notes, setNotes] = useState(document?.notes || initial?.notes || '');
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>(
    (document?.discountType as 'percent' | 'amount') || 'percent',
  );
  const [discountValue, setDiscountValue] = useState<number>(
    document?.discountValue ?? 0,
  );
  const [status, setStatus] = useState<string>(document?.status || 'brouillon');
  const [items, setItems] = useState<LineItem[]>(
    document?.items?.length
      ? document.items.map((i) => ({
          description: i.description,
          note: (i as any).note || '',
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        }))
      : initial?.items?.length
        ? initial.items
        : [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // AI title/description drafting popover
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const handleGenerate = async () => {
    if (!aiPrompt.trim() || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await generateDocumentDraft({
        input: aiPrompt.trim(),
        type: mode,
        clientId: clientId || null,
        projectId: projectId || null,
        itemLabels: items.map((i) => i.description).filter(Boolean),
        currentTitle: title || null,
        currentDescription: description || null,
      }) as { title: string; description: string };
      if (res.title) setTitle(res.title);
      if (res.description) setDescription(res.description);
      setAiOpen(false);
      setAiPrompt('');
      toast.success('Titre et description générés');
    } catch (e: any) {
      toast.error(e?.message || 'Erreur de génération IA');
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);

  const { data: priceItems } = useQuery(getPriceItems);

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
    if (safeItems === null) {
      setError('Chaque item doit avoir une description.');
      return;
    }
    if (safeItems.length === 0) {
      setError('Veuillez ajouter au moins un item.');
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
          dueDate: dueDate || null,
          notes,
          items: safeItems,
          discountType,
          discountValue: discountValue || 0,
        });
        if (status !== document.status) {
          await updateDocumentStatus({ id: document.id, status });
        }
        toast.success('Document modifié');
      } else {
        await createDocument({
          type: mode,
          clientId,
          projectId: projectId || null,
          title: title || null,
          description: description || null,
          dueDate: dueDate || null,
          notes,
          items: safeItems,
          discountType,
          discountValue: discountValue || 0,
        });
        toast.success(mode === 'invoice' ? 'Facture créée' : 'Soumission créée');
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
          <div ref={errorRef} className='rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger'>
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

          <div className='col-span-2 relative space-y-4'>
            <div>
              <div className='flex items-center justify-between gap-2'>
                <label className='label mb-0'>Titre <span className='text-danger'>*</span></label>
                <button
                  type='button'
                  onClick={() => setAiOpen((v) => !v)}
                  title="Rédiger le titre et la description avec l'IA"
                  className='flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 text-white text-[11px] font-semibold hover:bg-amber-600 transition-colors'
                >
                  <LuWand size={11} /> IA
                </button>
              </div>
              <MagicInput
                className='input mt-1'
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder='Ex. Refonte du site web'
              />
            </div>
            <div>
              <label className='label'>Description</label>
              <MagicTextarea
                className='input'
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {aiOpen && (
              <div className='absolute top-7 right-0 z-30 w-80 bg-white rounded-xl shadow-2xl border border-line p-4 flex flex-col gap-3'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-1.5'>
                    <LuWand size={14} className='text-amber-500' />
                    <p className='text-sm font-semibold'>Rédiger avec l’IA</p>
                  </div>
                  <button type='button' onClick={() => setAiOpen(false)} className='text-muted hover:text-ink'>
                    <LuX size={14} />
                  </button>
                </div>
                <p className='text-xs text-muted'>
                  Décrivez le travail en quelques mots. L’IA rédige le titre et la description.
                </p>
                <textarea
                  className='border border-line rounded-lg p-2.5 text-sm resize-none h-24 outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400'
                  placeholder='Ex : refonte du site web + hébergement 1 an'
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void handleGenerate();
                    }
                  }}
                  autoFocus
                />
                <div className='flex justify-end gap-2'>
                  <button type='button' className='btn-ghost text-xs' onClick={() => setAiOpen(false)}>Annuler</button>
                  <button
                    type='button'
                    className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                    onClick={handleGenerate}
                    disabled={aiLoading || !aiPrompt.trim()}
                  >
                    {aiLoading ? (
                      <><span className='animate-spin inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full' /> Génération…</>
                    ) : (
                      <><LuWand size={12} /> Générer</>
                    )}
                  </button>
                </div>
              </div>
            )}
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
          {isEdit && (
            <div>
              <label className='label'>Statut</label>
              <select
                className='input'
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {(mode === 'invoice' ? INVOICE_STATUSES : QUOTE_STATUSES).map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className='mt-6 pt-4 border-t border-line'>
        <ItemsEditor
          items={items}
          setItems={setItems}
          priceItems={priceItems as PriceItemLike[] | undefined}
          onAddToCatalogue={async (name, description) => {
            const exists = (priceItems as PriceItemLike[] | undefined)?.some(
              (p) => p.name.trim().toLowerCase() === name.toLowerCase()
            );
            if (exists) return;
            try {
              await createPriceItem({ name, description: description ?? undefined, unitPrice: 0 });
            } catch (e: any) {
              alert(e.message ?? 'Impossible d\'ajouter au catalogue');
            }
          }}
        />
        </div>

        {/* Discount */}
        <div className='flex items-center gap-3 pt-1'>
          <label className='label mb-0 whitespace-nowrap'>Rabais</label>
          <select
            className='input w-28 shrink-0'
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as 'percent' | 'amount')}
          >
            <option value='percent'>%</option>
            <option value='amount'>$</option>
          </select>
          <input
            type='number'
            min='0'
            step='0.01'
            className='input flex-1'
            placeholder={discountType === 'percent' ? 'ex. 10' : 'ex. 50.00'}
            value={discountValue || ''}
            onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
          />
        </div>

        <TotalsDisplay
          items={items}
          discount={discountValue > 0 ? { type: discountType, value: discountValue } : undefined}
        />

        <div>
          <label className='label'>Notes</label>
          <MagicTextarea
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

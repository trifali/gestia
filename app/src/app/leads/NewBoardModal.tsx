// Assistant « Nouveau tableau ».
//
// Ce qui change par rapport à « Nouvelle recherche » : un tableau et la façon
// dont il se remplit ne sont plus la même chose. Avant, un tableau *était* une
// recherche Google — dans l'interface comme dans le modèle. Cet écran pose donc
// deux questions dans l'ordre : quel tableau, puis d'où viennent les prospects.
//
// La branche Google Maps est le formulaire existant, déplacé d'un cran, sans une
// ligne de logique modifiée. La branche webhook crée le tableau immédiatement :
// l'adresse doit exister pour qu'on puisse déclencher un appel de test, qui est
// lui-même la façon de régler la correspondance.

import { useState } from 'react';
import toast from 'react-hot-toast';
import { LuLink, LuLoader, LuSearch } from 'react-icons/lu';
import { createWebhookBoard } from 'wasp/client/operations';
import { Modal } from '../../client/ui';
import { LEAD_SOURCES } from '../../shared/leadSources';
import { SearchForm, defaultForm } from './GoogleSearchForm';
import { IntakePanel } from './intake/IntakePanel';

type Kind = 'google_maps' | 'webhook';
type Step = 'choose' | 'google' | 'intake';

export function NewBoardModal({
  open,
  onClose,
  onDone,
  isAdmin,
  /** Duplication d'un tableau Google : on saute le choix, il est déjà tranché. */
  googlePrefill,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (searchId: string) => void;
  isAdmin: boolean;
  googlePrefill?: Partial<ReturnType<typeof defaultForm>>;
}) {
  const [step, setStep] = useState<Step>(googlePrefill ? 'google' : 'choose');
  const [kind, setKind] = useState<Kind>('google_maps');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('facebook');
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  function reset() {
    setStep(googlePrefill ? 'google' : 'choose');
    setKind('google_maps');
    setTitle('');
    setDescription('');
    setSource('facebook');
    setCreatedId(null);
  }

  function close() {
    reset();
    onClose();
  }

  async function handleContinue() {
    if (kind === 'google_maps') {
      // Le nom saisi ici alimente le champ « Nom de la recherche » du formulaire
      // Google, qui sait aussi le générer tout seul.
      setStep('google');
      return;
    }

    const name = title.trim();
    if (!name) {
      toast.error('Donnez un nom à ce tableau.');
      return;
    }
    setCreating(true);
    try {
      const res = await createWebhookBoard({ title: name, description, defaultSource: source });
      setCreatedId(res.searchId);
      setStep('intake');
    } catch (err: any) {
      toast.error(err?.message ?? 'Création impossible');
    } finally {
      setCreating(false);
    }
  }

  const modalTitle =
    step === 'intake' ? 'Connecter la source'
    : step === 'google' ? (googlePrefill ? 'Dupliquer la recherche' : 'Recherche Google Maps')
    : 'Nouveau tableau';

  return (
    <Modal open={open} onClose={close} title={modalTitle}>
      {step === 'choose' && (
        <div className='space-y-5'>
          <div>
            <label className='label required'>Nom du tableau</label>
            <input
              className='input'
              placeholder='Ex : Prospects Facebook — Toitures'
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className='label'>Description <span className='text-muted font-normal'>(optionnel)</span></label>
            <input
              className='input'
              placeholder='À quoi sert ce tableau'
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <div>
            <label className='label'>Comment le remplir</label>
            <div className='grid gap-3 sm:grid-cols-2 mt-1'>
              <SourceCard
                selected={kind === 'google_maps'}
                onSelect={() => setKind('google_maps')}
                icon={<LuSearch size={20} />}
                title='Recherche Google Maps'
                description="Trouvez des entreprises à démarcher par type et par ville. Le tableau se remplit immédiatement."
              />
              <SourceCard
                selected={kind === 'webhook'}
                onSelect={() => setKind('webhook')}
                icon={<LuLink size={20} />}
                title='Webhook'
                description="Recevez automatiquement les prospects d'un formulaire Facebook, d'un site web ou de Zapier."
                disabled={!isAdmin}
                disabledHint='Réservé aux administrateurs'
              />
            </div>
          </div>

          {kind === 'webhook' && (
            <div>
              <label className='label'>Provenance des prospects</label>
              <select className='input' value={source} onChange={e => setSource(e.target.value)}>
                {LEAD_SOURCES.filter(s => s.key !== 'google_maps' && s.key !== 'manual').map(s => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
              <p className='text-xs text-muted mt-1'>
                Affichée sur chaque carte. Modifiable ensuite dans la correspondance.
              </p>
            </div>
          )}

          <div className='flex justify-end gap-2 pt-2'>
            <button type='button' className='btn-secondary' onClick={close} disabled={creating}>
              Annuler
            </button>
            <button type='button' className='btn-primary gap-2' onClick={handleContinue} disabled={creating}>
              {creating ? <LuLoader size={16} className='animate-spin' /> : null}
              Continuer
            </button>
          </div>
        </div>
      )}

      {step === 'google' && (
        <SearchForm
          onClose={googlePrefill ? close : () => setStep('choose')}
          onDone={id => {
            reset();
            onDone(id);
          }}
          initialValues={{ ...googlePrefill, title: googlePrefill?.title ?? title, description: description || googlePrefill?.description }}
        />
      )}

      {step === 'intake' && createdId && (
        <IntakePanel
          searchId={createdId}
          isAdmin={isAdmin}
          onFinish={() => {
            const id = createdId;
            reset();
            onDone(id);
          }}
        />
      )}
    </Modal>
  );
}

function SourceCard({
  selected,
  onSelect,
  icon,
  title,
  description,
  disabled,
  disabledHint,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <button
      type='button'
      onClick={onSelect}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      className={`text-left rounded-xl border p-4 transition-colors ${
        selected ? 'border-accent-500 bg-accent-50' : 'border-line hover:border-accent-300 hover:bg-canvas-100'
      } ${disabled ? 'opacity-50 cursor-not-allowed hover:border-line hover:bg-transparent' : ''}`}
    >
      <div className={`mb-2 ${selected ? 'text-accent-700' : 'text-muted'}`}>{icon}</div>
      <p className='font-medium text-ink text-sm'>{title}</p>
      <p className='text-xs text-muted mt-1'>{description}</p>
      {disabled && disabledHint && <p className='text-xs text-muted mt-1.5 italic'>{disabledHint}</p>}
    </button>
  );
}

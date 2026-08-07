// Panneau « Connexion » : l'adresse, le secret, les recettes de branchement, et
// le panneau d'écoute qui attend le premier appel.
//
// L'écoute est le cœur de l'assistant. Plutôt que de demander à l'utilisateur de
// décrire ce que sa source envoie, on le lui fait déclencher et on montre ce
// qu'on a reçu. C'est aussi le seul moyen honnête : personne ne connaît par cœur
// la forme exacte que Zapier donne à un formulaire Facebook.

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  LuCheck,
  LuCircleAlert,
  LuLoader,
  LuPlay,
  LuRefreshCcw,
  LuEye,
  LuEyeOff,
} from 'react-icons/lu';
import {
  getLatestIntakeSample,
  revealLeadIntakeSecret,
  rotateLeadIntakeSecret,
  simulateLeadIntakeCall,
  useQuery,
} from 'wasp/client/operations';
import { CopyableUrl } from '../../../client/ui';
import { formatMontrealTime } from '../../../client/format';
import { buildRecipes, UPSTREAM_NOTE } from './recipes';

/** Assez court pour que l'attente paraisse vivante, assez long pour ne rien marteler. */
const LISTEN_POLL_MS = 2000;

export function IntakeConnectPanel({
  searchId,
  url,
  isAdmin,
  hasSample,
  onSampleArrived,
}: {
  searchId: string;
  url: string;
  isAdmin: boolean;
  /** Un échantillon existe déjà : on n'attend plus, on propose de passer à la suite. */
  hasSample: boolean;
  onSampleArrived: () => void;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [listening, setListening] = useState(!hasSample);
  const [recipeKey, setRecipeKey] = useState('zapier');

  // On ne scrute que tant qu'on attend : une fois l'appel arrivé, la requête
  // n'a plus rien à apprendre et continuerait à interroger le serveur pour rien.
  const { data: sample } = useQuery(
    getLatestIntakeSample,
    { searchId },
    { enabled: listening, refetchInterval: listening ? LISTEN_POLL_MS : false },
  );

  useEffect(() => {
    if (listening && sample) {
      setListening(false);
      onSampleArrived();
    }
  }, [listening, sample, onSampleArrived]);

  async function reveal() {
    setRevealing(true);
    try {
      const res = await revealLeadIntakeSecret({ searchId });
      setSecret(res.secret);
    } catch (err: any) {
      toast.error(err?.message ?? 'Impossible d\'afficher le secret');
    } finally {
      setRevealing(false);
    }
  }

  async function rotate() {
    if (!confirm(
      'Faire tourner le secret ?\n\n'
      + 'L\'adresse ne change pas, mais toute source qui utilise encore l\'ancien secret '
      + 'cessera d\'être acceptée jusqu\'à ce que vous y colliez le nouveau.',
    )) return;
    try {
      const res = await rotateLeadIntakeSecret({ searchId });
      setSecret(res.secret);
      toast.success('Nouveau secret généré. Recopiez-le dans vos sources.');
    } catch (err: any) {
      toast.error(err?.message ?? 'Rotation impossible');
    }
  }

  async function simulate() {
    setSimulating(true);
    try {
      await simulateLeadIntakeCall({ searchId });
      toast.success('Appel d\'exemple enregistré.');
      setListening(false);
      onSampleArrived();
    } catch (err: any) {
      toast.error(err?.message ?? 'Simulation impossible');
    } finally {
      setSimulating(false);
    }
  }

  const recipes = buildRecipes(url, secret);
  const recipe = recipes.find(r => r.key === recipeKey) ?? recipes[0];

  return (
    <div className='space-y-5'>
      <CopyableUrl
        label='Adresse de réception'
        value={url}
        hint='Cette adresse ne changera jamais, même après une rotation du secret.'
      />

      <div>
        <label className='label'>Secret</label>
        <div className='flex items-center gap-1.5 mt-1'>
          {secret ? (
            <input className='input font-mono text-xs flex-1' value={secret} readOnly onFocus={e => e.target.select()} />
          ) : (
            <input className='input font-mono text-xs flex-1' value='••••••••••••••••••••••••••••••••' readOnly disabled />
          )}
          {isAdmin && (
            <>
              <button
                type='button'
                className='btn-secondary px-2.5 shrink-0'
                title={secret ? 'Masquer' : 'Afficher'}
                onClick={() => (secret ? setSecret(null) : reveal())}
                disabled={revealing}
              >
                {revealing ? <LuLoader size={14} className='animate-spin' /> : secret ? <LuEyeOff size={14} /> : <LuEye size={14} />}
              </button>
              <button
                type='button'
                className='btn-secondary px-2.5 shrink-0'
                title='Faire tourner le secret'
                onClick={rotate}
              >
                <LuRefreshCcw size={14} />
              </button>
            </>
          )}
        </div>
        <p className='text-xs text-muted mt-1'>
          À envoyer dans l'en-tête <code className='font-mono'>X-Gestia-Secret</code>.
          {!secret && isAdmin && ' Affichez-le pour le recopier dans les recettes ci-dessous.'}
        </p>
      </div>

      {/* Ce qui reste à faire hors de Gestia — annoncé, pas découvert. */}
      <div className='flex gap-2.5 text-xs text-muted bg-canvas-100 border border-line rounded-xl p-3'>
        <LuCircleAlert size={15} className='shrink-0 mt-0.5' />
        <p>{UPSTREAM_NOTE}</p>
      </div>

      {/* ── Recettes ── */}
      <div>
        <div className='flex flex-wrap gap-1 border-b border-line'>
          {recipes.map(r => (
            <button
              key={r.key}
              type='button'
              onClick={() => setRecipeKey(r.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                r.key === recipeKey
                  ? 'border-accent-500 text-ink'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className='pt-3 space-y-3'>
          <p className='text-sm text-muted'>{recipe.summary}</p>
          <ol className='text-sm space-y-1 list-decimal list-inside text-ink'>
            {recipe.steps.map((s, i) => (
              <li key={i} className='marker:text-muted'>{s}</li>
            ))}
          </ol>
          {recipe.warning && (
            <div className='flex gap-2.5 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3'>
              <LuCircleAlert size={15} className='shrink-0 mt-0.5' />
              <p>{recipe.warning}</p>
            </div>
          )}
          <CodeBlock code={recipe.code} />
        </div>
      </div>

      {/* ── Écoute ── */}
      {listening ? (
        <div className='rounded-xl border border-accent-200 bg-accent-50 p-4'>
          <div className='flex items-center gap-3'>
            <LuLoader size={18} className='animate-spin shrink-0 text-accent-700' />
            <div className='flex-1 min-w-0'>
              <p className='text-sm font-medium text-accent-900'>En attente d'un premier appel…</p>
              <p className='text-xs text-accent-700 mt-0.5'>
                Déclenchez votre source : nous afficherons exactement ce qu'elle envoie, et vous
                pourrez associer ses champs.
              </p>
            </div>
            {isAdmin && (
              <button
                type='button'
                className='btn-secondary gap-1.5 shrink-0'
                onClick={simulate}
                disabled={simulating}
              >
                {simulating ? <LuLoader size={14} className='animate-spin' /> : <LuPlay size={14} />}
                Simuler un appel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className='rounded-xl border border-success/30 bg-success/5 p-4 flex items-center gap-3'>
          <LuCheck size={18} className='shrink-0 text-success' />
          <div className='flex-1 min-w-0'>
            <p className='text-sm font-medium text-ink'>Appel reçu</p>
            {sample && (
              <p className='text-xs text-muted mt-0.5'>
                Dernier appel le {formatMontrealTime(sample.receivedAt)} · {sample.paths.length} champ(s) détecté(s)
              </p>
            )}
          </div>
          <button type='button' className='btn-secondary shrink-0' onClick={() => setListening(true)}>
            Attendre un nouvel appel
          </button>
        </div>
      )}
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className='relative'>
      <pre className='bg-canvas-200 border border-line rounded-xl p-3 pr-12 text-xs font-mono overflow-x-auto whitespace-pre'>
        {code}
      </pre>
      <button
        type='button'
        className={`absolute top-2 right-2 btn-secondary px-2 py-1 ${copied ? 'text-success border-success/30' : ''}`}
        title='Copier'
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast.error('Copie impossible');
          }
        }}
      >
        {copied ? <LuCheck size={13} /> : 'Copier'}
      </button>
    </div>
  );
}

// Panneau « Connexion » : l'adresse, le secret, les recettes de branchement, et
// le panneau d'écoute qui attend le premier appel.
//
// L'écoute est le cœur de l'assistant. Plutôt que de demander à l'utilisateur de
// décrire ce que sa source envoie, on le lui fait déclencher et on montre ce
// qu'on a reçu. C'est aussi le seul moyen honnête : personne ne connaît par cœur
// la forme exacte que Zapier donne à un formulaire Facebook.

import { useState } from 'react';
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
  revealLeadIntakeSecret,
  rotateLeadIntakeSecret,
  simulateLeadIntakeCall,
  updateLeadIntakeWebhook,
} from 'wasp/client/operations';
import { CopyableUrl, useConfirm } from '../../../client/ui';
import { formatMontrealTime } from '../../../client/format';
import { buildRecipes } from './recipes';
import type { IntakeSample } from '../intakeOperations';

export function IntakeConnectPanel({
  searchId,
  url,
  isAdmin,
  sample,
  listening,
  onListen,
  onSimulated,
  notifyByEmail,
  notifyBySms,
  alertDelayMinutes,
  alertEmail,
  alertPhone,
  canAlertBySms,
  onAlertsChanged,
}: {
  searchId: string;
  url: string;
  isAdmin: boolean;
  /** Le dernier appel reçu — détenu par IntakePanel, jamais rechargé ici. */
  sample: IntakeSample;
  listening: boolean;
  onListen: () => void;
  /** L'appel d'exemple est une action délibérée : on enchaîne tout de suite. */
  onSimulated: () => void;
  notifyByEmail: boolean;
  notifyBySms: boolean;
  /** Sursis avant l'envoi, en minutes. `0` = dès l'arrivée. */
  alertDelayMinutes: number;
  /** Coordonnées de l'entreprise que les alertes viseraient. */
  alertEmail: string | null;
  alertPhone: string | null;
  canAlertBySms: boolean;
  onAlertsChanged: () => void;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [recipeKey, setRecipeKey] = useState('zapier');
  const { ask, Dialog: ConfirmDialog } = useConfirm();

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
    const ok = await ask('Faire tourner le secret ?', {
      description:
        'L\'adresse de réception ne change pas. En revanche, toute source qui utilise encore '
        + 'l\'ancien secret sera refusée jusqu\'à ce que vous y colliez le nouveau.',
      confirmLabel: 'Faire tourner',
      variant: 'danger',
    });
    if (!ok) return;
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
      onSimulated();
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
      {ConfirmDialog}
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

      <IntakeAlerts
        searchId={searchId}
        isAdmin={isAdmin}
        notifyByEmail={notifyByEmail}
        notifyBySms={notifyBySms}
        alertDelayMinutes={alertDelayMinutes}
        alertEmail={alertEmail}
        alertPhone={alertPhone}
        canAlertBySms={canAlertBySms}
        onChanged={onAlertsChanged}
      />

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
      ) : sample ? (
        <div className='rounded-xl border border-success/30 bg-success/5 p-4 flex items-center gap-3'>
          <LuCheck size={18} className='shrink-0 text-success' />
          <div className='flex-1 min-w-0'>
            <p className='text-sm font-medium text-ink'>Appel reçu</p>
            <p className='text-xs text-muted mt-0.5'>
              Dernier appel le {formatMontrealTime(sample.receivedAt)} · {sample.paths.length} champ(s) détecté(s)
            </p>
          </div>
          <button type='button' className='btn-secondary shrink-0' onClick={onListen}>
            Attendre un nouvel appel
          </button>
        </div>
      ) : (
        // Écoute arrivée à échéance sans rien recevoir. On le dit plutôt que de
        // laisser un aspirateur tourner : rien n'est perdu, un appel qui arrive
        // plus tard sera de toute façon enregistré et visible dans le journal.
        <div className='rounded-xl border border-line bg-canvas-100 p-4 flex items-center gap-3'>
          <LuCircleAlert size={18} className='shrink-0 text-muted' />
          <div className='flex-1 min-w-0'>
            <p className='text-sm font-medium text-ink'>Écoute interrompue</p>
            <p className='text-xs text-muted mt-0.5'>
              Aucun appel reçu pour l'instant. Vos sources peuvent écrire à tout moment : ce qui
              arrivera sera enregistré et visible dans le journal.
            </p>
          </div>
          <div className='flex items-center gap-1.5 shrink-0'>
            {isAdmin && (
              <button type='button' className='btn-secondary gap-1.5' onClick={simulate} disabled={simulating}>
                {simulating ? <LuLoader size={14} className='animate-spin' /> : <LuPlay size={14} />}
                Simuler
              </button>
            )}
            <button type='button' className='btn-secondary' onClick={onListen}>
              Réécouter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Alertes de la source ─────────────────────────────────────────────────────

/**
 * Qui est prévenu quand un prospect arrive **sur ce tableau**.
 *
 * Réglé par source et non dans les paramètres de l'entreprise : on ne reçoit pas
 * de la même façon d'un formulaire Facebook et d'un tableur de rappels, et une
 * entreprise veut être alertée sur le tableau qui compte, pas sur les six.
 *
 * Les deux sont éteints par défaut. Une alerte est une interruption, et le SMS est
 * facturé : on les demande, on ne les subit pas.
 *
 * Le moment de l'envoi se règle ici aussi. « Après 10 minutes » laisse à qui a
 * Gestia ouvert le temps de voir la carte arriver et regroupe une vague en une
 * seule alerte ; « Dès l'arrivée » sert ceux qui rappellent tout de suite, et pour
 * qui dix minutes de retard sont dix minutes de trop.
 */
function IntakeAlerts({
  searchId,
  isAdmin,
  notifyByEmail,
  notifyBySms,
  alertDelayMinutes,
  alertEmail,
  alertPhone,
  canAlertBySms,
  onChanged,
}: {
  searchId: string;
  isAdmin: boolean;
  notifyByEmail: boolean;
  notifyBySms: boolean;
  alertDelayMinutes: number;
  alertEmail: string | null;
  alertPhone: string | null;
  canAlertBySms: boolean;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState<'email' | 'sms' | 'delay' | null>(null);

  async function save(what: 'email' | 'sms' | 'delay', patch: Record<string, boolean | number>) {
    setSaving(what);
    try {
      await updateLeadIntakeWebhook({ searchId, ...patch } as any);
      onChanged();
    } catch (err: any) {
      toast.error(err?.message ?? 'Modification impossible');
    } finally {
      setSaving(null);
    }
  }

  const toggle = (channel: 'email' | 'sms', next: boolean) =>
    save(channel, channel === 'email' ? { notifyByEmail: next } : { notifyBySms: next });

  const none = !notifyByEmail && !notifyBySms;
  const instant = alertDelayMinutes === 0;

  // Ce qui empêche un canal de servir, dit à l'endroit où on l'active — et non
  // pas seulement l'absence de destinataire. Un « Par SMS » grisé qui affiche
  // pourtant le bon numéro ne dit pas ce qui manque : ici, la clé Telnyx.
  const emailBlocked = alertEmail ? null : "Aucun courriel d'entreprise — Paramètres › Entreprise";
  const smsBlocked =
    !alertPhone ? "Aucun téléphone d'entreprise — Paramètres › Entreprise"
    : !canAlertBySms ? 'Envoi de SMS non configuré — Paramètres › Intégrations'
    : null;

  return (
    <div>
      <label className='label'>Alertes à l'arrivée d'un prospect</label>
      <div className='grid gap-2 sm:grid-cols-2'>
        <AlertToggle
          label='Par courriel'
          target={alertEmail}
          blocked={emailBlocked}
          checked={notifyByEmail}
          busy={saving === 'email'}
          disabled={!isAdmin || saving !== null || !!emailBlocked}
          onChange={next => toggle('email', next)}
        />
        <AlertToggle
          label='Par SMS'
          target={alertPhone}
          blocked={smsBlocked}
          checked={notifyBySms}
          busy={saving === 'sms'}
          disabled={!isAdmin || saving !== null || !!smsBlocked}
          onChange={next => toggle('sms', next)}
        />
      </div>
      {/* Le moment de l'envoi n'a de sens qu'une fois un canal choisi : sans
          destinataire, régler « dès l'arrivée » ne règle rien. */}
      {!none && (
        <div className='mt-2 flex flex-wrap items-center gap-2'>
          <span className='text-xs text-muted'>Envoi</span>
          <div className='inline-flex rounded-xl border border-line p-0.5'>
            {[
              { value: 0, label: "Dès l'arrivée" },
              { value: 10, label: 'Après 10 minutes' },
            ].map(choice => (
              <button
                key={choice.value}
                type='button'
                disabled={!isAdmin || saving !== null}
                onClick={() => {
                  if (choice.value !== alertDelayMinutes) save('delay', { alertDelayMinutes: choice.value });
                }}
                className={`rounded-[10px] px-2.5 py-1 text-xs font-medium transition-colors ${
                  choice.value === alertDelayMinutes
                    ? 'bg-accent-500 text-white'
                    : 'text-muted hover:text-ink disabled:hover:text-muted'
                }`}
              >
                {choice.label}
              </button>
            ))}
          </div>
          {saving === 'delay' && <LuLoader size={11} className='animate-spin text-muted' />}
        </div>
      )}

      <p className='text-xs text-muted mt-1.5'>
        {none ? (
          <>
            Aucune alerte : les prospects apparaissent sur le tableau, sans notification hors de
            Gestia.
          </>
        ) : instant ? (
          <>
            Envoyée dès l'arrivée. Un appel reçu vaut une alerte, même s'il porte plusieurs
            prospects
            {notifyBySms ? (
              <>
                {' '}— soit <strong className='text-ink'>un SMS facturé</strong>, au maximum un
                toutes les 2 minutes pour qu'une rafale ne se facture pas au prospect
              </>
            ) : null}
            .
          </>
        ) : (
          <>
            Envoyée 10 minutes après l'arrivée, et seulement si personne n'a touché au prospect
            entre-temps. Une seule alerte par vague, pas une par prospect
            {notifyBySms ? <> — soit <strong className='text-ink'>un SMS facturé</strong></> : null}.
          </>
        )}
      </p>
    </div>
  );
}

function AlertToggle({
  label,
  target,
  blocked,
  checked,
  busy,
  disabled,
  onChange,
}: {
  label: string;
  target: string | null;
  /** Ce qui empêche ce canal de servir, et où le régler. `null` = utilisable. */
  blocked: string | null;
  checked: boolean;
  busy: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  // Le destinataire est affiché en clair quand le canal marche : un interrupteur
  // « Par SMS » nu laisse deviner à quel numéro, et personne n'active une alerte
  // facturée à l'aveugle. Sinon c'est l'obstacle qui prend la place.
  const detail = blocked ?? target;
  return (
    <label
      className={`flex items-start gap-2.5 rounded-xl border p-2.5 transition-colors ${
        disabled ? 'border-line bg-canvas-100' : 'border-line hover:border-ink/30 cursor-pointer'
      }`}
    >
      <input
        type='checkbox'
        className='mt-0.5 rounded border-line text-accent focus:ring-accent/30'
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
      <span className='min-w-0 flex-1'>
        <span className='flex items-center gap-1.5 text-sm font-medium text-ink'>
          {label}
          {busy && <LuLoader size={11} className='animate-spin text-muted' />}
        </span>
        <span className={`block truncate text-xs ${blocked ? 'text-warning' : 'text-muted'}`} title={detail ?? ''}>
          {detail}
        </span>
      </span>
    </label>
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

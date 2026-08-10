// Le panneau de réception d'un tableau : Connexion · Correspondance · Journal.
//
// Un seul composant sert deux moments — les étapes 2B et 3 de l'assistant
// « Nouveau tableau », et le panneau de réglages d'un tableau webhook existant.
// C'est délibéré : régler une correspondance à la création et la recorriger six
// mois plus tard sont la même tâche, et mériteraient mal deux interfaces
// différentes à maintenir.

import { useEffect, useRef, useState } from 'react';
import { LuCircleAlert, LuLoader, LuPause, LuPlay } from 'react-icons/lu';
import toast from 'react-hot-toast';
import {
  getLeadIntakeConfig,
  replayIntakeEvent,
  updateLeadIntakeWebhook,
  useQuery,
} from 'wasp/client/operations';
import { useConfirm } from '../../../client/ui';
import { EMPTY_MAPPING, type LeadIntakeMapping } from '../../../shared/leadIntake';
import { IntakeConnectPanel } from './IntakeConnectPanel';
import { IntakeMappingPanel } from './IntakeMappingPanel';
import { IntakeEventLog } from './IntakeEventLog';
import { useIntakeSample } from './useIntakeSample';
import { INTAKE_LISTEN_MAX_MS } from '../../../client/polling';

type Tab = 'connect' | 'mapping' | 'log';

export function IntakePanel({
  searchId,
  isAdmin,
  /** Dans l'assistant : ferme la fenêtre et ouvre le tableau. */
  onFinish,
  /** Signale qu'un prospect vient d'être créé, pour rafraîchir le tableau derrière. */
  onLeadsCreated,
}: {
  searchId: string;
  isAdmin: boolean;
  onFinish?: () => void;
  onLeadsCreated?: () => void;
}) {
  const { data: cfg, isLoading, refetch: refetchConfig } = useQuery(getLeadIntakeConfig, { searchId });
  const [tab, setTab] = useState<Tab>('connect');
  const [sampleEventId, setSampleEventId] = useState<string | undefined>(undefined);
  const [listening, setListening] = useState(false);
  const { ask, Dialog: ConfirmDialog } = useConfirm();

  // Une seule instance de la requête d'échantillon pour tout le panneau : les
  // sous-panneaux la reçoivent en propriété plutôt que de la rappeler.
  const { sample, refetch: refetchSample } = useIntakeSample(searchId, {
    eventId: sampleEventId,
    listening,
  });

  // L'appel qu'on avait déjà sous les yeux au moment de se mettre à l'écoute.
  // Sans ce repère, « attendre un nouvel appel » se terminerait au premier
  // battement : la requête renvoie le même événement dans un objet neuf, et
  // « un échantillon existe » serait pris pour « un appel vient d'arriver ».
  const baselineEventId = useRef<string | null>(null);
  // Vrai tant que le repère n'est pas fiable : on écoutait un événement épinglé
  // depuis le journal, donc le premier résultat non épinglé sera le *dernier*
  // appel existant, et non une nouveauté.
  const awaitingBaseline = useRef(false);

  function startListening() {
    awaitingBaseline.current = sampleEventId !== undefined;
    baselineEventId.current = sample?.eventId ?? null;
    // On attend le *dernier* appel, pas celui qu'on avait épinglé : tant que la
    // requête reste fixée sur un événement précis, aucun nouveau ne peut
    // apparaître.
    setSampleEventId(undefined);
    setListening(true);
  }

  // Un appel réellement nouveau : on arrête d'écouter et on enchaîne sur la
  // correspondance. C'est ici, et non dans le panneau Connexion, parce que c'est
  // ce composant qui détient l'onglet courant.
  useEffect(() => {
    if (!listening || !sample) return;
    if (awaitingBaseline.current) {
      // Premier résultat après avoir désépinglé : c'est l'état de départ.
      awaitingBaseline.current = false;
      baselineEventId.current = sample.eventId;
      return;
    }
    if (sample.eventId === baselineEventId.current) return;
    baselineEventId.current = sample.eventId;
    setListening(false);
    setTab('mapping');
  }, [listening, sample]);

  // Jamais indéfiniment : un onglet oublié sur cet écran interrogerait la base
  // sans fin.
  useEffect(() => {
    if (!listening) return;
    const stop = setTimeout(() => setListening(false), INTAKE_LISTEN_MAX_MS);
    return () => clearTimeout(stop);
  }, [listening]);

  // Une fois la source configurée, on ouvre sur le journal : à ce stade la
  // question n'est plus « comment brancher » mais « qu'est-ce qui arrive ».
  useEffect(() => {
    if (cfg?.configured) setTab('log');
  }, [cfg?.configured]);

  // Rien reçu et rien de configuré : on se met à l'écoute d'emblée, c'est
  // l'unique raison d'être de cet écran à ce moment-là.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !cfg || cfg.configured) return;
    started.current = true;
    if (!sample) startListening();
  }, [cfg, sample]);

  if (isLoading || !cfg) {
    return <div className='flex justify-center py-10'><LuLoader size={22} className='animate-spin text-muted' /></div>;
  }

  async function togglePause() {
    if (!cfg) return;
    try {
      await updateLeadIntakeWebhook({ searchId, isActive: !cfg.isActive });
      await refetchConfig();
      toast.success(cfg.isActive ? 'Source mise en pause.' : 'Source réactivée.');
    } catch (err: any) {
      toast.error(err?.message ?? 'Modification impossible');
    }
  }

  /** Après enregistrement : proposer de créer le prospect de l'appel d'essai. */
  async function handleSaved(_mapping: LeadIntakeMapping) {
    await refetchConfig();
    const replay = sample && await ask('Créer le prospect à partir de cet appel ?', {
      description:
        'La correspondance est enregistrée. L\'appel qui a servi d\'exemple peut maintenant '
        + 'devenir une vraie carte sur le tableau.',
      confirmLabel: 'Créer le prospect',
      cancelLabel: 'Non, merci',
      variant: 'primary',
    });
    if (replay) {
      try {
        const res = await replayIntakeEvent({ searchId, eventId: sample.eventId });
        toast.success(`${res.created} prospect(s) créé(s).`);
        onLeadsCreated?.();
      } catch (err: any) {
        toast.error(err?.message ?? 'Création impossible');
      }
    }
    setTab('log');
  }

  const tabs: { key: Tab; label: string; disabled?: boolean; hint?: string }[] = [
    { key: 'connect', label: 'Connexion' },
    {
      key: 'mapping',
      label: 'Correspondance',
      disabled: !sample,
      hint: sample ? undefined : 'Recevez d\'abord un appel',
    },
    { key: 'log', label: 'Journal' },
  ];

  return (
    <div className='space-y-4'>
      {ConfirmDialog}
      {!cfg.isActive && (
        <div className='flex items-center gap-2.5 text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3'>
          <LuPause size={16} className='shrink-0' />
          <span className='flex-1'>Cette source est en pause : les appels reçus sont refusés.</span>
          {isAdmin && (
            <button type='button' className='btn-secondary gap-1.5 shrink-0' onClick={togglePause}>
              <LuPlay size={13} />
              Réactiver
            </button>
          )}
        </div>
      )}

      {cfg.isActive && !cfg.configured && (
        <div className='flex gap-2.5 text-sm bg-canvas-100 border border-line rounded-xl p-3'>
          <LuCircleAlert size={16} className='shrink-0 mt-0.5 text-muted' />
          <p className='text-muted'>
            Cette source est <strong className='text-ink'>en attente de configuration</strong> : les
            appels sont enregistrés mais aucun prospect n'est créé tant que la correspondance des
            champs n'est pas réglée.
          </p>
        </div>
      )}

      {cfg.errorCount > 0 && (
        <div className='flex gap-2.5 text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3'>
          <LuCircleAlert size={16} className='shrink-0 mt-0.5' />
          <p>
            {cfg.errorCount} appel(s) refusé(s) ou en erreur dans les dernières 24 h. Le journal
            indique lesquels et pourquoi.
          </p>
        </div>
      )}

      <div className='flex flex-wrap gap-1 border-b border-line'>
        {tabs.map(t => (
          <button
            key={t.key}
            type='button'
            onClick={() => !t.disabled && setTab(t.key)}
            disabled={t.disabled}
            title={t.hint}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              t.key === tab
                ? 'border-accent-500 text-ink'
                : 'border-transparent text-muted hover:text-ink'
            } ${t.disabled ? 'opacity-40 cursor-not-allowed hover:text-muted' : ''}`}
          >
            {t.label}
          </button>
        ))}

        <div className='ml-auto flex items-center gap-2 pb-1.5'>
          {cfg.receivedCount > 0 && (
            <span className='text-xs text-muted'>{cfg.receivedCount} prospect(s) reçus</span>
          )}
          {isAdmin && cfg.isActive && (
            <button type='button' className='btn-secondary text-xs px-2 py-1 gap-1' onClick={togglePause}>
              <LuPause size={12} />
              Pause
            </button>
          )}
        </div>
      </div>

      {tab === 'connect' && (
        <IntakeConnectPanel
          searchId={searchId}
          url={cfg.url}
          isAdmin={isAdmin}
          sample={sample}
          listening={listening}
          onListen={startListening}
          notifyByEmail={cfg.notifyByEmail}
          notifyBySms={cfg.notifyBySms}
          alertDelayMinutes={cfg.alertDelayMinutes}
          alertEmail={cfg.alertEmail}
          alertPhone={cfg.alertPhone}
          canAlertBySms={cfg.canAlertBySms}
          onAlertsChanged={refetchConfig}
          onSimulated={async () => {
            await refetchSample();
            setListening(false);
            setTab('mapping');
          }}
        />
      )}

      {tab === 'mapping' && sample && (
        <IntakeMappingPanel
          searchId={searchId}
          payload={sample.payload}
          paths={sample.paths}
          // Une correspondance déjà enregistrée l'emporte sur la proposition
          // automatique : on ne réécrit pas par-dessus un réglage volontaire.
          initialMapping={cfg.mapping ?? sample.suggested ?? EMPTY_MAPPING}
          isAdmin={isAdmin}
          onSaved={handleSaved}
        />
      )}

      {tab === 'log' && (
        <IntakeEventLog
          searchId={searchId}
          configured={cfg.configured}
          isAdmin={isAdmin}
          onUseAsSample={async id => {
            setSampleEventId(id);
            await refetchSample();
            setTab('mapping');
          }}
          onReplayed={() => {
            refetchConfig();
            onLeadsCreated?.();
          }}
        />
      )}

      {onFinish && (
        <div className='flex justify-end pt-2 border-t border-line'>
          <button type='button' className='btn-primary' onClick={onFinish}>
            {cfg.configured ? 'Ouvrir le tableau' : 'Terminer plus tard'}
          </button>
        </div>
      )}
    </div>
  );
}

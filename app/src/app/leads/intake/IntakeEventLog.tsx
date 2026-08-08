// Panneau « Journal » : les derniers appels reçus, tels qu'ils sont arrivés.
//
// C'est la surface de diagnostic. Sans elle, « mon Zapier ne marche pas » n'a
// aucune réponse possible : on ne sait ni si l'appel est arrivé, ni ce qu'il
// contenait, ni pourquoi il a été refusé.
//
// « Utiliser comme exemple » est aussi la façon de recorriger la correspondance
// quand un émetteur change de forme — d'où l'absence de tout mode « capture » à
// activer : chaque appel est déjà un échantillon disponible.

import { useState } from 'react';
import toast from 'react-hot-toast';
import { LuLoader, LuRefreshCcw, LuWand } from 'react-icons/lu';
import { getLeadIntakeEvents, replayIntakeEvent, useQuery } from 'wasp/client/operations';
import { formatMontrealTime } from '../../../client/format';

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  ok: { label: 'Prospect créé', className: 'badge-success' },
  captured: { label: 'Capturé', className: 'badge-info' },
  duplicate: { label: 'Doublon', className: 'badge-neutral' },
  rejected: { label: 'Refusé', className: 'bg-amber-50 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full' },
  error: { label: 'Erreur', className: 'bg-red-50 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full' },
};

export function IntakeEventLog({
  searchId,
  configured,
  isAdmin,
  onUseAsSample,
  onReplayed,
}: {
  searchId: string;
  configured: boolean;
  isAdmin: boolean;
  onUseAsSample: (eventId: string) => void;
  onReplayed: () => void;
}) {
  const { data: events, isLoading, refetch } = useQuery(getLeadIntakeEvents, { searchId, limit: 50 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [replaying, setReplaying] = useState<string | null>(null);

  async function replay(eventId: string) {
    setReplaying(eventId);
    try {
      const res = await replayIntakeEvent({ searchId, eventId });
      toast.success(`${res.created} prospect(s) créé(s).`);
      await refetch();
      onReplayed();
    } catch (err: any) {
      toast.error(err?.message ?? 'Rejeu impossible');
    } finally {
      setReplaying(null);
    }
  }

  if (isLoading) {
    return <div className='flex justify-center py-8'><LuLoader size={20} className='animate-spin text-muted' /></div>;
  }

  if (!events || events.length === 0) {
    return (
      <div className='text-center py-8'>
        <p className='text-sm text-muted'>Aucun appel reçu pour l'instant.</p>
        <p className='text-xs text-muted mt-1'>
          Les appels apparaîtront ici dès que votre source en enverra, réussis comme refusés.
        </p>
      </div>
    );
  }

  return (
    <div className='space-y-2'>
      <div className='flex justify-end'>
        <button type='button' className='btn-secondary gap-1.5' onClick={() => refetch()}>
          <LuRefreshCcw size={13} />
          Actualiser
        </button>
      </div>

      <div className='border border-line rounded-xl divide-y divide-line'>
        {events.map(ev => {
          const badge = STATUS_LABEL[ev.status] ?? { label: ev.status, className: 'badge-neutral' };
          const isOpen = expanded === ev.id;
          // Un appel dont le prospect est encore sur le tableau ne se rejoue pas :
          // ce serait fabriquer un doublon à la main. Mais une carte supprimée
          // rouvre la porte — c'est même le seul moyen de la faire revenir, et
          // `leadIds` seul, qui garde la trace des identifiants d'origine, la
          // condamnait pour toujours.
          const canReplay = isAdmin && configured && ev.liveLeadCount === 0 && ev.status !== 'duplicate';

          return (
            <div key={ev.id} className='px-3 py-2.5'>
              <div className='flex items-center gap-2 flex-wrap'>
                <span className={badge.className}>{badge.label}</span>
                <span className='text-xs text-muted'>{formatMontrealTime(ev.createdAt)}</span>
                {ev.dedupeKey && (
                  <span className='text-xs font-mono text-muted truncate max-w-[10rem]' title={ev.dedupeKey}>
                    {ev.dedupeKey}
                  </span>
                )}
                {ev.sourceIp === 'simulation' && <span className='badge-neutral'>Simulation</span>}

                <div className='ml-auto flex items-center gap-1.5'>
                  <button
                    type='button'
                    className='btn-secondary text-xs px-2 py-1'
                    onClick={() => setExpanded(isOpen ? null : ev.id)}
                  >
                    {isOpen ? 'Masquer' : 'Voir'}
                  </button>
                  {isAdmin && (
                    <button
                      type='button'
                      className='btn-secondary text-xs px-2 py-1 gap-1'
                      title='Régler la correspondance sur cet appel'
                      onClick={() => onUseAsSample(ev.id)}
                    >
                      <LuWand size={12} />
                      Exemple
                    </button>
                  )}
                  {canReplay && (
                    <button
                      type='button'
                      className='btn-secondary text-xs px-2 py-1'
                      onClick={() => replay(ev.id)}
                      disabled={replaying === ev.id}
                    >
                      {replaying === ev.id ? <LuLoader size={12} className='animate-spin' /> : 'Rejouer'}
                    </button>
                  )}
                </div>
              </div>

              {ev.errorMsg && <p className='text-xs text-amber-700 mt-1'>{ev.errorMsg}</p>}

              {isOpen && (
                <pre className='mt-2 bg-canvas-200 border border-line rounded-lg p-2.5 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto'>
                  {JSON.stringify(ev.payload, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

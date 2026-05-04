import { useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import {
  LuVideo, LuArchive, LuUser, LuMail, LuRotateCcw,
  LuTriangleAlert, LuInfo, LuChevronRight, LuArrowRight,
} from 'react-icons/lu';
import {
  useQuery,
  getMeetings,
  getArchivedMeetings,
  getClients,
  deleteMeeting,
  archiveMeeting,
  unarchiveMeeting,
  getGoogleCalendarStatus,
} from 'wasp/client/operations';
import { PageHeader, EmptyState, useConfirm, IconBtn, EditIcon, TrashIcon } from '../../client/ui';
import { formatDate, formatTime, formatDateTime } from '../../shared/format';
import { MeetingForm } from './MeetingForm';

function parseEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

// ─── Meeting card ─────────────────────────────────────────────────────────────
function MeetingCard({
  m, past = false, onEdit, onDelete, onArchive, onUnarchive,
}: {
  m: any;
  past?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
}) {
  const attendees = parseEmails(m.attendeeEmails);
  return (
    <div className={`card p-4 flex items-start justify-between gap-4 ${past ? 'opacity-60' : ''}`}>
      <div className='flex gap-4 flex-1 min-w-0'>
        {/* Date badge */}
        <div className='shrink-0 w-16 text-center bg-canvas-200 rounded-lg p-2'>
          <div className='text-xs uppercase text-muted'>{formatDate(m.startsAt).split(' ')[1]}</div>
          <div className='text-2xl font-semibold leading-none'>{new Date(m.startsAt).getDate()}</div>
          <div className='text-xs text-muted mt-1'>{formatTime(m.startsAt)}</div>
        </div>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2 flex-wrap'>
            <h3 className='font-medium'>{m.title}</h3>
            <span className='badge-info text-xs flex items-center gap-1'><LuVideo size={11} /> Vidéo</span>
            {past && !m.archived && <span className='badge-default text-xs'>Passée</span>}
            {m.archived && <span className='badge-default text-xs flex items-center gap-1'><LuArchive size={11} /> Archivée</span>}
          </div>
          <div className='text-sm text-muted mt-1 flex flex-wrap gap-x-3'>
            {m.client?.name && <span className='flex items-center gap-1'><LuUser size={12} /> {m.client.name}</span>}
            {attendees.length > 0 && (
              <span className='flex items-center gap-1' title={attendees.join(', ')}><LuMail size={12} /> {attendees.length} invité{attendees.length > 1 ? 's' : ''}</span>
            )}
          </div>
          {m.description && <p className='text-sm mt-1.5 text-muted'>{m.description}</p>}
          {m.meetLink ? (
            <a href={m.meetLink} target='_blank' rel='noreferrer'
              className='inline-flex items-center gap-1.5 mt-2 text-sm font-medium text-blue-600 hover:underline'>
              <LuVideo size={14} /> Rejoindre Google Meet <LuArrowRight size={13} />
            </a>
          ) : (
            <span className='text-xs text-muted mt-2 inline-block'>Lien Meet non disponible</span>
          )}
        </div>
      </div>
      <div className='flex items-center gap-1 shrink-0'>
        {onUnarchive && (
          <button type='button' onClick={onUnarchive} title='Désarchiver'
            className='inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-canvas-300 text-muted hover:bg-canvas-100 transition-colors'>
            <LuRotateCcw size={12} /> Restaurer
          </button>
        )}
        {onArchive && (
          <button type='button' onClick={onArchive} title='Archiver cette rencontre'
            className='inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-canvas-300 text-muted hover:bg-canvas-100 transition-colors'>
            <LuArchive size={12} /> Archiver
          </button>
        )}
        {!onUnarchive && <IconBtn title='Modifier' onClick={onEdit}><EditIcon /></IconBtn>}
        <IconBtn variant='danger' title='Supprimer' onClick={onDelete}><TrashIcon /></IconBtn>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MeetingsPage() {
  const { data: meetings, isLoading } = useQuery(getMeetings);
  const { data: archived, isLoading: archivedLoading } = useQuery(getArchivedMeetings);
  const { data: clients } = useQuery(getClients);
  const { data: calStatus } = useQuery(getGoogleCalendarStatus);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [showPast, setShowPast] = useState(false);
  const [view, setView] = useState<'active' | 'archive'>('active');
  const { ask, Dialog: ConfirmDialog } = useConfirm();

  const calConnected = (calStatus as any)?.connected ?? false;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcoming = (meetings ?? []).filter((m: any) => new Date(m.startsAt) >= today);
  const past = (meetings ?? []).filter((m: any) => new Date(m.startsAt) < today);
  const archivedList = (archived ?? []) as any[];

  return (
    <>
      <PageHeader
        title='Rencontres'
        subtitle='Planifiez vos rencontres vidéo avec clients et collaborateurs.'
        actions={
          <button
            className='btn-primary'
            onClick={() => { if (calConnected) setCreating(true); }}
            disabled={!calConnected || view === 'archive'}
            title={!calConnected ? 'Connectez Google Agenda pour créer des rencontres' : undefined}
          >
            Nouvelle rencontre
          </button>
        }
      />

      {/* Tab switcher */}
      <div className='flex gap-1 mb-5 border-b border-canvas-300'>
        {(['active', 'archive'] as const).map((v) => (
          <button key={v} type='button' onClick={() => setView(v)}
            className={[
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              view === v ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-foreground',
            ].join(' ')}
          >
            {v === 'active' ? 'Rencontres' : `Archives${archivedList.length > 0 ? ` (${archivedList.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* ── Active view ── */}
      {view === 'active' && (
        <>
          {!calConnected && (
            <div className='mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-3'>
              <LuTriangleAlert size={18} className='shrink-0 mt-0.5' />
              <div>
                <strong>Google Agenda non connecté.</strong> La création de rencontres est désactivée jusqu'à ce que vous connectiez votre Google Agenda.{' '}
                <Link to='/parametres' className='underline font-medium'>Aller dans Paramètres → Intégrations</Link>
              </div>
            </div>
          )}
          {calConnected && (
            <div className='mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 flex items-start gap-3'>
              <LuInfo size={18} className='shrink-0 mt-0.5' />
              <div>
                <strong>Synchronisation Google Agenda unidirectionnelle.</strong>{' '}
                Les rencontres créées ici sont automatiquement ajoutées à votre Google Agenda et les invités reçoivent une invitation.{' '}
                Toute modification faite <em>directement dans Google Agenda</em> ne sera pas répercutée ici.
              </div>
            </div>
          )}

          {isLoading ? (
            <div className='text-muted'>Chargement…</div>
          ) : upcoming.length === 0 && past.length === 0 ? (
            <EmptyState title='Aucune rencontre' description='Planifiez votre première rencontre vidéo.'
              action={calConnected
                ? <button className='btn-primary' onClick={() => setCreating(true)}>Planifier</button>
                : <Link to='/parametres' className='btn-primary'>Connecter Google Agenda</Link>}
            />
          ) : (
            <>
              {upcoming.length === 0 && <p className='text-muted text-sm mb-4'>Aucune rencontre à venir.</p>}
              <div className='space-y-3'>
                {upcoming.map((m: any) => (
                  <MeetingCard key={m.id} m={m}
                    onEdit={() => setEditing(m)}
                    onDelete={async () => {
                      if (await ask('Supprimer cette rencontre ?', { description: 'Les invités recevront automatiquement un email d\'annulation.' })) {
                        try {
                          await deleteMeeting({ id: m.id });
                          const att = parseEmails(m.attendeeEmails);
                          const msg = att.length > 0 ? ` — ${att.length} invité${att.length > 1 ? 's' : ''} notifié${att.length > 1 ? 's' : ''}` : '';
                          toast.success(`Rencontre supprimée${msg}`);
                        } catch (err: any) { toast.error(err?.message || 'Erreur'); }
                      }
                    }}
                  />
                ))}
              </div>

              {past.length > 0 && (
                <div className='mt-6'>
                  <button type='button' onClick={() => setShowPast((v) => !v)}
                    className='flex items-center gap-2 text-sm text-muted hover:text-foreground transition-colors font-medium mb-3'>
                    <LuChevronRight size={14} className={`transition-transform ${showPast ? 'rotate-90' : ''}`} />
                    {showPast ? 'Masquer' : 'Afficher'} les rencontres passées ({past.length})
                  </button>
                  {showPast && (
                    <div className='space-y-3'>
                      {past.map((m: any) => (
                        <MeetingCard key={m.id} m={m} past
                          onEdit={() => setEditing(m)}
                          onDelete={async () => {
                            if (await ask('Supprimer cette rencontre ?', { description: 'Les invités recevront automatiquement un email d\'annulation.' })) {
                              try { await deleteMeeting({ id: m.id }); toast.success('Rencontre supprimée'); }
                              catch (err: any) { toast.error(err?.message || 'Erreur'); }
                            }
                          }}
                          onArchive={async () => {
                            try { await archiveMeeting({ id: m.id }); toast.success('Rencontre archivée'); }
                            catch (err: any) { toast.error(err?.message || 'Erreur'); }
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Archive view ── */}
      {view === 'archive' && (
        <>
          {archivedLoading ? (
            <div className='text-muted'>Chargement…</div>
          ) : archivedList.length === 0 ? (
            <EmptyState title='Aucune rencontre archivée' description='Les rencontres passées que vous archivez apparaîtront ici.' />
          ) : (
            <div className='space-y-3'>
              {archivedList.map((m: any) => (
                <MeetingCard key={m.id} m={m}
                  onEdit={() => {}}
                  onDelete={async () => {
                    if (await ask('Supprimer définitivement cette rencontre archivée ?')) {
                      try { await deleteMeeting({ id: m.id }); toast.success('Rencontre supprimée'); }
                      catch (err: any) { toast.error(err?.message || 'Erreur'); }
                    }
                  }}
                  onUnarchive={async () => {
                    try { await unarchiveMeeting({ id: m.id }); toast.success('Rencontre restaurée'); }
                    catch (err: any) { toast.error(err?.message || 'Erreur'); }
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {(creating || editing) && (
        <MeetingForm
          meeting={editing}
          clients={clients || []}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
      {ConfirmDialog}
    </>
  );
}


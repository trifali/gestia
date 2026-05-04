import { useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import {
  useQuery,
  getMeetings,
  getClients,
  deleteMeeting,
  getGoogleCalendarStatus,
} from 'wasp/client/operations';
import { PageHeader, EmptyState, useConfirm, IconBtn, EditIcon, TrashIcon } from '../../client/ui';
import { formatDate, formatTime } from '../../shared/format';
import { MeetingForm } from './MeetingForm';

function parseEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export default function MeetingsPage() {
  const { data: meetings, isLoading } = useQuery(getMeetings);
  const { data: clients } = useQuery(getClients);
  const { data: calStatus } = useQuery(getGoogleCalendarStatus);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const { ask, Dialog: ConfirmDialog } = useConfirm();

  const calConnected = (calStatus as any)?.connected ?? false;

  const handleNewMeeting = () => {
    if (!calConnected) return;
    setCreating(true);
  };

  return (
    <>
      <PageHeader
        title='Rencontres'
        subtitle='Planifiez vos rencontres vidéo avec clients et collaborateurs.'
        actions={
          <button
            className='btn-primary'
            onClick={handleNewMeeting}
            disabled={!calConnected}
            title={!calConnected ? 'Connectez Google Agenda pour créer des rencontres' : undefined}
          >
            Nouvelle rencontre
          </button>
        }
      />

      {!calConnected && (
        <div className='mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-3'>
          <span className='text-lg leading-tight'>⚠️</span>
          <div>
            <strong>Google Agenda non connecté.</strong> La création de rencontres est désactivée jusqu'à ce que vous connectiez votre Google Agenda.{' '}
            <Link to='/parametres' className='underline font-medium'>
              Aller dans Paramètres → Intégrations
            </Link>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className='text-muted'>Chargement…</div>
      ) : !meetings || meetings.length === 0 ? (
        <EmptyState
          title='Aucune rencontre'
          description='Planifiez votre première rencontre vidéo.'
          action={
            calConnected
              ? <button className='btn-primary' onClick={() => setCreating(true)}>Planifier</button>
              : <Link to='/parametres' className='btn-primary'>Connecter Google Agenda</Link>
          }
        />
      ) : (
        <div className='space-y-3'>
          {meetings.map((m: any) => {
            const attendees = parseEmails(m.attendeeEmails);
            return (
              <div key={m.id} className='card p-4 flex items-start justify-between gap-4'>
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
                      <span className='badge-info text-xs'>🎥 Vidéo</span>
                    </div>
                    {/* Client + attendees */}
                    <div className='text-sm text-muted mt-1 flex flex-wrap gap-x-3'>
                      {m.client?.name && <span>👤 {m.client.name}</span>}
                      {attendees.length > 0 && (
                        <span title={attendees.join(', ')}>
                          ✉️ {attendees.length} invité{attendees.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {m.description && <p className='text-sm mt-1.5 text-muted'>{m.description}</p>}
                    {/* Meet link */}
                    {m.meetLink ? (
                      <a
                        href={m.meetLink}
                        target='_blank'
                        rel='noreferrer'
                        className='inline-flex items-center gap-1.5 mt-2 text-sm font-medium text-blue-600 hover:underline'
                      >
                        <span>🎥</span>
                        Rejoindre Google Meet →
                      </a>
                    ) : (
                      <span className='text-xs text-muted mt-2 inline-block'>Lien Meet non disponible</span>
                    )}
                  </div>
                </div>
                <div className='flex items-center gap-1 shrink-0'>
                  <IconBtn title='Modifier' onClick={() => setEditing(m)}><EditIcon /></IconBtn>
                  <IconBtn variant='danger' title='Supprimer' onClick={async () => {
                    if (await ask('Supprimer cette rencontre ?')) {
                      try {
                        await deleteMeeting({ id: m.id });
                        toast.success('Rencontre supprimée');
                      } catch (err: any) {
                        toast.error(err?.message || 'Erreur lors de la suppression');
                      }
                    }
                  }}><TrashIcon /></IconBtn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(creating || editing) && (
        <MeetingForm
          meeting={editing}
          clients={clients || []}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {ConfirmDialog}
    </>
  );
}

import { useState } from 'react';
import toast from 'react-hot-toast';
import {
  useQuery,
  getMeetings,
  getClients,
  deleteMeeting,
} from 'wasp/client/operations';
import { PageHeader, EmptyState, useConfirm, IconBtn, EditIcon, TrashIcon } from '../../client/ui';
import { formatDate, formatTime } from '../../shared/format';
import { MeetingForm } from './MeetingForm';

const STATUS: Record<string, { label: string; className: string }> = {
  prevue: { label: 'Prévue', className: 'badge-info' },
  confirmee: { label: 'Confirmée', className: 'badge-success' },
  terminee: { label: 'Terminée', className: 'badge-neutral' },
  annulee: { label: 'Annulée', className: 'badge-danger' },
};

export default function MeetingsPage() {
  const { data: meetings, isLoading } = useQuery(getMeetings);
  const { data: clients } = useQuery(getClients);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const { ask, Dialog: ConfirmDialog } = useConfirm();

  return (
    <>
      <PageHeader
        title='Rencontres'
        subtitle='Planifiez vos rencontres avec clients et collaborateurs.'
        actions={<button className='btn-primary' onClick={() => setCreating(true)}>Nouvelle rencontre</button>}
      />

      {isLoading ? (
        <div className='text-muted'>Chargement…</div>
      ) : !meetings || meetings.length === 0 ? (
        <EmptyState
          title='Aucune rencontre'
          description='Planifiez votre première rencontre.'
          action={<button className='btn-primary' onClick={() => setCreating(true)}>Planifier</button>}
        />
      ) : (
        <div className='space-y-3'>
          {meetings.map((m: any) => (
            <div key={m.id} className='card p-4 flex items-start justify-between gap-4'>
              <div className='flex gap-4 flex-1 min-w-0'>
                <div className='shrink-0 w-16 text-center bg-canvas-200 rounded-lg p-2'>
                  <div className='text-xs uppercase text-muted'>{formatDate(m.startsAt).split(' ')[1]}</div>
                  <div className='text-2xl font-semibold leading-none'>{new Date(m.startsAt).getDate()}</div>
                  <div className='text-xs text-muted mt-1'>{formatTime(m.startsAt)}</div>
                </div>
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2 flex-wrap'>
                    <h3 className='font-medium'>{m.title}</h3>
                    <span className={STATUS[m.status]?.className || 'badge-neutral'}>
                      {STATUS[m.status]?.label || m.status}
                    </span>
                  </div>
                  <div className='text-sm text-muted mt-1'>
                    {m.client?.name && <>👤 {m.client.name} · </>}
                    {m.location && <>📍 {m.location}</>}
                  </div>
                  {m.description && <p className='text-sm mt-2'>{m.description}</p>}
                  {m.meetingUrl && (
                    <a href={m.meetingUrl} target='_blank' rel='noreferrer' className='text-sm text-accent hover:underline mt-2 inline-block'>
                      Lien de visioconférence →
                    </a>
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
          ))}
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

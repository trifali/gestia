import { useState } from 'react';
import {
  useQuery,
  getMeetings,
  getClients,
  createMeeting,
  updateMeeting,
  deleteMeeting,
} from 'wasp/client/operations';
import { PageHeader, EmptyState, Modal, useConfirm, IconBtn, EditIcon, TrashIcon } from '../../client/ui';
import { formatDate, formatTime, formatDateTimeForInput } from '../../shared/format';

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
                  if (await ask('Supprimer cette rencontre ?')) await deleteMeeting({ id: m.id });
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

function MeetingForm({ meeting, clients, onClose }: { meeting?: any; clients: any[]; onClose: () => void }) {
  const [form, setForm] = useState({
    title: meeting?.title || '',
    description: meeting?.description || '',
    clientId: meeting?.clientId || '',
    startsAt: formatDateTimeForInput(meeting?.startsAt) || formatDateTimeForInput(new Date()),
    endsAt: formatDateTimeForInput(meeting?.endsAt),
    location: meeting?.location || '',
    meetingUrl: meeting?.meetingUrl || '',
    status: meeting?.status || 'prevue',
  });
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        description: form.description || undefined,
        clientId: form.clientId || null,
        startsAt: form.startsAt,
        endsAt: form.endsAt || null,
        location: form.location || undefined,
        meetingUrl: form.meetingUrl || undefined,
        status: form.status,
      };
      if (meeting) {
        await updateMeeting({ id: meeting.id, ...payload });
      } else {
        await createMeeting(payload);
      }
      onClose();
    } catch (err: any) {
      alert(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={meeting ? 'Modifier la rencontre' : 'Nouvelle rencontre'}
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='meeting-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form id='meeting-form' onSubmit={onSubmit} className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
        <div className='col-span-2'>
          <label className='label'>Titre *</label>
          <input className='input' required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <label className='label'>Client</label>
          <select className='input' value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
            <option value=''>— Aucun —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className='label'>Statut</label>
          <select className='input' value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value='prevue'>Prévue</option>
            <option value='confirmee'>Confirmée</option>
            <option value='terminee'>Terminée</option>
            <option value='annulee'>Annulée</option>
          </select>
        </div>
        <div>
          <label className='label'>Début *</label>
          <input type='datetime-local' className='input' required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
        </div>
        <div>
          <label className='label'>Fin</label>
          <input type='datetime-local' className='input' value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
        </div>
        <div className='col-span-2'>
          <label className='label'>Lieu</label>
          <input className='input' value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder='Ex. Bureau · Visioconférence · Adresse' />
        </div>
        <div className='col-span-2'>
          <label className='label'>Lien de visioconférence</label>
          <input className='input' value={form.meetingUrl} onChange={(e) => setForm({ ...form, meetingUrl: e.target.value })} placeholder='https://…' />
        </div>
        <div className='col-span-2'>
          <label className='label'>Description</label>
          <textarea className='input' rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </form>
    </Modal>
  );
}

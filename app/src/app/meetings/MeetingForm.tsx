import { useState } from 'react';
import { createMeeting, updateMeeting } from 'wasp/client/operations';
import { Modal } from '../../client/ui';
import { formatDateTimeForInput } from '../../shared/format';

type Props = {
  /** When provided, edits this meeting; otherwise creates a new one. */
  meeting?: any;
  /** Pre-filled client id (hides the client selector). */
  clientId?: string;
  /** Required when `clientId` is not provided. */
  clients?: any[];
  onClose: () => void;
};

export function MeetingForm({ meeting, clientId: presetClientId, clients, onClose }: Props) {
  const [form, setForm] = useState({
    title: meeting?.title || '',
    description: meeting?.description || '',
    clientId: presetClientId ?? meeting?.clientId ?? '',
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
          <input
            className='input'
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>
        {!presetClientId && (
          <div>
            <label className='label'>Client</label>
            <select
              className='input'
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            >
              <option value=''>— Aucun —</option>
              {(clients || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className='label'>Statut</label>
          <select
            className='input'
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            <option value='prevue'>Prévue</option>
            <option value='confirmee'>Confirmée</option>
            <option value='terminee'>Terminée</option>
            <option value='annulee'>Annulée</option>
          </select>
        </div>
        <div>
          <label className='label'>Début *</label>
          <input
            type='datetime-local'
            className='input'
            required
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
          />
        </div>
        <div>
          <label className='label'>Fin</label>
          <input
            type='datetime-local'
            className='input'
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
          />
        </div>
        <div className='col-span-2'>
          <label className='label'>Lieu</label>
          <input
            className='input'
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder='Ex. Bureau · Visioconférence · Adresse'
          />
        </div>
        <div className='col-span-2'>
          <label className='label'>Lien de visioconférence</label>
          <input
            className='input'
            value={form.meetingUrl}
            onChange={(e) => setForm({ ...form, meetingUrl: e.target.value })}
            placeholder='https://…'
          />
        </div>
        <div className='col-span-2'>
          <label className='label'>Description</label>
          <textarea
            className='input'
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
      </form>
    </Modal>
  );
}

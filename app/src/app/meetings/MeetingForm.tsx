import { useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { createMeeting, updateMeeting } from 'wasp/client/operations';
import { Modal } from '../../client/ui';
import { MagicInput, MagicTextarea } from '../../client/magic';
import { formatDateTimeForInput, formatDate, formatTime } from '../../shared/format';
import { DayTimePicker } from './DayTimePicker';

type Props = {
  /** When provided, edits this meeting; otherwise creates a new one. */
  meeting?: any;
  /** Pre-filled client id. */
  clientId?: string;
  /** Pre-fill client name in default title. */
  clientName?: string;
  /** Pre-fill invited emails with client email. */
  clientEmail?: string;
  /** Required when `clientId` is not provided. */
  clients?: any[];
  onClose: () => void;
};

// ─── Email tag input ──────────────────────────────────────────────────────────
function EmailTagInput({
  emails,
  onChange,
  lockedEmails = [],
}: {
  emails: string[];
  onChange: (emails: string[]) => void;
  lockedEmails?: string[];
}) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addEmail = (raw: string) => {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return;
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error(`Courriel invalide : ${trimmed}`);
      return;
    }
    if (!emails.includes(trimmed)) onChange([...emails, trimmed]);
    setInput('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addEmail(input);
    } else if (e.key === 'Backspace' && !input && emails.length > 0) {
      // Don't remove locked emails via backspace
      const last = emails[emails.length - 1];
      if (!lockedEmails.includes(last)) onChange(emails.slice(0, -1));
    }
  };

  const onBlur = () => {
    if (input.trim()) addEmail(input);
  };

  return (
    <div
      className='input min-h-[42px] flex flex-wrap gap-1.5 items-center cursor-text py-1.5'
      onClick={() => inputRef.current?.focus()}
    >
      {emails.map((email) => {
        const locked = lockedEmails.includes(email);
        return (
          <span
            key={email}
            className={[
              'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
              locked ? 'bg-canvas-200 text-muted' : 'bg-accent/10 text-accent',
            ].join(' ')}
          >
            {email}
            {locked ? (
              <span className='text-muted/50 text-[10px]' title='Invité existant'>🔒</span>
            ) : (
              <button
                type='button'
                className='hover:text-danger transition-colors'
                onClick={(e) => { e.stopPropagation(); onChange(emails.filter((x) => x !== email)); }}
                aria-label={`Retirer ${email}`}
              >
                ✕
              </button>
            )}
          </span>
        );
      })}
      <input
        ref={inputRef}
        type='email'
        className='flex-1 min-w-[180px] bg-transparent outline-none text-sm placeholder:text-muted'
        placeholder={emails.length === 0 ? 'Ajouter une adresse courriel…' : '+ courriel'}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
    </div>
  );
}

// ─── Form ─────────────────────────────────────────────────────────────────────
export function MeetingForm({ meeting, clientId: presetClientId, clientName, clientEmail, clients, onClose }: Props) {
  // Parse attendee emails from existing meeting or default to client email
  const initialEmails = (): string[] => {
    if (meeting?.attendeeEmails) {
      try { return JSON.parse(meeting.attendeeEmails); } catch { /* ignore */ }
    }
    if (clientEmail) return [clientEmail];
    return [];
  };

  // Compute duration from existing meeting (startsAt → endsAt)
  const initialDuration = (): number => {
    if (meeting?.startsAt && meeting?.endsAt) {
      const diff = Math.round(
        (new Date(meeting.endsAt).getTime() - new Date(meeting.startsAt).getTime()) / 60000,
      );
      return diff > 0 ? diff : 60;
    }
    return 60;
  };

  const defaultTitle = (name?: string) => name ? `Rencontre avec ${name}` : 'Rencontre';

  const [form, setForm] = useState({
    title: meeting?.title || defaultTitle(clientName),
    description: meeting?.description || '',
    clientId: presetClientId ?? meeting?.clientId ?? '',
    startsAt: formatDateTimeForInput(meeting?.startsAt) || formatDateTimeForInput(new Date()),
    durationMinutes: String(initialDuration()),
  });
  // Track if user has manually edited the title so we don't overwrite it on client change
  const [titleDirty, setTitleDirty] = useState(!!meeting?.title);
  const [emails, setEmails] = useState<string[]>(initialEmails);
  // Emails already on the meeting cannot be removed — only new ones can
  const lockedEmails = initialEmails();
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
        durationMinutes: Number(form.durationMinutes) || 60,
        attendeeEmails: JSON.stringify(emails),
      };
      const inviteMsg = emails.length > 0
        ? ` — ${emails.length} invité${emails.length > 1 ? 's' : ''} notifié${emails.length > 1 ? 's' : ''} par courriel`
        : '';
      if (meeting) {
        await updateMeeting({ id: meeting.id, ...payload });
        toast.success(`Rencontre modifiée${inviteMsg}`);
      } else {
        await createMeeting(payload);
        toast.success(`Rencontre créée — lien Google Meet généré${inviteMsg}`);
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Une erreur est survenue');
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
            {saving ? 'Envoi en cours…' : (meeting ? 'Sauvegarder & envoyer' : 'Créer & envoyer les invitations')}
          </button>
        </>
      }
    >
      <form id='meeting-form' onSubmit={onSubmit} className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
        {/* Title */}
        <div className='col-span-2'>
          <label className='label'>Titre *</label>
          <MagicInput
            className='input'
            required
            value={form.title}
            onChange={(e) => { setTitleDirty(true); setForm({ ...form, title: e.target.value }); }}
          />
        </div>

        {/* Client selector (only on standalone meetings page) */}
        {!presetClientId && (
          <div className='col-span-2'>
            <label className='label'>Client</label>
            <select
              className='input'
              value={form.clientId}
              onChange={(e) => {
                const selected = (clients || []).find((c) => c.id === e.target.value);
                const newEmails = selected?.email
                  ? Array.from(new Set([...emails, selected.email]))
                  : emails;
                setEmails(newEmails);
                setForm({
                  ...form,
                  clientId: e.target.value,
                  title: titleDirty ? form.title : defaultTitle(selected?.name),
                });
              }}
            >
              <option value=''>— Aucun —</option>
              {(clients || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Date & time */}
        <div className='col-span-2'>
          <label className='label mb-1.5 block'>Date et heure *</label>
          <DayTimePicker
            value={form.startsAt}
            onChange={(v) => setForm({ ...form, startsAt: v })}
            duration={Number(form.durationMinutes) || 60}
            onDurationChange={(d) => setForm({ ...form, durationMinutes: String(d) })}
          />
          {/* Summary of selected date + time */}
          <div className='mt-2 flex items-center gap-2 text-sm'>
            <span className='text-muted'>📅</span>
            {form.startsAt.includes('T') ? (
              <span className='font-medium'>
                {formatDate(form.startsAt)}
                <span className='text-muted'> à </span>
                {formatTime(form.startsAt)}
                <span className='text-muted ml-1.5'>({Number(form.durationMinutes) || 60} min)</span>
              </span>
            ) : (
              <span className='text-muted italic'>Sélectionnez une heure</span>
            )}
          </div>
        </div>

        {/* Invited emails */}
        <div className='col-span-2'>
          <label className='label'>Invités</label>
          <EmailTagInput emails={emails} onChange={setEmails} lockedEmails={meeting ? lockedEmails : []} />
          <p className='text-xs text-muted mt-1'>
            Appuyez sur Entrée ou virgule pour ajouter. Les invités recevront une invitation Google Agenda.
          </p>
        </div>

        {/* Description */}
        <div className='col-span-2'>
          <label className='label'>Description</label>
          <MagicTextarea
            className='input'
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>

        {/* Show existing Meet link when editing */}
        {meeting?.meetLink && (
          <div className='col-span-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 flex items-center gap-2'>
            <span className='text-sm'>🎥</span>
            <a
              href={meeting.meetLink}
              target='_blank'
              rel='noreferrer'
              className='text-sm text-blue-700 hover:underline truncate'
            >
              {meeting.meetLink}
            </a>
          </div>
        )}
      </form>
    </Modal>
  );
}


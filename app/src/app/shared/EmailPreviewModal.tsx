// Aperçu d'un courriel avant l'envoi.
//
// Existe parce que la citation des échanges précédents est ajoutée au moment de
// l'envoi, pas dans le champ de saisie : sans aperçu, la moitié de ce que reçoit
// le destinataire n'est visible nulle part. Le corps est assemblé par la même
// fonction que le serveur (`shared/mailThread`), donc ce cadre montre les octets
// qui partiront, pas une approximation.

import { LuEye, LuMailOpen, LuPaperclip } from 'react-icons/lu';
import { Modal } from '../../client/ui';
import {
  QUOTED_HISTORY_LIMIT,
  buildEmailHtml,
  buildQuotedHistory,
  type SentEmailLog,
} from '../../shared/mailThread';

export type EmailPreviewHeaders = {
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  to: string;
  cc: string | null;
  /** Adresse mise en Cci par l'intégration, ou null quand la copie est coupée. */
  bcc: string | null;
  subject: string;
};

export function EmailPreviewModal({
  headers,
  body,
  previousLogs,
  attachmentName,
  onOpenAttachment,
  onClose,
}: {
  headers: EmailPreviewHeaders;
  body: string;
  /** Envois précédents, du plus récent au plus ancien — ceux qui seront cités. */
  previousLogs: SentEmailLog[];
  attachmentName?: string | null;
  /** Ouvre la pièce jointe. Absent = le nom reste du texte. */
  onOpenAttachment?: () => void;
  onClose: () => void;
}) {
  const quoted = buildQuotedHistory((previousLogs || []).slice(0, QUOTED_HISTORY_LIMIT));
  const html = buildEmailHtml(body, quoted);

  const from = headers.fromEmail
    ? `${headers.fromName || 'Gestia'} <${headers.fromEmail}>`
    : headers.fromName || '—';

  return (
    <Modal
      open
      onClose={onClose}
      title='Aperçu du courriel'
      footer={
        <>
          <div className='flex-1' />
          <button className='btn-secondary' onClick={onClose}>
            Fermer
          </button>
        </>
      }
    >
      <div className='space-y-3'>
        <p className='text-xs text-muted flex items-start gap-1.5'>
          <LuMailOpen size={13} className='mt-0.5 shrink-0' />
          <span>Ce que recevra le destinataire. Rien n’est envoyé depuis cet écran.</span>
        </p>

        <dl className='text-xs space-y-1 border border-line rounded-md px-3 py-2.5 bg-canvas-100'>
          <PreviewRow label='De' value={from} />
          <PreviewRow label='À' value={headers.to || '—'} />
          {headers.cc && <PreviewRow label='Cc' value={headers.cc} />}
          {headers.bcc && <PreviewRow label='Cci' value={headers.bcc} />}
          <PreviewRow label='Répondre à' value={headers.replyTo || '— (réponses perdues)'} />
          <PreviewRow label='Objet' value={headers.subject || '(sans objet)'} />
        </dl>

        <div className='border border-line rounded-md bg-white p-3 max-h-[45vh] overflow-y-auto'>
          {body.trim() || quoted.html ? (
            // Sûr : tout ce qui vient de l'utilisateur est échappé par
            // `buildEmailHtml` / `buildQuotedHistory` avant d'arriver ici.
            <div dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <p className='text-xs text-muted italic'>Message vide.</p>
          )}
        </div>

        {attachmentName &&
          (onOpenAttachment ? (
            <button
              type='button'
              className='text-xs text-muted hover:text-accent transition-colors inline-flex items-center gap-1.5 group'
              onClick={onOpenAttachment}
              title='Ouvrir la pièce jointe'
            >
              <LuPaperclip size={13} className='shrink-0' />
              <span>
                Pièce jointe :{' '}
                <span className='font-mono group-hover:underline'>{attachmentName}</span>
              </span>
              <LuEye size={13} className='shrink-0 opacity-60' />
            </button>
          ) : (
            <p className='text-xs text-muted flex items-center gap-1.5'>
              <LuPaperclip size={13} className='shrink-0' />
              <span>
                Pièce jointe : <span className='font-mono'>{attachmentName}</span>
              </span>
            </p>
          ))}

        {previousLogs.length > 0 && (
          <p className='text-xs text-muted'>
            {previousLogs.length > 1
              ? `Les ${Math.min(previousLogs.length, QUOTED_HISTORY_LIMIT)} échanges précédents sont cités ci-dessus`
              : 'L’échange précédent est cité ci-dessus'}
            , et le courriel repartira dans le même fil de discussion.
          </p>
        )}
      </div>
    </Modal>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex gap-2'>
      <dt className='text-muted shrink-0 w-24'>{label}</dt>
      <dd className='flex-1 break-words'>{value}</dd>
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { LuEye, LuTriangleAlert } from 'react-icons/lu';
import { useQuery, getCurrentCompany, sendSupplierPortalLink } from 'wasp/client/operations';
import { Modal } from '../../client/ui';
import { useEmailCapability } from '../../client/capabilities';
import { EmailPreviewModal } from '../shared/EmailPreviewModal';

/** Courriel par défaut : ce que le portail permet, le lien, la signature de l'entreprise. */
function defaultMessage(supplier: any, link: string, company: any): { subject: string; body: string } {
  const companyName = company?.name || 'notre entreprise';
  const signature = company?.brandEmailSignature?.trim() || `Cordialement,\n${companyName}`;
  return {
    subject: `Votre portail fournisseur — ${companyName}`,
    body: [
      `Bonjour ${supplier.contactName || supplier.name},`,
      '',
      `Voici votre accès personnel au portail fournisseur de ${companyName}. Vous pourrez y :`,
      '',
      '- déposer vos factures et suivre leur paiement ;',
      '- lire et signer vos ententes ;',
      '- échanger des documents et nous écrire.',
      '',
      link,
      '',
      'Aucun compte à créer. Ce lien vous est personnel : merci de ne pas le transférer.',
      '',
      signature,
    ].join('\n'),
  };
}

export function SendPortalLinkModal({
  supplier,
  access,
  link,
  onClose,
}: {
  supplier: any;
  access: { id: string; token: string; label: string | null };
  link: string;
  onClose: () => void;
}) {
  const { data: company } = useQuery(getCurrentCompany);
  const { canSend, reason, copyToCompany, fromName, fromEmail, replyTo } = useEmailCapability();
  const [to, setTo] = useState<string>(supplier.email || '');
  const [cc, setCc] = useState('');
  // Le message par défaut attend la fiche de l'entreprise (nom, signature).
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const message = draft ?? defaultMessage(supplier, link, company);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);

  const linkMissing = !message.body.includes(access.token);
  const ready = canSend && !!to.trim() && !!message.subject.trim() && !linkMissing;

  const send = async () => {
    setSending(true);
    try {
      await sendSupplierPortalLink({ accessId: access.id, to, cc, subject: message.subject, body: message.body });
      toast.success(`Lien envoyé à ${to.trim()}`);
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Envoi impossible');
      setPreviewing(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title='Envoyer le lien du portail'
        footer={
          <>
            <button className='btn-secondary' onClick={onClose}>Annuler</button>
            <button className='btn-primary' disabled={!ready} onClick={() => setPreviewing(true)}>
              <LuEye size={14} /> Aperçu et envoi
            </button>
          </>
        }
      >
        <div className='space-y-4'>
          {!canSend && (
            <div className='rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex gap-2'>
              <LuTriangleAlert size={16} className='shrink-0 mt-0.5' />
              <span>
                {reason}{' '}
                <Link to='/parametres' className='underline font-medium'>Ouvrir les paramètres</Link>
              </span>
            </div>
          )}
          {canSend && (
            <p className='text-xs text-muted'>
              Envoyé depuis <span className='font-medium text-ink'>{fromName} &lt;{fromEmail}&gt;</span>
              {replyTo && <> · les réponses arrivent à <span className='font-medium text-ink'>{replyTo}</span></>}
              {copyToCompany && <> · copie en Cci à {copyToCompany}</>}
            </p>
          )}
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
            <div>
              <label className='label'>À *</label>
              <input type='email' className='input' value={to} onChange={(e) => setTo(e.target.value)} placeholder='courriel du fournisseur' />
              {!supplier.email && <p className='text-xs text-muted mt-1'>Aucun courriel dans la fiche du fournisseur.</p>}
            </div>
            <div>
              <label className='label'>Cc</label>
              <input className='input' value={cc} onChange={(e) => setCc(e.target.value)} placeholder='optionnel' />
            </div>
          </div>
          <div>
            <label className='label'>Objet *</label>
            <input className='input' value={message.subject} onChange={(e) => setDraft({ ...message, subject: e.target.value })} />
          </div>
          <div>
            <label className='label'>Message</label>
            <textarea className='input font-[inherit]' rows={13} value={message.body} onChange={(e) => setDraft({ ...message, body: e.target.value })} />
            {linkMissing ? (
              <p className='text-xs text-danger mt-1'>Le lien du portail n'est plus dans le message : recollez-le avant d'envoyer.</p>
            ) : (
              <p className='text-xs text-muted mt-1'>Le lien deviendra cliquable dans le courriel.</p>
            )}
          </div>
        </div>
      </Modal>

      {previewing && (
        <EmailPreviewModal
          headers={{ fromName, fromEmail, replyTo, to: to.trim(), cc: cc.trim() || null, bcc: copyToCompany, subject: message.subject }}
          body={message.body}
          previousLogs={[]}
          linkify
          onSend={send}
          sending={sending}
          onClose={() => setPreviewing(false)}
        />
      )}
    </>
  );
}

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { LuEye } from 'react-icons/lu';
import { sendDocumentEmail } from 'wasp/client/operations';
import { Modal } from '../../client/ui';
import { MagicInput, MagicTextarea } from '../../client/magic';
import { buildDocumentPdfFilename, getDocumentPdfBase64 } from '../documents/pdf';
import type { DocForPdf, CompanyForPdf, BrandAssets } from '../documents/pdf';
import { PdfPreviewModal } from './PdfPreviewModal';

type LastSent = {
  createdAt: string | Date;
  metadata?: any;
} | null;

type Props = {
  doc: DocForPdf & { id: string };
  company: CompanyForPdf;
  brand: BrandAssets;
  lastSent?: LastSent;
  onClose: () => void;
};

export function SendDocumentEmailModal({ doc, company, brand, lastSent, onClose }: Props) {
  const isInvoice = doc.type === 'invoice';
  const docLabel = isInvoice ? 'la facture' : 'la soumission';
  const docLabelCap = isInvoice ? 'Facture' : 'Soumission';

  const defaults = useMemo(() => {
    const companyName = (company as any)?.name || 'notre entreprise';
    const signature = (company as any)?.brandEmailSignature?.trim() || '';
    const contactLine = doc.client.contactName ? `Bonjour ${doc.client.contactName},` : 'Bonjour,';
    const subject = `${docLabelCap} ${doc.number}${doc.title ? ' — ' + doc.title : ''}`;
    const closing = signature
      ? signature
      : ['Cordialement,', companyName].join('\n');
    const body = [
      contactLine,
      '',
      `Vous trouverez en pièce jointe ${docLabel} ${doc.number}${doc.title ? ` (${doc.title})` : ''}.`,
      '',
      isInvoice
        ? "N'h\u00e9sitez pas \u00e0 nous \u00e9crire pour toute question concernant le paiement."
        : "N'h\u00e9sitez pas \u00e0 nous contacter pour toute question ou ajustement.",
      '',
      closing,
    ].join('\n');
    return { subject, body };
  }, [doc, company, isInvoice, docLabel, docLabelCap]);

  const previous = lastSent?.metadata || null;
  const [to, setTo] = useState<string>(previous?.to || doc.client.email || '');
  const [cc, setCc] = useState<string>(previous?.cc ?? ((company as any)?.email || ''));
  const [subject, setSubject] = useState<string>(previous?.subject || defaults.subject);
  const [body, setBody] = useState<string>(previous?.body || defaults.body);
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const submit = async () => {
    if (!to.trim()) {
      toast.error('Adresse du destinataire requise');
      return;
    }
    setSending(true);
    try {
      const pdfBase64 = await getDocumentPdfBase64(doc, company, brand);
      await sendDocumentEmail({
        id: doc.id,
        to: to.trim(),
        cc: cc.trim() || null,
        subject: subject.trim() || defaults.subject,
        message: body,
        pdfBase64,
        filename: buildDocumentPdfFilename(doc),
      });
      toast.success('Courriel envoyé');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Erreur lors de l'envoi");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
    <Modal
      open
      onClose={onClose}
      title={`Envoyer ${docLabel} ${doc.number}`}
      footer={
        <>
          <button
            type='button'
            className='btn-ghost flex items-center gap-1.5'
            disabled={sending}
            onClick={() => setPreviewing(true)}
          >
            <LuEye size={14} /> Aperçu du PDF
          </button>
          <div className='flex-1' />
          <button className='btn-secondary' disabled={sending} onClick={onClose}>
            Annuler
          </button>
          <button className='btn-primary' disabled={sending} onClick={submit}>
            {sending ? 'Envoi…' : lastSent ? 'Renvoyer' : 'Envoyer'}
          </button>
        </>
      }
    >
      <div className='space-y-4'>
        {lastSent && (
          <div className='text-xs bg-canvas-200 border border-line rounded-md px-3 py-2 text-muted'>
            Déjà envoyé le {new Date(lastSent.createdAt).toLocaleString('fr-CA')}. Le contenu précédent est repris ci-dessous.
          </div>
        )}
        <Field label='À (destinataire)'>
          <input
            type='email'
            className='input'
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder='client@exemple.com'
          />
        </Field>
        <Field label='Cc' hint='Séparez plusieurs adresses par des virgules.'>
          <input
            type='text'
            className='input'
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder='nous@entreprise.com'
          />
        </Field>
        <Field label='Objet'>
          <MagicInput
            type='text'
            className='input'
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>
        <Field label='Message'>
          <MagicTextarea
            className='input min-h-[180px] resize-y'
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <p className='text-xs text-muted'>
          Pièce jointe : <span className='font-mono'>{buildDocumentPdfFilename(doc)}</span>
        </p>
      </div>
    </Modal>
    {previewing && (
      <PdfPreviewModal doc={doc} company={company} brand={brand} onClose={() => setPreviewing(false)} />
    )}
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className='block'>
      <span className='block text-sm font-medium text-ink mb-1'>{label}</span>
      {children}
      {hint && <span className='block text-xs text-muted mt-1'>{hint}</span>}
    </label>
  );
}

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { LuEye, LuSave, LuRotateCcw, LuChevronDown, LuChevronUp } from 'react-icons/lu';
import { sendDocumentEmail, saveDocumentEmailDraft } from 'wasp/client/operations';
import { Modal } from '../../client/ui';
import { MagicInput, MagicTextarea } from '../../client/magic';
import { buildDocumentPdfFilename, getDocumentPdfBase64 } from '../documents/pdf';
import type { DocForPdf, CompanyForPdf, BrandAssets } from '../documents/pdf';
import { PdfPreviewModal } from './PdfPreviewModal';

type SentActivity = {
  createdAt: string | Date;
  metadata?: any;
};

type DocType = 'quote' | 'invoice';

type Props = {
  doc: DocForPdf & { id: string };
  company: CompanyForPdf;
  brand: BrandAssets;
  /** All `document.email_sent` activities for this doc, newest first. */
  activities?: SentActivity[];
  onClose: () => void;
};

const TYPE_META: Record<DocType, { label: string; cap: string }> = {
  quote: { label: 'la soumission', cap: 'Soumission' },
  invoice: { label: 'la facture', cap: 'Facture' },
};

function buildDefaults(args: {
  type: DocType;
  doc: DocForPdf;
  company: CompanyForPdf;
}) {
  const { type, doc, company } = args;
  const { label, cap } = TYPE_META[type];
  const isInvoice = type === 'invoice';
  const companyName = (company as any)?.name || 'notre entreprise';
  const signature = (company as any)?.brandEmailSignature?.trim() || '';
  const contactLine = doc.client.contactName ? `Bonjour ${doc.client.contactName},` : 'Bonjour,';
  const subject = `${cap} ${doc.number}${doc.title ? ' — ' + doc.title : ''}`;
  const closing = signature ? signature : ['Cordialement,', companyName].join('\n');
  const body = [
    contactLine,
    '',
    `Vous trouverez en pièce jointe ${label} ${doc.number}${doc.title ? ` (${doc.title})` : ''}.`,
    '',
    isInvoice
      ? "N'h\u00e9sitez pas \u00e0 nous \u00e9crire pour toute question concernant le paiement."
      : "N'h\u00e9sitez pas \u00e0 nous contacter pour toute question ou ajustement.",
    '',
    closing,
  ].join('\n');
  return { subject, body };
}

export function SendDocumentEmailModal({ doc, company, brand, activities, onClose }: Props) {
  const docAny = doc as any;
  const initialType: DocType = doc.type === 'invoice' ? 'invoice' : 'quote';

  const lastSentByType = useMemo(() => {
    const map: Record<DocType, SentActivity | null> = { quote: null, invoice: null };
    for (const a of activities || []) {
      const t = (a.metadata?.type === 'invoice' ? 'invoice' : 'quote') as DocType;
      if (!map[t]) map[t] = a;
    }
    return map;
  }, [activities]);

  const defaultsQuote = useMemo(
    () => buildDefaults({ type: 'quote', doc, company }),
    [doc, company],
  );
  const defaultsInvoice = useMemo(
    () => buildDefaults({ type: 'invoice', doc, company }),
    [doc, company],
  );

  const [activeType, setActiveType] = useState<DocType>(initialType);
  const [mainTab, setMainTab] = useState<DocType | 'history'>(initialType);

  const [subjectQuote, setSubjectQuote] = useState<string>(
    docAny.emailSubjectQuote ||
      lastSentByType.quote?.metadata?.subject ||
      defaultsQuote.subject,
  );
  const [bodyQuote, setBodyQuote] = useState<string>(
    docAny.emailBodyQuote || lastSentByType.quote?.metadata?.body || defaultsQuote.body,
  );
  const [subjectInvoice, setSubjectInvoice] = useState<string>(
    docAny.emailSubjectInvoice ||
      lastSentByType.invoice?.metadata?.subject ||
      defaultsInvoice.subject,
  );
  const [bodyInvoice, setBodyInvoice] = useState<string>(
    docAny.emailBodyInvoice ||
      lastSentByType.invoice?.metadata?.body ||
      defaultsInvoice.body,
  );

  const initialPrev =
    lastSentByType[initialType] || lastSentByType.quote || lastSentByType.invoice;
  const [to, setTo] = useState<string>(
    docAny.emailTo || initialPrev?.metadata?.to || doc.client.email || '',
  );
  const [cc, setCc] = useState<string>(
    docAny.emailCc ?? initialPrev?.metadata?.cc ?? ((company as any)?.email || ''),
  );
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const subject = activeType === 'invoice' ? subjectInvoice : subjectQuote;
  const setSubject = activeType === 'invoice' ? setSubjectInvoice : setSubjectQuote;
  const body = activeType === 'invoice' ? bodyInvoice : bodyQuote;
  const setBody = activeType === 'invoice' ? setBodyInvoice : setBodyQuote;
  const activeDefaults = activeType === 'invoice' ? defaultsInvoice : defaultsQuote;
  const activeLastSent = lastSentByType[activeType];
  const activeTypeLabel = TYPE_META[activeType].label;
  const docType: DocType = initialType;
  const isCurrentType = activeType === docType;
  const isHistoryTab = mainTab === 'history';

  // Keep activeType in sync when switching type tabs
  const handleTabChange = (tab: DocType | 'history') => {
    setMainTab(tab);
    if (tab !== 'history') setActiveType(tab);
  };

  const saveDraft = async () => {
    setSavingDraft(true);
    try {
      await saveDocumentEmailDraft({ id: doc.id, type: activeType, subject, body, to: to.trim() || null, cc: cc.trim() || null });
      toast.success('Brouillon enregistré');
    } catch (err: any) {
      toast.error(err?.message || "Erreur lors de l'enregistrement");
    } finally {
      setSavingDraft(false);
    }
  };

  const resetTemplate = async () => {
    setSubject(activeDefaults.subject);
    setBody(activeDefaults.body);
    try {
      await saveDocumentEmailDraft({
        id: doc.id,
        type: activeType,
        subject: null,
        body: null,
      });
      toast.success(`Modèle réinitialisé (${TYPE_META[activeType].cap})`);
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la réinitialisation');
    }
  };

  const willTransitionToSent = isCurrentType && docAny.status !== 'envoyee';
  const docForOutput = isCurrentType
    ? ({ ...doc, status: 'envoyee' } as typeof doc)
    : doc;

  const submit = async () => {
    if (!to.trim()) {
      toast.error('Adresse du destinataire requise');
      return;
    }
    setSending(true);
    try {
      // If the document is still a draft, generate the PDF as if it had already
      // been sent so that the watermark / title reflect the new status. The
      // server persists the same transition right after the email is sent.
      const pdfBase64 = await getDocumentPdfBase64(docForOutput, company, brand);
      await sendDocumentEmail({
        id: doc.id,
        type: activeType,
        to: to.trim(),
        cc: cc.trim() || null,
        subject: subject.trim() || activeDefaults.subject,
        message: body,
        pdfBase64,
        filename: buildDocumentPdfFilename(docForOutput),
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
        title={`Envoyer ${isCurrentType ? activeTypeLabel : TYPE_META[docType].label} ${doc.number}`}
        footer={
          <>
            {isCurrentType && !isHistoryTab && (
              <>
                <button
                  type='button'
                  className='btn-ghost p-2'
                  disabled={sending}
                  onClick={() => setPreviewing(true)}
                  title='Aperçu du PDF'
                  aria-label='Aperçu du PDF'
                >
                  <LuEye size={16} />
                </button>
                <button
                  type='button'
                  className='btn-ghost p-2'
                  disabled={sending || savingDraft}
                  onClick={saveDraft}
                  title={savingDraft ? 'Enregistrement…' : 'Enregistrer brouillon'}
                  aria-label='Enregistrer brouillon'
                >
                  <LuSave size={16} />
                </button>
                <button
                  type='button'
                  className='btn-ghost p-2'
                  disabled={sending || savingDraft}
                  onClick={resetTemplate}
                  title={`Réinitialiser le modèle ${TYPE_META[activeType].cap}`}
                  aria-label='Réinitialiser le modèle'
                >
                  <LuRotateCcw size={16} />
                </button>
              </>
            )}
            <div className='flex-1' />
            <button className='btn-secondary' disabled={sending} onClick={onClose}>
              {isHistoryTab ? 'Fermer' : 'Annuler'}
            </button>
            {isCurrentType && !isHistoryTab && (
              <button className='btn-primary' disabled={sending} onClick={submit}>
                {sending ? 'Envoi…' : activeLastSent ? 'Renvoyer' : 'Envoyer'}
              </button>
            )}
          </>
        }
      >
        <div className='space-y-4'>
          {/* Tab bar: Soumission | Facture | Historique */}
          <div className='flex border-b border-line -mt-1'>
            {(['quote', 'invoice'] as DocType[]).map((t) => {
              const isActive = mainTab === t;
              const sent = !!lastSentByType[t];
              return (
                <button
                  key={t}
                  type='button'
                  onClick={() => handleTabChange(t)}
                  className={
                    'px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ' +
                    (isActive
                      ? 'border-primary text-ink'
                      : 'border-transparent text-muted hover:text-ink')
                  }
                >
                  {TYPE_META[t].cap}
                  {sent && (
                    <span className='inline-block w-1.5 h-1.5 rounded-full bg-success' />
                  )}
                </button>
              );
            })}
            {/* History tab */}
            <button
              type='button'
              onClick={() => handleTabChange('history')}
              className={
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 ' +
                (mainTab === 'history'
                  ? 'border-primary text-ink'
                  : 'border-transparent text-muted hover:text-ink')
              }
            >
              Historique
              {(activities?.length ?? 0) > 0 && (
                <span className='inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-canvas border border-line text-[9px] font-bold text-muted px-1'>
                  {activities!.length}
                </span>
              )}
            </button>
          </div>

          {/* ── History tab content ── */}
          {isHistoryTab ? (
            <EmailHistoryList activities={activities || []} />
          ) : (
            <>
              {activeLastSent && (
                <div className='text-xs bg-canvas-200 border border-line rounded-md px-3 py-2 text-muted'>
                  Déjà envoyé le {new Date(activeLastSent.createdAt).toLocaleString('fr-CA')}. Le contenu précédent est repris ci-dessous.
                </div>
              )}
              {willTransitionToSent && (
                <div className='text-xs bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-blue-800'>
                  L'envoi fera passer le statut à <strong>Envoyée</strong>. Le PDF joint sera généré avec ce nouveau statut.
                </div>
              )}
              {isCurrentType && !willTransitionToSent && (
                <div className='text-xs bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-blue-800'>
                  Le statut restera <strong>Envoyée</strong>. Le PDF joint sera généré avec ce statut.
                </div>
              )}
              {!isCurrentType && (
                <div className='text-xs bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-amber-700'>
                  Ce document est une <strong>{TYPE_META[docType].label.toLowerCase()}</strong>. L'onglet {TYPE_META[activeType].label} est en lecture seule — l'envoi est désactivé pour ce type.
                </div>
              )}
              <Field label='À (destinataire)'>
                <input
                  type='email'
                  className='input'
                  value={to}
                  readOnly={!isCurrentType}
                  onChange={(e) => isCurrentType && setTo(e.target.value)}
                  placeholder='client@exemple.com'
                />
              </Field>
              <Field label='Cc' hint={isCurrentType ? 'Séparez plusieurs adresses par des virgules.' : undefined}>
                <input
                  type='text'
                  className='input'
                  value={cc}
                  readOnly={!isCurrentType}
                  onChange={(e) => isCurrentType && setCc(e.target.value)}
                  placeholder='nous@entreprise.com'
                />
              </Field>
              <Field label='Objet'>
                <MagicInput
                  type='text'
                  className='input'
                  value={subject}
                  readOnly={!isCurrentType}
                  onChange={(e) => isCurrentType && setSubject(e.target.value)}
                />
              </Field>
              <Field label='Message'>
                <MagicTextarea
                  className='input min-h-[180px] resize-y'
                  value={body}
                  readOnly={!isCurrentType}
                  onChange={(e) => isCurrentType && setBody(e.target.value)}
                />
              </Field>
              {isCurrentType && (
                <p className='text-xs text-muted'>
                  Pièce jointe : <span className='font-mono'>{buildDocumentPdfFilename(docForOutput)}</span>
                </p>
              )}
            </>
          )}
        </div>
      </Modal>
      {previewing && (
        <PdfPreviewModal
          doc={doc}
          company={company}
          brand={brand}
          onClose={() => setPreviewing(false)}
        />
      )}
    </>
  );
}

function EmailHistoryList({ activities }: { activities: SentActivity[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (activities.length === 0) {
    return (
      <p className='text-sm text-muted py-4 text-center'>
        Aucun courriel envoyé pour ce document.
      </p>
    );
  }

  return (
    <ol className='space-y-1.5'>
      {activities.map((a, i) => {
        const m = a.metadata || {};
        const typeLabel = m.type === 'invoice' ? 'Facture' : 'Soumission';
        const isExpanded = expandedIdx === i;
        const date = new Date(a.createdAt).toLocaleString('fr-CA', {
          dateStyle: 'short',
          timeStyle: 'short',
        });

        return (
          <li key={i} className='rounded-lg border border-line bg-canvas text-xs overflow-hidden'>
            {/* Header row — always visible */}
            <button
              type='button'
              className='w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-canvas-200 transition-colors'
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
            >
              <span className='shrink-0 mt-0.5 text-muted'>{date}</span>
              <span className='shrink-0 badge-neutral text-[10px] mt-px'>{typeLabel}</span>
              <span className='flex-1 font-medium text-ink truncate'>{m.subject || '(sans objet)'}</span>
              <span className='shrink-0 text-muted ml-1'>
                {isExpanded ? <LuChevronUp size={13} /> : <LuChevronDown size={13} />}
              </span>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className='border-t border-line px-3 py-2.5 space-y-2 bg-white'>
                <div className='flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted'>
                  {m.to && (
                    <span><span className='font-medium text-ink/70'>À :</span> {m.to}</span>
                  )}
                  {m.cc && (
                    <span><span className='font-medium text-ink/70'>Cc :</span> {m.cc}</span>
                  )}
                </div>
                {m.body && (
                  <pre className='whitespace-pre-wrap text-[11px] text-ink/80 font-sans leading-snug max-h-52 overflow-y-auto'>
                    {m.body}
                  </pre>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
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

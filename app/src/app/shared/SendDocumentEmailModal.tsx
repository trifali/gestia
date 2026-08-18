import { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  LuSave,
  LuRotateCcw,
  LuChevronDown,
  LuChevronRight,
  LuClock,
  LuCornerUpLeft,
  LuMailOpen,
} from 'react-icons/lu';
import {
  useQuery,
  sendDocumentEmail,
  saveDocumentEmailDraft,
  getActivityFeed,
  // @ts-ignore -- généré par Wasp au prochain redémarrage
  getLeadEmailLogs,
} from 'wasp/client/operations';
import { clientIdentifier } from '../../shared/threads';
import { mergeSentHistory, type SentEmailRecord } from '../../shared/mailThread';
import { formatMontrealTime } from '../../shared/format';
import { Modal } from '../../client/ui';
import { MagicInput, MagicTextarea } from '../../client/magic';
import { buildDocumentPdfFilename, getDocumentPdfBase64 } from '../documents/pdf';
import type { DocForPdf, CompanyForPdf, BrandAssets } from '../documents/pdf';
import { PdfPreviewModal } from './PdfPreviewModal';
import { EmailPreviewModal } from './EmailPreviewModal';
import { useEmailCapability } from '../../client/capabilities';

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
  const {
    canSend: emailCanSend,
    reason: emailReason,
    copyToCompany,
    fromName,
    fromEmail,
    replyTo,
  } = useEmailCapability();
  const docAny = doc as any;
  const initialType: DocType = doc.type === 'invoice' ? 'invoice' : 'quote';

  // Un seul fil par client, tous documents confondus : relancer une facture
  // reprend la conversation ouverte par la soumission d'avant.
  const clientThread = docAny.clientId ? clientIdentifier(docAny.clientId) : null;
  const { data: sentLogs = [] } = useQuery(
    // @ts-ignore -- généré par Wasp au prochain redémarrage
    getLeadEmailLogs,
    { identifier: clientThread ?? '' },
    { enabled: !!clientThread },
  );

  // Les activités sont relues par client et non reprises de la prop : celle-ci
  // ne porte que ce document, alors que le fil — et donc ce qui sera cité —
  // couvre tous les siens. L'aperçu et l'envoi doivent lire la même chose.
  const { data: clientActivities = [] } = useQuery(
    getActivityFeed,
    { clientId: docAny.clientId, limit: 50 },
    { enabled: !!docAny.clientId },
  );
  const legacySends = useMemo(
    () => (clientActivities as any[]).filter(a => a.type === 'document.email_sent'),
    [clientActivities],
  );

  const history = useMemo(
    () => mergeSentHistory(sentLogs as any[], legacySends),
    [sentLogs, legacySends],
  );

  // Objet suggéré pour une relance — proposé sous le champ, jamais écrit d'office.
  //
  // Pris sur l'historique complet et non sur le seul journal d'envoi : sinon la
  // suggestion resterait invisible pour tous les clients déjà écrits avant que
  // ce journal existe, jusqu'à ce qu'on leur réécrive une première fois.
  const lastSubject = history[0]?.subject;
  const followUpSubject = lastSubject
    ? (/^re\s*:/i.test(lastSubject) ? lastSubject : `Re: ${lastSubject}`)
    : null;

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
  // Cible du retour en haut après « Répondre » : la liste des envois est sous le
  // formulaire, donc préremplir sans remonter ne se verrait pas.
  const composerRef = useRef<HTMLDivElement | null>(null);

  /**
   * Ordre de priorité à l'ouverture : un brouillon explicitement enregistré,
   * sinon le modèle par défaut — mais seulement tant que rien n'est parti. Une
   * fois le premier courriel envoyé, les champs restent vides : une relance est
   * un nouveau message, pas une copie du précédent. Le texte déjà envoyé se
   * relit dans « Envois précédents », et le bouton « Répondre » y reprend
   * destinataire et objet pour qui veut repartir de là.
   *
   * `lastSent` est ce qui rend la règle vraie pour les documents envoyés avant
   * que l'envoi n'efface le brouillon : leur ligne porte encore le texte parti.
   * Sur un document déjà envoyé, le brouillon n'est donc gardé que s'il diffère
   * de ce qui est parti — seul cas où quelqu'un l'a réellement écrit depuis.
   * Sans quoi ces documents-là garderaient éternellement leur dernier message
   * prérempli.
   */
  const initialText = (
    saved: string | null | undefined,
    lastSent: string | null | undefined,
    alreadySent: boolean,
    fallback: string,
  ): string => {
    if (saved == null) return alreadySent ? '' : fallback;
    if (!alreadySent) return saved;
    return lastSent != null && saved !== lastSent ? saved : '';
  };

  const sentQuote = lastSentByType.quote?.metadata;
  const sentInvoice = lastSentByType.invoice?.metadata;

  const [subjectQuote, setSubjectQuote] = useState<string>(
    initialText(docAny.emailSubjectQuote, sentQuote?.subject, !!sentQuote, defaultsQuote.subject),
  );
  const [bodyQuote, setBodyQuote] = useState<string>(
    initialText(docAny.emailBodyQuote, sentQuote?.body, !!sentQuote, defaultsQuote.body),
  );
  const [subjectInvoice, setSubjectInvoice] = useState<string>(
    initialText(
      docAny.emailSubjectInvoice,
      sentInvoice?.subject,
      !!sentInvoice,
      defaultsInvoice.subject,
    ),
  );
  const [bodyInvoice, setBodyInvoice] = useState<string>(
    initialText(docAny.emailBodyInvoice, sentInvoice?.body, !!sentInvoice, defaultsInvoice.body),
  );

  const initialPrev =
    lastSentByType[initialType] || lastSentByType.quote || lastSentByType.invoice;
  const [to, setTo] = useState<string>(
    docAny.emailTo || initialPrev?.metadata?.to || doc.client.email || '',
  );
  // Deliberately empty by default: the copy to the company goes out in Cci via
  // Paramètres → Intégrations, so pre-filling Cc here would only duplicate it.
  const [cc, setCc] = useState<string>(docAny.emailCc ?? initialPrev?.metadata?.cc ?? '');
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewingEmail, setPreviewingEmail] = useState(false);

  const subject = activeType === 'invoice' ? subjectInvoice : subjectQuote;
  const setSubject = activeType === 'invoice' ? setSubjectInvoice : setSubjectQuote;
  const body = activeType === 'invoice' ? bodyInvoice : bodyQuote;
  const setBody = activeType === 'invoice' ? setBodyInvoice : setBodyQuote;
  const activeDefaults = activeType === 'invoice' ? defaultsInvoice : defaultsQuote;
  const activeLastSent = lastSentByType[activeType];
  const activeTypeLabel = TYPE_META[activeType].label;
  const docType: DocType = initialType;
  const isCurrentType = activeType === docType;

  /**
   * Repartir d'un envoi précédent : destinataire, Cc et objet sont repris, et
   * l'onglet revient sur le type du document — le seul depuis lequel on peut
   * envoyer. Le corps est laissé tel quel : la citation de l'échange est ajoutée
   * à l'envoi, pas ici, sans quoi elle serait citée deux fois.
   *
   * Les setters sont nommés explicitement plutôt que pris à travers
   * `setSubject` : celui-ci suit `activeType`, qui n'aura changé qu'au rendu
   * suivant.
   */
  const replyToEntry = (entry: SentEmailRecord) => {
    setActiveType(docType);
    if (entry.to) setTo(entry.to);
    setCc(entry.cc ?? '');
    const next = /^re\s*:/i.test(entry.subject) ? entry.subject : `Re: ${entry.subject}`;
    (docType === 'invoice' ? setSubjectInvoice : setSubjectQuote)(next);
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
            {isCurrentType && (
              <>
                {/* Un seul aperçu : le courriel. Le PDF s'ouvre depuis la
                    pièce jointe qui y est listée — deux icônes d'œil côte à côte
                    ne disaient pas laquelle montrait quoi. */}
                <button
                  type='button'
                  className='btn-ghost p-2'
                  disabled={sending}
                  onClick={() => setPreviewingEmail(true)}
                  title='Aperçu du courriel'
                  aria-label='Aperçu du courriel'
                >
                  <LuMailOpen size={16} />
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
              Annuler
            </button>
            {isCurrentType && (
              <button
                className='btn-primary'
                disabled={sending || !emailCanSend}
                title={!emailCanSend ? (emailReason ?? '') : undefined}
                onClick={submit}
              >
                {sending ? 'Envoi…' : 'Envoyer'}
              </button>
            )}
          </>
        }
      >
        <div className='space-y-4'>
          {/* Tab bar: Soumission | Facture */}
          <div className='flex border-b border-line -mt-1'>
            {(['quote', 'invoice'] as DocType[]).map((t) => {
              const isActive = activeType === t;
              const sent = !!lastSentByType[t];
              return (
                <button
                  key={t}
                  type='button'
                  onClick={() => setActiveType(t)}
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
          </div>

          {activeLastSent && (
            <div className='text-xs bg-canvas-200 border border-line rounded-md px-3 py-2 text-muted'>
              Déjà envoyé le {new Date(activeLastSent.createdAt).toLocaleString('fr-CA')}. Objet et
              message repartent à vide — le contenu précédent se relit dans « Envois précédents ».
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
          <div ref={composerRef}>
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
          </div>
          <Field
            label='Cc'
            hint={
              isCurrentType
                ? 'Facultatif. Séparez plusieurs adresses par des virgules.'
                : undefined
            }
          >
            <input
              type='text'
              className='input'
              value={cc}
              readOnly={!isCurrentType}
              onChange={(e) => isCurrentType && setCc(e.target.value)}
              placeholder='autre@exemple.com'
            />
          </Field>
          {isCurrentType && copyToCompany && (
            <p className='text-xs text-muted -mt-2'>
              Une copie sera aussi envoyée en Cci à{' '}
              <span className='font-medium text-ink/80'>{copyToCompany}</span>.
            </p>
          )}
          {isCurrentType &&
            ((company as any)?.email ? (
              <p className='text-xs text-muted -mt-1'>
                Les réponses du client arriveront à{' '}
                <span className='font-medium text-ink/80'>{(company as any).email}</span>.
              </p>
            ) : (
              <div className='text-xs bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-amber-700'>
                Aucun courriel n'est configuré pour votre entreprise : les réponses du client
                seront perdues. Ajoutez-en un dans Paramètres.
              </div>
            ))}
          <Field label='Objet'>
            <MagicInput
              type='text'
              className='input'
              value={subject}
              readOnly={!isCurrentType}
              onChange={(e) => isCurrentType && setSubject(e.target.value)}
            />
          </Field>
          {isCurrentType && followUpSubject && subject.trim() !== followUpSubject && (
            <button
              type='button'
              className='text-xs text-accent-600 hover:underline -mt-2 inline-flex items-center gap-1'
              onClick={() => setSubject(followUpSubject)}
              title='Reprendre l’objet du dernier envoi'
            >
              <LuCornerUpLeft size={12} />
              {followUpSubject}
            </button>
          )}
          <Field label='Message'>
            <MagicTextarea
              className='input min-h-[180px] resize-y'
              value={body}
              readOnly={!isCurrentType}
              onChange={(e) => isCurrentType && setBody(e.target.value)}
            />
          </Field>
          {isCurrentType && history.length > 0 && (
            <p className='text-xs text-muted -mt-2'>
              Relance : {history.length > 1
                ? `les ${history.length} échanges précédents seront cités`
                : 'l’échange précédent sera cité'} sous votre message, dans le même fil de
              discussion.
            </p>
          )}
          {isCurrentType && (
            <p className='text-xs text-muted'>
              Pièce jointe : <span className='font-mono'>{buildDocumentPdfFilename(docForOutput)}</span>
            </p>
          )}

          <EmailHistoryList entries={history} onReply={replyToEntry} />
        </div>
      </Modal>
      {previewingEmail && (
        <EmailPreviewModal
          headers={{
            fromName,
            fromEmail,
            replyTo,
            to: to.trim(),
            cc: cc.trim() || null,
            bcc: copyToCompany,
            subject: subject.trim() || activeDefaults.subject,
          }}
          body={body}
          previousLogs={history}
          attachmentName={buildDocumentPdfFilename(docForOutput)}
          onOpenAttachment={() => setPreviewing(true)}
          onClose={() => setPreviewingEmail(false)}
        />
      )}
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

function EmailHistoryList({
  entries,
  onReply,
}: {
  entries: SentEmailRecord[];
  onReply: (entry: SentEmailRecord) => void;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Rien à montrer tant que rien n'est parti : un cadre vide sous le formulaire
  // ne dirait rien que « Envoyer » ne dise déjà.
  if (entries.length === 0) return null;

  return (
    <div className='border-t border-line pt-3'>
      <div className='text-xs font-medium text-muted mb-2 flex items-center gap-1.5'>
        <LuClock size={13} />
        Envois précédents ({entries.length})
      </div>
      <div className='space-y-1'>
        {entries.map(entry => {
          const open = expandedKey === entry.key;
          return (
            <div key={entry.key} className='border border-line rounded-md overflow-hidden'>
              <button
                type='button'
                className='w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-canvas-100'
                onClick={() => setExpandedKey(open ? null : entry.key)}
              >
                {open ? (
                  <LuChevronDown size={13} className='shrink-0 text-muted' />
                ) : (
                  <LuChevronRight size={13} className='shrink-0 text-muted' />
                )}
                {entry.docType && (
                  <span className='shrink-0 badge-neutral text-[10px]'>
                    {entry.docType === 'invoice' ? 'Facture' : 'Soumission'}
                  </span>
                )}
                <span className='text-xs font-medium truncate flex-1'>{entry.subject}</span>
                <span className='text-xs text-muted shrink-0'>
                  {formatMontrealTime(entry.createdAt)}
                </span>
              </button>
              {open && (
                <div className='px-3 py-2.5 bg-canvas-100 border-t border-line space-y-2'>
                  <dl className='text-xs space-y-1'>
                    <EmailPreviewRow
                      label='De'
                      value={
                        entry.fromEmail
                          ? `${entry.fromName || 'Gestia'} <${entry.fromEmail}>`
                          : entry.fromName || '—'
                      }
                    />
                    <EmailPreviewRow label='À' value={entry.to || '—'} />
                    {entry.cc && <EmailPreviewRow label='Cc' value={entry.cc} />}
                    <EmailPreviewRow
                      label='Répondre à'
                      value={entry.replyTo || (entry.legacy ? '—' : '— (réponses perdues)')}
                    />
                    <EmailPreviewRow label='Objet' value={entry.subject} />
                  </dl>
                  <div className='text-xs whitespace-pre-wrap bg-white border border-line rounded p-2.5 max-h-64 overflow-y-auto'>
                    {entry.body || (
                      <span className='text-muted italic'>
                        Corps non enregistré (envoyé avant l’ajout de l’aperçu).
                      </span>
                    )}
                  </div>
                  <div className='flex justify-end'>
                    <button
                      type='button'
                      className='btn-ghost px-2 py-1 text-xs text-accent-600 inline-flex items-center gap-1.5'
                      onClick={() => onReply(entry)}
                      title='Repartir de ce courriel : destinataire, Cc et objet repris'
                    >
                      <LuCornerUpLeft size={13} />
                      Répondre
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmailPreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex gap-2'>
      <dt className='text-muted shrink-0 w-24'>{label}</dt>
      <dd className='flex-1 break-words'>{value}</dd>
    </div>
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

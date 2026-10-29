/**
 * Shared UI components and helpers for the leads/prospection module.
 * Used by both LeadSearchPage (authenticated) and ProspectPortalPage (public token).
 */

import { useState, useRef, useEffect, type ReactNode, type FormEvent } from 'react';
import {
  LuClock,
  LuGlobe,
  LuPhone,
  LuMail,
  LuStar,
  LuExternalLink,
  LuMapPin,
  LuTag,
  LuTrash2,
  LuLoader,
  LuSend,
  LuCopy,
  LuMessageSquare,
  LuMessageSquareReply,
  LuFilePen,
  LuNotebook,
  LuUserCheck,
  LuCheck,
} from 'react-icons/lu';

// ─── Helpers partagés avec le shell ───────────────────────────────────────────
// Descendus dans client/ pour que le widget de messagerie, monté sur toutes les
// pages, puisse les utiliser sans tirer Syncfusion avec lui. Ré-exportés ici :
// les appelants existants n'ont pas à changer d'import.

import { formatMontrealTime } from '../../client/format';
import { PhoneInput } from '../../client/ui';
export { formatMontrealTime };

// ─── Lead provenance ──────────────────────────────────────────────────────────
// Where a prospect came from. `google_maps` is the default for everything the
// Google Maps search brings in; the rest are picked by hand or declared by an
// inbound webhook. Vit dans `shared/leadSources` depuis que le serveur doit
// valider la provenance annoncée par un appel entrant ; réexporté ici pour que
// les appelants existants n'aient pas à changer d'import.

import { leadSourceColor, leadSourceLabel, type LeadSourceOption } from '../../shared/leadSources';
import {
  MAX_EXTRA_FIELDS,
  MAX_EXTRA_LABEL_CHARS,
  MAX_EXTRA_VALUE_CHARS,
  normalizeLeadExtras,
  type LeadExtra,
} from '../../shared/leadIntake';
import { detectLeadValue } from '../../shared/leadValues';
import {
  DEFAULT_CARD_FIELDS,
  extraFieldId,
  isExtraFieldKey,
  visibleCardFields,
  type CardFieldConfig,
} from '../../shared/leadCardFields';

export {
  DEFAULT_CARD_FIELDS,
  extraFieldKey,
  extraFieldId,
  isExtraFieldKey,
  isLockedCardField,
  hasDetailToggle,
  slugifyFieldLabel,
  visibleCardFields,
  visibleDetailFields,
  isBoardOverride,
} from '../../shared/leadCardFields';
export type { CardFieldConfig } from '../../shared/leadCardFields';

export {
  DEFAULT_LEAD_SOURCES,
  LEAD_SOURCES,
  FALLBACK_SOURCE_KEY,
  leadSourceColor,
  leadSourceLabel,
  humanizeSourceKey,
  normalizeLeadSource,
  slugifyLeadSource,
} from '../../shared/leadSources';
export type { LeadSourceKey, LeadSourceOption } from '../../shared/leadSources';

// ─── Note thread (timeline + composer) ───────────────────────────────────────
// Used in NoteModal for both the authenticated page and the public portal.

type NoteItem = { id: string; text: string; createdAt: Date | string };

export function NoteThread({
  notes,
  text,
  setText,
  onSubmit,
  onDelete,
  saving,
  deletingId,
  autoFocus = true,
  scrollable = true,
}: {
  notes: NoteItem[];
  text: string;
  setText: (t: string) => void;
  onSubmit: (e: FormEvent) => void;
  onDelete: (id: string) => void;
  saving: boolean;
  deletingId: string | null;
  /** Disable when the thread is embedded in a panel that shouldn't steal focus. */
  autoFocus?: boolean;
  /** Disable the timeline's own scroll area when the container already scrolls. */
  scrollable?: boolean;
}) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef<number | null>(null);

  // La plus récente d'abord : c'est elle qu'on vient lire. Le serveur les rend
  // dans l'ordre chronologique, le tri se fait donc ici.
  const ordered = [...notes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // Une note ajoutée arrive en tête : on remonte la liste pour la montrer — mais
  // pas au premier rendu, qui déplacerait un panneau qui l'intègre.
  useEffect(() => {
    if (prevCount.current !== null && notes.length > prevCount.current) {
      timelineRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevCount.current = notes.length;
  }, [notes.length]);

  return (
    <div className='flex flex-col gap-4'>
      {/* Composer — en haut, juste au-dessus de la note qu'il va créer. */}
      <form onSubmit={onSubmit} className='flex gap-2'>
        <textarea
          className='input resize-none flex-1 text-[13px]'
          rows={2}
          placeholder='Ajouter une note…'
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit(e as unknown as FormEvent);
            }
          }}
          autoFocus={autoFocus}
        />
        <button
          type='submit'
          className='btn-primary self-end gap-1.5'
          disabled={saving || !text.trim()}
          aria-label='Ajouter la note'
        >
          {saving ? <LuLoader size={14} className='animate-spin' /> : <LuSend size={14} />}
        </button>
      </form>

      {/* Timeline */}
      <div
        ref={timelineRef}
        className={`flex flex-col pr-1 ${
          scrollable ? 'max-h-80 overflow-y-auto overscroll-contain' : ''
        }`}
      >
        {ordered.length === 0 ? (
          <p className='text-[13px] text-muted text-center py-6'>Aucune note pour ce prospect.</p>
        ) : (
          ordered.map((n, i) => (
            <div key={n.id} className='flex gap-3 group'>
              <div className='flex flex-col items-center'>
                <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${i === 0 ? 'bg-accent-500' : 'bg-line'}`} />
                {i < ordered.length - 1 && <div className='w-px flex-1 bg-line mt-1' />}
              </div>
              <div className='min-w-0 flex-1 pb-3'>
                <div className='rounded-xl border border-line bg-white px-3 py-2.5 shadow-soft'>
                  <div className='flex items-start justify-between gap-2'>
                    <p className='text-xs text-muted'>{formatMontrealTime(n.createdAt)}</p>
                    {/* Toujours visible sur écran tactile : il n'y a pas de survol. */}
                    <button
                      className='-mr-1 -mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-muted transition-opacity hover:bg-red-50 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100'
                      onClick={() => onDelete(n.id)}
                      disabled={deletingId === n.id}
                      title='Supprimer'
                      aria-label='Supprimer la note'
                    >
                      {deletingId === n.id ? (
                        <LuLoader size={12} className='animate-spin' />
                      ) : (
                        <LuTrash2 size={12} />
                      )}
                    </button>
                  </div>
                  <p className='mt-1 text-[13px] leading-5 text-ink whitespace-pre-wrap break-words'>{n.text}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Copy button ──────────────────────────────────────────────────────────────

export function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      title='Copier'
      className='inline-flex items-center justify-center w-6 h-6 rounded hover:bg-canvas transition-colors text-muted hover:text-ink shrink-0'
      onClick={e => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <LuCheck size={12} className='text-green-600' /> : <LuCopy size={12} />}
    </button>
  );
}

// ─── Lead edit form ───────────────────────────────────────────────────────────
// Renders the field grid for editing a lead's basic info.
// Pass onSave with the merged values; callers own the save operation.

export type LeadFormValues = {
  name: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  category: string;
};

export function LeadEditForm({
  initialValues,
  onSave,
  onCancel,
  extraFields,
  hiddenKeys,
  submitLabel = 'Sauvegarder',
  savingLabel = 'Sauvegarde…',
}: {
  initialValues: LeadFormValues;
  /** Called with trimmed values; should handle saving and call onCancel on success. */
  onSave: (values: LeadFormValues) => Promise<void>;
  onCancel: () => void;
  /** Extra cell(s) appended to the field grid, e.g. a status picker on creation. */
  extraFields?: ReactNode;
  /**
   * Les champs retirés de la fiche dans « Cartes », à ne pas proposer ici.
   *
   * Le nom n'en fait jamais partie : il est obligatoire en base, et un formulaire
   * qui ne permettrait pas de le corriger rendrait la fiche irréparable. La valeur
   * d'un champ masqué n'est pas effacée pour autant — elle n'est simplement plus
   * modifiable depuis cet écran, ce qui est exactement ce que « retiré » veut dire.
   */
  hiddenKeys?: readonly string[];
  submitLabel?: string;
  savingLabel?: string;
}) {
  const [form, setForm] = useState<LeadFormValues>(initialValues);
  const [saving, setSaving] = useState(false);

  function setField(field: keyof LeadFormValues, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        website: form.website.trim(),
        address: form.address.trim(),
        category: form.category.trim(),
      });
    } finally {
      setSaving(false);
    }
  }

  const hidden = new Set(hiddenKeys ?? []);
  const shows = (key: keyof LeadFormValues) => key === 'name' || !hidden.has(key);

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
        <div className='sm:col-span-2'>
          <label className='label'>Nom de l'entreprise</label>
          <input
            className='input'
            value={form.name}
            onChange={e => setField('name', e.target.value)}
          />
        </div>
        {shows('phone') && (
          <div>
            <label className='label'>Téléphone</label>
            {/* Le numéro du prospect est la cible de toute la prospection SMS :
                masqué ici, il ne peut plus arriver hors E.164 au moment d'envoyer. */}
            <PhoneInput
              className='input'
              value={form.phone}
              onChange={next => setField('phone', next)}
            />
          </div>
        )}
        {shows('email') && (
          <div>
            <label className='label'>Courriel</label>
            <input
              className='input'
              type='email'
              value={form.email}
              onChange={e => setField('email', e.target.value)}
              placeholder='—'
            />
          </div>
        )}
        {shows('website') && (
          <div className='sm:col-span-2'>
            <label className='label'>Site web</label>
            <input
              className='input'
              type='url'
              value={form.website}
              onChange={e => setField('website', e.target.value)}
              placeholder='https://…'
            />
          </div>
        )}
        {shows('address') && (
          <div className='sm:col-span-2'>
            <label className='label'>Adresse</label>
            <input
              className='input'
              value={form.address}
              onChange={e => setField('address', e.target.value)}
              placeholder='—'
            />
          </div>
        )}
        {shows('category') && (
          <div>
            <label className='label'>Catégorie</label>
            <input
              className='input'
              value={form.category}
              onChange={e => setField('category', e.target.value)}
              placeholder='—'
            />
          </div>
        )}
        {extraFields}
      </div>
      <div className='flex justify-end gap-2 pt-1'>
        <button className='btn-secondary' onClick={onCancel} disabled={saving}>
          Annuler
        </button>
        <button className='btn-primary' onClick={handleSave} disabled={saving}>
          {saving ? savingLabel : submitLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Informations de carte ────────────────────────────────────────────────────
// Ce qu'un webhook a câblé en plus des sept champs du prospect : un budget, un
// créneau de rappel, un numéro de dossier. Voir `shared/leadIntake` (`ExtraField`)
// pour le pourquoi, et `Lead.extras` pour la forme enregistrée.

/**
 * Une valeur d'information libre, rendue selon ce qu'elle est.
 *
 * Une adresse devient un lien qui s'ouvre dans un onglet, un courriel un
 * `mailto:`, un numéro un `tel:` — ce qui, sur un téléphone, compose directement
 * — et une date ISO se lit enfin. Le reste est du texte.
 *
 * Un seul composant pour la carte et pour la fiche : sans cela, les deux écrans
 * dériveraient et un champ cliquable ici cesserait de l'être là.
 *
 * `stopPropagation` est indispensable : sur la carte, tout clic non intercepté
 * remonte à `CardClickShell` et ouvre le panneau latéral. Sans lui, suivre un lien
 * ouvrirait aussi la fiche derrière.
 */
export function LeadValueText({ value, className }: { value: string; className?: string }) {
  const detected = detectLeadValue(value);

  if (detected.kind === 'text' || detected.kind === 'date') {
    return <span className={className}>{detected.display}</span>;
  }

  const external = detected.kind === 'url';
  return (
    <a
      href={detected.href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      title={external ? detected.href : undefined}
      onClick={e => e.stopPropagation()}
      className={`text-accent-700 hover:underline break-words ${className ?? ''}`}
    >
      {detected.display}
    </a>
  );
}

/** Les informations de carte d'un prospect. Même remise en forme que le serveur. */
export function leadExtras(lead: unknown): LeadExtra[] {
  return normalizeLeadExtras((lead as any)?.extras);
}

export type { LeadExtra };
export { MAX_EXTRA_FIELDS, MAX_EXTRA_LABEL_CHARS, MAX_EXTRA_VALUE_CHARS };

/** Les initiales d'un nom, pour l'avatar d'une carte : « Cybèle Goupil » → « CG ». */
function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0];
  const second = words.length > 1 ? words[words.length - 1][0] : words[0][1] ?? '';
  return (first + second).toUpperCase();
}

export function LeadAvatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className='flex shrink-0 items-center justify-center rounded-full bg-canvas-200 font-semibold text-ink-700'
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initialsOf(name)}
    </span>
  );
}

const CHIP_TONES = {
  neutral: 'bg-canvas-200 text-ink-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  accent: 'bg-accent-50 text-accent-700',
  solid: 'bg-accent-500 text-white',
} as const;

/**
 * Une étiquette de carte — « Courriel envoyé », « 2 notes ». Rectangle arrondi
 * plutôt que pilule : la forme des étiquettes du Leads Center de Facebook, et ce
 * qui les distingue des pastilles de filtre ailleurs dans l'application.
 */
export function LeadChip({
  tone = 'neutral',
  icon,
  title,
  children,
}: {
  tone?: keyof typeof CHIP_TONES;
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-px text-[11px] font-medium leading-[18px] ${CHIP_TONES[tone]}`}
      title={title}
    >
      {icon}
      <span className='truncate'>{children}</span>
    </span>
  );
}

/**
 * Les étiquettes d'état d'un prospect — courriel envoyé, brouillon, réponse SMS,
 * notes, déjà client. Une seule définition pour la carte et pour la fiche : les
 * deux doivent dire la même chose du même prospect.
 */
export function leadStateChips(
  lead: any,
  { smsCanSend = true, isClient = false, notes = true }: { smsCanSend?: boolean; isClient?: boolean; notes?: boolean } = {},
): ReactNode[] {
  const chips: ReactNode[] = [];
  if (smsCanSend && lead.smsUnreadCount > 0) {
    chips.push(
      <LeadChip key='sms-unread' tone='solid' icon={<LuMessageSquareReply size={11} />} title='Réponse SMS reçue, pas encore lue'>
        {lead.smsUnreadCount} SMS non lu{lead.smsUnreadCount > 1 ? 's' : ''}
      </LeadChip>,
    );
  } else if (lead.hasSmsReply) {
    chips.push(
      <LeadChip key='sms-reply' tone='accent' icon={<LuMessageSquareReply size={11} />} title='Ce prospect a répondu à un SMS (réponse déjà lue)'>
        A répondu par SMS
      </LeadChip>,
    );
  } else if (lead.hasSmsSent) {
    chips.push(
      <LeadChip key='sms-sent' tone='success' icon={<LuMessageSquare size={11} />} title='Un SMS a été envoyé, pas encore de réponse'>
        SMS envoyé
      </LeadChip>,
    );
  }
  if (lead.hasEmailSent) {
    chips.push(
      <LeadChip key='email-sent' tone='success' icon={<LuSend size={11} />} title='Un courriel a été envoyé à ce prospect'>
        Courriel envoyé
      </LeadChip>,
    );
  } else if (lead.hasEmailDraft) {
    chips.push(
      <LeadChip key='email-draft' tone='warning' icon={<LuFilePen size={11} />} title="Un courriel est en brouillon, pas encore envoyé">
        Brouillon de courriel
      </LeadChip>,
    );
  }
  if (notes && (lead.noteCount > 0 || lead.notes)) {
    chips.push(
      <LeadChip key='notes' icon={<LuNotebook size={11} />}>
        {lead.noteCount > 0 ? `${lead.noteCount} note${lead.noteCount > 1 ? 's' : ''}` : 'Note'}
      </LeadChip>,
    );
  }
  if (isClient && lead.status === 'qualifie') {
    chips.push(<LeadChip key='client' tone='success' icon={<LuUserCheck size={11} />}>Client</LeadChip>);
  }
  return chips;
}

/**
 * Le contenu d'une carte de prospect : avatar, nom, étiquettes, puis les champs.
 *
 * Ne décide pas de ce qu'elle montre : elle applique `cardFields`, le jeu résolu
 * pour ce tableau (voir `shared/leadCardFields`). C'est ce qui permet à un tableau
 * de formulaire d'afficher un budget là où un tableau Google Maps affiche une note
 * et un lien Maps, sans deux composants ni un `if` par provenance.
 *
 * La provenance n'est pas une ligne mais une étiquette, rangée avec les autres
 * sous le nom ; son interrupteur dans le réglage « Cartes » décide toujours si
 * elle s'affiche. Les autres champs suivent l'ordre de la configuration.
 */
export function LeadCardInfo({
  lead,
  menu,
  badges,
  selection,
  sources,
  cardFields,
}: {
  lead: {
    name: string;
    website?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    category?: string | null;
    rating?: number | null;
    mapsUrl?: string | null;
    statusUpdatedAt?: string | Date | null;
    source?: string | null;
    /** Première ouverture de la fiche. `null` = personne ne l'a encore regardée. */
    viewedAt?: string | Date | null;
    /** Informations libres. Lues via `leadExtras`. */
    extras?: unknown;
  };
  /** Le bouton ⋮ de la carte, aligné sur le nom. */
  menu?: ReactNode;
  /** Étiquettes d'état (`LeadChip`) rangées après la provenance. */
  badges?: ReactNode;
  /** Case de sélection, en tête de carte. */
  selection?: ReactNode;
  /** Le registre des provenances. Absent, on retombe sur les étiquettes d'origine. */
  sources?: readonly LeadSourceOption[] | null;
  /**
   * Les champs à afficher, dans l'ordre. Absent — l'aperçu d'une correspondance,
   * un appelant pas encore migré — on retombe sur le jeu par défaut.
   */
  cardFields?: readonly CardFieldConfig[] | null;
}) {
  const movedAt = lead.statusUpdatedAt ? new Date(lead.statusUpdatedAt) : null;
  const movedLabel = movedAt
    ? movedAt.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }) +
      ' ' +
      movedAt.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })
    : null;

  // Personne n'a encore ouvert cette fiche. La même trace que celle qui retient
  // l'alerte d'arrivée (`Lead.viewedAt`, voir jobs/leadIntake) : ce que le point
  // signale sur la carte est exactement ce qui déclencherait la notification.
  const unopened = !lead.viewedAt;

  const extras = leadExtras(lead);
  const shown = visibleCardFields(
    cardFields && cardFields.length
      ? cardFields
      : DEFAULT_CARD_FIELDS.map((f, order) => ({ ...f, order })),
  );
  const showSource = shown.some(f => f.key === 'source');

  /** Le rendu d'un champ, ou `null` quand ce prospect n'a rien à y mettre. */
  function renderField(key: string): ReactNode {
    // Le nom est dans l'en-tête, la provenance parmi les étiquettes.
    if (key === 'name' || key === 'source') return null;

    if (key === 'rating') {
      if (lead.rating == null && !lead.mapsUrl) return null;
      return (
        <div key={key} className='flex items-center gap-2'>
          {lead.rating != null && (
            <span className='flex items-center gap-1'>
              <LuStar size={13} className='text-amber-400 fill-amber-400' />
              <span className='font-medium'>{Number(lead.rating).toFixed(1)}</span>
            </span>
          )}
          {lead.mapsUrl && (
            <a
              href={lead.mapsUrl}
              target='_blank'
              rel='noopener noreferrer'
              draggable={false}
              className='flex items-center gap-1 text-accent-700 hover:underline'
              onClick={e => e.stopPropagation()}
            >
              <LuExternalLink size={12} />
              Maps
            </a>
          )}
        </div>
      );
    }

    if (key === 'website' && lead.website) {
      return (
        <div key={key} className='flex items-center gap-2'>
          <LuGlobe size={13} className='text-muted shrink-0' />
          <a
            href={lead.website}
            target='_blank'
            rel='noopener noreferrer'
            draggable={false}
            className='text-accent-700 hover:underline truncate'
            onClick={e => e.stopPropagation()}
          >
            {lead.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
          </a>
        </div>
      );
    }

    if (key === 'phone' && lead.phone) {
      return (
        <div key={key} className='flex items-center gap-2'>
          <LuPhone size={13} className='text-muted shrink-0' />
          <a
            href={`tel:${lead.phone}`}
            draggable={false}
            className='text-accent-700 hover:underline truncate'
            onClick={e => e.stopPropagation()}
          >
            {lead.phone}
          </a>
        </div>
      );
    }

    if (key === 'email' && lead.email) {
      return (
        <div key={key} className='flex items-center gap-2'>
          <LuMail size={13} className='text-muted shrink-0' />
          <a
            href={`mailto:${lead.email}`}
            draggable={false}
            className='text-accent-700 hover:underline truncate'
            onClick={e => e.stopPropagation()}
          >
            {lead.email}
          </a>
        </div>
      );
    }

    if (key === 'address' && lead.address) {
      return (
        <div key={key} className='flex items-start gap-2'>
          <LuMapPin size={13} className='text-muted shrink-0 mt-[3px]' />
          <span className='text-ink break-words'>{lead.address}</span>
        </div>
      );
    }

    if (key === 'category' && lead.category) {
      return (
        <div key={key} className='flex items-start gap-2'>
          <LuTag size={13} className='text-muted shrink-0 mt-[3px]' />
          <span className='text-ink break-words'>{lead.category}</span>
        </div>
      );
    }

    if (isExtraFieldKey(key)) {
      const id = extraFieldId(key);
      const extra = extras.find(e => e.key === id);
      if (!extra) return null;
      // Intitulé au-dessus et non en préfixe : « Budget : 40 000 $ » sur une seule
      // ligne se fait tronquer au milieu de la valeur, qui est la moitié utile.
      return (
        <div key={key} className='min-w-0'>
          <div className='text-[11px] font-semibold uppercase tracking-wide text-muted leading-tight'>
            {extra.label}
          </div>
          <LeadValueText
            value={extra.value}
            className='block text-ink leading-snug break-words whitespace-pre-wrap'
          />
        </div>
      );
    }

    return null;
  }

  const body = shown.map(field => renderField(field.key)).filter(Boolean);
  const sourceChip = showSource ? (
    <LeadChip
      title={`Provenance : ${leadSourceLabel(lead.source, sources)}`}
      icon={
        <span
          className='w-2 h-2 rounded-full shrink-0'
          style={{ backgroundColor: leadSourceColor(lead.source, sources) }}
        />
      }
    >
      {leadSourceLabel(lead.source, sources)}
    </LeadChip>
  ) : null;

  return (
    <div className='p-2.5'>
      <div className='flex items-start gap-2'>
        {selection}
        <LeadAvatar name={lead.name} />
        <div className='min-w-0 flex-1'>
          <div className='flex items-start gap-1'>
            <div
              className={`min-w-0 flex-1 pt-px text-sm leading-snug text-ink break-words ${
                unopened ? 'font-bold' : 'font-semibold'
              }`}
            >
              {unopened && (
                <span
                  className='mr-1.5 inline-block h-2 w-2 rounded-full bg-accent-500 align-middle'
                  title='Jamais ouvert'
                  aria-label='Jamais ouvert'
                />
              )}
              {lead.name}
            </div>
            {menu}
          </div>
          {(sourceChip || badges) && (
            <div className='mt-1 flex flex-wrap gap-1'>
              {sourceChip}
              {badges}
            </div>
          )}
        </div>
      </div>

      {body.length > 0 && <div className='mt-2 space-y-0.5 text-xs leading-5'>{body}</div>}

      {/* La date de déplacement n'est pas un champ du prospect mais une trace du
          tableau : elle ne se règle donc pas et garde sa place en pied de carte. */}
      {movedLabel && (
        <div className='mt-1.5 flex items-center gap-1 text-[11px] text-muted' title={`Déplacé le ${movedLabel}`}>
          <LuClock size={11} className='shrink-0' />
          <span>{movedLabel}</span>
        </div>
      )}
    </div>
  );
}

// ─── Delete confirmation modal ────────────────────────────────────────────────
// Identical in both the authenticated page and the public portal.

export function LeadDeleteConfirmModal({
  lead,
  onClose,
  onConfirm,
  deleting,
}: {
  lead: { name: string } | null;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
}) {
  if (!lead) return null;
  return (
    <div className='space-y-4'>
      <p className='text-sm text-muted'>
        Êtes-vous sûr de vouloir supprimer ce prospect ? Cette action est irréversible.
      </p>
      <div className='rounded-xl border border-line bg-canvas p-3.5 text-sm font-medium'>
        {lead.name}
      </div>
      <div className='flex justify-end gap-2'>
        <button className='btn-secondary' onClick={onClose} disabled={deleting}>
          Annuler
        </button>
        <button className='btn-danger gap-1.5' onClick={onConfirm} disabled={deleting}>
          {deleting ? <LuLoader size={14} className='animate-spin' /> : <LuTrash2 size={14} />}
          {deleting ? 'Suppression…' : 'Supprimer'}
        </button>
      </div>
    </div>
  );
}

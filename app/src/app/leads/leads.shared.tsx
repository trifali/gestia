/**
 * Shared UI components and helpers for the leads/prospection module.
 * Used by both LeadSearchPage (authenticated) and ProspectPortalPage (public token).
 */

import React, { useState, useRef, useEffect, useMemo, useCallback, type ReactNode, type FormEvent } from 'react';
import { KanbanComponent, ColumnsDirective, ColumnDirective } from '@syncfusion/ej2-react-kanban';
import { extend } from '@syncfusion/ej2-base';
import toast from 'react-hot-toast';
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
  LuChevronDown,
  LuCopy,
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef<number | null>(null);

  // Scroll to the newest note when one is added — but not on the first render,
  // which would drag an embedding panel down past its other sections.
  useEffect(() => {
    if (prevCount.current !== null && notes.length > prevCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    prevCount.current = notes.length;
  }, [notes.length]);

  return (
    <div className='flex flex-col gap-4'>
      {/* Timeline */}
      <div
        className={`flex flex-col gap-3 pr-1 ${
          scrollable ? 'max-h-80 overflow-y-auto overscroll-contain' : ''
        }`}
      >
        {notes.length === 0 ? (
          <p className='text-sm text-muted text-center py-6'>Aucune note pour ce prospect.</p>
        ) : (
          notes.map(n => (
            <div key={n.id} className='flex gap-3 group'>
              <div className='flex flex-col items-center'>
                <div className='w-2 h-2 rounded-full bg-accent-500 mt-1.5 shrink-0' />
                <div className='w-px flex-1 bg-line mt-1' />
              </div>
              <div className='flex-1 pb-3'>
                <div className='flex items-start justify-between gap-2'>
                  <p className='text-xs text-muted'>{formatMontrealTime(n.createdAt)}</p>
                  <button
                    className='opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-red-500'
                    onClick={() => onDelete(n.id)}
                    disabled={deletingId === n.id}
                    title='Supprimer'
                  >
                    {deletingId === n.id ? (
                      <LuLoader size={12} className='animate-spin' />
                    ) : (
                      <LuTrash2 size={12} />
                    )}
                  </button>
                </div>
                <p className='text-sm mt-0.5 whitespace-pre-wrap'>{n.text}</p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <form onSubmit={onSubmit} className='flex gap-2 border-t border-line pt-3'>
        <textarea
          className='input resize-none flex-1 text-sm'
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
        >
          {saving ? <LuLoader size={14} className='animate-spin' /> : <LuSend size={14} />}
        </button>
      </form>
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

// ─── Lead card info ───────────────────────────────────────────────────────────
// The non-interactive part of a lead card: name, timestamp, contact links,
// rating and Maps link. Used in both the Kanban card template and mobile
// accordion rows. Pass `actions` for the button row.

// ─── Informations de carte ────────────────────────────────────────────────────
// Ce qu'un webhook a câblé en plus des sept champs du prospect : un budget, un
// créneau de rappel, un numéro de dossier. Voir `shared/leadIntake` (`ExtraField`)
// pour le pourquoi, et `Lead.extras` pour la forme enregistrée.

/** Les informations de carte d'un prospect. Même remise en forme que le serveur. */
export function leadExtras(lead: unknown): LeadExtra[] {
  return normalizeLeadExtras((lead as any)?.extras);
}

export type { LeadExtra };
export { MAX_EXTRA_FIELDS, MAX_EXTRA_LABEL_CHARS, MAX_EXTRA_VALUE_CHARS };

/**
 * La partie non interactive d'une carte de prospect.
 *
 * Ne décide plus de ce qu'elle montre : elle applique `cardFields`, le jeu résolu
 * pour ce tableau (voir `shared/leadCardFields`). C'est ce qui permet à un tableau
 * de formulaire d'afficher un budget là où un tableau Google Maps affiche une note
 * et un lien Maps, sans deux composants ni un `if` par provenance.
 *
 * L'ordre de la configuration est respecté tel quel, y compris pour la pastille de
 * provenance et la note Google, qui ont chacune leur forme mais pas de place
 * réservée : ce que l'écran de réglage montre de haut en bas est ce que la carte
 * montre de haut en bas.
 */
export function LeadCardInfo({
  lead,
  actions,
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
  /** Optional button row rendered below contact info. */
  actions?: ReactNode;
  /** Optional selection checkbox rendered next to the name. */
  selection?: ReactNode;
  /**
   * Le registre des provenances, passé en prop et jamais lu par `useQuery` ici :
   * ce composant est rendu dans le `cardTemplate` de Syncfusion, hors de l'arbre
   * React normal, où les hooks de Wasp n'ont pas de contexte. Absent, on retombe
   * sur les étiquettes d'origine puis sur la clé dé-sluggifiée.
   */
  sources?: readonly LeadSourceOption[] | null;
  /**
   * Les champs à afficher, dans l'ordre. Même raison que `sources` de passer par
   * une prop. Absent — l'aperçu d'une correspondance, un appelant pas encore
   * migré — on retombe sur le jeu par défaut, qui est exactement ce que la carte
   * montrait avant que ce réglage n'existe.
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

  /** Le rendu d'un champ, ou `null` quand ce prospect n'a rien à y mettre. */
  function renderField(key: string): ReactNode {
    if (key === 'name') return null; // rendu dans l'en-tête, avec la sélection.

    if (key === 'source') {
      return (
        <span
          key={key}
          className='flex w-fit items-center gap-1 text-[9px] leading-none px-1 py-[1px] rounded bg-canvas border border-line text-muted whitespace-nowrap'
          title={`Provenance : ${leadSourceLabel(lead.source, sources)}`}
        >
          <span
            className='w-1.5 h-1.5 rounded-full shrink-0'
            style={{ backgroundColor: leadSourceColor(lead.source, sources) }}
          />
          {leadSourceLabel(lead.source, sources)}
        </span>
      );
    }

    if (key === 'rating') {
      if (lead.rating == null && !lead.mapsUrl) return null;
      return (
        <div key={key} className='flex items-center gap-1.5'>
          {lead.rating != null && (
            <span className='flex items-center gap-0.5 text-xs'>
              <LuStar size={10} className='text-amber-400 fill-amber-400' />
              <span className='font-medium'>{Number(lead.rating).toFixed(1)}</span>
            </span>
          )}
          {lead.mapsUrl && (
            <a
              href={lead.mapsUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='text-xs text-accent-700 hover:underline flex items-center gap-0.5'
              onClick={e => e.stopPropagation()}
            >
              <LuExternalLink size={10} />
              Maps
            </a>
          )}
        </div>
      );
    }

    if (key === 'website' && lead.website) {
      return (
        <div key={key} className='flex items-center gap-1.5 text-xs'>
          <LuGlobe size={10} className='text-muted shrink-0' />
          <a
            href={lead.website}
            target='_blank'
            rel='noopener noreferrer'
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
        <div key={key} className='flex items-center gap-1.5 text-xs'>
          <LuPhone size={10} className='text-muted shrink-0' />
          <a
            href={`tel:${lead.phone}`}
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
        <div key={key} className='flex items-center gap-1.5 text-xs'>
          <LuMail size={10} className='text-muted shrink-0' />
          <a
            href={`mailto:${lead.email}`}
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
        <div key={key} className='flex items-start gap-1.5 text-xs'>
          <LuMapPin size={10} className='text-muted shrink-0 mt-0.5' />
          <span className='text-ink break-words'>{lead.address}</span>
        </div>
      );
    }

    if (key === 'category' && lead.category) {
      return (
        <div key={key} className='flex items-start gap-1.5 text-xs'>
          <LuTag size={10} className='text-muted shrink-0 mt-0.5' />
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
          <div className='text-[9px] font-semibold uppercase tracking-wide text-muted leading-tight'>
            {extra.label}
          </div>
          <div className='text-xs text-ink leading-snug break-words whitespace-pre-wrap'>
            {extra.value}
          </div>
        </div>
      );
    }

    return null;
  }

  const body = shown.map(field => renderField(field.key)).filter(Boolean);

  return (
    <div className='p-3 space-y-2'>
      <div className='flex items-start gap-2'>
        {selection}
        {unopened && (
          <span
            className='w-2 h-2 rounded-full bg-accent-500 shrink-0 mt-[5px]'
            title='Jamais ouvert'
            aria-label='Jamais ouvert'
          />
        )}
        <div
          className={`text-sm leading-tight flex-1 min-w-0 ${
            unopened ? 'font-bold text-ink' : 'font-semibold'
          }`}
        >
          {lead.name}
        </div>
      </div>

      {/* La date de déplacement n'est pas un champ du prospect mais une trace du
          tableau : elle ne se règle donc pas et garde sa place sous le nom. */}
      {movedLabel && (
        <div
          className='flex items-center gap-1 text-[10px] text-muted'
          title={`Déplacé le ${movedLabel}`}
        >
          <LuClock size={9} className='shrink-0' />
          <span>{movedLabel}</span>
        </div>
      )}

      {body.length > 0 && <div className='space-y-1'>{body}</div>}

      {actions && <div className='pt-1.5 border-t border-line'>{actions}</div>}
    </div>
  );
}

// ─── Clickable card shell ─────────────────────────────────────────────────────
// Wraps a card so a plain click opens the detail panel while a drag does not.
// Inner buttons/links stop propagation, so they keep their own behaviour.

function CardClickShell({
  onClick,
  children,
}: {
  onClick?: () => void;
  children: ReactNode;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);

  if (!onClick) return <>{children}</>;

  return (
    <div
      className='cursor-pointer'
      onPointerDown={e => {
        start.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={e => {
        const s = start.current;
        // Ignore the click that ends a drag.
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 6) return;
        onClick();
      }}
    >
      {children}
    </div>
  );
}

// ─── Kanban column header ─────────────────────────────────────────────────────
// Color dot + label + count badge. Pass `extra` for additional controls
// (e.g. the "fetch more" button in the authenticated view).

export function KanbanColumnHeader({
  label,
  color,
  count,
  extra,
  selection,
}: {
  label: string;
  color: string;
  count: number;
  extra?: ReactNode;
  /** Optional checkbox selecting every card of the column. */
  selection?: ReactNode;
}) {
  return (
    <div className='flex items-center gap-2 px-1 py-0.5'>
      {selection}
      <div className='w-3 h-3 rounded-full shrink-0' style={{ backgroundColor: color }} />
      <span className='font-semibold text-sm'>{label}</span>
      <span className='text-xs text-muted ml-auto bg-canvas px-1.5 py-0.5 rounded-full'>
        {count}
      </span>
      {extra}
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

// ─── Kanban board (mobile accordion + desktop Syncfusion Kanban) ──────────────
// Shared layout for both the authenticated view and the public portal.
// The parent provides pre-filtered leads, action buttons, and status update ops.

// While a drag is in flight Syncfusion keeps the dragged card in its original
// slot (marked `e-kanban-dragged-card`), leaves a floating ghost copy at the end
// of the source column (`e-cloned-card`) and marks the slot the card would land
// in with a placeholder (`e-target-dropped-clone`). `dragStop` fires while the
// board is still in that state, so walking the target column then gives the
// exact order the user is about to see.
const DROP_SLOT_CLASS = 'e-target-dropped-clone';

function isDroppableCard(el: Element): boolean {
  return (
    el.classList.contains('e-card') &&
    !el.classList.contains('e-cloned-card') &&
    !el.classList.contains('e-kanban-dragged-card')
  );
}

/** Viewport Y of the pointer behind a Kanban drag event, mouse or touch. */
function dragClientY(args: any): number | null {
  const e = args?.event;
  const src = e?.event?.changedTouches?.[0] ?? e?.changedTouches?.[0] ?? e?.event ?? e;
  return typeof src?.clientY === 'number' ? src.clientY : null;
}

/**
 * Syncfusion always drops the placeholder *after* the card under the pointer and
 * only tests the pointer against a card's midpoint for the first card of a
 * column (`insertClone` is hard-set to `'afterend'` in its `drag` handler), so
 * hovering the top half of any other card still lands the card below it. This
 * re-places the placeholder against every card's midpoint. It runs on the `drag`
 * event, which fires right after Syncfusion positioned the placeholder and
 * before the browser paints, so the correction is invisible.
 */
function realignDropSlot(root: HTMLElement | null, clientY: number | null): void {
  if (clientY === null) return;
  const slot = root?.querySelector(`.${DROP_SLOT_CLASS}`);
  const wrapper = slot?.parentElement;
  if (!slot || !wrapper) return;

  const cards: Element[] = [];
  let slotIndex = 0;
  for (const el of Array.from(wrapper.children)) {
    if (el === slot) slotIndex = cards.length;
    else if (isDroppableCard(el)) cards.push(el);
  }

  // The placeholder takes up room, so the cards it pushed aside already sit
  // where they would land once the card is released. Measuring against those
  // shifted midpoints gives a card-height of hysteresis, which keeps the slot
  // from flipping back and forth around a boundary.
  let index = 0;
  while (index < cards.length) {
    const rect = cards[index].getBoundingClientRect();
    if (rect.top + rect.height / 2 >= clientY) break;
    index++;
  }
  if (index === slotIndex) return;

  if (index < cards.length) wrapper.insertBefore(slot, cards[index]);
  else cards[cards.length - 1].insertAdjacentElement('afterend', slot);
}

/**
 * The target column's card ids in their post-drop order, or null when the drop
 * placeholder is gone — Syncfusion removes it when the card is released outside
 * a valid slot (typically right back onto its own position) and then applies no
 * change of its own, so nothing must be persisted either.
 */
function readDroppedColumnOrder(
  root: HTMLElement | null,
  status: string,
  movedIds: string[],
): string[] | null {
  const cell = root?.querySelector(
    `.e-content-row:not(.e-swimlane-row) .e-content-cells[data-key="${CSS.escape(status)}"]`,
  );
  const wrapper = cell?.querySelector('.e-card-wrapper');
  if (!wrapper?.querySelector(`.${DROP_SLOT_CLASS}`)) return null;

  const moved = new Set(movedIds);
  const ids: string[] = [];
  for (const el of Array.from(wrapper.children)) {
    if (el.classList.contains(DROP_SLOT_CLASS)) {
      ids.push(...movedIds);
      continue;
    }
    // The dragged cards keep their old slot in the DOM; the placeholder above is
    // where they actually end up.
    if (!isDroppableCard(el)) continue;
    const id = el.getAttribute('data-id');
    if (id && !moved.has(id)) ids.push(id);
  }
  return ids;
}

export function LeadKanbanBoard({
  leads,
  statusConfigs,
  updateStatus,
  reorder,
  refetch,
  cardActions,
  columnExtra,
  mobileColumnExtra,
  searchBarSlot,
  onCardClick,
  selectedLeadId,
  selectedIds,
  onToggleSelect,
  onSelectMany,
  sources,
  cardFields,
  cssClass = 'gestia-kanban',
}: {
  /** Already-filtered leads to display. */
  leads: any[];
  statusConfigs: any[];
  /** Le registre des provenances, pour l'étiquette et la pastille des cartes. */
  sources?: readonly LeadSourceOption[] | null;
  /** Les champs à afficher sur les cartes, résolus pour ce tableau. */
  cardFields?: readonly CardFieldConfig[] | null;
  /** API call only — no toast, no refetch. Throws on error. */
  updateStatus: (leadId: string, newStatus: string) => Promise<void>;
  /**
   * Persists the manual card order of one column, `orderedIds` being the column
   * exactly as displayed. API call only — no toast, no refetch. Throws on error.
   */
  reorder?: (status: string, orderedIds: string[]) => Promise<void>;
  refetch: () => void;
  /** Action buttons rendered inside each card's actions area. */
  cardActions: (lead: any) => ReactNode;
  /** Opens the detail panel. Not fired when the pointer moved (i.e. a drag). */
  onCardClick?: (lead: any) => void;
  /** Highlights the card currently shown in the detail panel. */
  selectedLeadId?: string | null;
  /** Ids ticked for a bulk action. Cards only get a checkbox when `onToggleSelect` is passed. */
  selectedIds?: Set<string>;
  onToggleSelect?: (leadId: string) => void;
  /** Ticks/unticks a whole column at once. Adds a checkbox to the column header. */
  onSelectMany?: (leadIds: string[], selected: boolean) => void;
  /** Extra element for desktop column headers (e.g. "fetch more" button). */
  columnExtra?: (keyField: string) => ReactNode;
  /** Extra element for mobile accordion column headers. */
  mobileColumnExtra?: (col: any) => ReactNode;
  /** Rendered above the board (search input, filter chips, etc.). */
  searchBarSlot?: ReactNode;
  cssClass?: string;
}) {
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set());

  // Stable refs so callbacks stay referentially stable across re-renders.
  const updateStatusRef = useRef(updateStatus);
  updateStatusRef.current = updateStatus;
  const reorderRef = useRef(reorder);
  reorderRef.current = reorder;
  const leadsRef = useRef(leads);
  leadsRef.current = leads;
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const cardActionsRef = useRef(cardActions);
  cardActionsRef.current = cardActions;
  const columnExtraRef = useRef(columnExtra);
  columnExtraRef.current = columnExtra;
  const onCardClickRef = useRef(onCardClick);
  onCardClickRef.current = onCardClick;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const onToggleSelectRef = useRef(onToggleSelect);
  onToggleSelectRef.current = onToggleSelect;
  const onSelectManyRef = useRef(onSelectMany);
  onSelectManyRef.current = onSelectMany;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  // Même raison que `sourcesRef` : le gabarit de carte de Syncfusion est rendu
  // hors de l'arbre React normal, et lire la prop directement y donnerait la
  // valeur figée du premier rendu.
  const cardFieldsRef = useRef(cardFields);
  cardFieldsRef.current = cardFields;
  const boardRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Same constraint as the selected-card outline below: Syncfusion re-renders
  // cards on its own schedule, so the checkbox is uncontrolled (its initial
  // state read from the ref at mount) and the current selection is pushed back
  // onto the DOM by the effect underneath.
  const renderSelection = useCallback((lead: any): ReactNode => {
    if (!onToggleSelectRef.current) return null;
    return (
      <input
        type='checkbox'
        data-lead-select={lead.id}
        className='w-3.5 h-3.5 mt-0.5 rounded accent-accent-600 shrink-0 cursor-pointer'
        title='Sélectionner'
        defaultChecked={!!selectedIdsRef.current?.has(lead.id)}
        onClick={e => e.stopPropagation()}
        onChange={() => onToggleSelectRef.current?.(lead.id)}
      />
    );
  }, []);

  // Ids of the cards a column header checkbox stands for.
  const columnIdsOf = useCallback(
    (status: string) => leadsRef.current.filter((l: any) => l.status === status).map((l: any) => l.id),
    [],
  );

  const renderColumnSelection = useCallback((status: string): ReactNode => {
    if (!onSelectManyRef.current) return null;
    return (
      <input
        type='checkbox'
        data-column-select={status}
        className='w-3.5 h-3.5 rounded accent-accent-600 shrink-0 cursor-pointer'
        title='Sélectionner tous les prospects de cette colonne'
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        onChange={e => onSelectManyRef.current?.(columnIdsOf(status), e.target.checked)}
      />
    );
  }, [columnIdsOf]);

  useEffect(() => {
    if (!onToggleSelect && !onSelectMany) return;
    const raf = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      root.querySelectorAll<HTMLInputElement>('input[data-lead-select]').forEach(el => {
        const id = el.dataset.leadSelect;
        const checked = !!(id && selectedIds?.has(id));
        el.checked = checked;
        el.closest('.e-card')?.classList.toggle('gestia-card-checked', checked);
      });
      root.querySelectorAll<HTMLInputElement>('input[data-column-select]').forEach(el => {
        const status = el.dataset.columnSelect;
        const ids = status ? leads.filter((l: any) => l.status === status).map((l: any) => l.id) : [];
        const picked = ids.filter(id => selectedIds?.has(id)).length;
        el.checked = ids.length > 0 && picked === ids.length;
        el.indeterminate = picked > 0 && picked < ids.length;
        el.disabled = ids.length === 0;
      });
    });
    return () => cancelAnimationFrame(raf);
    // `openSections` is a dependency because the mobile accordion mounts its
    // checkboxes on expand, after the selection they need to reflect is set.
  }, [selectedIds, leads, openSections, onToggleSelect, onSelectMany]);

  // Syncfusion owns the card DOM, so the selected-card outline is toggled by
  // class on the rendered `.e-card` rather than through the React template.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const root = boardRef.current;
      if (!root) return;
      root
        .querySelectorAll('.e-card.gestia-card-selected')
        .forEach(el => el.classList.remove('gestia-card-selected'));
      if (selectedLeadId) {
        root
          .querySelector(`.e-card[data-id="${CSS.escape(selectedLeadId)}"]`)
          ?.classList.add('gestia-card-selected');
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedLeadId, leads]);

  // Kanban columns share the container width evenly, so insetting the board for
  // the detail panel would squeeze them. Instead the board is pinned to the
  // width it had before the panel opened and the viewport scrolls horizontally.
  const panelOpen = !!selectedLeadId;
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  const trackRef = useRef<HTMLDivElement>(null);
  const naturalWidth = useRef<number | null>(null);
  const [pinnedWidth, setPinnedWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!panelOpenRef.current) naturalWidth.current = el.clientWidth;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setPinnedWidth(panelOpen ? naturalWidth.current : null);
  }, [panelOpen]);

  function toggleSection(key: string) {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const kanbanData = useMemo(
    () => extend([], leads.map(l => ({ ...l })), undefined, true) as any[],
    [leads],
  );

  // Drops are persisted one after another: each one reads the column back from
  // the server, so overlapping round-trips would race on a stale order.
  const persistQueue = useRef<Promise<void>>(Promise.resolve());

  function handleDrag(args: any) {
    realignDropSlot(boardRef.current, dragClientY(args));
  }

  // Stays synchronous — the board DOM is read before Syncfusion applies the drop
  // and tears the placeholders down, which it does as soon as this returns.
  function handleDragStop(args: any) {
    if (!args?.data?.length) return;

    // One card per drag, always. Syncfusion drags every `e-selection` card of
    // the row at once, so should one ever slip through, only the card that was
    // actually dropped is persisted and the refetch snaps the others back.
    const dragged = args.data.slice(0, 1);
    const targetStatus = dragged[0].status;
    const movedIds = dragged.map((c: any) => c.id);
    const columnIds = readDroppedColumnOrder(boardRef.current, targetStatus, movedIds);
    if (!columnIds) return;

    const statusChanges = dragged.filter(
      (c: any) => leadsRef.current.find((l: any) => l.id === c.id)?.status !== c.status,
    );

    // Dropping a card back where it came from changes nothing — writing anyway
    // would make the board flicker through a refetch for no reason.
    const currentIds = leadsRef.current
      .filter((l: any) => l.status === targetStatus)
      .map((l: any) => l.id);
    const sameOrder =
      currentIds.length === columnIds.length && currentIds.every((id, i) => id === columnIds[i]);
    if (statusChanges.length === 0 && sameOrder) return;

    persistQueue.current = persistQueue.current.then(async () => {
      for (const card of statusChanges) {
        try {
          await updateStatusRef.current(card.id, card.status);
        } catch {
          toast.error('Erreur lors de la mise à jour du statut');
          refetchRef.current();
          return;
        }
      }

      // Without this the card would snap back to its stored position on the next
      // refetch instead of staying where it was dropped.
      if (reorderRef.current) {
        try {
          await reorderRef.current(targetStatus, columnIds);
        } catch {
          toast.error("Erreur lors de la mise à jour de l'ordre");
        }
      }

      refetchRef.current();
    })
    // An unexpected throw must not leave the queue rejected for later drops.
    .catch(() => {});
  }

  // `sources` est une vraie dépendance et non une lecture par ref : le registre
  // arrive d'une requête, donc après le premier rendu des cartes. Passer par une
  // ref laisserait les pastilles sur leur étiquette de repli jusqu'au prochain
  // rafraîchissement du tableau.
  const cardTemplate = useCallback(
    (lead: any): React.ReactElement => (
      <CardClickShell onClick={onCardClickRef.current ? () => onCardClickRef.current!(lead) : undefined}>
        <LeadCardInfo
          lead={lead}
          actions={cardActionsRef.current(lead)}
          selection={renderSelection(lead)}
          sources={sourcesRef.current}
          cardFields={cardFieldsRef.current}
        />
      </CardClickShell>
    ),
    // `cardFields` doit être une vraie dépendance : sans elle, le gabarit garde
    // celui qu'il avait au premier rendu, et étoiler un champ ne changerait rien
    // aux cartes tant qu'on n'a pas rechargé la page.
    [renderSelection, sources, cardFields],
  );

  const columnHeaderTemplate = useCallback(
    (props: any): React.ReactElement => {
      const config = statusConfigs.find((s: any) => s.key === props.keyField);
      return (
        <KanbanColumnHeader
          label={props.headerText}
          color={config?.color ?? '#6366f1'}
          count={props.count ?? 0}
          extra={columnExtraRef.current?.(props.keyField)}
          selection={renderColumnSelection(props.keyField)}
        />
      );
    },
    [statusConfigs, renderColumnSelection],
  );

  if (statusConfigs.length === 0) {
    return <div className='text-muted text-sm py-8 text-center'>Chargement des statuts…</div>;
  }

  return (
    <div ref={rootRef}>
      {searchBarSlot}

      {/* Mobile accordion */}
      <div className='sm:hidden space-y-2'>
        {statusConfigs.map((col: any) => {
          const colLeads = leads.filter((l: any) => l.status === col.key);
          const isOpen = openSections.has(col.key);
          return (
            <div key={col.key} className='rounded-xl border border-line overflow-hidden'>
              <div
                className='w-full flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none'
                onClick={() => toggleSection(col.key)}
                role='button'
                tabIndex={0}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleSection(col.key)}
              >
                {renderColumnSelection(col.key)}
                <div
                  className='w-3 h-3 rounded-full shrink-0'
                  style={{ backgroundColor: col.color ?? '#6366f1' }}
                />
                <span className='font-semibold text-sm flex-1 text-left'>{col.label}</span>
                <span className='text-xs text-muted bg-canvas px-1.5 py-0.5 rounded-full'>
                  {colLeads.length}
                </span>
                {mobileColumnExtra?.(col)}
                <LuChevronDown
                  size={14}
                  className={`text-muted transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                />
              </div>
              {isOpen && (
                <div className='divide-y divide-line border-t border-line'>
                  {colLeads.length === 0 ? (
                    <div className='text-xs text-muted text-center py-4 italic'>
                      Aucun prospect
                    </div>
                  ) : (
                    colLeads.map((lead: any) => (
                      <div
                        key={lead.id}
                        className={
                          selectedLeadId === lead.id || selectedIds?.has(lead.id)
                            ? 'bg-accent-50'
                            : undefined
                        }
                      >
                        <CardClickShell
                          onClick={onCardClick ? () => onCardClick(lead) : undefined}
                        >
                          <LeadCardInfo
                            lead={lead}
                            actions={cardActions(lead)}
                            selection={renderSelection(lead)}
                            sources={sources}
                            cardFields={cardFields}
                          />
                        </CardClickShell>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop kanban */}
      <div ref={boardRef} className='hidden sm:block overflow-x-auto -mx-4 px-4'>
        <div ref={trackRef} style={pinnedWidth ? { minWidth: pinnedWidth } : undefined}>
          <KanbanComponent
            keyField='status'
            dataSource={kanbanData}
            // Syncfusion's own card selection is switched off entirely, which is
            // what keeps a drag to a single card. On dragStart it drags *every*
            // card carrying `e-selection` in the row (all columns included), and
            // its layout re-applies that class on each re-render from a list of
            // remembered ids — with the board refetching as often as it does, a
            // stale id there was enough to pick up a second card. `None` means
            // the class is never added, so there is nothing to drag along.
            // Selecting cards is done with our own checkboxes anyway.
            cardSettings={{
              headerField: 'id',
              template: cardTemplate,
              showHeader: false,
              selectionType: 'None',
            }}
            drag={handleDrag}
            dragStop={handleDragStop}
            cssClass={cssClass}
          >
            <ColumnsDirective>
              {statusConfigs.map((col: any) => (
                <ColumnDirective
                  key={col.key}
                  headerText={col.label}
                  keyField={col.key}
                  template={columnHeaderTemplate}
                />
              ))}
            </ColumnsDirective>
          </KanbanComponent>
        </div>
      </div>
    </div>
  );
}

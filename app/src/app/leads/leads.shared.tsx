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
  LuTrash2,
  LuLoader,
  LuSend,
  LuChevronDown,
  LuCopy,
  LuCheck,
} from 'react-icons/lu';

// ─── Time helper ──────────────────────────────────────────────────────────────

export function formatMontrealTime(date: string | Date): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

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
}: {
  initialValues: LeadFormValues;
  /** Called with trimmed values; should handle saving and call onCancel on success. */
  onSave: (values: LeadFormValues) => Promise<void>;
  onCancel: () => void;
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
        <div>
          <label className='label'>Téléphone</label>
          <input
            className='input'
            type='tel'
            value={form.phone}
            onChange={e => setField('phone', e.target.value)}
            placeholder='—'
          />
        </div>
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
        <div className='sm:col-span-2'>
          <label className='label'>Adresse</label>
          <input
            className='input'
            value={form.address}
            onChange={e => setField('address', e.target.value)}
            placeholder='—'
          />
        </div>
        <div>
          <label className='label'>Catégorie</label>
          <input
            className='input'
            value={form.category}
            onChange={e => setField('category', e.target.value)}
            placeholder='—'
          />
        </div>
      </div>
      <div className='flex justify-end gap-2 pt-1'>
        <button className='btn-secondary' onClick={onCancel} disabled={saving}>
          Annuler
        </button>
        <button className='btn-primary' onClick={handleSave} disabled={saving}>
          {saving ? 'Sauvegarde…' : 'Sauvegarder'}
        </button>
      </div>
    </div>
  );
}

// ─── Lead card info ───────────────────────────────────────────────────────────
// The non-interactive part of a lead card: name, timestamp, contact links,
// rating and Maps link. Used in both the Kanban card template and mobile
// accordion rows. Pass `actions` for the button row.

export function LeadCardInfo({
  lead,
  actions,
}: {
  lead: {
    name: string;
    website?: string | null;
    phone?: string | null;
    email?: string | null;
    rating?: number | null;
    mapsUrl?: string | null;
    statusUpdatedAt?: string | Date | null;
  };
  /** Optional button row rendered below contact info. */
  actions?: ReactNode;
}) {
  const movedAt = lead.statusUpdatedAt ? new Date(lead.statusUpdatedAt) : null;
  const movedLabel = movedAt
    ? movedAt.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }) +
      ' ' +
      movedAt.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className='p-3 space-y-2'>
      <div className='font-semibold text-sm leading-tight'>{lead.name}</div>
      {movedLabel && (
        <div
          className='flex items-center gap-1 text-[10px] text-muted'
          title={`Déplacé le ${movedLabel}`}
        >
          <LuClock size={9} className='shrink-0' />
          <span>{movedLabel}</span>
        </div>
      )}
      <div className='space-y-0.5'>
        {lead.website && (
          <div className='flex items-center gap-1.5 text-xs'>
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
        )}
        {lead.phone && (
          <div className='flex items-center gap-1.5 text-xs'>
            <LuPhone size={10} className='text-muted shrink-0' />
            <a
              href={`tel:${lead.phone}`}
              className='text-accent-700 hover:underline truncate'
              onClick={e => e.stopPropagation()}
            >
              {lead.phone}
            </a>
          </div>
        )}
        {lead.email && (
          <div className='flex items-center gap-1.5 text-xs'>
            <LuMail size={10} className='text-muted shrink-0' />
            <a
              href={`mailto:${lead.email}`}
              className='text-accent-700 hover:underline truncate'
              onClick={e => e.stopPropagation()}
            >
              {lead.email}
            </a>
          </div>
        )}
      </div>
      {(lead.rating != null || lead.mapsUrl) && (
        <div className='flex items-center gap-1.5'>
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
      )}
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
}: {
  label: string;
  color: string;
  count: number;
  extra?: ReactNode;
}) {
  return (
    <div className='flex items-center gap-2 px-1 py-0.5'>
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
    if (!el.classList.contains('e-card') || el.classList.contains('e-cloned-card')) continue;
    const id = el.getAttribute('data-id');
    // The dragged cards keep their old slot in the DOM; the placeholder above is
    // where they actually end up.
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
  cssClass = 'gestia-kanban',
}: {
  /** Already-filtered leads to display. */
  leads: any[];
  statusConfigs: any[];
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
  const boardRef = useRef<HTMLDivElement>(null);

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

  // Stays synchronous — the board DOM is read before Syncfusion applies the drop
  // and tears the placeholders down, which it does as soon as this returns.
  function handleDragStop(args: any) {
    if (!args?.data?.length) return;

    const targetStatus = args.data[0].status;
    const movedIds = args.data.map((c: any) => c.id);
    const columnIds = readDroppedColumnOrder(boardRef.current, targetStatus, movedIds);
    if (!columnIds) return;

    const statusChanges = args.data.filter(
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

  const cardTemplate = useCallback(
    (lead: any): React.ReactElement => (
      <CardClickShell onClick={onCardClickRef.current ? () => onCardClickRef.current!(lead) : undefined}>
        <LeadCardInfo lead={lead} actions={cardActionsRef.current(lead)} />
      </CardClickShell>
    ),
    [],
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
        />
      );
    },
    [statusConfigs],
  );

  if (statusConfigs.length === 0) {
    return <div className='text-muted text-sm py-8 text-center'>Chargement des statuts…</div>;
  }

  return (
    <>
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
                        className={selectedLeadId === lead.id ? 'bg-accent-50' : undefined}
                      >
                        <CardClickShell
                          onClick={onCardClick ? () => onCardClick(lead) : undefined}
                        >
                          <LeadCardInfo lead={lead} actions={cardActions(lead)} />
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
            cardSettings={{ headerField: 'id', template: cardTemplate, showHeader: false }}
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
    </>
  );
}

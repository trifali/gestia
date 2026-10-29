/**
 * Le tableau kanban des prospects, partagé par la page Prospection et le portail
 * public par jeton.
 *
 * Calqué sur le Leads Center de Facebook : des colonnes de largeur fixe qui
 * défilent chacune pour elle-même, côte à côte dans un tableau qui défile à
 * l'horizontale, et des cartes sobres — avatar, nom, étiquettes — dont les
 * actions vivent dans un menu ⋮ plutôt que dans une rangée d'icônes.
 *
 * Le glisser-déposer passe par dnd-kit. Une seule mise en page pour toutes les
 * tailles d'écran : sur téléphone, une colonne occupe presque toute la largeur
 * et le tableau s'aimante colonne par colonne ; un appui long saisit une carte,
 * et l'approcher du bord fait défiler vers la colonne voisine. Le menu de chaque
 * carte offre aussi « Déplacer vers », pour qui ne veut pas glisser.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  MeasuringStrategy,
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS as DndCSS } from '@dnd-kit/utilities';
import { LuEllipsis, LuEllipsisVertical, LuInbox } from 'react-icons/lu';
import { UNKNOWN_STATUS_KEY } from '../../shared/leadStatus';
import { LeadCardInfo, type CardFieldConfig, type LeadSourceOption } from './leads.shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export type KanbanMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Pourquoi l'action est indisponible, ou ce qu'elle fait. */
  hint?: string;
  danger?: boolean;
};

type MenuSection = { title?: string; items: KanbanMenuItem[] };

/** Les identifiants de cartes de chaque colonne, dans l'ordre affiché. */
type Columns = Record<string, string[]>;

// Les colonnes et les cartes partagent l'espace d'identifiants de dnd-kit. Le
// préfixe empêche une clé de statut de jamais se confondre avec un id de prospect.
const COLUMN_PREFIX = 'col:';
const columnDndId = (key: string) => `${COLUMN_PREFIX}${key}`;
const isColumnDndId = (id: UniqueIdentifier) => String(id).startsWith(COLUMN_PREFIX);

/** Le clic qui termine un glisser ne doit pas ouvrir la fiche de la carte lâchée. */
const CLICK_AFTER_DRAG_MS = 300;

// ─── Small hooks ──────────────────────────────────────────────────────────────

const MOBILE_QUERY = '(max-width: 639px)';

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return mobile;
}

/** Arrête un événement avant qu'il n'atteigne la carte (ouverture, glisser). */
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

// ─── Menu ─────────────────────────────────────────────────────────────────────

/**
 * Un menu d'actions : liste déroulante sur ordinateur, feuille montant du bas
 * de l'écran sur téléphone, où une liste ancrée à un bouton de 32 px se ferait
 * couper par le bord ou recouvrir par le doigt.
 *
 * Rendu dans un portail pour échapper au défilement des colonnes. Les portails
 * React laissent pourtant remonter les événements jusqu'à la carte : sans les
 * arrêter, un clic dans le menu ouvrirait aussi la fiche, et un appui long y
 * démarrerait un glisser.
 */
export function KanbanMenu({
  label,
  sheetTitle,
  vertical = true,
  sections,
  trigger,
  triggerClassName,
  disabled,
}: {
  label: string;
  sheetTitle?: string;
  vertical?: boolean;
  /** Lu à l'ouverture seulement : inutile de calculer le menu de chaque carte à chaque rendu. */
  sections: () => MenuSection[];
  /** Contenu du bouton à la place des points de suspension (ex. « Déplacer »). */
  trigger?: ReactNode;
  /** Classes du bouton quand `trigger` est fourni. */
  triggerClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState<MenuSection[] | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobile = useIsMobile();

  const close = useCallback((refocus = false) => {
    setOpen(null);
    setPos(null);
    if (refocus) btnRef.current?.focus();
  }, []);

  /** Place la liste contre son bouton. Faux quand le bouton a quitté l'écran. */
  const place = useCallback((): boolean => {
    const btn = btnRef.current?.getBoundingClientRect();
    const menu = menuRef.current;
    if (!btn || !menu) return false;
    if (btn.bottom < 0 || btn.top > window.innerHeight || btn.right < 0 || btn.left > window.innerWidth) return false;
    const margin = 8;
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const left = Math.min(Math.max(margin, btn.right - w), window.innerWidth - w - margin);
    let top = btn.bottom + 4;
    if (top + h > window.innerHeight - margin) top = Math.max(margin, btn.top - h - 4);
    setPos({ top, left });
    return true;
  }, []);

  useLayoutEffect(() => {
    if (open && !mobile) place();
  }, [open, mobile, place]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true });

    function onPointerDown(e: PointerEvent) {
      // La feuille mobile a son propre fond, qui ferme au clic : fermer dès le
      // `pointerdown` laisserait le clic qui suit atterrir sur la carte dessous.
      if (mobile) return;
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close(true);
    }
    // Le tableau qui défile encore sous le doigt (inertie d'un pavé tactile) ne
    // doit pas refermer le menu qu'on vient d'ouvrir : la liste suit son bouton,
    // et ne se ferme que lorsque celui-ci sort de l'écran.
    function onScroll(e: Event) {
      if (mobile || menuRef.current?.contains(e.target as Node)) return;
      if (!place()) close();
    }
    const onResize = () => close();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, mobile, close, place]);

  // Le `stopPropagation` qui protège la carte empêche aussi la touche d'atteindre
  // l'écouteur de `document` : Échap se traite donc ici.
  function onMenuKeyDown(e: React.KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  const list = open && (
    <div className='space-y-1'>
      {open.map((section, si) => (
        <div key={si} className={si > 0 ? 'border-t border-line pt-1' : undefined}>
          {section.title && (
            <div className='px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted'>
              {section.title}
            </div>
          )}
          {section.items.map(item => (
            <button
              key={item.key}
              type='button'
              role='menuitem'
              disabled={item.disabled}
              title={item.hint}
              onClick={() => {
                close();
                item.onSelect();
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 text-left transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-45 ${
                mobile ? 'py-3 text-[15px]' : 'py-2 text-sm'
              } ${
                item.danger
                  ? 'text-danger hover:bg-red-50 focus:bg-red-50'
                  : 'text-ink hover:bg-canvas-200 focus:bg-canvas-200'
              }`}
            >
              <span className={`flex w-4 shrink-0 justify-center ${item.danger ? '' : 'text-muted'}`}>{item.icon}</span>
              <span className='min-w-0 flex-1'>
                <span className='block truncate'>{item.label}</span>
                {mobile && item.disabled && item.hint && (
                  <span className='block text-xs text-muted'>{item.hint}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <button
        ref={btnRef}
        type='button'
        aria-label={label}
        title={label}
        aria-haspopup='menu'
        aria-expanded={!!open}
        disabled={disabled}
        className={
          trigger
            ? triggerClassName
            : `-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-canvas-200 hover:text-ink sm:-mr-1 sm:-mt-0.5 sm:h-7 sm:w-7 ${
                open ? 'bg-canvas-200 text-ink' : ''
              }`
        }
        onMouseDown={stop}
        onTouchStart={stop}
        onPointerDown={stop}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Escape' && open) close(true);
        }}
        onClick={e => {
          e.stopPropagation();
          if (open) close();
          else setOpen(sections().filter(s => s.items.length > 0));
        }}
      >
        {trigger ?? (vertical ? <LuEllipsisVertical size={16} /> : <LuEllipsis size={16} />)}
      </button>

      {open &&
        createPortal(
          <div
            onClick={stop}
            onMouseDown={stop}
            onTouchStart={stop}
            onPointerDown={stop}
            onKeyDown={onMenuKeyDown}
          >
            {mobile ? (
              <div className='fixed inset-0 z-[45]'>
                <div className='absolute inset-0 bg-ink/40' onClick={() => close()} />
                <div
                  ref={menuRef}
                  role='menu'
                  aria-label={sheetTitle ?? label}
                  className='absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto overscroll-contain rounded-t-2xl bg-white px-2 pt-2 shadow-xl'
                  style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
                >
                  <div className='mx-auto mb-2 h-1 w-10 rounded-full bg-line' />
                  {sheetTitle && (
                    <div className='truncate px-3 pb-2 text-base font-semibold text-ink'>{sheetTitle}</div>
                  )}
                  {list}
                </div>
              </div>
            ) : (
              <div
                ref={menuRef}
                role='menu'
                aria-label={label}
                className='fixed z-[45] max-h-[70vh] w-60 overflow-y-auto rounded-xl border border-line bg-white p-1.5 shadow-card'
                // Mesuré d'abord hors écran, puis placé : la hauteur du menu
                // décide s'il s'ouvre sous le bouton ou au-dessus.
                style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
              >
                {list}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

/** Ce que les cartes lisent sans que leur identité ne change d'un rendu à l'autre. */
type CardHandlers = {
  open: (lead: any) => void;
  toggle: (leadId: string) => void;
  menu: (lead: any) => MenuSection[];
  lastDragEndAt: { current: number };
};

const cardSurface = (opts: { selected?: boolean; checked?: boolean; overlay?: boolean }) =>
  `rounded-xl border bg-white transition-[box-shadow,border-color,background-color] ${
    opts.overlay
      ? 'border-ink/15 shadow-xl rotate-[1.5deg] cursor-grabbing'
      : opts.checked
        ? 'border-accent-500 bg-accent-50'
        : opts.selected
          ? 'border-accent-500 bg-accent-50/60 shadow-card'
          : 'border-line shadow-soft hover:border-ink/20 hover:shadow-card'
  }`;

const SortableCard = memo(function SortableCard({
  lead,
  selected,
  checked,
  selectionMode,
  canMove,
  sources,
  cardFields,
  cardBadges,
  handlers,
}: {
  lead: any;
  selected: boolean;
  checked: boolean;
  selectionMode: boolean;
  canMove: boolean;
  sources?: readonly LeadSourceOption[] | null;
  cardFields?: readonly CardFieldConfig[] | null;
  cardBadges?: (lead: any) => ReactNode;
  handlers: { current: CardHandlers };
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: lead.id,
    data: { type: 'card' },
    disabled: selectionMode || !canMove,
  });

  function activate() {
    if (Date.now() - handlers.current.lastDragEndAt.current < CLICK_AFTER_DRAG_MS) return;
    if (selectionMode) handlers.current.toggle(lead.id);
    else handlers.current.open(lead);
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role='button'
      tabIndex={0}
      aria-label={lead.name}
      // dnd-kit marque la carte désactivée quand le glisser l'est ; en mode
      // sélection elle reste pourtant cliquable.
      aria-disabled={undefined}
      aria-pressed={selectionMode ? checked : undefined}
      data-lead-id={lead.id}
      style={{
        transform: DndCSS.Translate.toString(transform),
        transition,
        // Un appui long sert à saisir la carte : pas de menu contextuel iOS,
        // pas de sélection de texte.
        WebkitTouchCallout: 'none',
        touchAction: 'manipulation',
      }}
      // Un lien ou une image de la carte se glisserait sinon comme un fichier,
      // et le navigateur volerait le geste à dnd-kit.
      onDragStart={e => e.preventDefault()}
      onClick={activate}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
      className={`relative select-none outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 ${
        selectionMode || !canMove ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
      } ${cardSurface({ selected, checked })} ${isDragging ? 'opacity-40' : ''}`}
    >
      <LeadCardInfo
        lead={lead}
        sources={sources}
        cardFields={cardFields}
        badges={cardBadges?.(lead)}
        selection={
          selectionMode ? (
            <input
              type='checkbox'
              checked={checked}
              readOnly
              tabIndex={-1}
              aria-label={`Sélectionner ${lead.name}`}
              className='pointer-events-none mt-2.5 h-[18px] w-[18px] shrink-0 rounded accent-accent-600'
            />
          ) : undefined
        }
        menu={
          selectionMode ? undefined : (
            <KanbanMenu
              label={`Actions — ${lead.name}`}
              sheetTitle={lead.name}
              sections={() => handlers.current.menu(lead)}
            />
          )
        }
      />
    </div>
  );
});

// ─── Column ───────────────────────────────────────────────────────────────────

function ColumnCheckbox({ ids, selectedIds, onSelectMany, label }: {
  ids: string[];
  selectedIds?: Set<string>;
  onSelectMany: (ids: string[], selected: boolean) => void;
  label: string;
}) {
  const picked = ids.filter(id => selectedIds?.has(id)).length;
  const all = ids.length > 0 && picked === ids.length;
  return (
    <input
      type='checkbox'
      aria-label={`Sélectionner toute la colonne ${label}`}
      title='Sélectionner tous les prospects de cette colonne'
      className='h-[18px] w-[18px] shrink-0 cursor-pointer rounded accent-accent-600 disabled:cursor-not-allowed'
      checked={all}
      disabled={ids.length === 0}
      ref={el => { if (el) el.indeterminate = picked > 0 && !all; }}
      onChange={e => onSelectMany(ids, e.target.checked)}
    />
  );
}

function KanbanColumn({
  config,
  ids,
  leadsById,
  statusOf,
  selectedLeadId,
  selectedIds,
  selectionMode,
  canMove,
  onSelectMany,
  sources,
  cardFields,
  cardBadges,
  handlers,
  columnMenu,
  emptyAction,
}: {
  config: { key: string; label: string; color?: string | null };
  ids: string[];
  leadsById: Map<string, any>;
  statusOf: (id: string) => string;
  selectedLeadId?: string | null;
  selectedIds?: Set<string>;
  selectionMode: boolean;
  canMove: boolean;
  onSelectMany?: (ids: string[], selected: boolean) => void;
  sources?: readonly LeadSourceOption[] | null;
  cardFields?: readonly CardFieldConfig[] | null;
  cardBadges?: (lead: any) => ReactNode;
  handlers: { current: CardHandlers };
  columnMenu?: (status: string) => KanbanMenuItem[];
  emptyAction?: (status: string) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnDndId(config.key), data: { type: 'column' } });
  const menuItems = columnMenu?.(config.key) ?? [];

  return (
    <section
      ref={setNodeRef}
      data-column={config.key}
      aria-label={config.label}
      className={`flex h-full w-[calc(100vw-3rem)] max-w-[360px] shrink-0 snap-start snap-always flex-col rounded-2xl border bg-white transition-colors sm:w-[272px] lg:w-[288px] ${
        isOver ? 'border-accent-300 bg-accent-50/40' : 'border-line'
      }`}
    >
      <header className='flex shrink-0 items-center gap-2 px-3.5 pb-2 pt-3'>
        {selectionMode && onSelectMany && (
          <ColumnCheckbox ids={ids} selectedIds={selectedIds} onSelectMany={onSelectMany} label={config.label} />
        )}
        <span className='h-2.5 w-2.5 shrink-0 rounded-full' style={{ backgroundColor: config.color ?? '#6366f1' }} />
        <h3 className='min-w-0 truncate text-[15px] font-semibold text-ink' title={config.label}>
          {config.label}
        </h3>
        <span className='shrink-0 rounded-full bg-canvas-200 px-2 py-0.5 text-xs font-medium text-ink-700'>
          {ids.length}
        </span>
        <span className='ml-auto' />
        {menuItems.length > 0 && (
          <KanbanMenu
            label={`Actions — ${config.label}`}
            sheetTitle={config.label}
            vertical={false}
            sections={() => [{ items: columnMenu?.(config.key) ?? [] }]}
          />
        )}
      </header>

      {/* `overscroll-y` seulement : un `overscroll-contain` sur les deux axes
          garderait pour la colonne le balayage horizontal commencé sur une
          carte, et le tableau ne passerait plus d'une colonne à l'autre. */}
      <div className='min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2.5 pb-2.5'>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className='flex min-h-full flex-col gap-1.5'>
            {ids.map(id => {
              const lead = leadsById.get(id);
              if (!lead) return null;
              const status = statusOf(id);
              // Le statut de la colonne où la carte est affichée, pas celui encore
              // en base : pendant l'enregistrement d'un déplacement, le menu doit
              // déjà proposer ce qui vaut pour sa nouvelle colonne.
              const shown = lead.status === status ? lead : { ...lead, status };
              return (
                <SortableCard
                  key={id}
                  lead={shown}
                  selected={selectedLeadId === id}
                  checked={!!selectedIds?.has(id)}
                  selectionMode={selectionMode}
                  canMove={canMove}
                  sources={sources}
                  cardFields={cardFields}
                  cardBadges={cardBadges}
                  handlers={handlers}
                />
              );
            })}
            {ids.length === 0 && (
              <div className='flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-10 text-center'>
                <LuInbox size={28} className='text-muted/60' />
                <p className='text-sm font-medium text-ink-700'>Aucun prospect</p>
                {canMove && <p className='text-xs text-muted'>Glissez une carte ici</p>}
                {emptyAction?.(config.key)}
              </div>
            )}
          </div>
        </SortableContext>
      </div>
    </section>
  );
}

// ─── Board ────────────────────────────────────────────────────────────────────

function groupByStatus(leads: any[], keys: string[]): Columns {
  const cols: Columns = {};
  for (const k of keys) cols[k] = [];
  for (const l of leads) cols[l.status]?.push(l.id);
  return cols;
}

/**
 * Applique un ordre local (glisser en cours, ou déplacement pas encore relu du
 * serveur) sur les colonnes reçues. Une carte disparue entre-temps — supprimée,
 * masquée par la recherche — en sort ; une carte arrivée entre-temps rejoint sa
 * colonne d'origine au lieu de rester invisible jusqu'à la fin de l'enregistrement.
 */
function reconcile(local: Columns, base: Columns, known: Map<string, any>): Columns {
  const placed = new Set<string>();
  const out: Columns = {};
  for (const key of Object.keys(base)) {
    out[key] = (local[key] ?? []).filter(id => known.has(id) && !placed.has(id) && (placed.add(id), true));
  }
  for (const [key, ids] of Object.entries(base)) {
    for (const id of ids) if (!placed.has(id)) out[key].push(id);
  }
  return out;
}

function findColumn(cols: Columns, id: UniqueIdentifier): string | undefined {
  const s = String(id);
  if (s.startsWith(COLUMN_PREFIX)) {
    const key = s.slice(COLUMN_PREFIX.length);
    return key in cols ? key : undefined;
  }
  return Object.keys(cols).find(k => cols[k].includes(s));
}

const sameIds = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((id, i) => id === b[i]);

export function LeadKanbanBoard({
  leads,
  statusConfigs,
  sources,
  cardFields,
  updateStatus,
  reorder,
  refetch,
  cardMenu,
  cardBadges,
  columnMenu,
  emptyColumnAction,
  toolbar,
  onCardClick,
  selectedLeadId,
  selectionMode = false,
  canMove = true,
  selectedIds,
  onToggleSelect,
  onSelectMany,
}: {
  /** Prospects à afficher, déjà filtrés, dans l'ordre enregistré. */
  leads: any[];
  statusConfigs: { key: string; label: string; color?: string | null }[];
  /** Le registre des provenances, pour l'étiquette des cartes. */
  sources?: readonly LeadSourceOption[] | null;
  /** Les champs à afficher sur les cartes, résolus pour ce tableau. */
  cardFields?: readonly CardFieldConfig[] | null;
  /** Appel serveur seulement — ni toast ni rafraîchissement. Lève en cas d'erreur. */
  updateStatus: (leadId: string, newStatus: string) => Promise<unknown>;
  /**
   * Enregistre l'ordre d'une colonne, `orderedIds` étant la colonne telle
   * qu'affichée. Appel serveur seulement. Lève en cas d'erreur.
   */
  reorder?: (status: string, orderedIds: string[]) => Promise<unknown>;
  /** Peut rendre une promesse : le tableau garde son ordre local jusqu'à ce qu'elle se résolve. */
  refetch: () => unknown;
  /** Les actions propres à l'appelant ; « Déplacer vers » est ajouté par le tableau. */
  cardMenu: (lead: any) => KanbanMenuItem[];
  /** Étiquettes d'état d'une carte (`LeadChip`). */
  cardBadges?: (lead: any) => ReactNode;
  /** Le menu ⋯ d'une colonne. Vide = pas de bouton. */
  columnMenu?: (status: string) => KanbanMenuItem[];
  /** Action proposée dans une colonne vide (ex. « Ajouter un prospect »). */
  emptyColumnAction?: (status: string) => ReactNode;
  /** Rendu au-dessus du tableau : recherche, filtres, actions groupées. */
  toolbar?: ReactNode;
  onCardClick?: (lead: any) => void;
  /** Met en évidence la carte affichée dans le panneau latéral. */
  selectedLeadId?: string | null;
  /** En mode sélection, un clic coche la carte et le glisser est désactivé. */
  selectionMode?: boolean;
  /** Faux : les cartes ne se glissent pas et le menu n'offre pas « Déplacer vers ». */
  canMove?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (leadId: string) => void;
  onSelectMany?: (leadIds: string[], selected: boolean) => void;
}) {
  const statusKeys = useMemo(() => statusConfigs.map(c => c.key), [statusConfigs]);
  const leadsById = useMemo(() => new Map(leads.map(l => [l.id as string, l])), [leads]);
  const baseColumns = useMemo(() => groupByStatus(leads, statusKeys), [leads, statusKeys]);

  // L'ordre local : posé au début d'un glisser, gardé tant qu'un déplacement
  // n'est pas relu du serveur. Sans lui, la carte lâchée retournerait à son
  // ancienne place le temps de l'aller-retour, puis sauterait à la nouvelle.
  const [local, setLocal] = useState<Columns | null>(null);
  const columns = useMemo(
    () => (local ? reconcile(local, baseColumns, leadsById) : baseColumns),
    [local, baseColumns, leadsById],
  );
  // Les gestionnaires de dnd-kit s'enchaînent plus vite que les rendus : ils
  // lisent et écrivent cette copie, toujours à jour.
  const liveColumns = useRef(columns);
  liveColumns.current = columns;
  function commit(next: Columns) {
    liveColumns.current = next;
    setLocal(next);
  }

  const [activeId, setActiveId] = useState<string | null>(null);
  const dragOrigin = useRef<{ status: string; columns: Columns } | null>(null);
  const lastOverId = useRef<UniqueIdentifier | null>(null);
  const movedToNewColumn = useRef(false);
  const pendingWrites = useRef(0);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());

  const refs = useRef({ updateStatus, reorder, refetch, onCardClick, onToggleSelect, cardMenu, statusConfigs, canMove });
  refs.current = { updateStatus, reorder, refetch, onCardClick, onToggleSelect, cardMenu, statusConfigs, canMove };

  /** Rend la main aux données du serveur quand plus rien n'est en vol. */
  function settle() {
    if (pendingWrites.current === 0 && !dragOrigin.current) setLocal(null);
  }

  // Un déplacement à la fois : chacun relit la colonne côté serveur, deux
  // allers-retours qui se chevauchent écriraient sur un ordre périmé.
  function persist(leadId: string, from: string, to: string, targetIds: string[]) {
    pendingWrites.current++;
    writeQueue.current = writeQueue.current
      .then(async () => {
        try {
          if (from !== to) await refs.current.updateStatus(leadId, to);
          // Sans l'ordre, la carte reprendrait au prochain rafraîchissement la
          // place que lui donne son ancien rang, pas celle où on l'a lâchée.
          if (refs.current.reorder) await refs.current.reorder(to, targetIds);
        } catch {
          toast.error(from !== to ? 'Erreur lors de la mise à jour du statut' : "Erreur lors de la mise à jour de l'ordre");
        }
        try {
          await refs.current.refetch();
        } catch {
          // Le prochain rafraîchissement rattrapera.
        }
      })
      .catch(() => {})
      .finally(() => {
        pendingWrites.current--;
        settle();
      });
  }

  function moveTo(leadId: string, to: string) {
    const cols = liveColumns.current;
    const from = findColumn(cols, leadId);
    if (!from || from === to || !(to in cols)) return;
    // En tête de la colonne d'arrivée, là où l'œil la cherche.
    const next = { ...cols, [from]: cols[from].filter(id => id !== leadId), [to]: [leadId, ...cols[to]] };
    commit(next);
    persist(leadId, from, to, next[to]);
    const label = refs.current.statusConfigs.find(c => c.key === to)?.label ?? to;
    toast.success(`Déplacé vers « ${label} »`);
  }

  const lastDragEndAt = useRef(0);
  const handlers = useRef<CardHandlers>(null as unknown as CardHandlers);
  handlers.current = {
    lastDragEndAt,
    open: lead => refs.current.onCardClick?.(lead),
    toggle: id => refs.current.onToggleSelect?.(id),
    menu: lead => {
      const current = findColumn(liveColumns.current, lead.id) ?? lead.status;
      const targets = refs.current.statusConfigs.filter(s => s.key !== current && s.key !== UNKNOWN_STATUS_KEY);
      const items = refs.current.cardMenu(lead);
      if (!refs.current.canMove) return [{ items }];
      return [
        { items },
        {
          title: 'Déplacer vers',
          items: targets.map(s => ({
            key: `move:${s.key}`,
            label: s.label,
            icon: <span className='h-2.5 w-2.5 rounded-full' style={{ backgroundColor: s.color ?? '#6366f1' }} />,
            onSelect: () => moveTo(lead.id, s.key),
          })),
        },
      ];
    },
  };

  const statusOf = useCallback((id: string) => findColumn(columns, id) ?? '', [columns]);

  // ── dnd-kit ────────────────────────────────────────────────────────────────

  const sensors = useSensors(
    // Souris : quelques pixels avant de saisir, pour qu'un clic reste un clic.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Tactile : un appui long. Un doigt qui bouge avant le délai fait défiler.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  /**
   * Le pointeur d'abord, puis l'intersection : au-dessus d'une colonne, la carte
   * la plus proche du centre dans cette colonne. Retenir la dernière cible quand
   * plus rien ne touche évite qu'une carte qui vient de changer de colonne ne
   * rebondisse vers celle qu'elle quitte pendant que les mesures se refont.
   */
  const collisionDetection: CollisionDetection = useCallback(
    args => {
      const pointer = pointerWithin(args);
      const hits = pointer.length > 0 ? pointer : rectIntersection(args);
      let overId = getFirstCollision(hits, 'id');
      if (overId != null) {
        if (isColumnDndId(overId)) {
          const key = String(overId).slice(COLUMN_PREFIX.length);
          const items = liveColumns.current[key] ?? [];
          if (items.length > 0) {
            const closest = closestCenter({
              ...args,
              droppableContainers: args.droppableContainers.filter(c => items.includes(String(c.id))),
            });
            overId = closest[0]?.id ?? overId;
          }
        }
        lastOverId.current = overId;
        return [{ id: overId }];
      }
      if (movedToNewColumn.current) lastOverId.current = activeId;
      return lastOverId.current != null ? [{ id: lastOverId.current }] : [];
    },
    [activeId],
  );

  useEffect(() => {
    const raf = requestAnimationFrame(() => { movedToNewColumn.current = false; });
    return () => cancelAnimationFrame(raf);
  }, [columns]);

  function handleDragStart({ active, activatorEvent }: DragStartEvent) {
    const id = String(active.id);
    const snapshot = liveColumns.current;
    const status = findColumn(snapshot, id);
    if (!status) return;
    dragOrigin.current = { status, columns: snapshot };
    commit(snapshot);
    setActiveId(id);
    // Sur téléphone, confirme que l'appui long a bien saisi la carte.
    if (typeof TouchEvent !== 'undefined' && activatorEvent instanceof TouchEvent && 'vibrate' in navigator) {
      try { navigator.vibrate(8); } catch { /* non pris en charge */ }
    }
  }

  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const cols = liveColumns.current;
    const from = findColumn(cols, active.id);
    const to = findColumn(cols, over.id);
    if (!from || !to || from === to) return;

    const toItems = cols[to];
    let index = toItems.length;
    if (!isColumnDndId(over.id)) {
      const overIndex = toItems.indexOf(String(over.id));
      const translated = active.rect.current.translated;
      const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
      index = overIndex >= 0 ? overIndex + (below ? 1 : 0) : toItems.length;
    }
    movedToNewColumn.current = true;
    const id = String(active.id);
    commit({
      ...cols,
      [from]: cols[from].filter(x => x !== id),
      [to]: [...toItems.slice(0, index), id, ...toItems.slice(index)],
    });
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    const origin = dragOrigin.current;
    dragOrigin.current = null;
    setActiveId(null);
    lastDragEndAt.current = Date.now();
    if (!origin) return;

    const id = String(active.id);
    let cols = liveColumns.current;
    const to = findColumn(cols, id);
    if (!to || !over) {
      commit(origin.columns);
      settle();
      return;
    }

    // Dans une même colonne, dnd-kit n'a fait que décaler visuellement : l'ordre
    // se fixe ici.
    if (!isColumnDndId(over.id)) {
      const overColumn = findColumn(cols, over.id);
      if (overColumn === to) {
        const items = cols[to];
        const from = items.indexOf(id);
        const target = items.indexOf(String(over.id));
        if (from !== target && target >= 0) cols = { ...cols, [to]: arrayMove(items, from, target) };
      }
    }

    // Relâchée où elle était : rien à écrire, et surtout pas de rafraîchissement
    // qui ferait clignoter le tableau pour rien.
    if (to === origin.status && sameIds(cols[to], origin.columns[to])) {
      commit(origin.columns);
      settle();
      return;
    }

    commit(cols);
    persist(id, origin.status, to, cols[to]);
  }

  function handleDragCancel() {
    const origin = dragOrigin.current;
    dragOrigin.current = null;
    setActiveId(null);
    lastDragEndAt.current = Date.now();
    if (origin) commit(origin.columns);
    settle();
  }

  // ── Mise en page ───────────────────────────────────────────────────────────

  const boardRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [activeColumn, setActiveColumn] = useState(0);

  // Le tableau occupe ce qui reste de l'écran sous l'en-tête, et ce sont les
  // colonnes qui défilent, pas la page : comme sur Facebook, l'en-tête de chaque
  // colonne reste en vue jusqu'à la dernière carte.
  //
  // Quand il reste trop peu de place — un téléphone, un écran d'ordinateur bas —
  // le tableau prend presque toute la hauteur de l'écran et la page défile
  // jusqu'à lui. Le serrer dans le reste ne laisserait voir qu'une carte, et le
  // défilement automatique du glisser s'enclencherait partout.
  useLayoutEffect(() => {
    function measure() {
      const el = boardRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const main = el.closest('main');
      const bottom = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 16;
      const fill = Math.floor(window.innerHeight - top - bottom);
      const next = fill >= 400 ? fill : Math.max(420, window.innerHeight - 140);
      setHeight(h => (h === next ? h : next));
    }
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(document.body);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, []);

  // La pastille active du sélecteur de colonnes (téléphone) suit le défilement.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    function onScroll() {
      const sections = Array.from(el!.querySelectorAll<HTMLElement>('section[data-column]'));
      const left = el!.scrollLeft;
      let best = 0;
      sections.forEach((s, i) => {
        if (Math.abs(s.offsetLeft - el!.offsetLeft - left) < Math.abs(sections[best].offsetLeft - el!.offsetLeft - left)) best = i;
      });
      setActiveColumn(best);
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const strip = stripRef.current;
    const pill = strip?.children[activeColumn] as HTMLElement | undefined;
    if (!strip || !pill) return;
    const target = pill.offsetLeft - strip.offsetLeft - (strip.clientWidth - pill.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [activeColumn]);

  function scrollToColumn(index: number) {
    const board = boardRef.current;
    const section = board?.querySelectorAll<HTMLElement>('section[data-column]')[index];
    if (!board || !section) return;
    // `scroll-padding` du tableau : l'aimantation et ce calcul tombent au même endroit.
    const pad = parseFloat(getComputedStyle(board).scrollPaddingLeft) || 0;
    board.scrollTo({ left: section.offsetLeft - board.offsetLeft - pad, behavior: 'smooth' });
  }

  const activeLead = activeId ? leadsById.get(activeId) : null;
  const dragging = activeId !== null;

  if (statusConfigs.length === 0) {
    return <div className='py-8 text-center text-sm text-muted'>Chargement des statuts…</div>;
  }

  return (
    <div>
      {toolbar}

      {/* Sélecteur de colonnes — téléphone : une colonne à l'écran à la fois. */}
      <div
        ref={stripRef}
        className='no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 sm:hidden'
        role='tablist'
        aria-label='Colonnes'
      >
        {statusConfigs.map((c, i) => (
          <button
            key={c.key}
            type='button'
            role='tab'
            aria-selected={activeColumn === i}
            onClick={() => scrollToColumn(i)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              activeColumn === i ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-700'
            }`}
          >
            <span className='h-2 w-2 rounded-full' style={{ backgroundColor: c.color ?? '#6366f1' }} />
            <span className='max-w-[9rem] truncate'>{c.label}</span>
            <span className={activeColumn === i ? 'text-white/70' : 'text-muted'}>{columns[c.key]?.length ?? 0}</span>
          </button>
        ))}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          ref={boardRef}
          data-kanban-board
          // L'aimantation est coupée pendant un glisser : elle se battrait avec le
          // défilement automatique qui amène la colonne voisine sous la carte.
          className={`-mx-4 flex scroll-px-4 gap-2.5 overflow-x-auto overscroll-x-contain px-4 pb-1 sm:scroll-px-0 ${
            dragging ? '' : 'snap-x snap-mandatory sm:snap-none'
          }`}
          style={{ height: height ?? undefined }}
        >
          {statusConfigs.map(c => (
            <KanbanColumn
              key={c.key}
              config={c}
              ids={columns[c.key] ?? []}
              leadsById={leadsById}
              statusOf={statusOf}
              selectedLeadId={selectedLeadId}
              selectedIds={selectedIds}
              selectionMode={selectionMode}
              canMove={canMove}
              onSelectMany={onSelectMany}
              sources={sources}
              cardFields={cardFields}
              cardBadges={cardBadges}
              handlers={handlers}
              columnMenu={columnMenu}
              emptyAction={emptyColumnAction}
            />
          ))}
          {/* Marge de fin : `padding-right` d'un conteneur qui défile est ignorée
              par certains navigateurs, la dernière colonne collerait au bord. */}
          <div className='w-px shrink-0' aria-hidden />
        </div>

        {createPortal(
          <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
            {activeLead ? (
              <div className={cardSurface({ overlay: true })}>
                <LeadCardInfo
                  lead={activeLead}
                  sources={sources}
                  cardFields={cardFields}
                  badges={cardBadges?.(activeLead)}
                  menu={
                    <span className='-mr-1 -mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center text-muted'>
                      <LuEllipsisVertical size={16} />
                    </span>
                  }
                />
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </div>
  );
}

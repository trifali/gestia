/**
 * Qui s'occupe de quelle carte.
 *
 * Une couleur par personne, la même partout — bande sur le bord de la carte,
 * pastille en pied, filtre, fiche, auteur d'une note — pour qu'un coup d'œil sur
 * le tableau suffise à voir qui fait quoi. Les personnes ne sont pas une liste à
 * entretenir : ce sont celles qui ont des cartes en ce moment, plus soi.
 *
 * Sur un lien de partage, « soi » est un surnom retenu par le navigateur de
 * l'appareil (voir `usePortalNickname`). Dans l'application, c'est le nom de
 * l'entreprise, que le serveur renvoie avec le tableau.
 *
 * On ne confie une carte qu'à quelqu'un qui existe déjà : soi, ou une personne
 * qui a des cartes sur le tableau. Aucun nom ne se tape pour autrui — un nom
 * nouveau n'entre que par la personne elle-même, en se présentant. Le serveur
 * applique la même règle (voir `writeAssignee`).
 *
 * Tout passe par `AssigneeProvider`, posé une fois au-dessus du tableau et de la
 * fiche : la carte, le menu, la fiche et le filtre lisent les mêmes personnes et
 * les mêmes couleurs, et prendre une carte s'écrit à un seul endroit.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { LuCheck, LuHand, LuPencil, LuUserMinus, LuUserRound, LuUsers } from 'react-icons/lu';
import { Modal } from '../../client/ui';
import { readPref, writePref } from '../../client/localPref';
import {
  MAX_ASSIGNEE_CHARS,
  assigneeKey,
  normalizeAssigneeName,
  sameAssignee,
} from '../../shared/leadAssignee';
import type { KanbanMenuItem } from './LeadKanbanBoard';

// ─── Couleurs ─────────────────────────────────────────────────────────────────

// Dix teintes franches, lisibles en blanc, et aucune proche de l'orange de la
// marque — réservé ici au point « jamais ouvert » — ni du rouge des alertes.
const PALETTE = [
  '#2563EB', '#16A34A', '#9333EA', '#DB2777', '#0891B2',
  '#B45309', '#4F46E5', '#0D9488', '#65A30D', '#C026D3',
];

function hashIndex(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % PALETTE.length;
}

/** Hors d'un tableau (aperçu, historique) : la couleur que donne le nom seul. */
export function fallbackAssigneeColor(name: string): string {
  return PALETTE[hashIndex(assigneeKey(name))];
}

export function initialsOfPerson(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// ─── Personnes du tableau ─────────────────────────────────────────────────────

export type AssigneePerson = {
  key: string;
  name: string;
  /** Cartes qu'elle a sur le tableau entier. */
  count: number;
  color: string;
};

type LeadLike = { id: string; assignee?: string | null; assignedAt?: string | Date | null };

/**
 * Les personnes et leurs couleurs.
 *
 * Deux personnes d'un même tableau n'ont jamais la même couleur tant qu'il en
 * reste : la couleur que donne le nom d'abord, la suivante libre sinon. Les
 * premières arrivées choisissent en premier, si bien que l'arrivée d'un nouveau
 * ne repeint personne.
 */
function buildPeople(leads: LeadLike[], me: string | null): AssigneePerson[] {
  const byKey = new Map<string, { name: string; count: number; since: number }>();
  for (const l of leads) {
    if (!l.assignee) continue;
    const key = assigneeKey(l.assignee);
    const since = l.assignedAt ? new Date(l.assignedAt).getTime() : Number.MAX_SAFE_INTEGER;
    const entry = byKey.get(key);
    if (entry) {
      entry.count++;
      entry.since = Math.min(entry.since, since);
    } else {
      byKey.set(key, { name: l.assignee, count: 1, since });
    }
  }
  if (me && !byKey.has(assigneeKey(me))) {
    byKey.set(assigneeKey(me), { name: me, count: 0, since: Number.MAX_SAFE_INTEGER });
  }

  const taken = new Set<number>();
  const colors = new Map<string, string>();
  const bySeniority = [...byKey.entries()].sort((a, b) => a[1].since - b[1].since || a[0].localeCompare(b[0]));
  for (const [key] of bySeniority) {
    let i = hashIndex(key);
    for (let step = 0; step < PALETTE.length && taken.has(i); step++) i = (i + 1) % PALETTE.length;
    taken.add(i);
    colors.set(key, PALETTE[i]);
  }

  const meKey = me ? assigneeKey(me) : null;
  return [...byKey.entries()]
    .map(([key, v]) => ({ key, name: v.name, count: v.count, color: colors.get(key)! }))
    // Soi d'abord, puis qui porte le plus de cartes.
    .sort((a, b) =>
      Number(b.key === meKey) - Number(a.key === meKey) || b.count - a.count || a.name.localeCompare(b.name, 'fr'),
    );
}

// ─── Contexte ─────────────────────────────────────────────────────────────────

type AssigneeContextValue = {
  me: string | null;
  people: AssigneePerson[];
  canAssign: boolean;
  colorOf: (name: string) => string;
  isMe: (name: string | null | undefined) => boolean;
  /** Prendre la carte, en demandant d'abord son nom à qui ne s'est pas présenté. */
  claim: (lead: LeadLike) => Promise<void>;
  assignTo: (lead: LeadLike, name: string | null) => Promise<void>;
  assignMany: (leads: LeadLike[], name: string | null) => Promise<void>;
  /** La section « Responsable » du menu ⋮ d'une carte. */
  menuSection: (lead: LeadLike) => { title: string; items: KanbanMenuItem[] } | null;
  /** Les mêmes choix pour une sélection. */
  bulkItems: (leads: LeadLike[]) => KanbanMenuItem[];
  /** Changer de nom — sur un lien de partage seulement. */
  editMe?: () => void;
};

const AssigneeContext = createContext<AssigneeContextValue | null>(null);

export function useAssignees(): AssigneeContextValue | null {
  return useContext(AssigneeContext);
}

export function AssigneeProvider({
  leads,
  me,
  canAssign,
  assign,
  onChanged,
  requestMe,
  editMe,
  children,
}: {
  /** Toutes les cartes du tableau, filtres ignorés : ce sont elles qui font la liste des personnes. */
  leads: LeadLike[];
  me: string | null;
  canAssign: boolean;
  /**
   * L'appel serveur. `null` libère la carte. `self` : on se la donne à soi —
   * le seul cas où le nom peut ne pas encore exister sur le tableau.
   */
  assign: (leadId: string, name: string | null, self: boolean) => Promise<unknown>;
  onChanged: () => unknown;
  /** Demande son nom à qui ne s'est pas présenté. Absent : `me` est toujours connu. */
  requestMe?: () => Promise<string | null>;
  editMe?: () => void;
  children: ReactNode;
}) {
  const people = useMemo(() => buildPeople(leads, me), [leads, me]);
  // Les rappels changent à chaque rendu de l'appelant ; le contexte, lui, ne
  // doit changer qu'avec les personnes — chaque carte du tableau le lit.
  const calls = useRef({ assign, onChanged, requestMe, editMe });
  calls.current = { assign, onChanged, requestMe, editMe };
  const hasRequestMe = !!requestMe;
  const hasEditMe = !!editMe;

  const value = useMemo<AssigneeContextValue>(() => {
    const colorByKey = new Map(people.map(p => [p.key, p.color]));
    const colorOf = (name: string) => colorByKey.get(assigneeKey(name)) ?? fallbackAssigneeColor(name);
    const isMe = (name: string | null | undefined) => sameAssignee(name, me);

    async function assignMany(targets: LeadLike[], name: string | null) {
      const moving = targets.filter(l => (name ? !sameAssignee(l.assignee, name) : !!l.assignee));
      if (moving.length === 0) return;
      try {
        const self = !!name && sameAssignee(name, me);
        const results = await Promise.allSettled(moving.map(l => calls.current.assign(l.id, name, self)));
        const failed = results.filter(r => r.status === 'rejected').length;
        if (failed) toast.error(`${failed} attribution(s) en échec`);
        else if (moving.length > 1) {
          toast.success(name
            ? `${moving.length} cartes confiées à ${sameAssignee(name, me) ? 'vous' : name}`
            : `${moving.length} cartes libérées`);
        }
      } finally {
        await calls.current.onChanged();
      }
    }

    function personItems(targets: LeadLike[]): KanbanMenuItem[] {
      const single = targets.length === 1 ? targets[0] : null;
      const items: KanbanMenuItem[] = [];
      if (!me && hasRequestMe) {
        items.push({
          key: 'assign:claim',
          label: 'Je m’en occupe',
          icon: <LuHand size={15} />,
          onSelect: () => { void claimMany(targets); },
        });
      }
      for (const p of people) {
        const current = !!single && sameAssignee(single.assignee, p.name);
        items.push({
          key: `assign:${p.key}`,
          label: sameAssignee(p.name, me) ? `${p.name} (vous)` : p.name,
          icon: current
            ? <LuCheck size={15} style={{ color: p.color }} />
            : <span className='h-2.5 w-2.5 rounded-full' style={{ backgroundColor: p.color }} />,
          disabled: current,
          onSelect: () => { void assignMany(targets, p.name); },
        });
      }
      if (targets.some(l => l.assignee)) {
        items.push({
          key: 'assign:none',
          label: targets.length > 1 ? 'Libérer les cartes' : 'Libérer la carte',
          icon: <LuUserMinus size={15} />,
          onSelect: () => { void assignMany(targets, null); },
        });
      }
      return items;
    }

    async function claimMany(targets: LeadLike[]) {
      if (me) return assignMany(targets, me);
      // Qui vient de se présenter : `me` ne le sait pas encore dans ce rendu.
      const name = (await calls.current.requestMe?.()) ?? null;
      if (!name) return;
      try {
        const results = await Promise.allSettled(targets.map(l => calls.current.assign(l.id, name, true)));
        if (results.some(r => r.status === 'rejected')) toast.error('Attribution en échec');
      } finally {
        await calls.current.onChanged();
      }
    }
    const claim = (lead: LeadLike) => claimMany([lead]);

    return {
      me,
      people,
      canAssign,
      colorOf,
      isMe,
      claim,
      assignTo: (lead, name) => assignMany([lead], name),
      assignMany,
      menuSection: lead => {
        const items = canAssign ? personItems([lead]) : [];
        return items.length ? { title: 'Responsable', items } : null;
      },
      bulkItems: targets => (canAssign ? personItems(targets) : []),
      editMe: hasEditMe ? () => calls.current.editMe?.() : undefined,
    };
  }, [people, me, canAssign, hasRequestMe, hasEditMe]);

  return (
    <AssigneeContext.Provider value={value}>
      {children}
    </AssigneeContext.Provider>
  );
}

// ─── Pastilles ────────────────────────────────────────────────────────────────

export function AssigneeAvatar({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  const ctx = useAssignees();
  return (
    <span
      aria-hidden
      className='flex shrink-0 items-center justify-center rounded-full font-semibold text-white'
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.42)),
        backgroundColor: color ?? ctx?.colorOf(name) ?? fallbackAssigneeColor(name),
      }}
    >
      {initialsOfPerson(name)}
    </span>
  );
}

/** « ● Marie », ou « ● Vous » pour ses propres cartes — ce qu'on cherche en premier. */
export function AssigneeTag({ name, since }: { name: string; since?: string | Date | null }) {
  const ctx = useAssignees();
  const mine = !!ctx?.isMe(name);
  const color = ctx?.colorOf(name) ?? fallbackAssigneeColor(name);
  const sinceLabel = since
    ? new Date(since).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })
    : null;
  return (
    <span
      className='inline-flex min-w-0 max-w-full items-center gap-1 rounded-full py-px pl-px pr-2 text-[11px] font-semibold leading-[18px]'
      style={{ backgroundColor: `${color}1A`, color }}
      title={`${mine ? 'Vous vous en occupez' : `${name} s’en occupe`}${sinceLabel ? ` depuis le ${sinceLabel}` : ''}`}
    >
      <AssigneeAvatar name={name} size={18} color={color} />
      <span className='truncate'>{mine ? 'Vous' : name}</span>
    </span>
  );
}

/** La bande colorée du bord gauche d'une carte : se lit de loin, colonne par colonne. */
export function AssigneeStripe({ name }: { name: string }) {
  const ctx = useAssignees();
  return (
    <span
      aria-hidden
      className='pointer-events-none absolute inset-y-2 left-0 w-[3px] rounded-r-full'
      style={{ backgroundColor: ctx?.colorOf(name) ?? fallbackAssigneeColor(name) }}
    />
  );
}

// ─── Fiche ────────────────────────────────────────────────────────────────────

/** Le bloc « Responsable » de la fiche : qui s'en occupe, et de quoi changer d'un geste. */
export function AssigneeField({ lead }: { lead: LeadLike }) {
  const ctx = useAssignees();
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  useEffect(() => setChoosing(false), [lead.id]);
  if (!ctx) return null;
  const { assignee } = lead;
  if (!assignee && !ctx.canAssign) return null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  const mine = ctx.isMe(assignee);
  // À qui d'autre la confier : les personnes du tableau, ni soi (« Je m'en
  // occupe » est juste à côté) ni celle qui l'a déjà. Personne : pas de bouton.
  const others = ctx.people.filter(p => p.count > 0 && !ctx.isMe(p.name) && !sameAssignee(p.name, assignee));
  return (
    <div className='mt-3'>
      <div className='mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted'>Responsable</div>
      <div className='flex flex-wrap items-center gap-2'>
        {assignee ? <AssigneeTag name={assignee} since={lead.assignedAt} /> : (
          <span className='text-[13px] text-muted'>Personne pour l’instant</span>
        )}
        {ctx.canAssign && (
          <>
            {!mine && (
              <button
                type='button'
                className='btn-secondary h-8 gap-1.5 px-2.5 text-[13px]'
                disabled={busy}
                onClick={() => run(() => ctx.claim(lead))}
              >
                <LuHand size={13} />
                {assignee ? 'Je prends le relais' : 'Je m’en occupe'}
              </button>
            )}
            {others.length > 0 && (
              <button
                type='button'
                className={`h-8 gap-1.5 px-2.5 text-[13px] ${choosing ? 'btn-primary' : 'btn-secondary'}`}
                disabled={busy}
                aria-expanded={choosing}
                onClick={() => setChoosing(c => !c)}
              >
                <LuUsers size={13} />
                Confier…
              </button>
            )}
            {assignee && (
              <button
                type='button'
                className='h-8 rounded-lg px-2 text-[13px] text-muted hover:bg-canvas-200 hover:text-ink'
                disabled={busy}
                onClick={() => run(() => ctx.assignTo(lead, null))}
              >
                Libérer
              </button>
            )}
          </>
        )}
      </div>
      {choosing && others.length > 0 && (
        <div className='mt-2 flex flex-wrap gap-1.5'>
          {others.map(p => (
            <button
              key={p.key}
              type='button'
              disabled={busy}
              onClick={() => run(async () => { await ctx.assignTo(lead, p.name); setChoosing(false); })}
              className='inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-white pl-1 pr-2.5 text-[13px] text-ink-700 transition-colors hover:border-ink/30 disabled:opacity-60'
            >
              <AssigneeAvatar name={p.name} size={24} color={p.color} />
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Filtre ───────────────────────────────────────────────────────────────────

export const ASSIGNEE_FILTER_ME = '@me';
export const ASSIGNEE_FILTER_NONE = '@none';

/**
 * Le filtre « qui » d'un tableau, retenu par le navigateur, tableau par tableau.
 *
 * La valeur retenue n'est appliquée que si elle a encore un sens : une personne
 * qui n'a plus aucune carte disparaît de la liste, et le filtre qui la visait
 * retombe sur « Tout le monde » plutôt que d'ouvrir un tableau vide.
 */
export function useAssigneeFilter(searchId: string | null | undefined) {
  const ctx = useAssignees();
  const prefKey = `leadAssignee.${searchId ?? ''}`;
  const [stored, setStored] = useState<string>(() => (searchId ? readPref(prefKey) ?? '' : ''));
  useEffect(() => {
    setStored(searchId ? readPref(prefKey) ?? '' : '');
  }, [prefKey]);

  const people = ctx?.people ?? [];
  const value =
    stored === ASSIGNEE_FILTER_ME ? (ctx?.me ? stored : '')
      : stored === ASSIGNEE_FILTER_NONE || stored === '' ? stored
      : people.some(p => p.key === stored && p.count > 0) ? stored
      : '';

  function setValue(next: string) {
    setStored(next);
    if (searchId) writePref(prefKey, next);
  }

  function apply<T extends LeadLike>(leads: T[]): T[] {
    if (!value) return leads;
    if (value === ASSIGNEE_FILTER_NONE) return leads.filter(l => !l.assignee);
    const key = value === ASSIGNEE_FILTER_ME ? (ctx?.me ? assigneeKey(ctx.me) : '') : value;
    return leads.filter(l => !!l.assignee && assigneeKey(l.assignee) === key);
  }

  return { value, setValue, apply };
}

/**
 * La rangée de filtres « qui » : Tout le monde · Mes cartes · chaque personne ·
 * Non attribuées, avec leur nombre de cartes. Elle sert aussi de légende des
 * couleurs du tableau.
 *
 * `leads` : les cartes que les autres filtres laissent passer, pour que les
 * nombres s'additionnent à ce qu'on voit.
 */
export function AssigneeFilterBar({
  leads,
  value,
  onChange,
}: {
  leads: LeadLike[];
  value: string;
  onChange: (next: string) => void;
}) {
  const ctx = useAssignees();
  if (!ctx) return null;
  const { people, me } = ctx;
  // Rien à montrer tant que personne n'a pris de carte : la rangée apparaît avec
  // la première attribution.
  if (!people.some(p => p.count > 0)) return null;

  const counts = new Map<string, number>();
  let none = 0;
  for (const l of leads) {
    if (!l.assignee) { none++; continue; }
    const key = assigneeKey(l.assignee);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const meKey = me ? assigneeKey(me) : null;

  const chip = (key: string, label: ReactNode, count: number, opts: { color?: string; icon?: ReactNode } = {}) => {
    const active = value === key;
    return (
      <button
        key={key || 'all'}
        type='button'
        onClick={() => onChange(active && key ? '' : key)}
        aria-pressed={active}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border pl-1 pr-2.5 text-[13px] font-medium transition-colors ${
          active ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-700 hover:border-ink/30'
        }`}
      >
        {opts.icon ?? <span className='w-1' />}
        <span className='max-w-[9rem] truncate'>{label}</span>
        <span className={`tabular-nums ${active ? 'text-white/70' : 'text-muted'}`}>{count}</span>
      </button>
    );
  };

  const others = people.filter(p => p.key !== meKey && ((counts.get(p.key) ?? 0) > 0 || value === p.key));
  const mePerson = meKey ? people.find(p => p.key === meKey) : undefined;

  return (
    <div className='-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]'>
      {chip('', 'Tout le monde', leads.length, {
        icon: <span className='flex h-6 w-6 items-center justify-center rounded-full bg-canvas-200 text-ink-700'><LuUsers size={13} /></span>,
      })}
      {mePerson && chip(ASSIGNEE_FILTER_ME, 'Mes cartes', counts.get(mePerson.key) ?? 0, {
        icon: <AssigneeAvatar name={mePerson.name} size={24} color={mePerson.color} />,
      })}
      {others.map(p => chip(p.key, p.name, counts.get(p.key) ?? 0, {
        icon: <AssigneeAvatar name={p.name} size={24} color={p.color} />,
      }))}
      {chip(ASSIGNEE_FILTER_NONE, 'Non attribuées', none, {
        icon: <span className='flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-ink/25 text-muted'><LuUserRound size={12} /></span>,
      })}
    </div>
  );
}

// ─── Saisie d'un nom ──────────────────────────────────────────────────────────

/**
 * Un nom, choisi parmi les personnes du tableau ou saisi.
 *
 * Saisir le nom de quelqu'un qui a déjà des cartes n'est pas une erreur — c'est
 * souvent la même personne sur un autre appareil — mais mérite d'être dit :
 * deux Marc qui se partagent un nom se partagent aussi leurs cartes.
 */
function NameForm({
  people,
  me,
  initial = '',
  submitLabel,
  intro,
  cancelLabel = 'Annuler',
  onSubmit,
  onCancel,
  warnOnExisting = false,
  footer,
}: {
  people: AssigneePerson[];
  me: string | null;
  initial?: string;
  submitLabel: string;
  intro?: ReactNode;
  cancelLabel?: string;
  onSubmit: (name: string) => Promise<void> | void;
  onCancel?: () => void;
  warnOnExisting?: boolean;
  footer?: (name: string | null) => ReactNode;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const name = normalizeAssigneeName(text);
  const existing = name ? people.find(p => p.key === assigneeKey(name) && p.count > 0) : undefined;
  const choices = people.filter(p => p.count > 0 || sameAssignee(p.name, me));

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!name) return;
    setSaving(true);
    try { await onSubmit(name); } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className='space-y-4'>
      {intro}
      <div>
        <input
          className='input'
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder='Ex. : Marie T.'
          maxLength={MAX_ASSIGNEE_CHARS}
          autoFocus
          autoComplete='nickname'
          enterKeyHint='done'
          aria-label='Nom'
        />
        {warnOnExisting && existing && !sameAssignee(existing.name, initial) && (
          <p className='mt-1.5 text-xs text-amber-700'>
            « {existing.name} » s’occupe déjà de {existing.count} carte{existing.count > 1 ? 's' : ''} sur ce tableau.
            Si c’est vous, continuez ; sinon, ajoutez une initiale pour qu’on ne vous confonde pas.
          </p>
        )}
      </div>
      {choices.length > 0 && (
        <div>
          <div className='mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted'>Sur ce tableau</div>
          <div className='flex flex-wrap gap-1.5'>
            {choices.map(p => {
              const active = !!name && p.key === assigneeKey(name);
              return (
                <button
                  key={p.key}
                  type='button'
                  onClick={() => setText(p.name)}
                  aria-pressed={active}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border pl-1 pr-2.5 text-[13px] transition-colors ${
                    active ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-700 hover:border-ink/30'
                  }`}
                >
                  <AssigneeAvatar name={p.name} size={24} color={p.color} />
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {footer?.(name)}
      <div className='flex justify-end gap-2'>
        {onCancel && (
          <button type='button' className='btn-secondary' onClick={onCancel} disabled={saving}>{cancelLabel}</button>
        )}
        <button type='submit' className='btn-primary' disabled={!name || saving}>{submitLabel}</button>
      </div>
    </form>
  );
}

// ─── Surnom d'un lien de partage ──────────────────────────────────────────────

// Un seul surnom par appareil, pour tous les liens : on est la même personne
// d'un tableau à l'autre.
const NICKNAME_PREF = 'portal.nickname';

export function usePortalNickname(): [string | null, (name: string) => void] {
  const [nickname, setNickname] = useState<string | null>(() => normalizeAssigneeName(readPref(NICKNAME_PREF)));
  function save(name: string) {
    const clean = normalizeAssigneeName(name);
    if (!clean) return;
    writePref(NICKNAME_PREF, clean);
    setNickname(clean);
  }
  return [nickname, save];
}

/**
 * « Qui êtes-vous ? » — à la première visite d'un lien, et pour changer de nom.
 *
 * Changer de nom propose d'emporter ses cartes : sans cela, « Marie » qui devient
 * « Marie T. » laisserait derrière elle des cartes à un nom que plus personne ne
 * porte.
 */
export function NicknameModal({
  open,
  current,
  people,
  onSave,
  onClose,
}: {
  open: boolean;
  current: string | null;
  people: AssigneePerson[];
  /** `carry` : les cartes de l'ancien nom passent au nouveau. */
  onSave: (name: string, carry: boolean) => Promise<void> | void;
  onClose: () => void;
}) {
  const [carry, setCarry] = useState(true);
  const mine = current ? people.find(p => p.key === assigneeKey(current))?.count ?? 0 : 0;
  return (
    <Modal open={open} title={current ? 'Changer de nom' : 'Qui êtes-vous ?'} onClose={onClose} size='sm'>
      {open && (
        <NameForm
          people={people}
          me={current}
          initial={current ?? ''}
          warnOnExisting
          submitLabel={current ? 'Enregistrer' : 'Continuer'}
          cancelLabel={current ? 'Annuler' : 'Plus tard'}
          onCancel={onClose}
          intro={
            <p className='text-sm text-muted'>
              Votre nom s’affiche sur les cartes dont vous vous occupez et sur vos notes, pour que l’équipe
              sache qui fait quoi. Il est retenu sur cet appareil — pas besoin de compte.
            </p>
          }
          footer={name =>
            current && mine > 0 && name && !sameAssignee(name, current) ? (
              <label className='flex items-start gap-2 text-sm text-ink'>
                <input
                  type='checkbox'
                  className='mt-0.5 h-4 w-4 rounded accent-accent-600'
                  checked={carry}
                  onChange={e => setCarry(e.target.checked)}
                />
                <span>
                  Garder mes {mine} carte{mine > 1 ? 's' : ''} : elles passent de « {current} » à « {name} »
                </span>
              </label>
            ) : null
          }
          onSubmit={name => onSave(name, carry)}
        />
      )}
    </Modal>
  );
}

/** Le bouton d'identité de l'en-tête du lien : « ● Marie ✎ », ou « Se présenter ». */
export function NicknameButton({ nickname, onClick }: { nickname: string | null; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='inline-flex h-8 max-w-[11rem] items-center gap-1.5 rounded-full border border-line bg-white pl-1 pr-2.5 text-[13px] font-medium text-ink-700 hover:border-ink/30'
      title={nickname ? 'Changer de nom' : 'Dites à l’équipe qui vous êtes'}
    >
      {nickname ? <AssigneeAvatar name={nickname} size={24} /> : (
        <span className='flex h-6 w-6 items-center justify-center rounded-full bg-accent-50 text-accent-700'>
          <LuUserRound size={13} />
        </span>
      )}
      <span className='truncate'>{nickname ?? 'Se présenter'}</span>
      {nickname && <LuPencil size={11} className='shrink-0 text-muted' />}
    </button>
  );
}

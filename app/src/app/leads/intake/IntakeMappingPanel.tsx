// Panneau « Correspondance » : à gauche ce qu'on a réellement reçu, à droite les
// champs du prospect, et en dessous la carte telle qu'elle sera créée.
//
// L'aperçu n'est pas une illustration : c'est le vrai `LeadCardInfo`, alimenté
// par le vrai moteur de correspondance sur le vrai échantillon. Ce qu'on voit
// ici est exactement ce que produira le prochain appel — c'est ce qui permet de
// régler la correspondance sans avoir à créer un prospect pour vérifier.
//
// Le branchement est **toujours explicite**. Une première version associait un
// champ cliqué « au premier emplacement encore libre » : vu de l'écran, cliquer
// `email` remplissait « Nom » sans qu'on comprenne pourquoi. Cliquer une valeur
// ouvre donc maintenant la liste des destinations, et chaque ligne affiche en
// permanence où elle va. Survoler un côté éclaire son vis-à-vis : le câblage se
// lit sans avoir à le déduire.
//
// ── Pourquoi une ligne qui s'ouvre, et pas quatre colonnes ────────────────────
//
// Chaque champ se lit d'abord **en une ligne** : d'où vient la valeur, ce qu'on
// lui fait, ce qui en sort. C'est la lecture d'ensemble, celle qui permet de
// balayer les sept champs d'un coup d'œil.
//
// Régler quoi que ce soit demande en revanche de la place, et une version
// antérieure mettait les éditeurs *dans* les colonnes : à 672 px de modale, les
// listes déroulantes affichaient « full_n∨ » et l'assistant écrivait un mot par
// ligne. La leçon n'était pas « il faut élargir » mais « un éditeur ne tient pas
// dans une cellule ». La ligne cliquée s'ouvre donc sur toute la largeur, une
// seule à la fois — les six autres restent lisibles au-dessus et en dessous.

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  LuArrowRight,
  LuChevronDown,
  LuCircleAlert,
  LuCircleCheck,
  LuLoader,
  LuPlus,
  LuSave,
  LuTrash2,
  LuX,
} from 'react-icons/lu';
import { saveLeadIntakeMapping } from 'wasp/client/operations';
import { LeadCardInfo } from '../leads.shared';
import { LEAD_SOURCES } from '../../../shared/leadSources';
import {
  applyMapping,
  EMPTY_MAPPING,
  labelForPath,
  MAPPED_FIELD_LABELS,
  noteEntries,
  noteLines,
  previewRule,
  ruleTransforms,
  withTransforms,
  type DetectedPath,
  type FieldRule,
  type JsonValue,
  type LeadIntakeMapping,
  type MappedFieldKey,
  type NoteEntry,
} from '../../../shared/leadIntake';
import { previewTransforms } from '../../../shared/leadIntakeTransforms';
import { CleanupEditor, CleanupSummary } from './IntakeCleanup';

/** Ordre d'affichage : les champs qui font qu'un prospect est joignable d'abord. */
const FIELD_ORDER: MappedFieldKey[] = [
  'name',
  'email',
  'phone',
  'website',
  'address',
  'category',
];

/**
 * Une destination possible pour une valeur reçue.
 *
 * `source` n'en fait pas partie : la provenance se choisit dans une liste de
 * valeurs connues, pas en la branchant sur un champ de la charge utile.
 * `note` en fait partie depuis que les notes se composent ligne par ligne : c'est
 * une destination comme une autre, et l'exclure obligeait à choisir ses lignes
 * dans une liste séparée de celle où on lit les valeurs.
 */
type SlotKey = Exclude<MappedFieldKey, 'source'> | 'dedupe' | 'note';

const SLOTS: SlotKey[] = ['name', 'email', 'phone', 'website', 'address', 'category', 'note', 'dedupe'];

const SLOT_LABELS: Record<SlotKey, string> = {
  name: MAPPED_FIELD_LABELS.name,
  email: MAPPED_FIELD_LABELS.email,
  phone: MAPPED_FIELD_LABELS.phone,
  website: MAPPED_FIELD_LABELS.website,
  address: MAPPED_FIELD_LABELS.address,
  category: MAPPED_FIELD_LABELS.category,
  note: 'Note',
  dedupe: 'Anti-doublon',
};

/** Valeurs spéciales du menu déroulant, distinguées des chemins par leur préfixe. */
const OPT_NONE = '__none__';
const OPT_TEMPLATE = '__template__';
const OPT_CONST = '__const__';

/** Ce qui est ouvert, s'il y a lieu : un champ du prospect, ou une ligne de note. */
type OpenRow = { kind: 'field'; key: MappedFieldKey } | { kind: 'note'; index: number } | null;

function sameRow(a: OpenRow, b: OpenRow): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'field' && b.kind === 'field') return a.key === b.key;
  if (a.kind === 'note' && b.kind === 'note') return a.index === b.index;
  return false;
}

/**
 * Où va chaque valeur reçue, d'après la correspondance courante.
 *
 * Un chemin peut alimenter plusieurs destinations — c'est le cas dès qu'un
 * modèle assemble `{{ville}}, {{province}}` : les deux chemins nourrissent
 * « Adresse ». La table est donc un multi-map, pas une bijection.
 */
function assignmentsByPath(mapping: LeadIntakeMapping): Map<string, SlotKey[]> {
  const out = new Map<string, SlotKey[]>();
  const push = (path: string, slot: SlotKey) => {
    const key = path.trim();
    if (!key) return;
    out.set(key, [...(out.get(key) ?? []), slot]);
  };

  for (const slot of SLOTS) {
    if (slot === 'dedupe' || slot === 'note') continue;
    const rule = mapping.fields[slot];
    if (rule?.kind === 'path') push(rule.path, slot);
    if (rule?.kind === 'template') {
      for (const m of rule.template.matchAll(/\{\{([^}]+)\}\}/g)) push(m[1], slot);
    }
  }
  if (mapping.dedupePath) push(mapping.dedupePath, 'dedupe');
  if (mapping.notes.mode === 'selected') {
    for (const entry of noteEntries(mapping)) push(entry.path, 'note');
  }
  return out;
}

export function IntakeMappingPanel({
  searchId,
  payload,
  paths,
  initialMapping,
  isAdmin,
  onSaved,
}: {
  searchId: string;
  payload: JsonValue;
  paths: DetectedPath[];
  initialMapping: LeadIntakeMapping;
  isAdmin: boolean;
  onSaved: (mapping: LeadIntakeMapping) => void;
}) {
  const [mapping, setMapping] = useState<LeadIntakeMapping>(initialMapping);
  const [saving, setSaving] = useState(false);
  /** Ligne dont le choix de destination est ouvert, côté « reçu ». */
  const [openPath, setOpenPath] = useState<string | null>(null);
  /** Ligne dépliée, côté « champs ». Une seule à la fois. */
  const [openRow, setOpenRow] = useState<OpenRow>(null);
  /** Câblage mis en évidence de part et d'autre, au survol. */
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const [hoverSlot, setHoverSlot] = useState<SlotKey | null>(null);

  // Le même calcul que celui du serveur, sur le même échantillon : l'aperçu ne
  // peut pas diverger de ce qui sera réellement créé.
  const preview = useMemo(() => applyMapping(payload, mapping), [payload, mapping]);
  const lead = preview.leads[0];
  const wiring = useMemo(() => assignmentsByPath(mapping), [mapping]);

  // Le premier prospect de l'appel — celui dont les lignes montrent les valeurs.
  // Sans `rootPath`, c'est la charge utile elle-même.
  const item = useMemo(() => firstItem(payload, mapping.rootPath), [payload, mapping.rootPath]);

  function setField(key: MappedFieldKey, rule: FieldRule) {
    setMapping(m => ({ ...m, fields: { ...m.fields, [key]: rule } }));
  }

  function setNotes(notes: LeadIntakeMapping['notes']) {
    setMapping(m => ({ ...m, notes }));
  }

  /** Les lignes de la note, sous la forme éditable — jamais `paths`, toujours `entries`. */
  const entries = useMemo(() => noteEntries(mapping), [mapping]);

  function setEntries(next: NoteEntry[]) {
    // `paths` est laissé tomber dès qu'on touche aux lignes : garder les deux
    // formes ferait deux sources de vérité, et `noteEntries` privilégie déjà
    // `entries`. Le champ hérité ne survit donc pas à la première modification.
    setNotes({ mode: mapping.notes.mode, entries: next });
  }

  /** Branche — ou débranche — une valeur reçue sur une destination. */
  function toggleWire(path: string, slot: SlotKey) {
    const already = (wiring.get(path) ?? []).includes(slot);
    if (slot === 'dedupe') {
      setMapping(m => ({ ...m, dedupePath: already ? null : path }));
    } else if (slot === 'note') {
      // Choisir une ligne de note fait forcément passer en mode « choisies » :
      // en mode « tout ce qui reste », désigner une ligne ne voudrait rien dire.
      if (already) {
        setEntries(entries.filter(e => e.path !== path));
      } else {
        setNotes({ mode: 'selected', entries: [...entries, { path }] });
      }
    } else {
      setField(slot, already ? { kind: 'none' } : withTransforms({ kind: 'path', path }, ruleTransforms(mapping.fields[slot])));
    }
    setOpenPath(null);
  }

  async function save() {
    setSaving(true);
    try {
      await saveLeadIntakeMapping({ searchId, mapping });
      toast.success('Correspondance enregistrée.');
      onSaved(mapping);
    } catch (err: any) {
      toast.error(err?.message ?? 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }

  const notesCatchAll = mapping.notes.mode === 'unmapped';

  return (
    <div className='space-y-5'>
      {/* `items-start` pour que la colonne de gauche ne s'étire pas à la hauteur de
          la droite : c'est ce qui laissait un grand vide sous la liste des champs
          reçus. L'aperçu de la carte vient s'y loger, juste à côté des valeurs
          d'où il sort. */}
      <div className='grid items-start gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]'>
        {/* ── Gauche : ce qu'on a reçu, et la carte qui en sortira ── */}
        <div className='min-w-0 space-y-5'>
          <div>
          <SectionTitle>Ce que nous avons reçu</SectionTitle>
          <div className='max-h-[26rem] divide-y divide-line overflow-y-auto rounded-xl border border-line'>
            {paths.length === 0 && (
              <p className='p-3 text-sm text-muted'>Cet appel ne contenait aucun champ lisible.</p>
            )}
            {paths.map(p => {
              const slots = wiring.get(p.path) ?? [];
              const isOpen = openPath === p.path;
              // Éclairé quand on le survole, ou quand on survole une destination
              // qu'il alimente : c'est ce qui rend le câblage lisible des deux côtés.
              const lit = hoverPath === p.path || (hoverSlot !== null && slots.includes(hoverSlot));

              return (
                <div
                  key={p.path}
                  onMouseEnter={() => setHoverPath(p.path)}
                  onMouseLeave={() => setHoverPath(null)}
                  className={`border-l-2 transition-colors ${
                    lit ? 'border-l-accent bg-accent-50'
                    : slots.length ? 'border-l-accent/40'
                    : 'border-l-transparent'
                  }`}
                >
                  <button
                    type='button'
                    onClick={() => isAdmin && setOpenPath(isOpen ? null : p.path)}
                    disabled={!isAdmin}
                    className='flex w-full items-start gap-2 px-3 py-2 text-left disabled:cursor-default'
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='truncate font-mono text-[11px] text-muted'>{p.path}</div>
                      <div className='truncate text-sm text-ink'>
                        {p.sample || <span className='italic text-muted'>vide</span>}
                      </div>
                    </div>

                    <div className='flex shrink-0 flex-col items-end gap-0.5'>
                      {slots.map(slot => (
                        <span key={slot} className='whitespace-nowrap rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700'>
                          {SLOT_LABELS[slot]}
                        </span>
                      ))}
                      {slots.length === 0 && (
                        // Rien n'est « inutilisé » quand les notes ramassent le
                        // reste : le dire évite de croire que la donnée est perdue.
                        <span className='whitespace-nowrap rounded bg-canvas-200 px-1.5 py-0.5 text-[11px] text-muted'>
                          {notesCatchAll ? 'Note' : 'Ignoré'}
                        </span>
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className='px-3 pb-3'>
                      <p className='mb-1.5 text-xs text-muted'>Envoyer cette valeur vers :</p>
                      <div className='flex flex-wrap gap-1'>
                        {SLOTS.map(slot => {
                          const on = slots.includes(slot);
                          return (
                            <button
                              key={slot}
                              type='button'
                              onMouseEnter={() => setHoverSlot(slot)}
                              onMouseLeave={() => setHoverSlot(null)}
                              onClick={() => toggleWire(p.path, slot)}
                              className={`rounded-lg border px-2 py-1 text-xs transition-colors ${
                                on
                                  ? 'border-ink bg-ink text-white'
                                  : 'border-line hover:border-ink/40 hover:bg-canvas-100'
                              }`}
                            >
                              {on ? '✓ ' : ''}{SLOT_LABELS[slot]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {isAdmin && paths.length > 0 && (
            <p className='mt-1.5 text-xs text-muted'>
              Cliquez une ligne pour choisir où sa valeur atterrit.
            </p>
          )}
          </div>

          <div>
            <SectionTitle>Aperçu de la carte</SectionTitle>
            {lead ? (
              // `LeadCardInfo` porte déjà le nom et son propre `p-3` : les répéter
              // ici affichait le prospect deux fois, à deux graisses différentes.
              <div className='overflow-hidden rounded-xl border border-line bg-canvas-100'>
                <LeadCardInfo
                  lead={{
                    name: lead.name,
                    email: lead.email,
                    phone: lead.phone,
                    website: lead.website,
                    address: lead.address,
                    category: lead.category,
                    source: lead.source,
                  } as any}
                />
                {lead.notes && (
                  <div className='border-t border-line px-3 pb-3 pt-2'>
                    <p className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted'>
                      Note
                    </p>
                    {/* Plafonnée : en mode « tout ce qui reste », un export Meta en
                        produit quinze lignes, qui repousseraient l'aperçu hors de
                        l'écran au lieu de le montrer. */}
                    <p className='max-h-44 overflow-y-auto whitespace-pre-line text-xs text-muted'>
                      {lead.notes}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className='text-sm text-muted'>Aucun prospect ne ressort de cet appel.</p>
            )}
          </div>
        </div>

        {/* ── Droite : les champs du prospect ── */}
        <div className='min-w-0 space-y-4'>
          <div>
            <SectionTitle>Champs du prospect</SectionTitle>
            <div className='overflow-hidden rounded-xl border border-line'>
              <RowHeader />
              <div className='divide-y divide-line'>
                {FIELD_ORDER.map(key => (
                  <FieldRow
                    key={key}
                    fieldKey={key}
                    rule={mapping.fields[key] ?? EMPTY_MAPPING.fields[key]}
                    paths={paths}
                    item={item}
                    disabled={!isAdmin}
                    open={sameRow(openRow, { kind: 'field', key })}
                    lit={isSlotLit(key as SlotKey, hoverPath, hoverSlot, wiring)}
                    onToggle={() =>
                      setOpenRow(r => (sameRow(r, { kind: 'field', key }) ? null : { kind: 'field', key }))
                    }
                    onHover={setHoverSlot}
                    onChange={rule => setField(key, rule)}
                  />
                ))}
              </div>
            </div>
          </div>

          <NotesSection
            mapping={mapping}
            entries={entries}
            paths={paths}
            item={item}
            disabled={!isAdmin}
            lit={isSlotLit('note', hoverPath, hoverSlot, wiring)}
            openRow={openRow}
            onOpenRow={setOpenRow}
            onHover={setHoverSlot}
            onModeChange={mode => {
              // Passer de « tout ce qui reste » à « lignes choisies » part de ce
              // qu'on avait déjà sous les yeux, pas d'une page blanche : la
              // demande courante est de retirer trois lignes sur quinze, et vider
              // la liste obligerait à les ressaisir une à une pour obtenir moins
              // qu'avant.
              if (mode === 'selected' && entries.length === 0) {
                setNotes({
                  mode: 'selected',
                  entries: noteLines(item, { ...mapping, notes: { mode: 'unmapped' } })
                    .map(line => ({ path: line.path })),
                });
                return;
              }
              setNotes({ mode, entries });
            }}
            onEntriesChange={setEntries}
          />

          {/* ── Les réglages qui ne concernent pas un champ ── */}
          <div className='grid gap-4 sm:grid-cols-3'>
            <div>
              <label className='label'>{MAPPED_FIELD_LABELS.source}</label>
              <select
                className='input'
                value={mapping.fields.source?.kind === 'const' ? mapping.fields.source.value : 'other'}
                disabled={!isAdmin}
                onChange={e => setField('source', { kind: 'const', value: e.target.value })}
              >
                {LEAD_SOURCES.map(s => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
              <p className='mt-1 text-xs text-muted'>Identique pour tous les prospects de ce tableau.</p>
            </div>

            <div
              onMouseEnter={() => setHoverSlot('dedupe')}
              onMouseLeave={() => setHoverSlot(null)}
              className={`-m-2 rounded-lg p-2 transition-colors ${
                isSlotLit('dedupe', hoverPath, hoverSlot, wiring) ? 'bg-accent-50' : ''
              }`}
            >
              <label className='label'>{SLOT_LABELS.dedupe}</label>
              <select
                className='input'
                value={mapping.dedupePath ?? OPT_NONE}
                disabled={!isAdmin}
                onChange={e =>
                  setMapping(m => ({ ...m, dedupePath: e.target.value === OPT_NONE ? null : e.target.value }))
                }
              >
                <option value={OPT_NONE}>— Aucune —</option>
                {paths.map(p => (
                  <option key={p.path} value={p.path}>{p.path}</option>
                ))}
              </select>
              <p className='mt-1 text-xs text-muted'>
                Un même appel réémis ne créera pas de second prospect. Sans clé, deux envois
                identiques donneront deux cartes.
              </p>
            </div>

            <div>
              <label className='label'>
                Liste de prospects <span className='font-normal text-muted'>(optionnel)</span>
              </label>
              <select
                className='input'
                value={mapping.rootPath ?? OPT_NONE}
                disabled={!isAdmin}
                onChange={e =>
                  setMapping(m => ({ ...m, rootPath: e.target.value === OPT_NONE ? null : e.target.value }))
                }
              >
                <option value={OPT_NONE}>— L'appel porte un seul prospect —</option>
                {arrayPaths(payload).map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <p className='mt-1 text-xs text-muted'>
                Seulement si un même appel transporte plusieurs prospects.
              </p>
            </div>
          </div>
        </div>
      </div>

      {preview.warnings.length > 0 && (
        <div className='flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900'>
          <LuCircleAlert size={15} className='mt-0.5 shrink-0' />
          <ul className='space-y-0.5'>
            {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Barre d'action collée en bas du panneau.
          L'écran est haut — sept champs, les lignes de note, l'aperçu — et le
          bouton se retrouvait sous la ligne de flottaison de la modale : on
          réglait une correspondance sans voir comment l'enregistrer. Les marges
          négatives compensent le `px-6 py-5` du corps de la modale pour que la
          barre aille d'un bord à l'autre.

          `-bottom-5` et non `bottom-0` : le collage se mesure sur la **boîte des
          marges**, et un `-mb-5` avec un décalage nul faisait descendre la barre
          de ces 20 px sous le bas de la zone qui défile — la moitié du bouton
          passait dessous. Le décalage négatif rend exactement la marge reprise. */}
      {isAdmin && (
        <div className='sticky -bottom-5 -mx-6 -mb-5 flex items-center justify-end gap-3 border-t border-line bg-white/95 px-6 py-3 backdrop-blur-sm'>
          <button type='button' className='btn-primary gap-2' onClick={save} disabled={saving}>
            {saving ? <LuLoader size={16} className='animate-spin' /> : <LuSave size={16} />}
            Enregistrer la correspondance
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Gabarit d'une ligne ──────────────────────────────────────────────────────

/**
 * Le gabarit fermé : intitulé · source · valeur reçue · flèche · résultat.
 *
 * Aucun éditeur ici — ils vivent dans la partie dépliée, sur toute la largeur.
 * C'est cette séparation qui empêche les listes déroulantes de se faire tronquer
 * quand la modale rétrécit.
 */
/**
 * Quatre colonnes à partir de `md`, une simple ligne en dessous.
 *
 * Sous 768 px, un tableau à quatre colonnes ne tient pas : les valeurs se
 * réduisaient à « M… » et la chevron partait à la ligne. La ligne fermée se replie
 * donc sur l'essentiel — le champ et ce qui sera écrit — et « Reçu » comme
 * « Nettoyage » se lisent dans la partie dépliée, qui occupe toute la largeur de
 * toute façon (`max-md:hidden` sur les deux cellules du milieu).
 */
const ROW = 'flex items-center justify-between gap-2 md:grid md:items-center md:gap-x-3 md:gap-y-1 md:grid-cols-[11rem_minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)_1.25rem]';

function RowHeader({ first = 'Champ', last = 'Résultat' }: { first?: string; last?: string }) {
  return (
    <div className={`${ROW} border-b border-line bg-canvas-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted max-md:hidden`}>
      <span>{first}</span>
      <span>Reçu</span>
      <span>Nettoyage</span>
      <span>{last}</span>
      <span />
    </div>
  );
}

/** Une cellule vide qui se lit comme telle, plutôt qu'un blanc ambigu. */
function Dash() {
  return <span className='text-muted'>—</span>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted'>{children}</h4>;
}

// ─── Mise en évidence croisée ─────────────────────────────────────────────────

function isSlotLit(
  slot: SlotKey,
  hoverPath: string | null,
  hoverSlot: SlotKey | null,
  wiring: Map<string, SlotKey[]>,
): boolean {
  if (hoverSlot === slot) return true;
  if (hoverPath) return (wiring.get(hoverPath) ?? []).includes(slot);
  return false;
}

// ─── Un champ du prospect ─────────────────────────────────────────────────────

function FieldRow({
  fieldKey,
  rule,
  paths,
  item,
  disabled,
  open,
  lit,
  onToggle,
  onHover,
  onChange,
}: {
  fieldKey: MappedFieldKey;
  rule: FieldRule;
  paths: DetectedPath[];
  /** Le prospect de l'échantillon, pour calculer les valeurs. */
  item: unknown;
  disabled: boolean;
  open: boolean;
  lit: boolean;
  onToggle: () => void;
  onHover: (slot: SlotKey | null) => void;
  onChange: (rule: FieldRule) => void;
}) {
  // Les valeurs viennent du moteur partagé, pas d'un calcul local : c'est la
  // seule façon de garantir que « Résultat » est bien ce que le serveur écrira.
  const { raw, steps, final } = previewRule(item, rule);
  const transforms = ruleTransforms(rule);
  const label = MAPPED_FIELD_LABELS[fieldKey];

  const sourceLabel =
    rule.kind === 'path' ? rule.path
    : rule.kind === 'template' ? 'Champs assemblés'
    : rule.kind === 'const' ? 'Valeur fixe'
    : '—';

  return (
    <div
      onMouseEnter={() => onHover(fieldKey as SlotKey)}
      onMouseLeave={() => onHover(null)}
      className={`transition-colors ${lit && !open ? 'bg-accent-50' : ''}`}
    >
      <button
        type='button'
        onClick={onToggle}
        className={`${ROW} w-full px-3 py-2 text-left transition-colors hover:bg-canvas-100 ${open ? 'bg-canvas-100' : ''}`}
      >
        {/* Le champ et sa source empilés : deux colonnes pour ça volaient la place
            dont « Reçu » et « Nettoyage » ont réellement besoin, et le chemin est
            une précision sur le champ plus qu'une donnée à comparer. */}
        <span className='min-w-0'>
          <span className='block text-sm font-medium text-ink'>
            {label}
            {fieldKey === 'name' && <span className='text-danger'> *</span>}
          </span>
          <span
            className={`block truncate font-mono text-[11px] ${rule.kind === 'none' ? 'text-muted/70' : 'text-muted'}`}
            title={sourceLabel}
          >
            {sourceLabel}
          </span>
        </span>

        <span className='min-w-0 truncate font-mono text-xs text-ink-700 max-md:hidden' title={raw}>
          {rule.kind === 'none' ? <Dash /> : raw || <span className='italic text-muted'>vide</span>}
        </span>

        <span className='min-w-0 max-md:hidden'>
          {rule.kind === 'none' ? <Dash /> : <CleanupSummary transforms={transforms} steps={steps} />}
        </span>

        <ResultValue raw={raw} final={final} empty={rule.kind === 'none'} />

        <LuChevronDown
          size={14}
          className={`justify-self-end text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className='space-y-4 border-t border-line bg-canvas-100/60 px-3 py-3.5'>
          <div className='grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]'>
            {/* ── Source ── */}
            <div>
              <p className='mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted'>
                Source
              </p>
              <select
                className='input font-mono text-xs'
                value={
                  rule.kind === 'path' ? rule.path
                  : rule.kind === 'template' ? OPT_TEMPLATE
                  : rule.kind === 'const' ? OPT_CONST
                  : OPT_NONE
                }
                disabled={disabled}
                onChange={e => {
                  const v = e.target.value;
                  // Le nettoyage suit le champ, pas la source : changer de chemin
                  // pour un autre téléphone ne doit pas faire perdre le
                  // « retirer p: » qu'on vient de régler.
                  if (v === OPT_NONE) onChange({ kind: 'none' });
                  else if (v === OPT_TEMPLATE) onChange(withTransforms({ kind: 'template', template: rule.kind === 'template' ? rule.template : '' }, transforms));
                  else if (v === OPT_CONST) onChange(withTransforms({ kind: 'const', value: rule.kind === 'const' ? rule.value : '' }, transforms));
                  else onChange(withTransforms({ kind: 'path', path: v }, transforms));
                }}
              >
                <option value={OPT_NONE}>— Ignorer ce champ —</option>
                {paths.map(p => (
                  <option key={p.path} value={p.path}>
                    {p.path}{p.sample ? ` — ${p.sample.slice(0, 22)}` : ''}
                  </option>
                ))}
                <option value={OPT_TEMPLATE}>Assembler plusieurs champs…</option>
                <option value={OPT_CONST}>Valeur fixe…</option>
              </select>

              {rule.kind === 'template' && (
                <>
                  <input
                    className='input mt-2 font-mono text-xs'
                    placeholder='{{first_name}} {{last_name}}'
                    value={rule.template}
                    disabled={disabled}
                    onChange={e => onChange({ ...rule, template: e.target.value })}
                  />
                  <p className='mt-1 text-xs text-muted'>
                    Les chemins entre doubles accolades. Une partie absente disparaît avec son
                    séparateur.
                  </p>
                </>
              )}

              {rule.kind === 'const' && (
                <input
                  className='input mt-2'
                  placeholder='Valeur identique pour tous les prospects'
                  value={rule.value}
                  disabled={disabled}
                  onChange={e => onChange({ ...rule, value: e.target.value })}
                />
              )}

              {fieldKey === 'name' && rule.kind === 'none' && (
                <p className='mt-1.5 text-xs text-muted'>
                  Sans association, Gestia prendra l'entreprise, puis le courriel, puis le
                  téléphone.
                </p>
              )}
            </div>

            {/* ── Nettoyage, sur toute la largeur restante ── */}
            <div className='min-w-0'>
              <p className='mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted'>
                Nettoyage
              </p>
              {rule.kind === 'none' ? (
                <p className='text-xs text-muted'>Ce champ est ignoré : rien à nettoyer.</p>
              ) : (
                <CleanupEditor
                  fieldLabel={label}
                  path={rule.kind === 'path' ? rule.path : label}
                  raw={raw}
                  transforms={transforms}
                  steps={steps}
                  disabled={disabled}
                  onChange={next => onChange(withTransforms(rule, next))}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Le « après ».
 *
 * Marqué en vert seulement quand le nettoyage a effectivement changé quelque
 * chose : signaler chaque champ indistinctement rendrait le repère muet, alors
 * que ce qu'on veut voir d'un coup d'œil, c'est où le nettoyage agit.
 */
function ResultValue({ raw, final, empty }: { raw: string; final: string; empty: boolean }) {
  if (empty) return <span className='text-xs italic text-muted'>ignoré</span>;
  if (!final) return <span className='text-xs italic text-muted'>vide</span>;
  const changed = final !== raw;
  return (
    <span className={`flex min-w-0 items-center gap-1 text-sm ${changed ? 'font-medium text-emerald-700' : 'text-ink'}`}>
      {changed && <LuCircleCheck size={11} className='shrink-0' />}
      <span className='truncate' title={final}>{final}</span>
    </span>
  );
}

// ─── Notes ────────────────────────────────────────────────────────────────────

/**
 * Ce qui finira dans la note du prospect.
 *
 * Trois régimes, et le milieu est celui qui manquait : « tout ce qui reste » noie
 * la seule ligne utile sous les identifiants techniques d'un export Meta, « aucune
 * note » la perd complètement. Choisir ses lignes — leur intitulé, leur ordre,
 * leur nettoyage — est le seul régime qui donne une note qu'on a envie de lire.
 */
function NotesSection({
  mapping,
  entries,
  paths,
  item,
  disabled,
  lit,
  openRow,
  onOpenRow,
  onHover,
  onModeChange,
  onEntriesChange,
}: {
  mapping: LeadIntakeMapping;
  entries: NoteEntry[];
  paths: DetectedPath[];
  item: unknown;
  disabled: boolean;
  lit: boolean;
  openRow: OpenRow;
  onOpenRow: (row: OpenRow) => void;
  onHover: (slot: SlotKey | null) => void;
  onModeChange: (mode: LeadIntakeMapping['notes']['mode']) => void;
  onEntriesChange: (entries: NoteEntry[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const mode = mapping.notes.mode;

  /** Les lignes telles qu'elles seront écrites — même fonction que le serveur. */
  const lines = useMemo(() => noteLines(item, mapping), [item, mapping]);
  const unused = paths.filter(p => !entries.some(e => e.path === p.path));

  return (
    <div
      onMouseEnter={() => onHover('note')}
      onMouseLeave={() => onHover(null)}
      className='overflow-hidden rounded-xl border border-line'
    >
      {/* La mise en évidence ne touche que l'en-tête. Teinter la carte entière
          noyait quinze lignes sous un fond orangé dès qu'on passait la souris —
          l'indice devenait le sujet. */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 transition-colors ${
          lit ? 'bg-accent-50' : 'bg-canvas-100'
        }`}
      >
        <span className='text-xs font-semibold uppercase tracking-wide text-muted'>
          Note du prospect
        </span>
        <select
          className='input w-auto py-1 text-xs'
          value={mode}
          disabled={disabled}
          onChange={e => onModeChange(e.target.value as LeadIntakeMapping['notes']['mode'])}
        >
          <option value='unmapped'>Tous les champs non utilisés</option>
          <option value='selected'>Seulement les lignes choisies</option>
          <option value='none'>Aucune note</option>
        </select>
      </div>

      {mode === 'unmapped' && (
        <p className='px-3 py-2.5 text-xs text-muted'>
          Ce qui n'alimente aucun champ ci-dessus finit en note — {lines.length} ligne
          {lines.length > 1 ? 's' : ''} pour cet appel. Passez à « lignes choisies » pour ne garder
          que l'essentiel, renommer les intitulés et nettoyer les valeurs.
        </p>
      )}

      {mode === 'none' && (
        <p className='px-3 py-2.5 text-xs text-muted'>
          Aucune note ne sera créée. Tout ce qui n'alimente pas un champ ci-dessus est perdu.
        </p>
      )}

      {mode === 'selected' && (
        <>
          {entries.length > 0 && <RowHeader first='Intitulé' last='Dans la note' />}
          <div className='divide-y divide-line'>
            {entries.length === 0 && (
              <p className='px-3 py-3 text-xs text-muted'>
                Aucune ligne choisie : la note ne sera pas créée.
              </p>
            )}
            {entries.map((entry, index) => (
              <NoteEntryRow
                key={`${entry.path}-${index}`}
                entry={entry}
                index={index}
                count={entries.length}
                item={item}
                disabled={disabled}
                open={sameRow(openRow, { kind: 'note', index })}
                onToggle={() =>
                  onOpenRow(sameRow(openRow, { kind: 'note', index }) ? null : { kind: 'note', index })
                }
                onChange={next => onEntriesChange(entries.map((e, i) => (i === index ? next : e)))}
                onRemove={() => {
                  onEntriesChange(entries.filter((_, i) => i !== index));
                  onOpenRow(null);
                }}
                onMove={delta => {
                  const target = index + delta;
                  if (target < 0 || target >= entries.length) return;
                  const next = [...entries];
                  [next[index], next[target]] = [next[target], next[index]];
                  onEntriesChange(next);
                  onOpenRow({ kind: 'note', index: target });
                }}
              />
            ))}
          </div>

          {!disabled && (
            <div className='border-t border-line px-3 py-2'>
              {adding ? (
                <div className='flex items-center gap-1.5'>
                  <select
                    className='input py-1 text-xs'
                    defaultValue=''
                    autoFocus
                    onChange={e => {
                      if (!e.target.value) return;
                      onEntriesChange([...entries, { path: e.target.value }]);
                      setAdding(false);
                    }}
                  >
                    <option value=''>Choisir un champ reçu…</option>
                    {unused.map(p => (
                      <option key={p.path} value={p.path}>
                        {p.path}{p.sample ? ` — ${p.sample.slice(0, 22)}` : ''}
                      </option>
                    ))}
                  </select>
                  <button type='button' className='btn-ghost px-2 py-1 text-xs' onClick={() => setAdding(false)}>
                    <LuX size={12} />
                  </button>
                </div>
              ) : (
                <button
                  type='button'
                  onClick={() => setAdding(true)}
                  disabled={unused.length === 0}
                  className='inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink disabled:opacity-40'
                >
                  <LuPlus size={12} />
                  {unused.length === 0 ? 'Tous les champs reçus sont déjà dans la note' : 'Ajouter une ligne'}
                </button>
              )}
            </div>
          )}

          {lines.length > 0 && (
            <div className='border-t border-line bg-canvas-100 px-3 py-2.5'>
              <p className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted'>
                La note telle qu'elle sera écrite
              </p>
              <p className='whitespace-pre-line font-mono text-xs text-ink'>
                {lines.map(l => `${l.label} : ${l.value}`).join('\n')}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Une ligne de note, même gabarit fermé que les champs, même éditeur déplié. */
function NoteEntryRow({
  entry,
  index,
  count,
  item,
  disabled,
  open,
  onToggle,
  onChange,
  onRemove,
  onMove,
}: {
  entry: NoteEntry;
  index: number;
  count: number;
  item: unknown;
  disabled: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: (entry: NoteEntry) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  const raw = useMemo(() => previewRule(item, { kind: 'path', path: entry.path }).raw, [item, entry.path]);
  const { final, steps } = useMemo(() => previewTransforms(raw, entry.transforms), [raw, entry.transforms]);
  const fallbackLabel = labelForPath(entry.path);
  const label = entry.label?.trim() || fallbackLabel;

  return (
    <div>
      {/* `group`/`relative` enveloppe la seule ligne fermée, pas le panneau
          déplié : sinon la corbeille se centrait sur la hauteur totale et se
          retrouvait flottant au milieu de l'éditeur. */}
      <div className='group relative'>
      <button
        type='button'
        onClick={onToggle}
        className={`${ROW} w-full py-2 pl-3 pr-3 text-left transition-colors hover:bg-canvas-100 ${open ? 'bg-canvas-100' : ''}`}
      >
        <span className='min-w-0'>
          <span className='block truncate text-sm font-medium text-ink' title={label}>{label}</span>
          <span className='block truncate font-mono text-[11px] text-muted' title={entry.path}>
            {entry.path}
          </span>
        </span>

        <span className='min-w-0 truncate font-mono text-xs text-ink-700 max-md:hidden' title={raw}>
          {raw || <span className='italic text-muted'>vide</span>}
        </span>

        <span className='min-w-0 max-md:hidden'>
          <CleanupSummary transforms={entry.transforms ?? []} steps={steps} />
        </span>

        {final.trim() ? (
          <ResultValue raw={raw} final={final} empty={false} />
        ) : (
          // Une valeur vide ne produit pas de ligne : le dire ici évite de
          // chercher pourquoi la note n'en a que deux sur trois.
          <span className='text-xs italic text-muted'>vide — ligne omise</span>
        )}

        <LuChevronDown
          size={14}
          className={`justify-self-end text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Hors du <button> : un bouton dans un bouton n'est pas du HTML valide, et
          la corbeille doit rester atteignable au clavier. Retirer une ligne est
          le geste le plus fréquent de cet écran — partir de « tous les champs »
          puis élaguer, un export Meta en proposant quinze — et le faire depuis la
          ligne fermée épargne un dépliage à chaque fois. */}
      {!disabled && (
        <button
          type='button'
          title='Retirer cette ligne de la note'
          onClick={onRemove}
          className='absolute right-8 top-1/2 -translate-y-1/2 rounded p-1 text-muted opacity-0 transition-opacity hover:bg-red-50 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100'
        >
          <LuTrash2 size={13} />
        </button>
      )}
      </div>

      {open && (
        <div className='space-y-4 border-t border-line bg-canvas-100/60 px-3 py-3.5'>
          <div className='grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]'>
            <div className='space-y-3'>
              <div>
                <p className='mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted'>
                  Intitulé dans la note
                </p>
                <input
                  className='input'
                  value={entry.label ?? ''}
                  placeholder={fallbackLabel}
                  disabled={disabled}
                  onChange={e => onChange({ ...entry, label: e.target.value || undefined })}
                />
                <p className='mt-1 text-xs text-muted'>
                  Vide = déduit du champ reçu. La note affichera «&nbsp;{label} : {final || '…'}&nbsp;».
                </p>
              </div>

              {!disabled && (
                <div className='flex flex-wrap items-center gap-1.5'>
                  <button
                    type='button'
                    disabled={index === 0}
                    onClick={() => onMove(-1)}
                    className='rounded-lg border border-line px-2 py-1 text-xs text-muted transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-30'
                  >
                    ↑ Monter
                  </button>
                  <button
                    type='button'
                    disabled={index === count - 1}
                    onClick={() => onMove(1)}
                    className='rounded-lg border border-line px-2 py-1 text-xs text-muted transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-30'
                  >
                    ↓ Descendre
                  </button>
                  <button
                    type='button'
                    onClick={onRemove}
                    className='inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-muted transition-colors hover:border-danger/40 hover:text-danger'
                  >
                    <LuTrash2 size={11} />
                    Retirer
                  </button>
                </div>
              )}
            </div>

            <div className='min-w-0'>
              <p className='mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted'>
                Nettoyage
              </p>
              <CleanupEditor
                fieldLabel={label}
                path={entry.path}
                raw={raw}
                transforms={entry.transforms ?? []}
                steps={steps}
                disabled={disabled}
                onChange={next => onChange({ ...entry, transforms: next.length ? next : undefined })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Petites aides ────────────────────────────────────────────────────────────

/**
 * Le prospect sur lequel porte l'aperçu ligne à ligne.
 *
 * Avec un `rootPath`, un appel porte un lot : les lignes montrent le premier
 * élément, celui-là même que `applyMapping` traite en premier. Montrer la charge
 * utile entière ferait afficher « vide » partout dès qu'un tableur envoie ses
 * lignes groupées.
 */
function firstItem(payload: JsonValue, rootPath: string | null | undefined): unknown {
  if (!rootPath) return Array.isArray(payload) ? payload[0] : payload;
  const root = getPath(payload, rootPath);
  if (Array.isArray(root)) return root[0];
  return root ?? payload;
}

/** Lecture d'un chemin simple, pour `firstItem` seulement. */
function getPath(payload: JsonValue, path: string): unknown {
  let current: any = payload;
  for (const key of path.split('.')) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

/** Les chemins qui mènent à une liste — les seuls candidats à « liste de prospects ». */
function arrayPaths(payload: JsonValue): string[] {
  const out: string[] = [];
  const walk = (value: JsonValue, prefix: string, depth: number) => {
    if (depth > 3 || value == null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      if (prefix) out.push(prefix);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      walk(child as JsonValue, prefix ? `${prefix}.${key}` : key, depth + 1);
    }
  };
  walk(payload, '', 0);
  return out;
}

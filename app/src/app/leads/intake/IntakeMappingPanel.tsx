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

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { LuArrowRight, LuCircleAlert, LuLoader, LuSave, LuX } from 'react-icons/lu';
import { saveLeadIntakeMapping } from 'wasp/client/operations';
import { LeadCardInfo } from '../leads.shared';
import { LEAD_SOURCES } from '../../../shared/leadSources';
import {
  applyMapping,
  EMPTY_MAPPING,
  MAPPED_FIELD_LABELS,
  type DetectedPath,
  type FieldRule,
  type JsonValue,
  type LeadIntakeMapping,
  type MappedFieldKey,
} from '../../../shared/leadIntake';

/** Ordre d'affichage : les champs qui font qu'un prospect est joignable d'abord. */
const FIELD_ORDER: MappedFieldKey[] = [
  'name',
  'email',
  'phone',
  'website',
  'address',
  'category',
  'source',
];

/**
 * Une destination possible pour une valeur reçue.
 *
 * `source` n'en fait pas partie : la provenance se choisit dans une liste de
 * valeurs connues, pas en la branchant sur un champ de la charge utile.
 */
type SlotKey = Exclude<MappedFieldKey, 'source'> | 'dedupe';

const SLOTS: SlotKey[] = ['name', 'email', 'phone', 'website', 'address', 'category', 'dedupe'];

const SLOT_LABELS: Record<SlotKey, string> = {
  name: MAPPED_FIELD_LABELS.name,
  email: MAPPED_FIELD_LABELS.email,
  phone: MAPPED_FIELD_LABELS.phone,
  website: MAPPED_FIELD_LABELS.website,
  address: MAPPED_FIELD_LABELS.address,
  category: MAPPED_FIELD_LABELS.category,
  dedupe: 'Anti-doublon',
};

/** Valeurs spéciales du menu déroulant, distinguées des chemins par leur préfixe. */
const OPT_NONE = '__none__';
const OPT_TEMPLATE = '__template__';
const OPT_CONST = '__const__';

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
    if (slot === 'dedupe') continue;
    const rule = mapping.fields[slot];
    if (rule?.kind === 'path') push(rule.path, slot);
    if (rule?.kind === 'template') {
      for (const m of rule.template.matchAll(/\{\{([^}]+)\}\}/g)) push(m[1], slot);
    }
  }
  if (mapping.dedupePath) push(mapping.dedupePath, 'dedupe');
  return out;
}

export function IntakeMappingPanel({
  searchId,
  boardTitle,
  payload,
  paths,
  initialMapping,
  isAdmin,
  onSaved,
}: {
  searchId: string;
  boardTitle: string;
  payload: JsonValue;
  paths: DetectedPath[];
  initialMapping: LeadIntakeMapping;
  isAdmin: boolean;
  onSaved: (mapping: LeadIntakeMapping) => void;
}) {
  const [mapping, setMapping] = useState<LeadIntakeMapping>(initialMapping);
  const [saving, setSaving] = useState(false);
  /** Ligne dont le choix de destination est ouvert. */
  const [openPath, setOpenPath] = useState<string | null>(null);
  /** Câblage mis en évidence de part et d'autre, au survol. */
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const [hoverSlot, setHoverSlot] = useState<SlotKey | null>(null);

  // Le même calcul que celui du serveur, sur le même échantillon : l'aperçu ne
  // peut pas diverger de ce qui sera réellement créé.
  const preview = useMemo(
    () => applyMapping(payload, mapping, { boardLabel: boardTitle }),
    [payload, mapping, boardTitle],
  );
  const lead = preview.leads[0];
  const wiring = useMemo(() => assignmentsByPath(mapping), [mapping]);

  function setField(key: MappedFieldKey, rule: FieldRule) {
    setMapping(m => ({ ...m, fields: { ...m.fields, [key]: rule } }));
  }

  /** Branche — ou débranche — une valeur reçue sur une destination. */
  function toggleWire(path: string, slot: SlotKey) {
    const already = (wiring.get(path) ?? []).includes(slot);
    if (slot === 'dedupe') {
      setMapping(m => ({ ...m, dedupePath: already ? null : path }));
    } else {
      setField(slot, already ? { kind: 'none' } : { kind: 'path', path });
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
      <div className='grid gap-5 lg:grid-cols-2'>
        {/* ── Gauche : ce qu'on a reçu, et où ça va ── */}
        <div className='min-w-0'>
          <h4 className='label mb-2'>Ce que nous avons reçu</h4>
          <div className='border border-line rounded-xl divide-y divide-line max-h-96 overflow-y-auto'>
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
                    lit ? 'bg-accent-50 border-l-accent-500'
                    : slots.length ? 'border-l-accent-300'
                    : 'border-l-transparent'
                  }`}
                >
                  <button
                    type='button'
                    onClick={() => isAdmin && setOpenPath(isOpen ? null : p.path)}
                    disabled={!isAdmin}
                    className='w-full text-left px-3 py-2 flex items-start gap-2 disabled:cursor-default'
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='font-mono text-xs text-muted truncate'>{p.path}</div>
                      <div className='text-sm text-ink truncate'>
                        {p.sample || <span className='text-muted italic'>vide</span>}
                      </div>
                    </div>

                    <div className='shrink-0 flex flex-wrap justify-end gap-1 max-w-[45%]'>
                      {slots.map(slot => (
                        <span
                          key={slot}
                          className='badge-info inline-flex items-center gap-0.5 whitespace-nowrap'
                        >
                          <LuArrowRight size={9} />
                          {SLOT_LABELS[slot]}
                        </span>
                      ))}
                      {slots.length === 0 && (
                        // Rien n'est « inutilisé » quand les notes ramassent le
                        // reste : le dire évite de croire que la donnée est perdue.
                        <span className='badge-neutral inline-flex items-center gap-0.5 whitespace-nowrap'>
                          <LuArrowRight size={9} />
                          {notesCatchAll ? 'Notes' : 'Ignoré'}
                        </span>
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className='px-3 pb-3 -mt-0.5'>
                      <div className='flex items-center justify-between mb-1.5'>
                        <span className='text-xs text-muted'>Envoyer cette valeur vers:</span>
                      </div>
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
                              className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                                on
                                  ? 'border-accent-500 bg-accent-500 text-white'
                                  : 'border-line hover:border-accent-300 hover:bg-canvas-100'
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
            <p className='text-xs text-muted mt-1.5'>
              Cliquez une ligne pour choisir où sa valeur atterrit. Chaque ligne indique sa
              destination.
            </p>
          )}
        </div>

        {/* ── Droite : les champs du prospect ── */}
        <div className='min-w-0'>
          <h4 className='label mb-2'>Champs du prospect</h4>
          <div className='space-y-2.5'>
            {FIELD_ORDER.map(key => (
              <FieldRow
                key={key}
                fieldKey={key}
                rule={mapping.fields[key] ?? EMPTY_MAPPING.fields[key]}
                paths={paths}
                resolved={resolvedValue(lead, key)}
                disabled={!isAdmin}
                lit={isFieldLit(key, hoverPath, hoverSlot, wiring)}
                onHover={slot => setHoverSlot(slot)}
                onChange={rule => setField(key, rule)}
              />
            ))}

            <div>
              <label className='label'>Notes</label>
              <select
                className='input'
                value={mapping.notes.mode}
                disabled={!isAdmin}
                onChange={e =>
                  setMapping(m => ({ ...m, notes: { ...m.notes, mode: e.target.value as any } }))
                }
              >
                <option value='unmapped'>Tous les champs non utilisés</option>
                <option value='none'>Aucune note</option>
              </select>
              <p className='text-xs text-muted mt-1'>
                Par défaut, ce qui n'alimente aucun champ ci-dessus finit en notes : les questions
                personnalisées d'un formulaire ne se perdent jamais.
              </p>
            </div>

            <div
              onMouseEnter={() => setHoverSlot('dedupe')}
              onMouseLeave={() => setHoverSlot(null)}
              className={`rounded-lg transition-colors ${
                isSlotLit('dedupe', hoverPath, hoverSlot, wiring) ? 'bg-accent-50' : ''
              }`}
            >
              <label className='label'>{SLOT_LABELS.dedupe}</label>
              <select
                className='input'
                value={mapping.dedupePath ?? OPT_NONE}
                disabled={!isAdmin}
                onChange={e =>
                  setMapping(m => ({
                    ...m,
                    dedupePath: e.target.value === OPT_NONE ? null : e.target.value,
                  }))
                }
              >
                <option value={OPT_NONE}>— Aucune —</option>
                {paths.map(p => (
                  <option key={p.path} value={p.path}>{p.path}</option>
                ))}
              </select>
              <p className='text-xs text-muted mt-1'>
                Un identifiant propre à l'envoi. Un même appel réémis ne créera pas de second
                prospect. Sans clé, deux envois identiques donneront deux cartes.
              </p>
            </div>

            <div>
              <label className='label'>Liste de prospects <span className='text-muted font-normal'>(optionnel)</span></label>
              <select
                className='input'
                value={mapping.rootPath ?? OPT_NONE}
                disabled={!isAdmin}
                onChange={e =>
                  setMapping(m => ({
                    ...m,
                    rootPath: e.target.value === OPT_NONE ? null : e.target.value,
                  }))
                }
              >
                <option value={OPT_NONE}>— L'appel porte un seul prospect —</option>
                {arrayPaths(payload).map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <p className='text-xs text-muted mt-1'>
                À renseigner seulement si un même appel transporte plusieurs prospects.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Aperçu ── */}
      <div>
        <h4 className='label mb-2'>Aperçu de la carte</h4>
        {lead ? (
          <div className='border border-line rounded-xl p-3 bg-canvas-100 max-w-md'>
            <p className='font-medium text-ink mb-1'>{lead.name}</p>
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
              <p className='text-xs text-muted mt-2 whitespace-pre-line border-t border-line pt-2'>
                {lead.notes}
              </p>
            )}
          </div>
        ) : (
          <p className='text-sm text-muted'>Aucun prospect ne ressort de cet appel.</p>
        )}

        {preview.warnings.length > 0 && (
          <div className='flex gap-2.5 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 mt-2'>
            <LuCircleAlert size={15} className='shrink-0 mt-0.5' />
            <ul className='space-y-0.5'>
              {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className='flex justify-end'>
          <button type='button' className='btn-primary gap-2' onClick={save} disabled={saving}>
            {saving ? <LuLoader size={16} className='animate-spin' /> : <LuSave size={16} />}
            Enregistrer la correspondance
          </button>
        </div>
      )}
    </div>
  );
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

function isFieldLit(
  key: MappedFieldKey,
  hoverPath: string | null,
  hoverSlot: SlotKey | null,
  wiring: Map<string, SlotKey[]>,
): boolean {
  if (key === 'source') return false;
  return isSlotLit(key as SlotKey, hoverPath, hoverSlot, wiring);
}

// ─── Une ligne de correspondance ──────────────────────────────────────────────

function FieldRow({
  fieldKey,
  rule,
  paths,
  resolved,
  disabled,
  lit,
  onHover,
  onChange,
}: {
  fieldKey: MappedFieldKey;
  rule: FieldRule;
  paths: DetectedPath[];
  resolved: string | null;
  disabled: boolean;
  lit: boolean;
  onHover: (slot: SlotKey | null) => void;
  onChange: (rule: FieldRule) => void;
}) {
  const selectValue =
    rule.kind === 'path' ? rule.path
    : rule.kind === 'template' ? OPT_TEMPLATE
    : rule.kind === 'const' ? OPT_CONST
    : OPT_NONE;

  const hoverProps =
    fieldKey === 'source'
      ? {}
      : {
          onMouseEnter: () => onHover(fieldKey as SlotKey),
          onMouseLeave: () => onHover(null),
        };

  // La provenance est presque toujours fixe : on met donc la liste des
  // provenances connues plutôt qu'un champ libre, qui serait ramené à « Autre ».
  if (fieldKey === 'source') {
    return (
      <div>
        <label className='label'>{MAPPED_FIELD_LABELS.source}</label>
        <select
          className='input'
          value={rule.kind === 'const' ? rule.value : 'other'}
          disabled={disabled}
          onChange={e => onChange({ kind: 'const', value: e.target.value })}
        >
          {LEAD_SOURCES.map(s => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div {...hoverProps} className={`rounded-lg transition-colors ${lit ? 'bg-accent-50' : ''}`}>
      <label className='label'>
        {MAPPED_FIELD_LABELS[fieldKey]}
        {fieldKey === 'name' && <span className='text-red-500'> *</span>}
      </label>
      <div className='flex gap-1.5 items-start'>
        <select
          className='input flex-1 min-w-0'
          value={selectValue}
          disabled={disabled}
          onChange={e => {
            const v = e.target.value;
            if (v === OPT_NONE) onChange({ kind: 'none' });
            else if (v === OPT_TEMPLATE) onChange({ kind: 'template', template: rule.kind === 'template' ? rule.template : '' });
            else if (v === OPT_CONST) onChange({ kind: 'const', value: rule.kind === 'const' ? rule.value : '' });
            else onChange({ kind: 'path', path: v });
          }}
        >
          <option value={OPT_NONE}>— Ignorer —</option>
          {paths.map(p => (
            <option key={p.path} value={p.path}>{p.path}</option>
          ))}
          <option value={OPT_TEMPLATE}>Assembler plusieurs champs…</option>
          <option value={OPT_CONST}>Valeur fixe…</option>
        </select>
        <div className='w-32 shrink-0 text-xs text-muted pt-2 truncate' title={resolved ?? ''}>
          {resolved || <span className='italic'>vide</span>}
        </div>
      </div>

      {rule.kind === 'template' && (
        <>
          <input
            className='input mt-1.5 font-mono text-xs'
            placeholder='{{first_name}} {{last_name}}'
            value={rule.template}
            disabled={disabled}
            onChange={e => onChange({ kind: 'template', template: e.target.value })}
          />
          <p className='text-xs text-muted mt-1'>
            Écrivez les chemins entre doubles accolades. Une partie absente disparaît avec son
            séparateur.
          </p>
        </>
      )}

      {rule.kind === 'const' && (
        <input
          className='input mt-1.5'
          placeholder='Valeur identique pour tous les prospects'
          value={rule.value}
          disabled={disabled}
          onChange={e => onChange({ kind: 'const', value: e.target.value })}
        />
      )}

      {fieldKey === 'name' && rule.kind === 'none' && (
        <p className='text-xs text-muted mt-1'>
          Sans association, Gestia prendra l'entreprise, puis le courriel, puis le téléphone.
        </p>
      )}
    </div>
  );
}

// ─── Petites aides ────────────────────────────────────────────────────────────

function resolvedValue(lead: ReturnType<typeof applyMapping>['leads'][number] | undefined, key: MappedFieldKey): string | null {
  if (!lead) return null;
  const value = (lead as any)[key];
  return typeof value === 'string' && value ? value : null;
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

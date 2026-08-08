// Correspondance entre le JSON d'un appel entrant et les champs d'un prospect.
//
// Le problème que ce module résout : chaque émetteur a sa propre forme. Zapier
// relaie Facebook en `field_data: [{name, values}]`, un formulaire de site web
// envoie `nom`/`courriel` en urlencodé, un script Google Sheets envoie les
// en-têtes de colonnes tels quels. Deviner à coup d'heuristiques donne un
// résultat qui marche neuf fois sur dix et qu'on ne peut pas corriger.
//
// D'où le choix : on **capture un vrai appel**, on en extrait les chemins, on
// propose une correspondance de départ (`suggestMapping`), et l'utilisateur la
// corrige. L'heuristique ne sert qu'à pré-remplir ; le contrat, c'est la
// correspondance enregistrée.
//
// Module pur, sans entrée/sortie : le serveur l'applique, et le client s'en sert
// pour afficher l'aperçu de la carte pendant qu'on règle la correspondance. Les
// deux voient donc rigoureusement le même résultat.

import { formatMontrealTime } from './format';
import { normalizeLeadSource, type LeadSourceKey } from './leadSources';

// ─── Contrat HTTP ─────────────────────────────────────────────────────────────

/** Chemin de base du point d'entrée, partagé par le serveur et par l'écran qui affiche l'adresse. */
export const LEAD_INTAKE_PATH = '/webhooks/prospects';

/** En-tête portant le secret partagé. */
export const LEAD_INTAKE_SECRET_HEADER = 'x-gestia-secret';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Une charge utile reçue, telle qu'elle traverse le fil.
 *
 * `unknown` conviendrait au moteur, qui ne présume rien de ce qu'il lit — mais
 * Wasp sérialise les retours d'opérations en SuperJSON et refuse `unknown` à la
 * compilation. Ce type dit la même chose en restant sérialisable.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Comment un champ du prospect est alimenté depuis la charge utile reçue. */
export type FieldRule =
  /** Une valeur, désignée par son chemin : `email`, `contact.email`, `field_data[name=email].values[0]`. */
  | { kind: 'path'; path: string }
  /** Plusieurs valeurs assemblées : `{{first_name}} {{last_name}}`, `{{city}}, {{province}}`. */
  | { kind: 'template'; template: string }
  /** Une valeur fixe, indépendante de la charge utile — typiquement la provenance. */
  | { kind: 'const'; value: string }
  /** Champ laissé vide. */
  | { kind: 'none' };

export type MappedFieldKey =
  | 'name'
  | 'email'
  | 'phone'
  | 'website'
  | 'address'
  | 'category'
  | 'source';

export type NotesMode =
  /** Tout ce qui n'a servi à aucun autre champ (défaut : rien ne se perd). */
  | 'unmapped'
  /** Seulement les chemins choisis. */
  | 'selected'
  | 'none';

export type LeadIntakeMapping = {
  version: 1;
  /** Chemin vers un tableau quand un même appel porte plusieurs prospects. */
  rootPath?: string | null;
  /** Chemin de la clé anti-doublon (`external_id`, `leadgen_id`, numéro de ligne…). */
  dedupePath?: string | null;
  fields: Record<MappedFieldKey, FieldRule>;
  notes: { mode: NotesMode; paths?: string[] };
};

export type MappedLead = {
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  category: string | null;
  source: LeadSourceKey;
  notes: string | null;
  externalId: string | null;
};

/** Un chemin repéré dans un échantillon, avec la valeur qui s'y trouvait. */
export type DetectedPath = { path: string; label: string; sample: string };

export const NO_RULE: FieldRule = { kind: 'none' };

export const EMPTY_MAPPING: LeadIntakeMapping = {
  version: 1,
  rootPath: null,
  dedupePath: null,
  fields: {
    name: NO_RULE,
    email: NO_RULE,
    phone: NO_RULE,
    website: NO_RULE,
    address: NO_RULE,
    category: NO_RULE,
    source: { kind: 'const', value: 'other' },
  },
  notes: { mode: 'unmapped' },
};

export const MAPPED_FIELD_LABELS: Record<MappedFieldKey, string> = {
  name: 'Nom',
  email: 'Courriel',
  phone: 'Téléphone',
  website: 'Site web',
  address: 'Adresse',
  category: 'Catégorie',
  source: 'Provenance',
};

export function isMappingConfigured(mapping: unknown): mapping is LeadIntakeMapping {
  const m = mapping as LeadIntakeMapping | null;
  return !!m && typeof m === 'object' && (m as any).version === 1 && !!m.fields;
}

// ─── Lecture par chemin ───────────────────────────────────────────────────────

/**
 * Découpe un chemin en segments : `a.b[0]` → `['a', 'b', '0']`,
 * `field_data[name=email].values[0]` → `['field_data', {key:'name', value:'email'}, 'values', '0']`.
 */
type Segment = string | { key: string; value: string };

function parsePath(path: string): Segment[] {
  const segments: Segment[] = [];
  // Un seul balayage : les crochets peuvent contenir un `=`, donc un split('.')
  // naïf couperait `field_data[name=a.b]` au mauvais endroit.
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) segments.push(buf);
    buf = '';
  };
  while (i < path.length) {
    const c = path[i];
    if (c === '.') {
      flush();
      i++;
    } else if (c === '[') {
      flush();
      const end = path.indexOf(']', i);
      if (end === -1) {
        buf += c;
        i++;
        continue;
      }
      const inner = path.slice(i + 1, end);
      const eq = inner.indexOf('=');
      segments.push(eq === -1 ? inner : { key: inner.slice(0, eq), value: inner.slice(eq + 1) });
      i = end + 1;
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  return segments;
}

/**
 * Résout un chemin dans une charge utile. Renvoie `undefined` dès qu'un segment
 * ne mène nulle part — un chemin qui ne correspond plus (l'émetteur a changé de
 * forme) doit produire un champ vide, pas une exception qui ferait échouer tout
 * l'appel.
 */
export function getByPath(payload: unknown, path: string | null | undefined): unknown {
  if (!path) return undefined;
  let current: any = payload;
  for (const seg of parsePath(path)) {
    if (current == null) return undefined;
    if (typeof seg === 'string') {
      current = Array.isArray(current) && /^\d+$/.test(seg) ? current[Number(seg)] : current[seg];
    } else {
      if (!Array.isArray(current)) return undefined;
      current = current.find(item => item != null && String(item[seg.key]) === seg.value);
    }
  }
  return current;
}

function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ');
  return '';
}

// ─── Aplatissement d'un échantillon ───────────────────────────────────────────

const MAX_DEPTH = 6;
const MAX_PATHS = 200;

/**
 * Tous les chemins utilisables d'un échantillon, avec un extrait de leur valeur.
 *
 * Cas particulier volontaire : un tableau d'objets `{name, value(s)}` reçoit en
 * plus un sélecteur par clé — `field_data[name=email].values[0]` à côté de
 * `field_data[0].values[0]`. C'est exactement la forme que Zapier et Make
 * relaient depuis Meta, et l'index positionnel y est instable : l'ordre des
 * questions d'un formulaire change dès qu'on le modifie. Choisir par nom survit
 * à ça, choisir par index non.
 */
export function flattenPaths(payload: unknown): DetectedPath[] {
  const out: DetectedPath[] = [];
  const seen = new Set<string>();

  const push = (path: string, value: unknown, label?: string) => {
    if (out.length >= MAX_PATHS || seen.has(path)) return;
    seen.add(path);
    const sample = toText(value);
    out.push({ path, label: label ?? path, sample: sample.length > 120 ? `${sample.slice(0, 117)}…` : sample });
  };

  const walk = (value: unknown, prefix: string, depth: number) => {
    if (out.length >= MAX_PATHS || depth > MAX_DEPTH || value == null) return;

    if (Array.isArray(value)) {
      // Un tableau `{name, value(s)}` n'est *que* désigné par nom : les jumeaux
      // positionnels (`field_data[0].values[0]`) resteraient lisibles par
      // getByPath, mais les proposer serait un piège — l'ordre des questions d'un
      // formulaire change dès qu'on le modifie, et la correspondance pointerait
      // silencieusement sur la mauvaise réponse. Les exclure évite du même coup
      // de retrouver « Name : email / Values : … » dans les notes.
      if (isNameValueArray(value)) {
        value.forEach(item => {
          const key = String((item as any).name);
          const valueField = 'values' in (item as any) ? 'values[0]' : 'value';
          const path = `${prefix}[name=${key}].${valueField}`;
          push(path, getByPath(payload, path), key);
        });
        return;
      }
      value.forEach((item, index) => walk(item, `${prefix}[${index}]`, depth + 1));
      return;
    }

    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (child != null && typeof child === 'object') walk(child, path, depth + 1);
        else push(path, child);
      }
      return;
    }

    push(prefix, value);
  };

  walk(payload, '', 0);
  return out;
}

function isNameValueArray(value: unknown[]): boolean {
  return (
    value.length > 0 &&
    value.every(
      item =>
        item != null &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        'name' in (item as any) &&
        ('value' in (item as any) || 'values' in (item as any)),
    )
  );
}

// ─── Correspondance proposée ──────────────────────────────────────────────────

/** Dernier segment d'un chemin, ramené à une forme comparable : `Full Name` → `fullname`. */
function normalizeKey(path: string): string {
  const segments = parsePath(path);
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (typeof seg !== 'string') return seg.value.toLowerCase().replace(/[\s_-]/g, '');
    if (!/^\d+$/.test(seg) && seg !== 'values' && seg !== 'value') {
      return seg.toLowerCase().replace(/[\s_-]/g, '');
    }
  }
  return path.toLowerCase().replace(/[\s_-]/g, '');
}

/** Synonymes reconnus, du plus précis au plus vague — le premier trouvé gagne. */
const ALIASES: Record<Exclude<MappedFieldKey, 'source'> | 'first' | 'last' | 'company' | 'city' | 'province' | 'postal' | 'dedupe', string[]> = {
  name: ['fullname', 'name', 'nom', 'nomcomplet', 'yourname', 'nomprenom', 'contactname'],
  first: ['firstname', 'prenom', 'givenname'],
  last: ['lastname', 'nomdefamille', 'nomfamille', 'surname', 'familyname'],
  email: ['email', 'courriel', 'emailaddress', 'adressecourriel', 'mail'],
  phone: ['phonenumber', 'phone', 'telephone', 'tel', 'numero', 'numerodetelephone', 'mobile', 'cellulaire'],
  website: ['website', 'siteweb', 'site', 'url', 'webpage'],
  address: ['streetaddress', 'address', 'adresse', 'rue', 'addressline1'],
  city: ['city', 'ville'],
  province: ['province', 'state', 'region'],
  postal: ['postalcode', 'codepostal', 'postcode', 'zipcode', 'zip'],
  category: ['category', 'categorie', 'secteur', 'industry', 'typedentreprise'],
  company: ['companyname', 'company', 'entreprise', 'business', 'organisation', 'organization', 'compagnie'],
  dedupe: ['externalid', 'leadgenid', 'leadid', 'id', 'submissionid', 'entryid'],
};

function findPath(paths: DetectedPath[], aliases: string[]): string | null {
  for (const alias of aliases) {
    const hit = paths.find(p => normalizeKey(p.path) === alias);
    if (hit) return hit.path;
  }
  return null;
}

/**
 * Provenance devinée d'après la forme de l'appel.
 *
 * `leadgen_id` et `field_data` sont la signature d'un formulaire Meta relayé par
 * Zapier ou Make ; rien d'autre n'a cette allure. Deviner ici plutôt que de le
 * demander à la création du tableau : à ce moment-là on a l'appel sous les yeux,
 * et l'utilisateur corrige d'un clic dans la même liste déroulante.
 */
export function inferSource(paths: DetectedPath[]): LeadSourceKey {
  const keys = paths.map(p => p.path.toLowerCase());
  const has = (needle: string) => keys.some(k => k.includes(needle));
  if (has('leadgen_id') || has('field_data')) return 'facebook';
  return 'other';
}

/**
 * Correspondance de départ, déduite des noms de champs. Sert **uniquement** à
 * pré-remplir l'assistant : l'utilisateur voit chaque ligne et la corrige. Une
 * heuristique qu'on peut relire et rectifier vaut mieux qu'une heuristique
 * invisible qui se trompe en silence.
 */
export function suggestMapping(
  paths: DetectedPath[],
  defaultSource: LeadSourceKey = inferSource(paths),
): LeadIntakeMapping {
  const rule = (path: string | null): FieldRule => (path ? { kind: 'path', path } : NO_RULE);

  // Nom : `full_name` s'il existe, sinon prénom + nom assemblés, sinon rien —
  // le repli vers l'entreprise/courriel/téléphone est appliqué à l'exécution.
  const full = findPath(paths, ALIASES.name);
  const first = findPath(paths, ALIASES.first);
  const last = findPath(paths, ALIASES.last);
  let nameRule: FieldRule = rule(full);
  if (!full && (first || last)) {
    nameRule = { kind: 'template', template: [first, last].filter(Boolean).map(p => `{{${p}}}`).join(' ') };
  }

  // Adresse : les émetteurs la découpent presque toujours. On rassemble ce qu'on
  // trouve dans l'ordre naturel plutôt que de ne garder que la rue.
  const street = findPath(paths, ALIASES.address);
  const city = findPath(paths, ALIASES.city);
  const province = findPath(paths, ALIASES.province);
  const postal = findPath(paths, ALIASES.postal);
  const addressParts = [street, city, province, postal].filter(Boolean) as string[];
  const addressRule: FieldRule =
    addressParts.length > 1
      ? { kind: 'template', template: addressParts.map(p => `{{${p}}}`).join(', ') }
      : rule(addressParts[0] ?? null);

  return {
    version: 1,
    rootPath: null,
    dedupePath: findPath(paths, ALIASES.dedupe),
    fields: {
      name: nameRule,
      email: rule(findPath(paths, ALIASES.email)),
      phone: rule(findPath(paths, ALIASES.phone)),
      website: rule(findPath(paths, ALIASES.website)),
      address: addressRule,
      category: rule(findPath(paths, ALIASES.category)),
      source: { kind: 'const', value: defaultSource },
    },
    notes: { mode: 'unmapped' },
  };
}

// ─── Application ──────────────────────────────────────────────────────────────

/**
 * Bruit de plomberie des plateformes d'automatisation : présent dans la charge
 * utile, sans aucun intérêt sur une carte de prospect.
 */
const NOISE_KEY = /^(zap|bundle|_meta|__|hook|webhook_|querystring)/i;

function resolveRule(payload: unknown, rule: FieldRule | undefined): string {
  if (!rule) return '';
  switch (rule.kind) {
    case 'path':
      return toText(getByPath(payload, rule.path));
    case 'const':
      return rule.value.trim();
    case 'template':
      // Les parties absentes disparaissent avec leur séparateur, sinon un
      // `{{city}}, {{province}}` sans province laisserait « Laval, ».
      return renderTemplate(payload, rule.template);
    default:
      return '';
  }
}

function renderTemplate(payload: unknown, template: string): string {
  const parts: { text: string; resolved: boolean }[] = [];
  let last = 0;
  const re = /\{\{([^}]+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    if (match.index > last) parts.push({ text: template.slice(last, match.index), resolved: true });
    parts.push({ text: toText(getByPath(payload, match[1].trim())), resolved: false });
    last = match.index + match[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last), resolved: true });

  // Reconstruit en jetant les séparateurs orphelins : on ne garde un littéral
  // que s'il reste une valeur de chaque côté.
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.resolved) {
      out += part.text;
      continue;
    }
    const before = out.trim().length > 0;
    const after = parts.slice(i + 1).some(p => !p.resolved && p.text.trim().length > 0);
    if (before && after) out += part.text;
  }
  return out.trim().replace(/\s+/g, ' ');
}

const CLEAN = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/** Chemins consommés par un champ, pour savoir ce qui reste à mettre en notes. */
function consumedPaths(mapping: LeadIntakeMapping): Set<string> {
  const used = new Set<string>();
  for (const rule of Object.values(mapping.fields)) {
    if (rule?.kind === 'path') used.add(rule.path);
    if (rule?.kind === 'template') {
      for (const m of rule.template.matchAll(/\{\{([^}]+)\}\}/g)) used.add(m[1].trim());
    }
  }
  if (mapping.dedupePath) used.add(mapping.dedupePath);
  return used;
}

function buildNotes(
  item: unknown,
  mapping: LeadIntakeMapping,
  context: { boardLabel: string; receivedAt: Date },
): string | null {
  if (mapping.notes.mode === 'none') return null;

  const used = consumedPaths(mapping);
  const paths = flattenPaths(item);
  const chosen =
    mapping.notes.mode === 'selected'
      ? paths.filter(p => (mapping.notes.paths ?? []).includes(p.path))
      : paths.filter(p => !used.has(p.path) && !NOISE_KEY.test(p.path));

  const lines = chosen
    .filter(p => p.sample.length > 0)
    .map(p => `${humanizeLabel(p.label)} : ${p.sample}`);

  const header = `Reçu de « ${context.boardLabel} » le ${formatMontrealTime(context.receivedAt)}`;
  return [header, ...lines].join('\n');
}

/** `phone_number` → « Phone number », `budget-estime` → « Budget estime ». */
function humanizeLabel(label: string): string {
  const last = label.split('.').pop() ?? label;
  const words = last.replace(/\[\d+\]/g, '').replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ApplyResult = { leads: MappedLead[]; warnings: string[] };

/**
 * Applique une correspondance à une charge utile reçue.
 *
 * Ne lève jamais : un émetteur qui change de forme doit produire un prospect
 * incomplet et un avertissement lisible, pas une erreur 500 qui ferait retenter
 * l'appel indéfiniment.
 */
export function applyMapping(
  payload: unknown,
  mapping: LeadIntakeMapping,
  context: { boardLabel: string; receivedAt?: Date },
): ApplyResult {
  const receivedAt = context.receivedAt ?? new Date();
  const warnings: string[] = [];

  // Un même appel peut porter plusieurs prospects (un lot de lignes de tableur).
  let items: unknown[];
  if (mapping.rootPath) {
    const root = getByPath(payload, mapping.rootPath);
    if (Array.isArray(root)) items = root;
    else if (root != null) items = [root];
    else {
      warnings.push(`Le chemin « ${mapping.rootPath} » ne mène à aucune liste dans cet appel.`);
      items = [];
    }
  } else {
    items = Array.isArray(payload) ? payload : [payload];
  }

  const leads: MappedLead[] = [];
  items.forEach((item, index) => {
    const email = CLEAN(resolveRule(item, mapping.fields.email));
    // Le « + » est conservé tel quel : `toE164` s'en sert pour désarmer sa règle
    // nord-américaine à dix chiffres. Le retirer transformerait silencieusement
    // un numéro français en un numéro valide mais faux.
    const phone = CLEAN(resolveRule(item, mapping.fields.phone));
    const company = CLEAN(resolveRule(item, mapping.fields.category));

    // `Lead.name` est non nul en base : la chaîne de repli ne doit jamais rendre
    // vide, sinon l'insertion échoue et le prospect est perdu.
    const name =
      CLEAN(resolveRule(item, mapping.fields.name)) ??
      company ??
      email ??
      phone ??
      'Prospect';

    if (!CLEAN(resolveRule(item, mapping.fields.name)) && (email || phone)) {
      warnings.push(
        items.length > 1
          ? `Prospect ${index + 1} : aucun nom trouvé, « ${name} » utilisé à la place.`
          : `Aucun nom trouvé, « ${name} » utilisé à la place.`,
      );
    }

    leads.push({
      name,
      email,
      phone,
      website: CLEAN(resolveRule(item, mapping.fields.website)),
      address: CLEAN(resolveRule(item, mapping.fields.address)),
      category: company,
      source: normalizeLeadSource(resolveRule(item, mapping.fields.source)),
      notes: buildNotes(item, mapping, { boardLabel: context.boardLabel, receivedAt }),
      externalId: CLEAN(toText(getByPath(item, mapping.dedupePath))),
    });
  });

  return { leads, warnings };
}

/**
 * Un prospect sans nom réel, sans courriel et sans téléphone n'est pas
 * exploitable : ni relance, ni suivi. Mieux vaut le refuser bruyamment — le
 * journal de Zapier montrera l'erreur — que de garnir le tableau de cartes
 * « Prospect » vides que personne ne pourra rattacher à quoi que ce soit.
 */
export function isUsableLead(lead: MappedLead): boolean {
  return !!(lead.email || lead.phone || (lead.name && lead.name !== 'Prospect'));
}

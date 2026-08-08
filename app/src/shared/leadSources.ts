// Provenance d'un prospect — d'où il vient, indépendamment du tableau où il vit.
//
// Vit ici plutôt que dans `leads.shared.tsx` parce que le serveur doit traiter la
// provenance qu'un appel entrant prétend avoir, et que `leads.shared.tsx` importe
// le Kanban Syncfusion au niveau module, ce qu'on ne veut évidemment pas tirer
// dans le serveur.
//
// La liste ci-dessous n'est plus la vérité : elle sème `LeadSourceConfig` au
// premier accès d'une entreprise, qui peut ensuite renommer, recolorer, ajouter
// les siennes, et en voir naître automatiquement quand une correspondance câble la
// provenance sur une valeur de la charge utile. Tout ce fichier reste donc **pur et
// synchrone** : `applyMapping` s'en sert pour l'aperçu en direct côté client autant
// que pour l'insertion côté serveur, et une lecture en base y est impossible.

export const DEFAULT_LEAD_SOURCES = [
  { key: 'google_maps', label: 'Google Maps', color: '#4285f4', order: 0 },
  { key: 'manual', label: 'Ajout manuel', color: '#6b7280', order: 1 },
  { key: 'facebook', label: 'Facebook', color: '#1877f2', order: 2 },
  { key: 'instagram', label: 'Instagram', color: '#e1306c', order: 3 },
  { key: 'linkedin', label: 'LinkedIn', color: '#0a66c2', order: 4 },
  { key: 'referral', label: 'Référence', color: '#10b981', order: 5 },
  { key: 'website', label: 'Site web', color: '#f59e0b', order: 6 },
  { key: 'other', label: 'Autre', color: '#9ca3af', order: 7 },
] as const;

/**
 * La provenance de rattrapage : celle qu'on donne quand on n'a rien de mieux.
 *
 * L'équivalent de `UNKNOWN_STATUS_KEY` pour les statuts, à une différence près :
 * elle existe réellement en base. « Autre » est une provenance légitime qu'on peut
 * choisir dans une liste, pas une colonne fantôme de rattrapage.
 */
export const FALLBACK_SOURCE_KEY = 'other';

/** Plafond de provenances par entreprise — voir `registerLeadSources`. */
export const MAX_SOURCES_PER_COMPANY = 60;

/** Longueur maximale d'une clé produite par `slugifyLeadSource`. */
const MAX_KEY_CHARS = 40;

/**
 * Longueur maximale d'une étiquette.
 *
 * La clé est plafonnée par construction, l'étiquette ne l'était pas : une
 * correspondance câblée sur le mauvais champ enverrait une phrase entière, qui
 * deviendrait un onglet plus large que le tableau. On tronque à la réception
 * plutôt qu'à l'affichage — une étiquette illisible se répare en la renommant,
 * pas en espérant que chaque écran pense à la couper.
 */
export const MAX_SOURCE_LABEL_CHARS = 60;

/** Ramène une étiquette à quelque chose d'affichable, ou `null` si elle est vide. */
export function cleanSourceLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_SOURCE_LABEL_CHARS
    ? `${trimmed.slice(0, MAX_SOURCE_LABEL_CHARS - 1).trimEnd()}…`
    : trimmed;
}

/** La forme minimale dont l'affichage a besoin — une ligne de `LeadSourceConfig`. */
export type LeadSourceOption = {
  key: string;
  label: string;
  color?: string;
};

/** Rétrocompatibilité : du code encore écrit contre l'ancien nom. */
export const LEAD_SOURCES = DEFAULT_LEAD_SOURCES;
export type LeadSourceKey = (typeof DEFAULT_LEAD_SOURCES)[number]['key'];

/**
 * Ramène une valeur quelconque à une clé de provenance utilisable.
 *
 * Purement mécanique, sans consultation d'un registre : c'est ce que
 * `applyMapping` appelle, des deux côtés du fil. Une valeur venue de la charge
 * utile — « Salon Habitation 2026 », « fb/été-2026 » — devient une clé stable, et
 * c'est le serveur qui décide ensuite s'il l'enregistre (voir `registerLeadSources`
 * côté `leadIntake/persist`).
 *
 * Les accents passent par NFD plutôt que par une table de correspondance : « Référence »
 * doit donner `reference` et non `rf`, et le fr-CA en produit à peu près partout.
 *
 * Toute suite de caractères non alphanumériques devient **un** souligné plutôt que
 * d'être effacée : les noms de campagne sont pleins de tirets et de barres
 * obliques, et les supprimer collait les mots deux à deux — `fb/été-2026` donnait
 * `fbete2026`, illisible partout où la clé se montre.
 */
export function slugifyLeadSource(value: unknown): string {
  if (typeof value !== 'string') return FALLBACK_SOURCE_KEY;
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, MAX_KEY_CHARS)
    // Le découpage peut laisser un souligné en fin de chaîne.
    .replace(/_+$/, '');
  return slug || FALLBACK_SOURCE_KEY;
}

/**
 * L'étiquette à afficher pour une clé, en repli successif.
 *
 * Registre → liste d'amorçage → clé dé-sluggifiée. Le dernier repli compte : entre
 * le moment où un appel entrant invente une provenance et celui où le client
 * recharge son registre, une carte doit afficher « Salon habitation 2026 » et non
 * `salon_habitation_2026`.
 */
export function leadSourceLabel(
  source: string | null | undefined,
  configs?: readonly LeadSourceOption[] | null,
): string {
  if (!source) return 'Inconnue';
  const fromRegistry = configs?.find(s => s.key === source);
  if (fromRegistry) return fromRegistry.label;
  const fromDefaults = DEFAULT_LEAD_SOURCES.find(s => s.key === source);
  if (fromDefaults) return fromDefaults.label;
  return humanizeSourceKey(source);
}

/** La couleur d'une provenance, avec le même repli que l'étiquette. */
export function leadSourceColor(
  source: string | null | undefined,
  configs?: readonly LeadSourceOption[] | null,
): string {
  if (!source) return '#9ca3af';
  return (
    configs?.find(s => s.key === source)?.color ??
    DEFAULT_LEAD_SOURCES.find(s => s.key === source)?.color ??
    '#9ca3af'
  );
}

/**
 * `salon_habitation_2026` → « Salon habitation 2026 ».
 *
 * Sert d'étiquette par défaut à une provenance apprise. Volontairement sobre : on
 * ne met une majuscule qu'au premier mot, parce que capitaliser chaque mot
 * produirait « Site Web » ou « Référence Client », qui se lisent mal en français.
 */
export function humanizeSourceKey(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  if (!words) return 'Inconnue';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Valide une provenance choisie dans une liste.
 *
 * Réservée aux chemins où l'utilisateur a cliqué dans un `<select>` alimenté par le
 * registre : `createLead`, `updateLead`. Une clé absente y est un bogue, pas une
 * saisie à rattraper — d'où le `null` renvoyé, que l'appelant transforme en 400.
 *
 * À ne pas confondre avec `slugifyLeadSource`, qui accepte tout parce qu'elle
 * traite une valeur venue d'un tiers.
 */
export function normalizeLeadSource(
  source: unknown,
  allowedKeys: readonly string[],
): string | null {
  const key = slugifyLeadSource(source);
  return allowedKeys.includes(key) ? key : null;
}

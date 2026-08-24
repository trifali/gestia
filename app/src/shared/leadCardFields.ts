// Ce qu'une carte de kanban montre, et dans quel ordre.
//
// Le problème que ce module résout : la carte affichait un jeu de champs figé
// dans le JSX — nom, site, téléphone, courriel, note Google. Convenable pour une
// recherche Google Maps, à côté de la plaque pour un formulaire de site web où ce
// qui décide de rappeler ou non est le budget annoncé, et où l'adresse ne sert à
// rien. Aucun réglage ne permettait de le dire.
//
// D'où le choix : la carte se **compose**. Chaque champ porte une étoile — allumée,
// il est sur la carte ; éteinte, il n'y est plus, sans disparaître de la fiche. Un
// champ libre s'ajoute à la même liste et s'étoile pareil.
//
// ── Deux portées, comme les statuts ──────────────────────────────────────────
//
// Le jeu de l'entreprise vaut par défaut pour tous les tableaux ; un tableau peut
// le **remplacer entièrement**. Tout ou rien, jamais une fusion — exactement la
// règle de `LeadStatusConfig`, et pour la même raison : un tableau qui hériterait
// de la moitié des champs serait impossible à raisonner, et renommer un champ
// d'entreprise donnerait des résultats imprévisibles.
//
// Module pur, sans entrée/sortie : le serveur sème et résout, le client affiche et
// règle. Les deux voient donc rigoureusement la même carte.

import type { MappedFieldKey } from './leadIntake';

/**
 * Un champ libre se distingue d'une colonne du prospect par ce préfixe.
 *
 * Un préfixe plutôt qu'un booléen `isExtra` : la clé voyage seule — dans une
 * correspondance, dans `Lead.extras`, dans une contrainte d'unicité — et doit
 * pouvoir se lire sans sa ligne de configuration à côté.
 */
export const EXTRA_PREFIX = 'extra:';

export function extraFieldKey(id: string): string {
  return `${EXTRA_PREFIX}${id}`;
}

export function isExtraFieldKey(key: string): boolean {
  return key.startsWith(EXTRA_PREFIX);
}

/** L'identifiant nu d'un champ libre : `extra:budget` → `budget`. */
export function extraFieldId(key: string): string {
  return isExtraFieldKey(key) ? key.slice(EXTRA_PREFIX.length) : key;
}

/**
 * Une clé stable déduite d'un intitulé : « Budget estimé » → `budget_estime`.
 *
 * Sert à nommer un champ libre créé à la main, pour que la même information porte
 * la même clé d'un tableau à l'autre — c'est ce qui permet à une correspondance de
 * webhook et à une saisie manuelle d'alimenter le même champ.
 */
export function slugifyFieldLabel(label: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || 'info';
}

/** Les colonnes du prospect affichables sur une carte, dans leur ordre naturel. */
export type BuiltInCardFieldKey = MappedFieldKey | 'rating';

export type CardFieldDefinition = {
  key: string;
  label: string;
  /** Étoilé au premier accès de l'entreprise. */
  onCard: boolean;
  /** Visible dans la fiche au premier accès. */
  onDetail: boolean;
};

/**
 * Le jeu semé à la première ouverture, choisi pour ne rien changer à ce que les
 * cartes montraient avant que ce réglage n'existe.
 *
 * `address` et `category` sont donc éteints : ils n'étaient pas sur la carte, et
 * les allumer d'office aurait rallongé toutes les colonnes de tous les tableaux
 * existants au premier déploiement — une migration visible que personne n'a
 * demandée. Ils sont dans la liste, à un clic.
 */
export const DEFAULT_CARD_FIELDS: CardFieldDefinition[] = [
  { key: 'name', label: 'Nom', onCard: true, onDetail: false },
  { key: 'source', label: 'Provenance', onCard: true, onDetail: false },
  { key: 'phone', label: 'Téléphone', onCard: true, onDetail: true },
  { key: 'email', label: 'Courriel', onCard: true, onDetail: true },
  { key: 'website', label: 'Site web', onCard: true, onDetail: true },
  { key: 'rating', label: 'Note Google', onCard: true, onDetail: true },
  { key: 'address', label: 'Adresse', onCard: false, onDetail: true },
  { key: 'category', label: 'Catégorie', onCard: false, onDetail: false },
];

/**
 * Les deux champs qui n'ont pas de ligne d'information dans la fiche.
 *
 * Le nom en est le titre, et la provenance y a déjà son propre sélecteur. Leur
 * donner un œil laisserait croire qu'on peut les en retirer, alors qu'il n'y a
 * rien à retirer — et l'allumer les afficherait en double.
 */
export const DETAIL_EXEMPT_FIELDS = new Set(['name', 'source']);

export function hasDetailToggle(key: string): boolean {
  return !DETAIL_EXEMPT_FIELDS.has(key);
}

/**
 * Le nom ne se retire pas.
 *
 * Une carte sans rien pour désigner le prospect n'est plus une carte : on ne peut
 * ni la reconnaître, ni la déplacer sciemment, ni savoir laquelle on ouvre. Le
 * réglage compose ce qui s'ajoute au nom, il ne compose pas le nom lui-même.
 */
export const LOCKED_CARD_FIELDS = new Set(['name']);

export function isLockedCardField(key: string): boolean {
  return LOCKED_CARD_FIELDS.has(key);
}

/** Une ligne de configuration telle qu'elle arrive de la base. */
export type CardFieldConfig = {
  id?: string;
  key: string;
  label: string;
  onCard: boolean;
  /** Absent d'une ligne semée avant l'existence de l'œil : traité comme visible. */
  onDetail?: boolean;
  order: number;
  /** Non nul = ce tableau surcharge le jeu de l'entreprise. */
  searchId?: string | null;
};

/**
 * Les champs réellement affichés, dans l'ordre, à partir des lignes résolues.
 *
 * Le nom passe toujours, même si une ligne mal formée prétend le contraire : la
 * garde vit ici plutôt que dans l'écran de réglage, parce qu'une configuration
 * peut aussi venir d'une base modifiée à la main.
 */
export function visibleCardFields(configs: readonly CardFieldConfig[]): CardFieldConfig[] {
  const shown = [...configs]
    .sort((a, b) => a.order - b.order)
    .filter(c => c.onCard || isLockedCardField(c.key));
  return shown;
}

/**
 * Les champs à afficher dans la **fiche**, dans l'ordre.
 *
 * Le même ordre que la carte : régler deux ordres pour deux écrans donnerait deux
 * réglages à tenir alignés, pour un bénéfice que personne n'a demandé.
 *
 * `onDetail` absent vaut visible — une ligne semée avant l'existence de l'œil
 * décrit la fiche telle qu'elle était, et la masquer d'office ferait disparaître
 * des informations sans que personne ne l'ait demandé.
 */
export function visibleDetailFields(configs: readonly CardFieldConfig[]): CardFieldConfig[] {
  return [...configs]
    .sort((a, b) => a.order - b.order)
    .filter(c => hasDetailToggle(c.key) && (c.onDetail ?? true));
}

/**
 * Vrai quand ces lignes appartiennent en propre au tableau donné.
 *
 * Les lignes portent leur `searchId`, ce qui suffit au client pour savoir s'il
 * regarde une surcharge ou le jeu de l'entreprise — même mécanique que pour les
 * statuts, et donc même bandeau de portée en tête de l'écran de réglage.
 */
export function isBoardOverride(
  configs: readonly CardFieldConfig[],
  searchId: string | null | undefined,
): boolean {
  return !!searchId && configs.some(c => c.searchId === searchId);
}

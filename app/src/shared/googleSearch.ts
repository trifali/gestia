// ─── Critères d'une recherche Google Maps ─────────────────────────────────────
//
// Une seule définition pour le formulaire, le serveur qui interroge Google, et
// tous les écrans qui affichent les critères d'un tableau (en-tête, « Chercher
// plus », lien de partage).
//
// Les tableaux créés avant cette forme portent `businessType` (une seule chaîne)
// et `requireWebsite` : `normalizeCriteria` les lit sans qu'on ait à réécrire la
// base, et la prochaine recherche enregistre la forme actuelle.

export type WebsiteFilter = 'any' | 'with' | 'without';

export type GoogleSearchCriteria = {
  /** Un à trois types d'entreprise, cherchés l'un après l'autre et fusionnés. */
  businessTypes: string[];
  city: string;
  /** Code de province (`QC`, `ON`…). */
  province: string;
  /** Rayon autour du centre de la ville, en mètres. */
  radius: number;
  /** Note Google minimale ; `0` = aucune exigence. */
  minRating: number;
  /**
   * Note Google maximale, incluse (« 2 ★ ou moins ») ; `0` = aucune limite.
   * Les entreprises mal notées sont souvent celles qui ont le plus besoin d'aide :
   * c'est un critère de prospection à part entière, pas seulement un filtre.
   */
  maxRating: number;
  /** Avec `maxRating` : garder aussi les entreprises qui n'ont encore aucun avis. */
  includeUnrated: boolean;
  /** Avec site web, sans site web, ou peu importe. */
  website: WebsiteFilter;
  /** N'ajouter que les entreprises qui affichent un téléphone. */
  requirePhone: boolean;
  /** Écarter les entreprises déjà présentes dans un autre tableau de l'entreprise. */
  skipKnown: boolean;
  /** Nombre de prospects visés — atteint après filtrage, pas avant. */
  maxResults: number;
  language: 'fr' | 'en';
};

export const MAX_BUSINESS_TYPES = 3;

export const RADIUS_CHOICES = [2000, 5000, 10000, 25000, 50000] as const;
export const RATING_CHOICES = [0, 3, 4, 4.5] as const;
export const MAX_RATING_CHOICES = [0, 2, 3, 4] as const;

/** Les choix du formulaire : au moins une note, ou au plus une note — jamais les deux. */
export const RATING_PRESETS: { key: string; label: string; minRating: number; maxRating: number }[] = [
  { key: 'all', label: 'Toutes', minRating: 0, maxRating: 0 },
  { key: 'min4.5', label: '4,5 ★ et plus', minRating: 4.5, maxRating: 0 },
  { key: 'min4', label: '4 ★ et plus', minRating: 4, maxRating: 0 },
  { key: 'min3', label: '3 ★ et plus', minRating: 3, maxRating: 0 },
  { key: 'max4', label: '4 ★ ou moins', minRating: 0, maxRating: 4 },
  { key: 'max3', label: '3 ★ ou moins', minRating: 0, maxRating: 3 },
  { key: 'max2', label: '2 ★ ou moins', minRating: 0, maxRating: 2 },
];

export function ratingPresetKey(c: Pick<GoogleSearchCriteria, 'minRating' | 'maxRating'>): string {
  return RATING_PRESETS.find(p => p.minRating === c.minRating && p.maxRating === c.maxRating)?.key ?? 'all';
}

const fr = (n: number) => String(n).replace('.', ',');
/** 60 : le plafond de Google pour une même requête (trois pages de vingt). */
export const RESULT_CHOICES = [10, 20, 40, 60] as const;

export const WEBSITE_CHOICES: { value: WebsiteFilter; label: string; hint: string }[] = [
  { value: 'any', label: 'Peu importe', hint: 'Toutes les entreprises' },
  { value: 'with', label: 'Avec site web', hint: 'Seulement celles qui ont un site' },
  { value: 'without', label: 'Sans site web', hint: "Seulement celles qui n'en ont pas" },
];

export const PROVINCES: { code: string; name: string }[] = [
  { code: 'QC', name: 'Québec' },
  { code: 'ON', name: 'Ontario' },
  { code: 'BC', name: 'Colombie-Britannique' },
  { code: 'AB', name: 'Alberta' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'NS', name: 'Nouvelle-Écosse' },
  { code: 'NB', name: 'Nouveau-Brunswick' },
  { code: 'NL', name: 'Terre-Neuve-et-Labrador' },
  { code: 'PE', name: 'Île-du-Prince-Édouard' },
  { code: 'YT', name: 'Yukon' },
  { code: 'NT', name: 'Territoires du Nord-Ouest' },
  { code: 'NU', name: 'Nunavut' },
];

export function provinceName(code: string): string {
  return PROVINCES.find(p => p.code === code)?.name ?? code;
}

/** Les suggestions du champ « Type d'entreprise », par secteur. Toute saisie libre reste permise. */
export const BUSINESS_TYPE_GROUPS: { label: string; items: string[] }[] = [
  { label: 'Construction et rénovation', items: ['Entrepreneur général', 'Plombier', 'Électricien', 'Menuisier', 'Peintre', 'Couvreur', 'Paysagiste', 'Installateur de thermopompes', 'Excavation', 'Architecte', 'Designer intérieur'] },
  { label: 'Restauration', items: ['Restaurant', 'Café', 'Boulangerie', 'Traiteur', 'Bar', 'Food truck'] },
  { label: 'Services professionnels', items: ['Avocat', 'Notaire', 'Comptable', 'Fiscaliste', 'Courtier immobilier', "Courtier d'assurance", 'Agence web', 'Agence marketing', 'Agence de communication'] },
  { label: 'Santé', items: ['Médecin', 'Dentiste', 'Physiothérapeute', 'Chiropraticien', 'Massothérapeute', 'Optométriste', 'Clinique vétérinaire'] },
  { label: 'Beauté et bien-être', items: ['Salon de coiffure', 'Barbier', 'Salon de beauté', 'Spa', 'Esthéticienne', 'Gym', 'Studio yoga'] },
  { label: 'Automobile', items: ['Garage', 'Mécanicien auto', 'Carrossier', 'Concessionnaire', 'Lave-auto'] },
  { label: 'Commerce de détail', items: ['Fleuriste', 'Boutique de vêtements', 'Boutique cadeaux', 'Librairie', 'Quincaillerie', 'Animalerie'] },
  { label: 'Services', items: ['Nettoyage commercial', 'Service de ménage', 'Déménageur', 'Photographe', 'Vidéaste', 'Garderie', 'Centre de formation', 'École de conduite'] },
  { label: 'Hébergement', items: ['Hôtel', 'Auberge', 'Gîte', 'Chalet à louer', 'Camping'] },
];

/** Les villes proposées ; la saisie libre reste permise. Choisir une ville règle sa province. */
export const CITY_SUGGESTIONS: { city: string; province: string }[] = [
  ...['Montréal', 'Québec', 'Laval', 'Gatineau', 'Longueuil', 'Sherbrooke', 'Saguenay', 'Lévis', 'Trois-Rivières',
    'Terrebonne', 'Saint-Jean-sur-Richelieu', 'Repentigny', 'Brossard', 'Drummondville', 'Saint-Jérôme',
    'Granby', 'Blainville', 'Saint-Hyacinthe', 'Mirabel', 'Shawinigan', 'Dollard-des-Ormeaux', 'Rimouski',
    'Châteauguay', 'Mascouche', 'Victoriaville', 'Saint-Eustache', 'Boucherville', 'Vaudreuil-Dorion',
    'Rouyn-Noranda', 'Salaberry-de-Valleyfield', 'Sorel-Tracy', 'Saint-Georges', 'Joliette', 'Val-d\'Or',
    'Alma', 'Sept-Îles', 'Baie-Comeau', 'Thetford Mines', 'Magog', 'Rivière-du-Loup', 'Sainte-Julie',
    'Chambly', 'Candiac', 'La Prairie', 'Beloeil', 'Boisbriand', 'Sainte-Thérèse', 'Varennes', 'Mont-Tremblant']
    .map(city => ({ city, province: 'QC' })),
  { city: 'Ottawa', province: 'ON' },
  { city: 'Toronto', province: 'ON' },
  { city: 'Mississauga', province: 'ON' },
  { city: 'Hamilton', province: 'ON' },
  { city: 'Kingston', province: 'ON' },
  { city: 'Cornwall', province: 'ON' },
  { city: 'Vancouver', province: 'BC' },
  { city: 'Calgary', province: 'AB' },
  { city: 'Edmonton', province: 'AB' },
  { city: 'Winnipeg', province: 'MB' },
  { city: 'Halifax', province: 'NS' },
  { city: 'Moncton', province: 'NB' },
  { city: 'Fredericton', province: 'NB' },
];

export function defaultCriteria(): GoogleSearchCriteria {
  return {
    businessTypes: [],
    city: '',
    province: 'QC',
    radius: 10000,
    minRating: 0,
    maxRating: 0,
    includeUnrated: false,
    website: 'any',
    requirePhone: false,
    // Non coché par défaut : une entreprise déjà prospectée s'affiche avec son
    // historique (« Déjà contacté »), ce qui vaut mieux que de la cacher.
    skipKnown: false,
    maxResults: 20,
    language: 'fr',
  };
}

const pick = <T extends number>(choices: readonly T[], v: unknown, fallback: T): T =>
  choices.includes(Number(v) as T) ? (Number(v) as T) : fallback;

/**
 * Les critères enregistrés ou reçus, sous leur forme actuelle.
 *
 * Tolère l'ancienne forme (`businessType`, `requireWebsite`) et ramène toute
 * valeur hors liste à sa valeur par défaut : le serveur ne doit jamais envoyer à
 * Google — ni facturer — une demande que l'écran n'aurait pas pu formuler.
 * `skipKnown` vaut `false` pour un ancien tableau : il n'écartait rien.
 */
export function normalizeCriteria(raw: unknown): GoogleSearchCriteria {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const d = defaultCriteria();
  const types = Array.isArray(r.businessTypes)
    ? r.businessTypes
    : typeof r.businessType === 'string'
      ? [r.businessType]
      : [];
  const businessTypes = [...new Set(types.map((t: unknown) => String(t ?? '').trim().slice(0, 80)).filter(Boolean))]
    .slice(0, MAX_BUSINESS_TYPES);
  const website: WebsiteFilter =
    r.website === 'with' || r.website === 'without' || r.website === 'any'
      ? r.website
      : r.requireWebsite === true ? 'with' : 'any';
  const province = PROVINCES.some(p => p.code === r.province) ? r.province : d.province;
  // Au moins *ou* au plus : les deux ensemble ne laisseraient presque rien.
  const minRating = pick(RATING_CHOICES, r.minRating, 0 as any);
  const maxRating = minRating > 0 ? 0 : pick(MAX_RATING_CHOICES, r.maxRating, 0 as any);
  return {
    businessTypes,
    city: String(r.city ?? '').trim().slice(0, 80),
    province,
    radius: pick(RADIUS_CHOICES, r.radius, d.radius as any),
    minRating,
    maxRating,
    includeUnrated: maxRating > 0 && r.includeUnrated === true,
    website,
    requirePhone: r.requirePhone === true,
    skipKnown: 'skipKnown' in r ? r.skipKnown === true : false,
    maxResults: pick(RESULT_CHOICES, r.maxResults, d.maxResults as any),
    language: r.language === 'en' ? 'en' : 'fr',
  };
}

/** Ce qui empêche de lancer la recherche, ou `null`. */
export function criteriaProblem(c: GoogleSearchCriteria): string | null {
  if (c.businessTypes.length === 0) return "Indiquez au moins un type d'entreprise.";
  if (!c.city) return 'Indiquez une ville.';
  return null;
}

export function radiusLabel(meters: number): string {
  return `${Math.round(meters / 1000)} km`;
}

/** Le nom proposé pour un tableau quand on n'en donne pas. */
export function criteriaTitle(c: GoogleSearchCriteria): string {
  return `${c.businessTypes.join(', ')} — ${c.city}`;
}

/** Les pastilles d'en-tête d'un tableau Google : quoi, où, et les filtres actifs. */
export function criteriaBadges(c: GoogleSearchCriteria): { key: string; label: string }[] {
  const out = c.businessTypes.map(t => ({ key: `type:${t}`, label: t }));
  if (c.city) out.push({ key: 'city', label: `${c.city}, ${c.province} · ${radiusLabel(c.radius)}` });
  if (c.minRating > 0) out.push({ key: 'rating', label: `${fr(c.minRating)} ★ et plus` });
  if (c.maxRating > 0) {
    out.push({ key: 'rating', label: `${fr(c.maxRating)} ★ ou moins${c.includeUnrated ? ', ou sans avis' : ''}` });
  }
  if (c.website === 'with') out.push({ key: 'web', label: 'Avec site web' });
  if (c.website === 'without') out.push({ key: 'web', label: 'Sans site web' });
  if (c.requirePhone) out.push({ key: 'phone', label: 'Téléphone requis' });
  if (c.language === 'en') out.push({ key: 'lang', label: 'English' });
  return out;
}

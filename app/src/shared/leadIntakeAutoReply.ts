// Réponse automatique par SMS au prospect qui vient d'arriver par webhook.
//
// Le besoin : quelqu'un remplit un formulaire à 22 h, et personne ne le rappellera
// avant le lendemain matin. Un SMS qui le dit tout de suite — « merci, on vous
// rappelle demain dès 9 h » — vaut mieux que douze heures de silence. En pleine
// journée, le même SMS annoncerait un rappel « demain » à quelqu'un qu'on va
// appeler dans dix minutes : d'où trois messages, un par tranche de la journée.
//
// Réglé par source, comme les alertes d'arrivée : un formulaire de site et un
// tableur de rappels ne méritent pas le même mot d'accueil, et la seconde n'en
// mérite peut-être aucun.
//
// Module pur, partagé : l'écran de réglage et le point d'entrée doivent choisir
// la même tranche pour la même heure, et rendre les mêmes variables.

// ─── Forme enregistrée ────────────────────────────────────────────────────────

export type AutoReplyWindowKey = 'morning' | 'day' | 'evening';

export type AutoReplyWindow = {
  enabled: boolean;
  text: string;
};

/**
 * Ce que porte `LeadInboundWebhook.autoReply`.
 *
 * Trois tranches bornées par deux heures : avant `dayStartHour`, de
 * `dayStartHour` à `dayEndHour` exclu, puis à partir de `dayEndHour`. Les bornes
 * sont réglables parce que « la journée » n'a pas la même fin pour tout le
 * monde — 17 h pour un bureau, 20 h pour un commerce.
 *
 * `{}` en base = jamais réglé : `normalizeAutoReply` en fait une configuration
 * entière, tout éteint.
 */
export type IntakeAutoReply = {
  version: 1;
  dayStartHour: number;
  dayEndHour: number;
  morning: AutoReplyWindow;
  day: AutoReplyWindow;
  evening: AutoReplyWindow;
};

export const AUTO_REPLY_WINDOW_KEYS: readonly AutoReplyWindowKey[] = ['morning', 'day', 'evening'];

/**
 * Le fuseau dans lequel « 9 h » et « 19 h » se lisent.
 *
 * Le même que partout dans Gestia (`formatMontrealTime`, agenda) : l'entreprise
 * n'a pas de fuseau propre, et le serveur tourne en UTC — lire l'heure système
 * ferait basculer en « soirée » à 15 h de Montréal.
 */
export const AUTO_REPLY_TIMEZONE = 'America/Toronto';

/**
 * Longueur maximale d'un message, variables non résolues. Quatre segments
 * GSM-7 : au-delà, ce n'est plus un SMS d'accueil, c'est une brochure facturée.
 */
export const AUTO_REPLY_MAX_CHARS = 600;

/**
 * Au-delà de ce nombre de prospects dans un même appel, aucune réponse ne part.
 *
 * Un appel qui porte cinquante lignes est un import de tableur, pas cinquante
 * personnes qui viennent de remplir un formulaire : leur écrire « merci de votre
 * demande » serait faux, et facturé cinquante fois.
 */
export const AUTO_REPLY_MAX_LEADS_PER_CALL = 10;

/**
 * Plancher entre un SMS déjà échangé avec un numéro et une réponse automatique,
 * toutes sources et tous sens confondus.
 *
 * Un prospect qui soumet deux fois le formulaire — ou qui tombe dans deux sources
 * à la fois — ne doit pas recevoir deux fois le même accueil. Et s'il nous a
 * écrit lui-même depuis moins de 24 h, une conversation est en cours : un
 * « merci pour votre demande » automatique au milieu serait déplacé.
 */
export const AUTO_REPLY_REPEAT_FLOOR_MS = 24 * 60 * 60_000;

/**
 * Plafond de prospects reçus par une source en une heure au-delà duquel plus
 * aucune réponse ne part.
 *
 * Le point d'entrée accepte jusqu'à 300 appels à l'heure pour qu'une rafale
 * légitime ne soit pas refusée. Mais 300 SMS facturés en une heure, c'est ce que
 * produirait un formulaire de site web attaqué par un robot. Le plafond ici est
 * celui d'une activité humaine : au-delà, on garde les prospects, on retient les
 * SMS, et le journal dit pourquoi.
 */
export const AUTO_REPLY_MAX_LEADS_PER_HOUR = 30;

/**
 * Ce qu'un prospect écrit pour ne plus être contacté. Un seul de ces mots, reçu
 * un jour de ce numéro, interdit toute réponse automatique pour toujours : c'est
 * la règle de la LCAP, et c'est surtout la politesse élémentaire.
 */
export const AUTO_REPLY_OPT_OUT_PATTERN = /^\s*(stop|arr[êe]te?z?|unsubscribe|d[ée]sabonne(r|z)?|cancel|quit|end)\b/i;

export function isOptOutMessage(body: string | null | undefined): boolean {
  return AUTO_REPLY_OPT_OUT_PATTERN.test(body ?? '');
}

export const DEFAULT_DAY_START_HOUR = 9;
export const DEFAULT_DAY_END_HOUR = 19;

/**
 * Les messages proposés à une source jamais réglée. Éteints : ils se lisent, se
 * retouchent, puis s'allument — jamais l'inverse.
 *
 * Écrits dans l'alphabet GSM-7 (apostrophes droites, pas de « ç », de « ê » ni
 * de tiret long) pour tenir en un seul segment une fois les variables remplies
 * par un nom ordinaire. Voir `smsSegments` : un seul caractère hors alphabet
 * ferait tomber la limite de 160 à 70.
 */
export const DEFAULT_AUTO_REPLY_TEXTS: Readonly<Record<AutoReplyWindowKey, string>> = {
  morning:
    'Bonjour {{lead.name}}, merci pour votre demande. '
    + '{{company.name}} vous rappelle ce matin, dès l\'ouverture.',
  day:
    'Bonjour {{lead.name}}, merci pour votre demande. '
    + '{{company.name}} vous rappelle dans les prochaines heures.',
  evening:
    'Bonjour {{lead.name}}, merci pour votre demande. '
    + '{{company.name}} vous rappelle demain matin, dès l\'ouverture. Bonne soirée !',
};

export const EMPTY_AUTO_REPLY: IntakeAutoReply = {
  version: 1,
  dayStartHour: DEFAULT_DAY_START_HOUR,
  dayEndHour: DEFAULT_DAY_END_HOUR,
  morning: { enabled: false, text: DEFAULT_AUTO_REPLY_TEXTS.morning },
  day: { enabled: false, text: DEFAULT_AUTO_REPLY_TEXTS.day },
  evening: { enabled: false, text: DEFAULT_AUTO_REPLY_TEXTS.evening },
};

// ─── Variables ────────────────────────────────────────────────────────────────

/**
 * Les variables qu'un message peut porter. Volontairement peu : le prénom n'est
 * pas une colonne (le formulaire envoie « Jean Tremblay » d'un bloc), et un SMS
 * d'accueil n'a pas besoin du site web du prospect.
 */
export const AUTO_REPLY_VARS: readonly { token: string; label: string }[] = [
  { token: '{{lead.name}}', label: 'Nom du prospect' },
  { token: '{{company.name}}', label: 'Mon entreprise' },
  { token: '{{search.title}}', label: 'Nom du tableau' },
];

export function renderAutoReply(
  text: string,
  vars: { leadName: string | null | undefined; companyName: string | null | undefined; searchTitle: string | null | undefined },
): string {
  return text
    .split('{{lead.name}}').join((vars.leadName ?? '').trim())
    .split('{{company.name}}').join((vars.companyName ?? '').trim())
    .split('{{search.title}}').join((vars.searchTitle ?? '').trim())
    // Un nom absent laisse deux espaces ou un espace avant la virgule : on resserre.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.!?;:])/g, '$1')
    .trim();
}

// ─── Lecture tolérante ────────────────────────────────────────────────────────

function clampHour(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isInteger(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Une tranche jamais enregistrée reçoit le message proposé ; une tranche
 * enregistrée garde son texte, même vide — effacer un message est un choix.
 */
function readWindow(raw: unknown, fallbackText: string): AutoReplyWindow {
  if (!raw || typeof raw !== 'object') return { enabled: false, text: fallbackText };
  const w = raw as Record<string, unknown>;
  const text = typeof w.text === 'string' ? w.text.slice(0, AUTO_REPLY_MAX_CHARS) : fallbackText;
  return { enabled: w.enabled === true && text.trim().length > 0, text };
}

/**
 * Lit ce qui est en base et renvoie toujours une configuration complète.
 *
 * Tolérante parce qu'elle lit une colonne JSON : `{}` d'une source jamais réglée,
 * ou une forme d'une version antérieure. Une tranche « activée » sans texte est
 * rendue éteinte — il n'y a rien à envoyer, autant que l'écran le montre.
 */
export function normalizeAutoReply(raw: unknown): IntakeAutoReply {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const dayStartHour = clampHour(r.dayStartHour, DEFAULT_DAY_START_HOUR, 0, 23);
  const dayEndHour = clampHour(r.dayEndHour, DEFAULT_DAY_END_HOUR, dayStartHour + 1, 24);
  return {
    version: 1,
    dayStartHour,
    dayEndHour,
    morning: readWindow(r.morning, DEFAULT_AUTO_REPLY_TEXTS.morning),
    day: readWindow(r.day, DEFAULT_AUTO_REPLY_TEXTS.day),
    evening: readWindow(r.evening, DEFAULT_AUTO_REPLY_TEXTS.evening),
  };
}

/** Au moins une tranche prête à partir. */
export function isAutoReplyActive(cfg: IntakeAutoReply): boolean {
  return AUTO_REPLY_WINDOW_KEYS.some(k => cfg[k].enabled && cfg[k].text.trim().length > 0);
}

// ─── Choix de la tranche ──────────────────────────────────────────────────────

/** L'heure (0–23) qu'il est à `date` dans le fuseau de l'entreprise. */
export function localHour(date: Date, timeZone: string = AUTO_REPLY_TIMEZONE): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(date)
    .find(p => p.type === 'hour');
  const hour = part ? parseInt(part.value, 10) : NaN;
  // `hourCycle: 'h23'` est ignoré par quelques moteurs anciens, qui rendent 24.
  return Number.isFinite(hour) ? hour % 24 : date.getUTCHours();
}

export function autoReplyWindowForHour(cfg: IntakeAutoReply, hour: number): AutoReplyWindowKey {
  if (hour < cfg.dayStartHour) return 'morning';
  if (hour < cfg.dayEndHour) return 'day';
  return 'evening';
}

export function autoReplyWindowAt(cfg: IntakeAutoReply, date: Date = new Date()): AutoReplyWindowKey {
  return autoReplyWindowForHour(cfg, localHour(date));
}

// ─── Libellés ─────────────────────────────────────────────────────────────────

export function formatHour(hour: number): string {
  return `${hour} h`;
}

/** « Avant 9 h » · « Entre 9 h et 19 h » · « Après 19 h ». */
export function autoReplyWindowLabel(cfg: IntakeAutoReply, key: AutoReplyWindowKey): string {
  switch (key) {
    case 'morning': return `Avant ${formatHour(cfg.dayStartHour)}`;
    case 'day': return `Entre ${formatHour(cfg.dayStartHour)} et ${formatHour(cfg.dayEndHour)}`;
    case 'evening': return `À partir de ${formatHour(cfg.dayEndHour)}`;
  }
}

/** Ce que la tranche veut dire pour celui qui écrit le message. */
export function autoReplyWindowHint(key: AutoReplyWindowKey): string {
  switch (key) {
    case 'morning': return 'Le prospect écrit avant l\'ouverture : on le rappellera dans la matinée.';
    case 'day': return 'Heures d\'ouverture : quelqu\'un va le rappeler rapidement.';
    case 'evening': return 'Après la fermeture : le rappel attendra le lendemain.';
  }
}

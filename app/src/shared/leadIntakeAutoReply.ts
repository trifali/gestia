// Réponse automatique par SMS au prospect qui vient d'arriver par webhook.
//
// Le besoin : quelqu'un remplit un formulaire à 22 h, et personne ne le rappellera
// avant le lendemain matin. Un SMS qui le dit tout de suite — « merci, on vous
// rappelle demain dès 9 h » — vaut mieux que douze heures de silence. En pleine
// journée, le même SMS annoncerait un rappel « demain » à quelqu'un qu'on va
// appeler dans dix minutes : d'où un message par plage horaire, plages que
// l'entreprise découpe à sa guise.
//
// Réglé par source, comme les alertes d'arrivée : un formulaire de site et un
// tableur de rappels ne méritent pas le même mot d'accueil, et la seconde n'en
// mérite peut-être aucun.
//
// Module pur, partagé : l'écran de réglage et le point d'entrée doivent choisir
// la même tranche pour la même heure, et rendre les mêmes variables.

// ─── Forme enregistrée ────────────────────────────────────────────────────────

/**
 * Une plage horaire et ce qu'on y répond.
 *
 * Les bornes sont en minutes depuis minuit, heure de Montréal. `end` est exclu ;
 * `end <= start` veut dire que la plage passe minuit (19 h → 8 h), et `end ===
 * start` qu'elle couvre la journée entière.
 *
 * Plusieurs messages par plage : l'un d'eux, tiré au hasard, part à chaque
 * prospect. Deux personnes du même quartier qui comparent leurs SMS ne lisent
 * pas mot pour mot le même texte de robot.
 */
export type AutoReplyRule = {
  id: string;
  start: number;
  end: number;
  enabled: boolean;
  texts: string[];
};

/**
 * Ce que porte `LeadInboundWebhook.autoReply`.
 *
 * Une liste de plages plutôt que les trois tranches fixes de la version 1 : un
 * commerce ouvert le soir, une équipe qui répond pendant le dîner ou un message
 * distinct pour la nuit ne rentraient pas dans « avant / pendant / après ».
 * Quand deux plages se recouvrent, la première de la liste l'emporte.
 *
 * `{}` en base = jamais réglé : `normalizeAutoReply` en fait une configuration
 * entière, tout éteint. Une forme version 1 est convertie à la lecture.
 */
export type IntakeAutoReply = {
  version: 2;
  rules: AutoReplyRule[];
};

export const AUTO_REPLY_MAX_RULES = 12;
export const AUTO_REPLY_MAX_TEXTS_PER_RULE = 5;
export const MINUTES_PER_DAY = 24 * 60;

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
export const DEFAULT_AUTO_REPLY_TEXTS = {
  morning:
    'Bonjour {{lead.name}}, merci pour votre demande. '
    + '{{company.name}} vous rappelle ce matin, dès l\'ouverture.',
  day:
    'Bonjour {{lead.name}}, merci pour votre demande. '
    + '{{company.name}} vous rappelle dans les prochaines heures.',
  evening:
    'Bonjour {{lead.name}}, merci pour votre demande. '
    + '{{company.name}} vous rappelle demain matin, dès l\'ouverture. Bonne soirée !',
} as const;

/** Le texte proposé pour une plage ajoutée à la main. */
export const DEFAULT_NEW_RULE_TEXT = DEFAULT_AUTO_REPLY_TEXTS.day;

/** Les trois plages proposées d'office : la nuit et le matin, la journée, la soirée. */
function defaultRules(): AutoReplyRule[] {
  const start = DEFAULT_DAY_START_HOUR * 60;
  const end = DEFAULT_DAY_END_HOUR * 60;
  return [
    { id: 'morning', start: 0, end: start, enabled: false, texts: [DEFAULT_AUTO_REPLY_TEXTS.morning] },
    { id: 'day', start, end, enabled: false, texts: [DEFAULT_AUTO_REPLY_TEXTS.day] },
    { id: 'evening', start: end, end: MINUTES_PER_DAY, enabled: false, texts: [DEFAULT_AUTO_REPLY_TEXTS.evening] },
  ];
}

export const EMPTY_AUTO_REPLY: IntakeAutoReply = { version: 2, rules: defaultRules() };

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

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function readTexts(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  const texts = raw
    .filter((t): t is string => typeof t === 'string')
    .map(t => t.slice(0, AUTO_REPLY_MAX_CHARS))
    .slice(0, AUTO_REPLY_MAX_TEXTS_PER_RULE);
  return texts.length ? texts : [''];
}

function readRule(raw: unknown, index: number): AutoReplyRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const texts = readTexts(r.texts, ['']);
  const start = clampInt(r.start, 0, 0, MINUTES_PER_DAY - 1);
  const end = clampInt(r.end, MINUTES_PER_DAY, 0, MINUTES_PER_DAY);
  return {
    id: typeof r.id === 'string' && r.id.trim() ? r.id.slice(0, 40) : `rule_${index}`,
    start,
    end,
    // Une plage « activée » sans aucun texte est rendue éteinte : il n'y a rien à
    // envoyer, autant que l'écran le montre.
    enabled: r.enabled === true && texts.some(t => t.trim().length > 0),
    texts,
  };
}

/**
 * La forme version 1 — trois tranches bornées par deux heures — traduite en
 * trois plages. Rien ne change pour le prospect : chaque heure tombe dans la
 * plage qui reprend sa tranche, avec le même texte et le même interrupteur.
 */
function fromVersion1(r: Record<string, unknown>): AutoReplyRule[] {
  const startHour = clampInt(r.dayStartHour, DEFAULT_DAY_START_HOUR, 0, 23);
  const endHour = clampInt(r.dayEndHour, DEFAULT_DAY_END_HOUR, startHour + 1, 24);
  const windows: [string, unknown, number, number, string][] = [
    ['morning', r.morning, 0, startHour * 60, DEFAULT_AUTO_REPLY_TEXTS.morning],
    ['day', r.day, startHour * 60, endHour * 60, DEFAULT_AUTO_REPLY_TEXTS.day],
    ['evening', r.evening, endHour * 60, MINUTES_PER_DAY, DEFAULT_AUTO_REPLY_TEXTS.evening],
  ];
  return windows
    // Une tranche vide (journée qui commence à minuit) n'a aucune heure à couvrir.
    .filter(([, , start, end]) => end > start)
    .map(([id, raw, start, end, fallback]) => {
      const w = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const text = typeof w.text === 'string' ? w.text.slice(0, AUTO_REPLY_MAX_CHARS) : fallback;
      return { id, start, end, enabled: w.enabled === true && text.trim().length > 0, texts: [text] };
    });
}

/**
 * Lit ce qui est en base et renvoie toujours une configuration complète.
 *
 * Tolérante parce qu'elle lit une colonne JSON : `{}` d'une source jamais réglée,
 * la forme à trois tranches de la version 1, ou la liste de plages actuelle.
 */
export function normalizeAutoReply(raw: unknown): IntakeAutoReply {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  if (Array.isArray(r.rules)) {
    const rules = r.rules
      .slice(0, AUTO_REPLY_MAX_RULES)
      .map((rule, i) => readRule(rule, i))
      .filter((rule): rule is AutoReplyRule => rule !== null);
    return { version: 2, rules };
  }
  if ('morning' in r || 'day' in r || 'evening' in r || 'dayStartHour' in r) {
    return { version: 2, rules: fromVersion1(r) };
  }
  return { version: 2, rules: defaultRules() };
}

/** Les textes d'une plage qui peuvent réellement partir. */
export function usableTexts(rule: AutoReplyRule): string[] {
  return rule.texts.filter(t => t.trim().length > 0);
}

/** Au moins une plage prête à partir. */
export function isAutoReplyActive(cfg: IntakeAutoReply): boolean {
  return cfg.rules.some(r => r.enabled && usableTexts(r).length > 0);
}

// ─── Choix de la plage ────────────────────────────────────────────────────────

/** L'heure (0–23) et la minute qu'il est à `date` dans le fuseau de l'entreprise. */
export function localMinutes(date: Date, timeZone: string = AUTO_REPLY_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '', 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return date.getUTCHours() * 60 + date.getUTCMinutes();
  // `hourCycle: 'h23'` est ignoré par quelques moteurs anciens, qui rendent 24.
  return (hour % 24) * 60 + minute;
}

/** Vrai si `minute` (0–1439) tombe dans la plage. */
export function ruleCovers(rule: Pick<AutoReplyRule, 'start' | 'end'>, minute: number): boolean {
  const end = rule.end % MINUTES_PER_DAY;
  if (rule.start === end) return true; // la journée entière
  if (rule.start < end) return minute >= rule.start && minute < end;
  return minute >= rule.start || minute < end; // passe minuit
}

/** La première plage active qui couvre cette minute, ou `null` : rien ne part. */
export function autoReplyRuleForMinute(cfg: IntakeAutoReply, minute: number): AutoReplyRule | null {
  return cfg.rules.find(r => r.enabled && usableTexts(r).length > 0 && ruleCovers(r, minute)) ?? null;
}

export function autoReplyRuleAt(cfg: IntakeAutoReply, date: Date = new Date()): AutoReplyRule | null {
  return autoReplyRuleForMinute(cfg, localMinutes(date));
}

/** Un des messages de la plage, au hasard. `random` est injectable pour les essais. */
export function pickAutoReplyText(rule: AutoReplyRule, random: () => number = Math.random): string {
  const texts = usableTexts(rule);
  if (texts.length === 0) return '';
  return texts[Math.min(texts.length - 1, Math.floor(random() * texts.length))];
}

/**
 * Les minutes de la journée où aucune plage active ne répond, regroupées en
 * intervalles `[start, end)`. Sert à l'écran : « aucun SMS de 3 h à 6 h ».
 */
export function uncoveredRanges(cfg: IntakeAutoReply): { start: number; end: number }[] {
  const active = cfg.rules.filter(r => r.enabled && usableTexts(r).length > 0);
  const out: { start: number; end: number }[] = [];
  let open: number | null = null;
  for (let m = 0; m <= MINUTES_PER_DAY; m++) {
    const covered = m < MINUTES_PER_DAY && active.some(r => ruleCovers(r, m));
    if (!covered && m < MINUTES_PER_DAY && open === null) open = m;
    if ((covered || m === MINUTES_PER_DAY) && open !== null) {
      out.push({ start: open, end: m });
      open = null;
    }
  }
  return out;
}

/** Vrai si deux plages ont au moins une minute en commun. */
export function rulesOverlap(a: AutoReplyRule, b: AutoReplyRule): boolean {
  for (let m = 0; m < MINUTES_PER_DAY; m += 5) {
    if (ruleCovers(a, m) && ruleCovers(b, m)) return true;
  }
  return false;
}

// ─── Libellés ─────────────────────────────────────────────────────────────────

/** « 9 h », « 17 h 30 », « minuit ». */
export function formatMinutes(minutes: number): string {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0 && mm === 0) return 'minuit';
  return mm ? `${h} h ${String(mm).padStart(2, '0')}` : `${h} h`;
}

/** « De 9 h à 17 h » · « De 19 h à 8 h (nuit) » · « Toute la journée ». */
export function autoReplyRuleLabel(rule: Pick<AutoReplyRule, 'start' | 'end'>): string {
  const end = rule.end % MINUTES_PER_DAY;
  if (rule.start === end) return 'Toute la journée';
  const label = `De ${formatMinutes(rule.start)} à ${formatMinutes(rule.end)}`;
  return rule.start > end && end !== 0 ? `${label} (passe minuit)` : label;
}

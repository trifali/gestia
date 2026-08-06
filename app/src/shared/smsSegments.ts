// ─── Coût d'un SMS ───────────────────────────────────────────────────────────
//
// Telnyx facture au *segment*, pas au message. Un texte entièrement GSM-7 tient
// 160 caractères par segment ; un seul caractère hors de cet alphabet — emoji,
// apostrophe courbe, tiret cadratin — bascule **tout** le message en UCS-2 et
// fait tomber la limite à 70. Un « — » égaré coûte donc plus cher que trente
// lettres.
//
// Source de vérité partagée : le compteur de la zone de rédaction (client) et le
// constructeur d'alerte (serveur) doivent compter pareil, sans quoi l'un promet
// ce que l'autre facture.

const GSM7_BASE =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/** GSM-7 aussi, mais via un préfixe d'échappement : deux septets par caractère. */
const GSM7_EXTENDED = '^{}\\[~]|€';

const BASE_SET = new Set([...GSM7_BASE]);
const EXTENDED_SET = new Set([...GSM7_EXTENDED]);

export function isGsm7Char(c: string): boolean {
  return BASE_SET.has(c) || EXTENDED_SET.has(c);
}

export type SmsCost = { chars: number; segments: number; unicode: boolean };

/**
 * Ce que Telnyx comptera pour ce texte.
 *
 * En UCS-2 l'unité facturée est le *code unit* UTF-16, pas le caractère perçu :
 * un emoji hors BMP en consomme deux. `text.length` est exactement cette
 * mesure — compter les points de code sous-estimerait un message à emoji.
 */
export function smsSegments(text: string): SmsCost {
  const cps = [...text];
  const unicode = cps.some(c => !isGsm7Char(c));
  const chars = unicode ? text.length : gsm7Cost(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const segments = chars === 0 ? 0 : chars <= single ? 1 : Math.ceil(chars / multi);
  return { chars, segments, unicode };
}

/** Le coût en septets d'un texte déjà GSM-7. */
export function gsm7Cost(text: string): number {
  let n = 0;
  for (const c of text) n += EXTENDED_SET.has(c) ? 2 : 1;
  return n;
}

/**
 * Replis pour ce qui ne se résout pas en retirant simplement un accent :
 * ponctuation typographique, espaces exotiques, ligatures.
 */
const FALLBACKS: Record<string, string> = {
  // Guillemets et apostrophes courbes — le tout-venant du copier-coller.
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '«': '"', '»': '"', '‹': "'", '›': "'",
  '′': "'", '″': '"',
  // Tirets. `—` est le coupable historique du gabarit d'alerte.
  '‐': '-', '‑': '-', '‒': '-', '–': '-',
  '—': '-', '―': '-', '−': '-',
  '…': '...',
  '•': '-', '·': '.', '‧': '.',
  // Espaces insécables et fines : invisibles à l'œil, coûteuses au compteur.
  // En points de code explicites — deux espaces exotiques se ressemblent trop
  // dans un fichier source pour qu'on les y écrive littéralement.
  '\u00A0': ' ', '\u202F': ' ', '\u2007': ' ', '\u2009': ' ',
  '\u200A': ' ', '\u2028': ' ', '\u2029': ' ', '\t': ' ',
  // Ligatures : aucune décomposition NFD ne les sépare.
  'œ': 'oe', 'Œ': 'OE',
  '™': 'TM', '©': '(c)', '®': '(r)',
};

/**
 * Réécrit un texte pour qu'il tienne entièrement dans l'alphabet GSM-7.
 *
 * Trois passes, de la moins destructrice à la plus : le caractère est déjà
 * GSM-7, ou il a un repli explicite, ou on lui retire son accent — « francais »
 * se lit, « franais » non. Ce qui résiste (emoji, idéogramme) est retiré : il
 * n'y a rien de lisible à en tirer et le garder coûterait le message entier.
 *
 * À n'appliquer qu'à nos propres textes. Un message que l'utilisateur adresse à
 * un prospect ne se réécrit pas dans son dos — voir `SmsComposer`, qui propose
 * la conversion au lieu de l'imposer.
 */
export function toGsm7(text: string): string {
  let out = '';
  for (const c of text) {
    if (isGsm7Char(c)) {
      out += c;
      continue;
    }
    const mapped = FALLBACKS[c];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const stripped = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (stripped !== c && stripped.length > 0 && [...stripped].every(isGsm7Char)) {
      out += stripped;
    }
  }
  return out;
}

/** Coupe un texte déjà GSM-7 à `maxCost` septets, sans scinder un caractère étendu. */
export function clampGsm7(text: string, maxCost: number): string {
  if (maxCost <= 0) return '';
  let out = '';
  let cost = 0;
  for (const c of text) {
    const w = EXTENDED_SET.has(c) ? 2 : 1;
    if (cost + w > maxCost) break;
    out += c;
    cost += w;
  }
  return out;
}

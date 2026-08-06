// ─── Numéros de téléphone ────────────────────────────────────────────────────
//
// Telnyx n'accepte que le format E.164 : « + », indicatif pays, puis le numéro,
// 15 chiffres au maximum. Tout le reste est refusé à l'envoi — trop tard, une
// fois le prospect enregistré avec un numéro injoignable.
//
// D'où le masque : les champs ne laissent plus *écrire* un numéro que Telnyx
// refuserait. `toE164` reste l'arbitre — le masque met simplement la saisie en
// forme au fur et à mesure pour qu'elle finisse dans un format acceptable.
//
// Source unique : le serveur (envoi, webhook) et le client (champs, validation)
// partagent ce fichier. Il y en avait trois copies auparavant, avec l'avis
// explicite de les tenir synchronisées à la main.

/**
 * Normalise vers E.164, le seul format que Telnyx accepte.
 *
 * Les numéros de prospects viennent de Google Maps en « (514) 574-2228 » ou
 * « +1 514-574-2228 » : un numéro à 10 chiffres est donc supposé nord-américain.
 * Retourne null quand l'entrée ne peut pas être un numéro valide.
 */
export function toE164(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (hadPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** Le numéro est-il envoyable par Telnyx tel quel ? */
export function isSupportedPhone(raw: string): boolean {
  return toE164(raw) !== null;
}

/**
 * Un numéro est-il plausiblement nord-américain (indicatif +1) ?
 *
 * Le « 1 » de tête est l'indicatif pays, jamais un chiffre du numéro : aucun
 * indicatif régional du plan nord-américain ne commence par 1. On peut donc le
 * retirer sans ambiguïté — mais seulement si ce qui reste tient en dix chiffres,
 * sinon on a affaire à un numéro étranger qui commence par 1.
 */
function nanpDigits(digits: string): string | null {
  const national = digits.startsWith('1') ? digits.slice(1) : digits;
  return national.length <= 10 ? national : null;
}

/**
 * Met un numéro en forme pendant la frappe.
 *
 * Nord-américain : `+1 (514) 555-0100`, coupé à dix chiffres — impossible d'en
 * saisir onze par mégarde.
 *
 * Étranger : `+` suivi des chiffres, sans découpage. Deviner le groupement de
 * chaque pays serait faux plus souvent que juste, et le seul enjeu ici est que
 * Telnyx accepte le résultat.
 *
 * Le piège que ce découpage évite : coller un numéro français
 * (« +33 6 12 34 56 78 ») dans un masque nord-américain naïf donnait
 * `+1 (336) 123-4567` — un numéro parfaitement valide, parfaitement faux, et
 * que rien en aval ne pouvait plus détecter.
 */
export function maskPhone(raw: string): string {
  const trimmed = (raw ?? '').trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (!digits) return hasPlus ? '+' : '';

  // Un « + » suivi d'autre chose que 1 est une déclaration explicite : l'auteur
  // sait que son numéro n'est pas nord-américain, on ne le contredit pas.
  const national = hasPlus && !digits.startsWith('1') ? null : nanpDigits(digits);
  if (national === null) return `+${digits.slice(0, 15)}`;

  if (!national) return '+1';
  if (national.length <= 3) return `+1 (${national}`;
  if (national.length <= 6) return `+1 (${national.slice(0, 3)}) ${national.slice(3)}`;
  return `+1 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

/**
 * Masque uniquement ce qui ne peut pas être un nom.
 *
 * Le champ « À » de la messagerie sert aussi à chercher un contact par son nom :
 * y appliquer le masque à chaque frappe détruirait « Plomberie » lettre par
 * lettre. La présence d'une lettre suffit à trancher — aucun numéro E.164 n'en
 * contient.
 */
export function maskPhoneOrName(raw: string): string {
  return /\p{L}/u.test(raw ?? '') ? raw : maskPhone(raw);
}

/** `+15145550100` → `+1 (514) 555-0100`. Tout le reste est rendu tel quel. */
export function formatPhoneDisplay(e164: string | null | undefined): string {
  const s = (e164 ?? '').trim();
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(s);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : s;
}

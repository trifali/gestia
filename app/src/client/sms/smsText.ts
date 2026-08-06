// ─── SMS length helper ────────────────────────────────────────────────────────
// A GSM-7 message fits 160 characters per part, but a single character outside
// that alphabet (an emoji, a curly quote) switches the whole message to UCS-2
// and drops it to 70 — which is why the composer shows both numbers.
//
// Descendu du module prospection : les deux zones de rédaction (fiche prospect
// et messagerie flottante) affichent le même compteur.

const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€';

export function smsSegments(text: string): { chars: number; segments: number; unicode: boolean } {
  const unicode = [...text].some(c => !GSM7.includes(c) && !GSM7_EXTENDED.includes(c));
  // Extended characters cost two septets each.
  const chars = unicode
    ? [...text].length
    : [...text].reduce((n, c) => n + (GSM7_EXTENDED.includes(c) ? 2 : 1), 0);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const segments = chars === 0 ? 0 : chars <= single ? 1 : Math.ceil(chars / multi);
  return { chars, segments, unicode };
}

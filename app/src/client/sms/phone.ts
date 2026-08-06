// Utilitaires de numéro côté client.
//
// `toE164` est une copie conforme de `app/src/server/sms.ts` — Wasp ne permet pas
// d'importer `@src/server` dans du code client. La source de vérité reste le
// serveur, qui revalide tout ; cette copie n'existe que pour dire « numéro
// invalide » sans aller-retour réseau. Toute correction là-bas doit être
// reportée ici.

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

/** `+15145550100` → `+1 (514) 555-0100`. Tout le reste est rendu tel quel. */
export function formatPhoneDisplay(e164: string | null | undefined): string {
  const s = (e164 ?? '').trim();
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(s);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : s;
}

/** Initiales pour la pastille d'une conversation. Un numéro donne « # ». */
export function initialsFor(name: string | null | undefined): string {
  const s = (name ?? '').trim();
  if (!s || s.startsWith('+')) return '#';
  const parts = s.split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : s.slice(0, 2);
  return letters.toUpperCase();
}

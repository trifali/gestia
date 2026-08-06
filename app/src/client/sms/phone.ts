// Utilitaires de numéro côté client.
//
// `toE164` et `formatPhoneDisplay` vivent désormais dans `shared/phone`, avec le
// masque de saisie et la validation : serveur et client partagent la même
// définition de « numéro acceptable par Telnyx ». Il y en avait trois copies,
// dont celle-ci, avec la consigne de les tenir synchronisées à la main.
//
// Ce fichier reste comme point d'entrée de la messagerie et pour `initialsFor`,
// qui n'a rien à faire côté serveur.

export {
  toE164,
  formatPhoneDisplay,
  maskPhone,
  maskPhoneOrName,
  isSupportedPhone,
} from '../../shared/phone';

/** Initiales pour la pastille d'une conversation. Un numéro donne « # ». */
export function initialsFor(name: string | null | undefined): string {
  const s = (name ?? '').trim();
  if (!s || s.startsWith('+')) return '#';
  const parts = s.split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : s.slice(0, 2);
  return letters.toUpperCase();
}

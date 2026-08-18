// Identifiants de fil, partagés client et serveur.
//
// LeadEmailLog et LeadSmsLog sont indexés par une chaîne opaque (`identifier`)
// qui n'exige l'existence d'aucun Lead — c'est déjà ce qui autorise les
// conversations `tel:+…` de la boîte SMS (voir server/sms.ts). La même
// convention ouvre un fil par client : `client:<uuid>`. Aucune collision
// possible avec un placeId Google (base64url) ni un id de Lead (uuid) :
// ni l'un ni l'autre ne peut contenir ':'.

export const CLIENT_IDENTIFIER_PREFIX = 'client:';

/** Le fil courriel d'un client — un seul, tous documents confondus. */
export function clientIdentifier(clientId: string): string {
  return `${CLIENT_IDENTIFIER_PREFIX}${clientId}`;
}

export function isClientIdentifier(identifier: string): boolean {
  return (identifier ?? '').startsWith(CLIENT_IDENTIFIER_PREFIX);
}

export function parseClientIdentifier(identifier: string): string | null {
  if (!isClientIdentifier(identifier)) return null;
  return identifier.slice(CLIENT_IDENTIFIER_PREFIX.length) || null;
}

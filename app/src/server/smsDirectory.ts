// Met un nom sur un numéro de téléphone.
//
// Partagé entre le webhook (qui nomme l'expéditeur dans l'alerte courriel) et
// les opérations de la boîte de réception (qui nomment chaque fil). Vit à part
// parce que ni `sms.ts` — volontairement sans Prisma — ni `smsWebhook.ts` ne
// peuvent proprement héberger des requêtes partagées.
//
// Difficulté de fond : `Client.phone` et `Lead.phone` sont du texte libre
// (« +1 (438) 444-4343 »), alors que LeadSmsLog ne contient que de l'E.164. La
// comparaison passe donc par une normalisation en JS après lecture, ce qui
// impose de borner ce qu'on lit.

import { toE164, isDirectIdentifier } from './sms';

/**
 * Plafond du balayage des téléphones en texte libre. Au-delà, la résolution de
 * nom devient partielle plutôt que lente — c'est le bon compromis pour un
 * libellé d'affichage. Le vrai correctif serait une colonne `phoneE164`
 * dénormalisée sur Client et Lead, hors périmètre ici.
 */
export const MAX_DIRECTORY_SCAN = 2000;

export type DirectoryHit = {
  id: string;
  name: string;
  phone: string; // E.164
  source: 'client' | 'lead';
  identifier?: string; // fils existant pour un prospect : placeId ?? id
  searchId?: string;
};

/** Clients de l'entreprise dont le téléphone, normalisé, est dans `wanted`. */
export async function findClientsByE164(
  entities: any,
  companyId: string,
  wanted: Set<string>,
): Promise<DirectoryHit[]> {
  if (!wanted.size) return [];
  const rows = await entities.Client.findMany({
    where: { companyId, phone: { not: null } },
    select: { id: true, name: true, phone: true },
    take: MAX_DIRECTORY_SCAN,
  });
  const hits: DirectoryHit[] = [];
  for (const c of rows as any[]) {
    const e164 = toE164(c.phone ?? '');
    if (e164 && wanted.has(e164)) {
      hits.push({ id: c.id, name: c.name, phone: e164, source: 'client' });
    }
  }
  return hits;
}

/** Prospects de l'entreprise dont le téléphone, normalisé, est dans `wanted`. */
export async function findLeadsByE164(
  entities: any,
  companyId: string,
  wanted: Set<string>,
): Promise<DirectoryHit[]> {
  if (!wanted.size) return [];
  const rows = await entities.Lead.findMany({
    // Un Lead n'a pas de companyId : la portée passe par sa recherche parente.
    where: { search: { companyId }, phone: { not: null } },
    select: { id: true, name: true, phone: true, placeId: true, searchId: true },
    take: MAX_DIRECTORY_SCAN,
  });
  const hits: DirectoryHit[] = [];
  for (const l of rows as any[]) {
    const e164 = toE164(l.phone ?? '');
    if (e164 && wanted.has(e164)) {
      hits.push({
        id: l.id,
        name: l.name,
        phone: e164,
        source: 'lead',
        identifier: l.placeId ?? l.id,
        searchId: l.searchId,
      });
    }
  }
  return hits;
}

/**
 * Nom à afficher pour une conversation. L'ordre n'est pas arbitraire :
 * un contact nommé à la main gagne toujours (c'est une intention humaine), puis
 * l'identifiant du fil lui-même quand il désigne un prospect (correspondance
 * indexée et exacte), et seulement ensuite les recherches par téléphone, qui
 * sont approximatives et bornées.
 */
export async function resolveDisplayName(
  entities: any,
  companyId: string,
  e164: string | null,
  identifier: string,
): Promise<string | null> {
  if (e164) {
    const contact = await entities.SmsContact.findUnique({
      where: { companyId_phone: { companyId, phone: e164 } },
      select: { name: true },
    });
    if (contact?.name) return contact.name;
  }

  if (!isDirectIdentifier(identifier)) {
    const lead = await entities.Lead.findFirst({
      where: {
        search: { companyId },
        OR: [{ placeId: identifier }, { id: identifier }],
      },
      select: { name: true },
    });
    if (lead?.name) return lead.name;
  }

  if (e164) {
    const wanted = new Set([e164]);
    const [clients, leads] = await Promise.all([
      findClientsByE164(entities, companyId, wanted),
      findLeadsByE164(entities, companyId, wanted),
    ]);
    if (clients[0]) return clients[0].name;
    if (leads[0]) return leads[0].name;
  }

  return null;
}

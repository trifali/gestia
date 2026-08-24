// Enregistrement d'un prospect issu d'une correspondance.
//
// Partagé par le point d'entrée (appel reçu) et par le rejeu depuis le journal,
// qui doivent produire exactement la même chose. C'était déjà deux fois le même
// bloc ; ça l'est désormais une seule.

import { effectiveSourceConfigs, insertLeadOnTop } from '../../app/leads/operations';
import {
  FALLBACK_SOURCE_KEY,
  MAX_SOURCES_PER_COMPANY,
  cleanSourceLabel,
  humanizeSourceKey,
} from '../../shared/leadSources';
import type { MappedLead } from '../../shared/leadIntake';

/**
 * Enregistre au registre les provenances qu'un appel entrant vient d'inventer, et
 * renvoie celles qui sont réellement utilisables.
 *
 * C'est le seul endroit où une clé de provenance peut naître sans qu'un humain
 * l'ait décidé : une correspondance câblée sur la charge utile produit ce que
 * l'émetteur envoie. D'où le plafond — un champ mal câblé (le nom du prospect, un
 * identifiant d'appel) créerait sinon une provenance par appel, et l'écran
 * « Provenances » comme la barre d'onglets deviendraient inutilisables en une
 * après-midi. Au-delà du plafond, les prospects tombent sur « Autre » : on perd
 * une étiquette, pas un prospect.
 *
 * Renvoie la table des clés effectivement retenues, chaque clé refusée pointant
 * sur « Autre ».
 */
export async function registerLeadSources(
  entities: any,
  companyId: string,
  items: { source: string; sourceLabel?: string | null }[],
): Promise<{ resolved: Map<string, string>; skipped: string[] }> {
  const resolved = new Map<string, string>();
  const skipped: string[] = [];

  // L'étiquette telle qu'envoyée, quand on l'a : « Salon Habitation 2026 » se lit
  // mieux que la clé remise en forme, qui a perdu majuscules et accents en route.
  const labels = new Map<string, string>();
  for (const item of items) {
    if (!item.source) continue;
    const label = cleanSourceLabel(item.sourceLabel);
    if (label && !labels.has(item.source)) labels.set(item.source, label);
  }
  const wanted = [...new Set(items.map(i => i.source).filter(Boolean))];
  if (wanted.length === 0) return { resolved, skipped };

  const configs = await effectiveSourceConfigs(entities, companyId);
  const known = new Set<string>(configs.map((c: any) => c.key));
  let count = configs.length;
  let nextOrder = Math.max(-1, ...configs.map((c: any) => c.order)) + 1;

  for (const key of wanted) {
    if (known.has(key)) {
      resolved.set(key, key);
      continue;
    }
    if (count >= MAX_SOURCES_PER_COMPANY) {
      resolved.set(key, FALLBACK_SOURCE_KEY);
      skipped.push(key);
      continue;
    }
    try {
      await entities.LeadSourceConfig.create({
        data: {
          companyId,
          key,
          label: labels.get(key) ?? humanizeSourceKey(key),
          color: '#6366f1',
          order: nextOrder++,
          learned: true,
        },
      });
      known.add(key);
      count++;
      resolved.set(key, key);
    } catch (err: any) {
      // P2002 : deux appels simultanés ont voulu créer la même provenance. La
      // ligne existe donc bien, ce qui est exactement ce qu'on voulait.
      if (err?.code === 'P2002') {
        known.add(key);
        resolved.set(key, key);
      } else {
        console.error('[intake] provenance non enregistrée', key, err);
        resolved.set(key, FALLBACK_SOURCE_KEY);
      }
    }
  }

  return { resolved, skipped };
}

export async function insertMappedLead(
  entities: any,
  args: {
    searchId: string;
    companyId: string;
    status: string;
    lead: MappedLead;
    /** Repli quand la correspondance n'a pas désigné de clé anti-doublon. */
    fallbackExternalId?: string | null;
    /**
     * Provenances déjà arbitrées par `registerLeadSources` pour ce lot. Absente,
     * la provenance est enregistrée pour ce seul prospect — le rejeu d'un unique
     * événement n'a pas de lot à amortir.
     */
    sourceMap?: Map<string, string>;
  },
  // La carte créée, et non son seul identifiant : l'alerte immédiate a besoin de
  // nommer les prospects qu'elle annonce, et les relire juste après les avoir
  // écrits serait une requête pour rien.
): Promise<{ id: string; name: string; email: string | null; phone: string | null }> {
  const { lead } = args;

  const source =
    args.sourceMap?.get(lead.source) ??
    (await registerLeadSources(entities, args.companyId, [lead])).resolved.get(lead.source) ??
    FALLBACK_SOURCE_KEY;

  const row = await insertLeadOnTop(entities, {
    searchId: args.searchId,
    status: args.status,
    data: {
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      website: lead.website,
      address: lead.address,
      category: lead.category,
      source,
      externalId: lead.externalId ?? args.fallbackExternalId ?? null,
      // Les informations de carte, figées telles qu'elles sont arrivées. Voir
      // `Lead.extras` : on enregistre l'intitulé avec la valeur, pas un renvoi
      // vers la correspondance, qui peut être remaniée demain.
      extras: lead.extras ?? [],
    },
  });

  // Les champs non associés deviennent une note de la fiche — une entrée
  // `LeadNote`, pas la colonne `Lead.notes`.
  //
  // La distinction n'est pas cosmétique : `Lead.notes` n'est affichée nulle part
  // dans la prospection. Tout ce que l'utilisateur lit comme « notes » vient de
  // `LeadNote`, indexé par `placeId ?? lead.id`. Écrire dans la colonne revenait
  // à jeter le contenu dans un champ que personne n'ouvre — ce qui donnait des
  // fiches vides alors que la correspondance avait bien fait son travail.
  //
  // Best-effort : un prospect enregistré sans sa note vaut mieux qu'un appel
  // rejoué en boucle parce que la note a échoué.
  if (lead.notes) {
    try {
      await entities.LeadNote.create({
        data: {
          companyId: args.companyId,
          identifier: (row as any).placeId ?? row.id,
          text: lead.notes,
        },
      });
    } catch (err) {
      console.error('[intake] prospect créé mais note non enregistrée', err);
    }
  }

  return row;
}

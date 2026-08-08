// Enregistrement d'un prospect issu d'une correspondance.
//
// Partagé par le point d'entrée (appel reçu) et par le rejeu depuis le journal,
// qui doivent produire exactement la même chose. C'était déjà deux fois le même
// bloc ; ça l'est désormais une seule.

import { insertLeadOnTop } from '../../app/leads/operations';
import type { MappedLead } from '../../shared/leadIntake';

export async function insertMappedLead(
  entities: any,
  args: {
    searchId: string;
    companyId: string;
    status: string;
    lead: MappedLead;
    /** Repli quand la correspondance n'a pas désigné de clé anti-doublon. */
    fallbackExternalId?: string | null;
  },
): Promise<{ id: string }> {
  const { lead } = args;

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
      source: lead.source,
      externalId: lead.externalId ?? args.fallbackExternalId ?? null,
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

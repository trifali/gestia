// Le SMS d'accueil envoyé au prospect qui vient d'arriver — et rien d'autre.
//
// À ne pas confondre avec `alerts.ts`, qui prévient l'*entreprise*. Ici le
// destinataire est le prospect, le texte est celui que l'entreprise a écrit pour
// la tranche horaire du moment, et chaque envoi est une ligne de `LeadSmsLog`
// dans le fil du prospect : sa réponse éventuelle s'y rattache, l'alerte de
// réponse différée s'y applique, et la fiche montre ce qu'on lui a dit.
//
// Un seul chemin l'emprunte : le point d'entrée, à la réception. Pas le rejeu
// depuis le journal — un appel rejoué peut dater de la veille, et « nous vous
// rappelons ce matin » envoyé à 16 h le lendemain ferait pire que rien.
//
// Chaque SMS est facturé et part sans qu'un humain l'ait relu : d'où la liste de
// garde-fous ci-dessous, chacun avec sa raison. Ils retiennent le SMS, jamais le
// prospect — la carte est déjà créée quand on arrive ici.

import { resolveSmsCredentials, sendSms, toE164 } from '../sms';
import { isCanadianNumber } from '../../shared/phone';
import {
  AUTO_REPLY_MAX_LEADS_PER_CALL,
  AUTO_REPLY_MAX_LEADS_PER_HOUR,
  AUTO_REPLY_REPEAT_FLOOR_MS,
  autoReplyWindowAt,
  isAutoReplyActive,
  isOptOutMessage,
  normalizeAutoReply,
  renderAutoReply,
} from '../../shared/leadIntakeAutoReply';

export type AutoReplyTarget = {
  id: string;
  companyId: string;
  autoReply: unknown;
  search: { title: string };
};

export type AutoReplyLead = {
  id: string;
  name: string;
  phone: string | null;
  placeId?: string | null;
};

/** Pourquoi un prospect n'a pas reçu de SMS — pour le journal, pas pour l'écran. */
type SkipReason =
  | 'no_phone'
  | 'invalid_phone'
  | 'foreign_number'
  | 'own_number'
  | 'opted_out'
  | 'recent_exchange'
  | 'empty_text';

/**
 * Envoie à chaque prospect du lot le message de la tranche en cours.
 *
 * Best-effort de bout en bout : la réponse HTTP à l'émetteur est déjà partie, et
 * un Telnyx en panne ne doit ni faire rejouer l'appel ni empêcher le prospect
 * suivant d'être servi. Rien n'est journalisé pour un envoi refusé par Telnyx —
 * une ligne sortante fantôme corromprait l'attribution des réponses à venir,
 * exactement comme dans `sendClientSms`.
 *
 * Renvoie le nombre de SMS effectivement acceptés par Telnyx.
 */
export async function deliverIntakeAutoReplies(
  entities: any,
  webhook: AutoReplyTarget,
  leads: AutoReplyLead[],
  now: Date = new Date(),
): Promise<number> {
  if (leads.length === 0) return 0;

  const cfg = normalizeAutoReply(webhook.autoReply);
  if (!isAutoReplyActive(cfg)) return 0;

  const windowKey = autoReplyWindowAt(cfg, now);
  const window = cfg[windowKey];
  if (!window.enabled || !window.text.trim()) {
    console.log(`[intake] réponse automatique : tranche « ${windowKey} » éteinte, rien envoyé.`);
    return 0;
  }

  // ── Garde-fous sur le lot ──────────────────────────────────────────────────

  if (leads.length > AUTO_REPLY_MAX_LEADS_PER_CALL) {
    console.log(
      `[intake] réponse automatique retenue : ${leads.length} prospects dans un même appel, `
      + `c'est un import et non des demandes (plafond ${AUTO_REPLY_MAX_LEADS_PER_CALL}).`,
    );
    return 0;
  }

  if (await isFlooded(entities, webhook.id, now)) {
    console.warn(
      `[intake] réponse automatique retenue : plus de ${AUTO_REPLY_MAX_LEADS_PER_HOUR} prospects `
      + `reçus en une heure sur cette source — rafale ou robot, on ne facture pas un SMS par ligne.`,
    );
    return 0;
  }

  const company = await entities.Company.findUnique({
    where: { id: webhook.companyId },
    select: { name: true, telnyxPhoneNumber: true, telnyxApiKey: true },
  });
  const credentials = resolveSmsCredentials(company);
  if (!credentials) {
    console.warn('[intake] réponse automatique demandée mais identifiants Telnyx absents.');
    return 0;
  }

  // ── Un prospect à la fois ──────────────────────────────────────────────────

  let sent = 0;
  // Deux prospects du même appel avec le même numéro (un formulaire soumis deux
  // fois d'affilée) : le second ne trouvera pas encore la ligne du premier en
  // base si Telnyx est lent. On s'en souvient ici.
  const servedInThisCall = new Set<string>();

  for (const lead of leads) {
    const verdict = await inspectLead(entities, webhook.companyId, lead, credentials.from, now);
    if ('skip' in verdict) {
      console.log(`[intake] réponse automatique retenue pour « ${lead.name} » : ${describe(verdict.skip)}.`);
      continue;
    }
    const { to } = verdict;
    if (servedInThisCall.has(to)) {
      console.log(`[intake] réponse automatique retenue pour « ${lead.name} » : ${describe('recent_exchange')}.`);
      continue;
    }

    const text = renderAutoReply(window.text, {
      leadName: lead.name,
      companyName: company?.name,
      searchTitle: webhook.search.title,
    });
    if (!text) {
      console.log(`[intake] réponse automatique retenue pour « ${lead.name} » : ${describe('empty_text')}.`);
      continue;
    }

    let providerId: string | null = null;
    try {
      ({ id: providerId } = await sendSms({ to, text, credentials }));
    } catch (err) {
      console.error(`[intake] réponse automatique échouée vers ${to}`, err);
      continue;
    }
    servedInThisCall.add(to);

    // Même fil que celui qu'ouvre la fiche prospect (`placeId ?? lead.id`) : la
    // réponse du prospect s'y rattachera par le dernier sortant vers ce numéro.
    try {
      await entities.LeadSmsLog.create({
        data: {
          companyId: webhook.companyId,
          identifier: lead.placeId ?? lead.id,
          to,
          fromNumber: credentials.from,
          body: text,
          providerId,
          direction: 'outbound',
          // Telnyx l'a accepté ; l'état réel arrive plus tard par le webhook.
          status: 'queued',
        },
      });
    } catch (err) {
      console.error('[intake] réponse automatique envoyée mais non journalisée', err);
    }
    sent++;
  }

  if (sent > 0) console.log(`[intake] ${sent} réponse(s) automatique(s) envoyée(s) (tranche « ${windowKey} »).`);
  return sent;
}

// ─── Garde-fous ───────────────────────────────────────────────────────────────

/**
 * La source a-t-elle reçu plus que ce qu'une activité humaine produit en une
 * heure ?
 *
 * Compté sur le journal des appels, qui porte déjà les cartes créées par chacun :
 * `LeadSmsLog` ne sait pas de quelle source vient un envoi, et ajouter une
 * colonne pour un compteur serait disproportionné. C'est une borne haute (les
 * prospects reçus, pas les SMS partis), ce qui est le bon sens de l'erreur pour
 * un garde-fou de facturation.
 */
async function isFlooded(entities: any, webhookId: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - 60 * 60_000);
  const events = await entities.LeadInboundEvent.findMany({
    where: { webhookId, status: 'ok', createdAt: { gte: since } },
    select: { leadIds: true },
  });
  const received = events.reduce((n: number, e: { leadIds: string[] }) => n + e.leadIds.length, 0);
  return received > AUTO_REPLY_MAX_LEADS_PER_HOUR;
}

/**
 * Tout ce qui, sur ce prospect précis, interdit de lui écrire — ou le numéro
 * E.164 vers lequel partir.
 *
 * L'ordre va du moins coûteux au plus coûteux : les contrôles de forme ne
 * touchent pas la base, les deux derniers la lisent.
 */
async function inspectLead(
  entities: any,
  companyId: string,
  lead: AutoReplyLead,
  ownNumber: string,
  now: Date,
): Promise<{ to: string } | { skip: SkipReason }> {
  const raw = (lead.phone ?? '').trim();
  if (!raw) return { skip: 'no_phone' };

  const to = toE164(raw);
  if (!to) return { skip: 'invalid_phone' };

  // Canadien seulement. Un numéro américain ou européen est peut-être un vrai
  // prospect, mais l'envoi international coûte plusieurs fois le tarif local et
  // personne n'a relu ce message : à lui d'écrire à la main s'il le juge utile.
  if (!isCanadianNumber(to)) return { skip: 'foreign_number' };

  // Écrire à notre propre numéro rentrerait dans le webhook entrant et ouvrirait
  // une conversation avec nous-mêmes — même garde-fou que les alertes.
  if (to === ownNumber) return { skip: 'own_number' };

  // Un « STOP » reçu un jour de ce numéro vaut pour toujours, quel que soit le
  // tableau d'où il repasse. Une ligne entrante porte le numéro du prospect en
  // `fromNumber` : c'est lui qu'on cherche, pas le fil — un même numéro peut en
  // avoir plusieurs.
  const inbound = await entities.LeadSmsLog.findMany({
    where: { companyId, direction: 'inbound', fromNumber: to },
    select: { body: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  if (inbound.some((m: { body: string }) => isOptOutMessage(m.body))) return { skip: 'opted_out' };

  // Déjà en conversation, dans un sens ou dans l'autre, depuis moins de 24 h.
  const floor = new Date(now.getTime() - AUTO_REPLY_REPEAT_FLOOR_MS);
  const recent = await entities.LeadSmsLog.findFirst({
    where: {
      companyId,
      createdAt: { gte: floor },
      OR: [
        { direction: 'outbound', to },
        { direction: 'inbound', fromNumber: to },
      ],
    },
    select: { id: true },
  });
  if (recent) return { skip: 'recent_exchange' };

  return { to };
}

function describe(reason: SkipReason): string {
  switch (reason) {
    case 'no_phone': return 'aucun numéro';
    case 'invalid_phone': return 'numéro invalide';
    case 'foreign_number': return 'numéro hors Canada';
    case 'own_number': return 'c\'est notre propre numéro Telnyx';
    case 'opted_out': return 'ce numéro a demandé à ne plus être contacté (STOP)';
    case 'recent_exchange': return 'un SMS a déjà été échangé avec ce numéro depuis moins de 24 h';
    case 'empty_text': return 'le message rendu est vide';
  }
}

// Tâches d'entretien de la réception de prospects.
//
// Aucune n'est nécessaire au fonctionnement : un appel entrant crée sa carte
// immédiatement, sans file d'attente ni rattrapage. C'est l'avantage structurel
// de recevoir plutôt que d'aller chercher. Ces deux tâches ne font que borner la
// croissance du journal, et prévenir quand personne ne regarde.
//
// L'envoi de l'alerte, lui, vit dans `leadIntake/alerts` : une source réglée sur
// « dès l'arrivée » est servie par le point d'entrée, sans passer par ici.

import { deliverIntakeAlerts } from '../leadIntake/alerts';
import { intakeAlertDelayMs } from '../../shared/leadIntake';

/** Au-delà, un appel journalisé n'aide plus personne à diagnostiquer quoi que ce soit. */
const RETENTION_DAYS = 90;

/**
 * Purge le journal des appels.
 *
 * Le plus récent de chaque source est épargné : c'est lui qui sert d'échantillon
 * à l'écran de correspondance, et une source calme depuis trois mois ne doit pas
 * se retrouver sans rien à quoi se référer le jour où on veut la reconfigurer.
 */
export const sweepLeadInboundEvents = async (_args: unknown, context: any) => {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);

  const webhooks = await context.entities.LeadInboundWebhook.findMany({ select: { id: true } });
  let deleted = 0;

  for (const webhook of webhooks) {
    const newest = await context.entities.LeadInboundEvent.findFirst({
      where: { webhookId: webhook.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const { count } = await context.entities.LeadInboundEvent.deleteMany({
      where: {
        webhookId: webhook.id,
        createdAt: { lt: cutoff },
        ...(newest ? { id: { not: newest.id } } : {}),
      },
    });
    deleted += count;
  }

  if (deleted > 0) console.log(`[intake] ${deleted} appel(s) purgé(s) du journal.`);
  return { deleted };
};

// ─── Alerte de prospects reçus ────────────────────────────────────────────────

/** Au-delà, on ne rattrape plus : le prospect est de toute façon froid. */
const NOTIFY_MAX_AGE_MS = 12 * 60 * 60_000;

/**
 * Prévient l'entreprise des prospects arrivés que personne n'a encore ouverts.
 *
 * Un prospect qu'on ne voit pas est exactement le problème que cette
 * fonctionnalité existe pour résoudre : il ne suffit pas que la carte se crée,
 * encore faut-il que quelqu'un l'apprenne. L'alerte est différée et conditionnée
 * à `statusUpdatedAt` — dès que le prospect change de colonne, c'est que
 * quelqu'un s'en occupe, et l'alerte n'a plus lieu d'être.
 *
 * Le sursis se lit sur chaque source (`alertDelayMinutes`). Une source réglée sur
 * « dès l'arrivée » a normalement déjà été traitée par le point d'entrée, qui a
 * posé `notifiedAt` : il ne reste alors rien à annoncer ici. Ce passage lui sert
 * de filet — si l'envoi immédiat a échoué avant d'écrire ce repère, il reprend le
 * lot au tour suivant.
 */
export const notifyInboundLeads = async (_args: unknown, context: any) => {
  const now = Date.now();
  const floor = new Date(now - NOTIFY_MAX_AGE_MS);

  // Les sources sans aucune alerte demandée sont écartées en SQL. C'est le cas
  // par défaut, donc de très loin le plus courant : les charger pour découvrir
  // ensuite qu'il n'y a rien à envoyer ferait tourner une requête de prospects
  // par source toutes les cinq minutes, pour rien.
  //
  // L'échéance, elle, ne s'exprime plus en SQL depuis qu'elle dépend de chaque
  // source : le filtre ne garde ici que ce qui est encore rattrapable, et le
  // sursis est appliqué dans la boucle.
  const webhooks = await context.entities.LeadInboundWebhook.findMany({
    where: {
      isActive: true,
      lastReceivedAt: { gte: floor },
      OR: [{ notifyByEmail: true }, { notifyBySms: true }],
    },
    select: {
      id: true,
      companyId: true,
      notifiedAt: true,
      notifyByEmail: true,
      notifyBySms: true,
      alertDelayMinutes: true,
      lastReceivedAt: true,
      search: { select: { id: true, title: true } },
    },
  });

  let sent = 0;
  for (const webhook of webhooks) {
    // Le sursis court depuis la dernière réception, et non depuis chaque prospect :
    // c'est ce qui fait qu'une vague d'arrivées produit une seule alerte.
    const due = new Date(now - intakeAlertDelayMs(webhook.alertDelayMinutes));
    if (webhook.lastReceivedAt && webhook.lastReceivedAt > due) continue;

    // Uniquement ce qui est arrivé depuis la dernière alerte : sans cette borne,
    // chaque passage réexpédierait tout l'historique de la journée.
    const since = webhook.notifiedAt ?? floor;
    const fresh = await context.entities.Lead.findMany({
      where: {
        searchId: webhook.search.id,
        createdAt: { gt: since, lte: due },
      },
      select: { id: true, name: true, email: true, phone: true, status: true, statusUpdatedAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    // Un prospect déjà déplacé de sa colonne d'arrivée a été vu. Rien à annoncer.
    const unseen = fresh.filter(
      (l: any) => !l.statusUpdatedAt || l.statusUpdatedAt.getTime() <= l.createdAt.getTime() + 1000,
    );
    if (unseen.length === 0) continue;

    if (await deliverIntakeAlerts(context.entities, webhook, unseen)) sent += 1;
  }

  return { sent };
};

// Tâches d'entretien de la réception de prospects.
//
// Aucune n'est nécessaire au fonctionnement : un appel entrant crée sa carte
// immédiatement, sans file d'attente ni rattrapage. C'est l'avantage structurel
// de recevoir plutôt que d'aller chercher. Ces deux tâches ne font que borner la
// croissance du journal, et prévenir quand personne ne regarde.

import { config } from 'wasp/server';
import { sendEmailWithAttachment, companySmtp } from '../mail';
import { resolveSmsCredentials, sendSms, toE164 } from '../sms';

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

/**
 * Le sursis laissé avant d'alerter. Même raisonnement que pour les réponses SMS
 * (`REPLY_ALERT_DELAY_MINUTES`) : quelqu'un qui a Gestia ouvert verra la carte
 * arriver, et n'a pas besoin d'un courriel en plus.
 */
const NOTIFY_DELAY_MS = 10 * 60_000;

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
 */
export const notifyInboundLeads = async (_args: unknown, context: any) => {
  const now = Date.now();
  const due = new Date(now - NOTIFY_DELAY_MS);
  const floor = new Date(now - NOTIFY_MAX_AGE_MS);

  const webhooks = await context.entities.LeadInboundWebhook.findMany({
    where: { isActive: true, lastReceivedAt: { gte: floor, lte: due } },
    select: {
      id: true,
      companyId: true,
      notifiedAt: true,
      search: { select: { id: true, title: true } },
    },
  });

  let sent = 0;
  for (const webhook of webhooks) {
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

    const company = await context.entities.Company.findUnique({
      where: { id: webhook.companyId },
      select: {
        id: true, name: true, email: true, phone: true,
        notifyInboundLeadByEmail: true, notifyInboundLeadBySms: true,
        telnyxPhoneNumber: true, telnyxApiKey: true,
        smtpHost: true, smtpPort: true, smtpUsername: true, smtpPassword: true,
        smtpFromName: true, smtpFromEmail: true,
      },
    });
    if (!company) continue;

    // Les deux canaux sont éteints : rien à envoyer, et surtout on ne pose pas
    // `notifiedAt`. Réactiver l'alerte doit pouvoir rattraper ce qui est arrivé
    // entre-temps, ce qu'un repère avancé dans le vide interdirait.
    if (!company.notifyInboundLeadByEmail && !company.notifyInboundLeadBySms) continue;

    let delivered = false;
    if (company.notifyInboundLeadByEmail) {
      delivered = await deliverInboundAlert(company, webhook.search.title, unseen);
    }
    if (company.notifyInboundLeadBySms) {
      delivered = (await deliverInboundSms(company, webhook.search.title, unseen)) || delivered;
    }

    // La date est posée même en cas d'échec d'envoi : sans cela, un SMTP mal
    // configuré ferait retenter le même lot toutes les cinq minutes, sans fin.
    await context.entities.LeadInboundWebhook.update({
      where: { id: webhook.id },
      data: { notifiedAt: new Date() },
    });
    if (delivered) sent += 1;
  }

  return { sent };
};

/**
 * L'alerte par SMS.
 *
 * Court et sans lien : un SMS est facturé au segment, et l'adresse de Gestia ne
 * tient pas dans le budget utile. Le message dit combien et sur quel tableau ;
 * l'application dit le reste.
 *
 * Les mêmes garde-fous que les alertes de réponse (`jobs/smsReplyAlerts`), pour
 * la même raison : écrire à notre propre numéro Telnyx rentrerait dans le webhook
 * entrant et créerait une conversation avec nous-mêmes.
 */
async function deliverInboundSms(company: any, boardTitle: string, leads: any[]): Promise<boolean> {
  const credentials = resolveSmsCredentials(company);
  const target = toE164(company.phone ?? '');

  if (!credentials) {
    console.warn('[intake] alerte SMS demandée mais identifiants Telnyx absents.');
    return false;
  }
  if (!target) {
    console.warn('[intake] alerte SMS demandée mais aucun téléphone d\'entreprise valide.');
    return false;
  }
  if (target === credentials.from) {
    console.warn('[intake] alerte SMS ignorée : le téléphone d\'entreprise est le numéro Telnyx.');
    return false;
  }

  const count = leads.length;
  const head = leads[0];
  const text = count === 1
    ? `Gestia — nouveau prospect sur « ${boardTitle} » : ${head.name}.`
    : `Gestia — ${count} nouveaux prospects sur « ${boardTitle} ».`;

  try {
    await sendSms({ to: target, text, credentials });
    return true;
  } catch (err) {
    console.error('[intake] alerte SMS échouée', err);
    return false;
  }
}

async function deliverInboundAlert(company: any, boardTitle: string, leads: any[]): Promise<boolean> {
  const to = (company.email ?? '').trim();
  const smtp = companySmtp(company);
  if (!to) {
    console.warn('[intake] prospects reçus mais aucun courriel d\'entreprise configuré.');
    return false;
  }
  if (!smtp) {
    console.warn('[intake] prospects reçus mais aucun serveur SMTP propre à l\'entreprise.');
    return false;
  }

  const link = `${config.frontendUrl}/prospection`;
  const count = leads.length;
  const subject = count === 1
    ? `Nouveau prospect — ${boardTitle}`
    : `${count} nouveaux prospects — ${boardTitle}`;

  const lines = leads.map(l => `• ${l.name}${l.email ? ` — ${l.email}` : ''}${l.phone ? ` — ${l.phone}` : ''}`);

  try {
    await sendEmailWithAttachment({
      smtp,
      to,
      subject,
      text: `${subject}\n\n${lines.join('\n')}\n\nVoir dans Gestia : ${link}`,
      html:
        `<p><strong>${escapeHtml(subject)}</strong></p>`
        + `<ul>${leads.map(l => `<li>${escapeHtml(l.name)}${l.email ? ` — ${escapeHtml(l.email)}` : ''}${l.phone ? ` — ${escapeHtml(l.phone)}` : ''}</li>`).join('')}</ul>`
        + `<p><a href="${link}">Voir dans Gestia</a></p>`,
    });
    return true;
  } catch (err) {
    console.error('[intake] alerte courriel échouée', err);
    return false;
  }
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

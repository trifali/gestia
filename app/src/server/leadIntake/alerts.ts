// L'alerte « des prospects sont arrivés », et rien d'autre.
//
// Deux chemins l'empruntent, et doivent produire exactement le même message :
//
//   · le point d'entrée (`webhook.ts`), quand la source est réglée sur « dès
//     l'arrivée » — l'alerte part dans la foulée de la création des cartes ;
//   · la tâche `notifyInboundLeads` (`jobs/leadIntake.ts`), quand la source
//     laisse un sursis — l'alerte part au passage suivant, si personne n'a
//     touché aux prospects entre-temps.
//
// Le module ne décide pas *quand* alerter : il reçoit une source et une liste de
// prospects, envoie ce que la source a demandé, et pose les repères. Le choix du
// moment appartient à l'appelant, qui seul sait de quel chemin il s'agit.

import { config } from 'wasp/server';
import { sendEmailWithAttachment, companySmtp } from '../mail';
import { resolveSmsCredentials, sendSms, toE164 } from '../sms';
import { INTAKE_SMS_FLOOR_MS } from '../../shared/leadIntake';

/** Ce que l'alerte a besoin de savoir de la source. */
export type IntakeAlertTarget = {
  id: string;
  companyId: string;
  notifyByEmail: boolean;
  notifyBySms: boolean;
  search: { title: string };
};

/** Ce que l'alerte a besoin de savoir des prospects annoncés. */
export type IntakeAlertLead = {
  name: string;
  email: string | null;
  phone: string | null;
};

/**
 * Envoie à l'entreprise les canaux demandés par cette source, et pose les repères.
 *
 * Les coordonnées visées sont celles de l'entreprise — jamais un compte
 * individuel — mais le choix des canaux appartient à la source.
 *
 * `notifiedAt` est posé même quand l'envoi échoue : sans cela, un SMTP mal
 * configuré ferait retenter le même lot indéfiniment. `smsNotifiedAt` ne l'est
 * qu'en cas de SMS réellement parti, puisque c'est lui qui sert de plancher.
 *
 * Renvoie `true` si au moins un canal a abouti — ce que la tâche compte.
 */
export async function deliverIntakeAlerts(
  entities: any,
  webhook: IntakeAlertTarget,
  leads: IntakeAlertLead[],
): Promise<boolean> {
  if (leads.length === 0) return false;
  if (!webhook.notifyByEmail && !webhook.notifyBySms) return false;

  const company = await entities.Company.findUnique({
    where: { id: webhook.companyId },
    select: {
      id: true, name: true, email: true, phone: true,
      telnyxPhoneNumber: true, telnyxApiKey: true,
      smtpHost: true, smtpPort: true, smtpUsername: true, smtpPassword: true,
      smtpFromName: true, smtpFromEmail: true,
    },
  });
  if (!company) return false;

  const title = webhook.search.title;
  let delivered = false;

  if (webhook.notifyByEmail) {
    delivered = await deliverInboundAlert(company, title, leads);
  }

  if (webhook.notifyBySms) {
    if (await claimSmsSlot(entities, webhook.id)) {
      delivered = (await deliverInboundSms(company, title, leads)) || delivered;
    } else {
      // Le SMS précédent, émis il y a moins de deux minutes, annonçait déjà
      // « des prospects sont arrivés ». Le redire coûterait un segment pour une
      // information que le destinataire a sous les yeux.
      console.log('[intake] SMS d\'arrivée retenu : un envoi trop récent pour cette source.');
    }
  }

  await entities.LeadInboundWebhook.update({
    where: { id: webhook.id },
    data: { notifiedAt: new Date() },
  });

  return delivered;
}

/**
 * Réserve le droit d'émettre un SMS pour cette source, et le date d'un coup.
 *
 * Lire `smsNotifiedAt` puis décider en JavaScript laisserait passer deux appels
 * simultanés — et deux segments facturés là où on en voulait un. Le `updateMany`
 * conditionné à l'ancienneté fait office de verrou : de deux appels concurrents,
 * un seul verra `count === 1`. Même discipline que la reprise de clé anti-doublon
 * dans `webhook.ts`.
 *
 * La date est posée avant l'envoi, donc aussi quand il échoue : deux minutes sans
 * réessai valent mieux qu'une boucle de segments facturés sur un Telnyx en panne.
 */
async function claimSmsSlot(entities: any, webhookId: string): Promise<boolean> {
  const floor = new Date(Date.now() - INTAKE_SMS_FLOOR_MS);
  const { count } = await entities.LeadInboundWebhook.updateMany({
    where: {
      id: webhookId,
      OR: [{ smsNotifiedAt: null }, { smsNotifiedAt: { lte: floor } }],
    },
    data: { smsNotifiedAt: new Date() },
  });
  return count === 1;
}

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
async function deliverInboundSms(company: any, boardTitle: string, leads: IntakeAlertLead[]): Promise<boolean> {
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

async function deliverInboundAlert(company: any, boardTitle: string, leads: IntakeAlertLead[]): Promise<boolean> {
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

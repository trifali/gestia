// SMS vers un client, depuis une carte de suivi.
//
// Même mécanique que le SMS de prospection (leads/operations) : un envoi, une
// ligne dans LeadSmsLog, et le fil se relit dans la foulée. Ce qui change est
// l'identifiant du fil — un client n'a pas de placeId, alors la conversation
// est celle de son numéro (`tel:+…`), exactement celle que la boîte SMS affiche
// et à laquelle le webhook rattache déjà les réponses. Écrire à un client
// depuis le suivi et lui écrire depuis la boîte alimentent donc un seul fil.
//
// Volontairement hors de sms/operations : la boîte universelle est opt-in, et
// relancer un client par SMS ne doit pas dépendre d'un interrupteur qui ne
// parle que de la messagerie.

import { HttpError } from 'wasp/server';
import {
  sendSms,
  toE164,
  resolveSmsCredentials,
  directIdentifier,
} from '../../server/sms';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

const MAX_SMS_BODY = 1600;

async function requireClient(context: any, companyId: string, clientId: string): Promise<any> {
  const client = await context.entities.Client.findUnique({ where: { id: clientId } });
  if (!client || client.companyId !== companyId) throw new HttpError(404, 'Client introuvable');
  return client;
}

/**
 * Le fil dans lequel un envoi vers ce numéro atterrira. Même règle que
 * `sendDirectSms` et que le webhook entrant : celui depuis lequel on a écrit à
 * ce numéro le plus récemment, sinon une conversation autonome. Sans cette
 * résolution, écrire au numéro d'un client qui est aussi un prospect ouvrirait
 * un second fil et l'attribution des réponses basculerait de l'un à l'autre.
 */
async function resolveThread(context: any, companyId: string, to: string): Promise<string> {
  const lastOutbound = await (context.entities as any).LeadSmsLog.findFirst({
    where: { companyId, to, direction: 'outbound' },
    orderBy: { createdAt: 'desc' },
    select: { identifier: true },
  });
  return lastOutbound?.identifier ?? directIdentifier(to);
}

export type ClientSmsThread = {
  /** null quand aucun numéro exploitable n'est connu : rien à afficher encore. */
  identifier: string | null;
  /** E.164 vers lequel l'envoi partira. */
  phone: string | null;
  /** Le numéro tel qu'il est saisi sur la fiche, pour préremplir le champ. */
  rawPhone: string | null;
};

/**
 * `phone` permet de suivre le champ « À » du formulaire : taper un autre numéro
 * doit montrer la conversation de ce numéro-là, pas celle de la fiche.
 */
export const getClientSmsThread = async (
  { clientId, phone }: { clientId: string; phone?: string | null },
  context: any,
): Promise<ClientSmsThread> => {
  const companyId = ensureCompany(context.user);
  const client = await requireClient(context, companyId, clientId);

  const rawPhone = (client.phone ?? null) as string | null;
  const e164 = toE164(phone?.trim() || rawPhone || '');
  if (!e164) return { identifier: null, phone: null, rawPhone };

  return { identifier: await resolveThread(context, companyId, e164), phone: e164, rawPhone };
};

export const sendClientSms = async (
  args: { clientId: string; to: string; body: string },
  context: any,
): Promise<{ ok: true; identifier: string }> => {
  const companyId = ensureCompany(context.user);
  await requireClient(context, companyId, args.clientId);

  const text = (args.body ?? '').trim();
  if (!text) throw new HttpError(400, 'Message requis');
  if (text.length > MAX_SMS_BODY) {
    throw new HttpError(400, `Message trop long (${MAX_SMS_BODY} caractères maximum).`);
  }

  const to = toE164(args.to ?? '');
  if (!to) throw new HttpError(400, 'Numéro de téléphone invalide');

  const company = await context.entities.Company.findUnique({
    where: { id: companyId },
    select: { telnyxPhoneNumber: true, telnyxApiKey: true },
  });
  const credentials = resolveSmsCredentials(company);
  if (!credentials) {
    throw new HttpError(
      400,
      'SMS non configuré. Ajoutez votre numéro et votre clé API Telnyx dans Paramètres → Intégrations.',
    );
  }
  if (to === credentials.from) {
    throw new HttpError(400, 'Vous ne pouvez pas envoyer un SMS à votre propre numéro Telnyx.');
  }

  const identifier = await resolveThread(context, companyId, to);

  let providerId: string | null = null;
  try {
    ({ id: providerId } = await sendSms({ to, text, credentials }));
  } catch (e: any) {
    // Rien n'est journalisé : une ligne sortante fantôme corromprait
    // l'attribution des réponses à venir.
    throw new HttpError(502, e?.message ?? "Erreur lors de l'envoi du SMS");
  }

  await (context.entities as any).LeadSmsLog.create({
    data: {
      companyId,
      identifier,
      to,
      fromNumber: credentials.from,
      body: text,
      providerId,
      direction: 'outbound',
      // Telnyx l'a accepté ; l'état réel arrive plus tard par le webhook.
      status: 'queued',
    },
  });

  return { ok: true, identifier };
};

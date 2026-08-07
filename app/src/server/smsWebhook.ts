// Inbound Telnyx webhooks: prospect replies (message.received) and delivery
// receipts for what we sent (message.sent / message.finalized).
//
// Telnyx has no list-messages endpoint, so webhooks are the only way to see a
// reply. Each company configures these URLs on its own Messaging Profile
// (the settings screen shows them):
//   Webhook URL          <serverUrl>/webhooks/telnyx/sms
//   Webhook failover URL <serverUrl>/webhooks/telnyx/sms-failover
// Both land on the same handler; the failover path only makes retries visible in
// the logs.
//
// Because the signing key is per-company, the payload's destination number is
// used to pick which company's key to verify against. That number is untrusted
// input, but choosing a company cannot help an attacker: they still have to
// produce a valid signature for that company's key, and nothing is read or
// written before verification succeeds.

import crypto from 'crypto';
import express from 'express';
import type { Request, Response } from 'express';
import type { MiddlewareConfigFn } from 'wasp/server';
import {
  toE164,
  resolveSmsPublicKey,
  directIdentifier,
  isDirectIdentifier,
} from './sms';
import { REPLY_ALERT_DELAY_MS } from '../shared/smsAlerts';

/** Telnyx signs `${timestamp}|${rawBody}`; anything older than this is a replay. */
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/**
 * Replaces Wasp's `express.json()` on the webhook routes with one that keeps the
 * raw body around — the Ed25519 signature covers the exact bytes Telnyx sent, so
 * re-serialising the parsed object would not verify.
 */
export const telnyxWebhookMiddleware: MiddlewareConfigFn = (config) => {
  config.set(
    'express.json',
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf.toString('utf8');
      },
    }),
  );
  return config;
};

function toKeyObject(rawBase64: string): crypto.KeyObject | null {
  try {
    // The portal hands out a standard-base64 raw Ed25519 key; JWK wants base64url.
    const x = rawBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' } as any);
  } catch {
    return null;
  }
}

function verifySignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  publicKeyBase64: string,
): boolean {
  if (!signature || !timestamp) return false;
  const key = toKeyObject(publicKeyBase64);
  if (!key) return false;

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return false;
  if (Math.abs(Date.now() / 1000 - sent) > SIGNATURE_TOLERANCE_SECONDS) return false;

  try {
    return crypto.verify(
      null,
      Buffer.from(`${timestamp}|${rawBody}`, 'utf8'),
      key,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

/** Telnyx reports one status per recipient; the worst one is what matters to us. */
function worstRecipientStatus(payload: any): { status: string | null; errorCode: string | null } {
  const recipients: any[] = Array.isArray(payload?.to) ? payload.to : [];
  const statuses = recipients.map(r => r?.status).filter(Boolean) as string[];
  const failed = statuses.find(s => s.includes('failed') || s === 'undelivered' || s === 'expired');
  const errorCode = payload?.errors?.[0]?.code ?? null;
  return {
    status: failed ?? statuses[0] ?? null,
    errorCode: errorCode == null ? null : String(errorCode),
  };
}

function firstRecipientNumber(payload: any): string | null {
  const recipients: any[] = Array.isArray(payload?.to) ? payload.to : [];
  return recipients[0]?.phone_number ?? null;
}

/**
 * For an inbound reply the destination is our Telnyx number; for a delivery
 * receipt it is the prospect's, and the *sender* is our Telnyx number.
 */
function ourNumberFromPayload(eventType: string, payload: any): string | null {
  const raw = eventType === 'message.received'
    ? firstRecipientNumber(payload)
    : payload?.from?.phone_number;
  return toE164(raw ?? '');
}

/**
 * Datation de l'alerte de réponse — aucune notification ne part d'ici.
 *
 * Les deux canaux, courriel et SMS, partagent la même échéance à +5 minutes. La
 * tâche planifiée `sendDueSmsReplyAlerts` ne les postera que si la réponse est
 * *toujours non lue* à ce moment-là : quelqu'un qui a Gestia ouvert la verra via
 * la pastille en vingt secondes, et personne n'aura reçu de doublon dans sa boîte
 * ni payé un SMS. Notifier hors de l'application n'a de sens que si personne
 * n'était dedans.
 *
 * Rien n'est vérifié ici — ni courriel d'entreprise, ni identifiants Telnyx.
 * Cinq minutes suffisent à décocher une option ou à changer de coordonnées, et
 * c'est l'instant de l'envoi qui fait foi : la tâche revalide tout.
 *
 * Best-effort : un échec ne doit jamais faire échouer le webhook, sinon Telnyx
 * retenterait une réponse déjà enregistrée.
 */
async function scheduleReplyAlert(company: any, entities: any, messageId: string): Promise<void> {
  if (!company.notifySmsReplyByEmail && !company.notifySmsReplyBySms) return;
  try {
    await entities.LeadSmsLog.update({
      where: { id: messageId },
      data: { replyAlertDueAt: new Date(Date.now() + REPLY_ALERT_DELAY_MS) },
    });
  } catch (err) {
    console.error('[telnyx] réponse enregistrée mais échéance d\'alerte non posée', err);
  }
}

/**
 * Enregistre un SMS entrant et alerte l'entreprise.
 *
 * Attribution : le fil retenu est celui **depuis lequel l'entreprise a écrit à ce
 * numéro le plus récemment**, quel que soit son identifiant — rien dans une
 * charge utile entrante n'identifie l'interlocuteur. Un numéro qui est aussi
 * celui d'un prospect répond donc dans le fil du prospect ; après un envoi
 * direct vers ce même numéro, la réponse suivante ira dans le fil direct.
 * Déterministe, et sans code d'arbitrage.
 *
 * Faute d'historique, on ouvre une conversation autonome `tel:+…` sous
 * l'entreprise propriétaire du numéro Telnyx destinataire : un inconnu qui
 * écrit est un message à traiter, pas une anomalie à mettre en quarantaine.
 */
async function handleInbound(payload: any, company: any, entities: any): Promise<void> {
  const providerId: string | null = payload?.id ?? null;
  const fromRaw: string = (payload?.from?.phone_number ?? '').trim();
  const from = toE164(fromRaw);
  // Un code court (« 12345 ») ou un expéditeur alphanumérique n'est pas en
  // E.164 : on garde la valeur brute plutôt que de perdre le message.
  const fromKey = from ?? (fromRaw || null);
  if (!fromKey) return;

  const arrivedOn = toE164(firstRecipientNumber(payload) ?? '') ?? company.telnyxPhoneNumber ?? '';
  const body: string = payload?.text ?? '';

  // Scoping to the company (known from the Telnyx number the reply arrived on)
  // keeps companies that happen to share a prospect from stealing each other's
  // replies.
  const lastOutbound = await entities.LeadSmsLog.findFirst({
    where: { companyId: company.id, to: fromKey, direction: 'outbound' },
    orderBy: { createdAt: 'desc' },
    select: { identifier: true },
  });
  const identifier: string = lastOutbound?.identifier ?? directIdentifier(fromKey);

  // Écrit avant toute notification : une relivraison Telnyx casse ici sur
  // providerId @unique (P2002 → 200 plus bas) et ne peut donc pas produire une
  // seconde alerte.
  const created = await entities.LeadSmsLog.create({
    data: {
      companyId: company.id,
      identifier,
      // `to`/`fromNumber` stay literal: the reply came *from* them *to* us.
      to: arrivedOn,
      fromNumber: fromKey,
      body,
      providerId,
      direction: 'inbound',
      status: 'received',
    },
    select: { id: true },
  });

  // Sur un fil autonome, une seule échéance tant qu'il n'est pas lu : une réponse
  // de prospect est attendue et mérite chaque notification, mais un flot de
  // pourriel venant d'un inconnu ne doit pas devenir autant de courriels — et
  // autant de SMS facturés quand notifySmsReplyBySms est actif.
  if (isDirectIdentifier(identifier)) {
    const priorUnread = await entities.LeadSmsLog.count({
      where: {
        companyId: company.id,
        identifier,
        direction: 'inbound',
        readAt: null,
        id: { not: created.id },
      },
    });
    if (priorUnread > 0) return;
  }

  await scheduleReplyAlert(company, entities, created.id);
}

async function handleDeliveryReceipt(payload: any, company: any, entities: any): Promise<void> {
  const providerId: string | null = payload?.id ?? null;
  if (!providerId) return;

  const { status, errorCode } = worstRecipientStatus(payload);
  if (!status) return;

  // updateMany, not update: a receipt can arrive for a message we never logged
  // (e.g. sent before this feature shipped) and that must not throw. Scoped to
  // the company so one tenant's receipt cannot touch another's row.
  await entities.LeadSmsLog.updateMany({
    where: { providerId, direction: 'outbound', companyId: company.id },
    data: { status, errorCode },
  });
}

export const telnyxSmsWebhook = async (req: Request, res: Response, context: any) => {
  const rawBody: string = (req as any).rawBody ?? '';
  const signature = String(req.header('telnyx-signature-ed25519') ?? '');
  const timestamp = String(req.header('telnyx-timestamp') ?? '');

  const eventType: string = req.body?.data?.event_type ?? '';
  const payload = req.body?.data?.payload ?? {};

  // Untrusted routing hint — see the note at the top of this file.
  const ourNumber = ourNumberFromPayload(eventType, payload);
  const company = ourNumber
    ? await context.entities.Company.findUnique({ where: { telnyxPhoneNumber: ourNumber } })
    : null;
  if (!company) {
    console.warn('[telnyx] webhook pour un numéro inconnu, ignoré :', ourNumber);
    // 200, not 404: retrying will not make the number known, and we do not want
    // Telnyx hammering the endpoint over a misconfigured profile.
    res.status(200).json({ ok: true, ignored: 'unknown number' });
    return;
  }

  const publicKey = resolveSmsPublicKey(company);
  if (!publicKey) {
    console.error('[telnyx] aucune clé publique configurée pour', (company as any).name, '— webhook rejeté.');
    res.status(500).json({ error: 'webhook not configured' });
    return;
  }
  if (!verifySignature(rawBody, signature, timestamp, publicKey)) {
    console.warn('[telnyx] signature invalide, webhook ignoré.');
    res.status(401).json({ error: 'invalid signature' });
    return;
  }

  try {
    if (eventType === 'message.received') {
      await handleInbound(payload, company, context.entities);
    } else if (eventType === 'message.sent' || eventType === 'message.finalized') {
      await handleDeliveryReceipt(payload, company, context.entities);
    }
    // Any other event type is acknowledged and ignored, so Telnyx stops retrying.
  } catch (err: any) {
    // Unique-constraint hits mean Telnyx retried a webhook we already stored —
    // that is success, not failure. Anything else gets a 500 so Telnyx retries.
    if (err?.code === 'P2002') {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
    console.error('[telnyx] échec du traitement du webhook', eventType, err);
    res.status(500).json({ error: 'processing failed' });
    return;
  }

  res.status(200).json({ ok: true });
};

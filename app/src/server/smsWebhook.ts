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
import { config } from 'wasp/server';
import type { MiddlewareConfigFn } from 'wasp/server';
import { toE164, sendSms, resolveSmsCredentials, resolveSmsPublicKey } from './sms';
import { sendEmailWithAttachment, companySmtp } from './mail';

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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Notifies the company — and only the company, via the contact details on its
 * own record — that a prospect replied. Each channel is opt-out via the
 * notifySmsReplyBy* toggles in Paramètres → Intégrations.
 *
 * Best-effort throughout: a notification failure must never fail the webhook, or
 * Telnyx would retry a reply we have already stored.
 */
async function notifyCompanyOfReply(
  company: any,
  opts: { prospectNumber: string; body: string; prospectName: string | null },
): Promise<void> {
  const who = opts.prospectName
    ? `${opts.prospectName} (${opts.prospectNumber})`
    : opts.prospectNumber;

  if (company.notifySmsReplyByEmail) {
    const to = (company.email ?? '').trim();
    const smtp = companySmtp(company);
    if (!to) {
      console.warn('[telnyx] notification courriel activée mais aucun courriel d\'entreprise.');
    } else if (!smtp) {
      console.warn('[telnyx] notification courriel activée mais aucun serveur SMTP propre à l\'entreprise.');
    } else {
      try {
        const link = `${config.frontendUrl}/prospection`;
        await sendEmailWithAttachment({
          smtp,
          to,
          subject: `Réponse SMS — ${opts.prospectName ?? opts.prospectNumber}`,
          text: `${who} a répondu par SMS :\n\n${opts.body}\n\nVoir dans Gestia : ${link}`,
          html:
            `<p><strong>${escapeHtml(who)}</strong> a répondu par SMS :</p>` +
            `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #FF6A3D;white-space:pre-wrap">${escapeHtml(opts.body)}</blockquote>` +
            `<p><a href="${link}">Voir dans Gestia</a></p>`,
        });
      } catch (err) {
        console.error('[telnyx] réponse enregistrée mais notification courriel échouée', err);
      }
    }
  }

  if (company.notifySmsReplyBySms) {
    const credentials = resolveSmsCredentials(company);
    const target = toE164(company.phone ?? '');
    // Guard the two ways this could loop or misfire: texting our own Telnyx
    // number would re-enter this webhook forever, and texting the prospect's own
    // number would send them a copy of their own message.
    if (!credentials) {
      console.warn('[telnyx] notification SMS activée mais identifiants Telnyx absents.');
    } else if (!target) {
      console.warn('[telnyx] notification SMS activée mais aucun téléphone d\'entreprise valide.');
    } else if (target === credentials.from) {
      console.warn('[telnyx] notification SMS ignorée : le téléphone d\'entreprise est le numéro Telnyx.');
    } else if (target === opts.prospectNumber) {
      console.warn('[telnyx] notification SMS ignorée : le téléphone d\'entreprise est celui du prospect.');
    } else {
      try {
        // Deliberately not written to LeadSmsLog: an internal alert is not part
        // of the prospect conversation, and logging it would corrupt the
        // "last outbound to this number" lookup used to attribute replies.
        await sendSms({
          to: target,
          text: `Gestia — ${who} a répondu par SMS :\n${opts.body}`,
          credentials,
        });
      } catch (err) {
        console.error('[telnyx] réponse enregistrée mais notification SMS échouée', err);
      }
    }
  }
}

async function handleInbound(payload: any, company: any, entities: any): Promise<void> {
  const providerId: string | null = payload?.id ?? null;
  const from = toE164(payload?.from?.phone_number ?? '');
  const arrivedOn = toE164(firstRecipientNumber(payload) ?? '') ?? company.telnyxPhoneNumber ?? '';
  const body: string = payload?.text ?? '';
  if (!from) return;

  // Attribute by the last message this company sent to that number — nothing in
  // an inbound payload identifies the prospect. Scoping to the company (known
  // from the Telnyx number the reply arrived on) keeps companies that happen to
  // share a prospect from stealing each other's replies.
  const lastOutbound = await entities.LeadSmsLog.findFirst({
    where: { companyId: company.id, to: from, direction: 'outbound' },
    orderBy: { createdAt: 'desc' },
    select: { companyId: true, identifier: true },
  });

  if (!lastOutbound) {
    await entities.SmsInboundUnmatched.create({
      data: { providerId, fromNumber: from, to: arrivedOn, body },
    });
    return;
  }

  await entities.LeadSmsLog.create({
    data: {
      companyId: lastOutbound.companyId,
      identifier: lastOutbound.identifier,
      // `to`/`fromNumber` stay literal: the reply came *from* the prospect *to* us.
      to: arrivedOn,
      fromNumber: from,
      body,
      providerId,
      direction: 'inbound',
      status: 'received',
    },
  });

  // `identifier` is the placeId when Google Maps gave us one, else the lead's id.
  const lead = await entities.Lead.findFirst({
    where: {
      search: { companyId: lastOutbound.companyId },
      OR: [{ placeId: lastOutbound.identifier }, { id: lastOutbound.identifier }],
    },
    select: { name: true },
  });

  await notifyCompanyOfReply(company, {
    prospectNumber: from,
    body,
    prospectName: lead?.name ?? null,
  });
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

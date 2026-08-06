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
import {
  toE164,
  sendSms,
  resolveSmsCredentials,
  resolveSmsPublicKey,
  directIdentifier,
  isDirectIdentifier,
} from './sms';
import { resolveDisplayName } from './smsDirectory';
import { sendEmailWithAttachment, companySmtp } from './mail';
import { toGsm7, gsm7Cost, clampGsm7 } from '../shared/smsSegments';

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

/** Une alerte tient dans un segment. Toujours. */
const ALERT_MAX_CHARS = 160;
/** Ce qu'on garantit à l'aperçu, même face à une raison sociale à rallonge. */
const ALERT_MIN_PREVIEW = 40;

/**
 * Compose l'alerte SMS interne, cadrée à un seul segment.
 *
 * Telnyx facture au segment et cette alerte cite la réponse du prospect : sans
 * cadrage, un prospect bavard se paie trois ou quatre fois — et l'alerte est le
 * seul SMS que Gestia envoie de sa propre initiative, donc le seul coût que
 * l'entreprise ne décide pas.
 *
 * Deux leviers, dans cet ordre :
 *
 *  1. `toGsm7`. Le « — » du gabarit d'origine est hors alphabet GSM-7 : il
 *     basculait *chaque* alerte en UCS-2, où le segment tombe à 70 caractères.
 *     Le ramener à « - » (et déshabiller les accents que GSM-7 ignore, ç ê â…)
 *     rend les 160 — 2,4× plus d'aperçu pour le même prix.
 *  2. Troncature. Ce qui dépasse est coupé sur un mot entier. Une alerte dit
 *     « qui » et « quoi en gros » ; le texte intégral est dans Gestia, à un clic.
 *
 * Le courriel, lui, ne coûte rien : il garde la réponse entière et sa typographie.
 */
export function buildReplyAlertText(who: string, body: string): string {
  const prefix = 'Gestia - ';
  const suffix = ' a répondu :\n';
  const fixed = gsm7Cost(prefix) + gsm7Cost(toGsm7(suffix));

  const whoText = clampGsm7(
    toGsm7(who).replace(/\s+/g, ' ').trim(),
    ALERT_MAX_CHARS - fixed - ALERT_MIN_PREVIEW,
  );
  const header = `${prefix}${whoText}${toGsm7(suffix)}`;

  // Un retour à la ligne coûte autant qu'une lettre et n'apporte rien dans une
  // notification : la réponse est remise à plat.
  const preview = toGsm7(body).replace(/\s+/g, ' ').trim() || '(sans texte)';
  const budget = ALERT_MAX_CHARS - gsm7Cost(header);
  if (gsm7Cost(preview) <= budget) return header + preview;

  const cut = clampGsm7(preview, budget - 3);
  // Reculer jusqu'au mot précédent, sauf si ça ampute l'aperçu : mieux vaut un
  // mot tronqué que douze caractères perdus.
  const onWord = cut.replace(/\s+\S*$/, '');
  const kept = onWord.length > 0 && cut.length - onWord.length <= 12 ? onWord : cut;
  return `${header}${kept}...`;
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
          text: buildReplyAlertText(who, opts.body),
          credentials,
        });
      } catch (err) {
        console.error('[telnyx] réponse enregistrée mais notification SMS échouée', err);
      }
    }
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

  // Sur un fil autonome, une seule alerte tant qu'il n'est pas lu : une réponse
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

  const prospectName = await resolveDisplayName(entities, company.id, from, identifier);

  await notifyCompanyOfReply(company, {
    prospectNumber: from ?? fromKey,
    body,
    prospectName,
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

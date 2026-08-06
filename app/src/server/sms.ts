// Outgoing SMS through Telnyx, sent from each company's own Telnyx number.
// Uses the plain Messages API over fetch — the Telnyx SDK would be the only
// dependency added for a single POST.
//
// Credentials live on the Company row (Paramètres → Intégrations) and nowhere
// else. There are no TELNYX_* environment variables.

import { createPublicKey } from 'crypto';

const TELNYX_API_BASE = 'https://api.telnyx.com/v2';
const TELNYX_MESSAGES_URL = `${TELNYX_API_BASE}/messages`;

/** Webhook paths, shared with main.wasp so the settings UI can show real URLs. */
export const SMS_WEBHOOK_PATH = '/webhooks/telnyx/sms';
export const SMS_WEBHOOK_FAILOVER_PATH = '/webhooks/telnyx/sms-failover';

/** The subset of Company this module needs. */
export type SmsCompany = {
  telnyxPhoneNumber?: string | null;
  telnyxApiKey?: string | null;
};

export type SmsCredentials = { apiKey: string; from: string };

/**
 * Resolves the credentials to send with, from the company's own settings only.
 * There is deliberately no environment fallback: a misconfigured company must
 * fail loudly rather than silently borrow another number's credentials.
 */
export function resolveSmsCredentials(company: SmsCompany | null | undefined): SmsCredentials | null {
  const apiKey = (company?.telnyxApiKey || '').trim();
  const from = (company?.telnyxPhoneNumber || '').trim();
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

/** The Ed25519 key inbound webhook signatures are checked against. */
export function resolveSmsPublicKey(company: { telnyxPublicKey?: string | null } | null | undefined): string | null {
  const key = (company?.telnyxPublicKey || '').trim();
  return key || null;
}

/**
 * Telnyx hands out the webhook signing key as base64 of a raw 32-byte Ed25519
 * key. Checking that at save time turns a silent "replies never arrive" into an
 * immediate error on the form.
 */
export function isValidTelnyxPublicKey(raw: string): boolean {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return false;
  try {
    if (Buffer.from(trimmed, 'base64').length !== 32) return false;
    const x = trimmed.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' } as any);
    return true;
  } catch {
    return false;
  }
}

/**
 * Confirms an API key is accepted by Telnyx without sending anything. Listing
 * messaging profiles is a read-only call, so this costs nothing and never texts
 * a prospect. Returns 'unknown' when Telnyx is unreachable — a network blip must
 * not be reported to the user as a bad key.
 */
export async function verifyTelnyxApiKey(apiKey: string): Promise<'ok' | 'invalid' | 'unknown'> {
  let res: Response;
  try {
    res = await fetch(`${TELNYX_API_BASE}/messaging_profiles?page[size]=1`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return 'unknown';
  }
  if (res.ok) return 'ok';
  if (res.status === 401 || res.status === 403) return 'invalid';
  return 'unknown';
}

/**
 * Normalises a number to E.164, the only format Telnyx accepts.
 * Prospect numbers come from Google Maps as "(514) 574-2228" or "+1 514-574-2228",
 * so a 10-digit local number is assumed to be North American (+1).
 * Returns null when the input can't be a valid number.
 */
export function toE164(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (hadPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// ─── Conversations autonomes ─────────────────────────────────────────────────
//
// Une conversation avec un numéro qui n'appartient à aucun prospect réutilise
// LeadSmsLog plutôt qu'une seconde table : `identifier` y est déjà une chaîne
// opaque qui n'exige l'existence d'aucun Lead. Aucun risque de collision — un
// placeId Google est du base64url (`ChIJ…`) et un id de Lead est un uuid, ni
// l'un ni l'autre ne peut contenir ':'.

export const DIRECT_IDENTIFIER_PREFIX = 'tel:';

export function directIdentifier(phone: string): string {
  return `${DIRECT_IDENTIFIER_PREFIX}${phone}`;
}

export function isDirectIdentifier(identifier: string): boolean {
  return (identifier ?? '').startsWith(DIRECT_IDENTIFIER_PREFIX);
}

/**
 * Le numéro E.164 d'une conversation autonome, ou null si l'identifiant n'en est
 * pas une — ou porte quelque chose qui n'est pas un numéro joignable (code court,
 * expéditeur alphanumérique). `isDirectIdentifier` reste vrai dans ce dernier
 * cas : le fil existe et se lit, mais on ne peut pas y répondre.
 */
export function parseDirectIdentifier(identifier: string): string | null {
  if (!isDirectIdentifier(identifier)) return null;
  return toE164(identifier.slice(DIRECT_IDENTIFIER_PREFIX.length));
}

export async function sendSms(params: {
  to: string;
  text: string;
  credentials: SmsCredentials;
}): Promise<{ id: string | null }> {
  const { apiKey, from } = params.credentials;

  let res: Response;
  try {
    res = await fetch(TELNYX_MESSAGES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: params.to, text: params.text }),
    });
  } catch {
    throw new Error('Service SMS injoignable.');
  }

  const payload = await res.json().catch(() => null as any);
  if (!res.ok) {
    // Telnyx reports problems as { errors: [{ detail, title }] }.
    const detail = payload?.errors?.[0]?.detail || payload?.errors?.[0]?.title;
    throw new Error(detail ? `Telnyx : ${detail}` : `Échec de l'envoi du SMS (${res.status}).`);
  }
  return { id: payload?.data?.id ?? null };
}

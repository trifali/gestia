// Outgoing SMS through Telnyx, sent from the company's own Telnyx number.
// Uses the plain Messages API over fetch — the Telnyx SDK would be the only
// dependency added for a single POST.

const TELNYX_MESSAGES_URL = 'https://api.telnyx.com/v2/messages';

/** The Telnyx number every prospect SMS is sent from. */
export function getSmsFromNumber(): string {
  return (process.env.TELNYX_PHONE_NUMBER || '').trim();
}

export function isSmsConfigured(): boolean {
  return !!(process.env.TELNYX_API_KEY?.trim() && getSmsFromNumber());
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

export async function sendSms(params: { to: string; text: string }): Promise<{ id: string | null }> {
  const apiKey = process.env.TELNYX_API_KEY?.trim();
  const from = getSmsFromNumber();
  if (!apiKey) throw new Error('TELNYX_API_KEY manquant.');
  if (!from) throw new Error('TELNYX_PHONE_NUMBER manquant.');

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

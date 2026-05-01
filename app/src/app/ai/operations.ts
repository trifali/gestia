import { HttpError } from 'wasp/server';
import type { MagicCorrect } from 'wasp/server/operations';

// Cheapest reliable text model on Replicate for short text correction.
// See https://replicate.com/meta/meta-llama-3-8b-instruct
const REPLICATE_MODEL = 'meta/meta-llama-3-8b-instruct';
const REPLICATE_URL = `https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`;

const MAX_INPUT_CHARS = 5000;

const SYSTEM_PROMPT =
  "Tu es un correcteur de texte professionnel. Tu corriges uniquement les fautes (orthographe, grammaire, accents, ponctuation, espaces) sans changer le sens, le ton ni la langue. Tu réponds STRICTEMENT avec le texte corrigé, sans guillemets, sans préfixe, sans explication, sans liste à puces. Si le texte est déjà correct, renvoie-le tel quel.";

type MagicArgs = { text: string };
type MagicResult = { text: string };

export const magicCorrect: MagicCorrect<MagicArgs, MagicResult> = async ({ text }, context) => {
  if (!context.user) throw new HttpError(401);

  const input = (text ?? '').toString();
  const trimmed = input.trim();
  if (!trimmed) return { text: input };
  if (trimmed.length > MAX_INPUT_CHARS) {
    throw new HttpError(400, 'Texte trop long pour la correction.');
  }

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new HttpError(500, 'REPLICATE_API_TOKEN manquant.');

  const prompt = `Corrige ce texte sans le réécrire :\n\n${trimmed}`;

  let res: Response;
  try {
    res = await fetch(REPLICATE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=30',
      },
      body: JSON.stringify({
        input: {
          prompt,
          system_prompt: SYSTEM_PROMPT,
          max_tokens: 600,
          temperature: 0.1,
          top_p: 0.9,
        },
      }),
    });
  } catch (err) {
    throw new HttpError(502, 'Service de correction indisponible.');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HttpError(502, `Replicate ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    output?: string | string[];
    error?: string | null;
    status?: string;
  };

  if (json.error) throw new HttpError(502, json.error);
  if (json.status && json.status !== 'succeeded') {
    throw new HttpError(504, 'La correction a expiré, veuillez réessayer.');
  }

  const raw = Array.isArray(json.output) ? json.output.join('') : (json.output ?? '');
  const cleaned = cleanModelOutput(raw);

  return { text: cleaned || input };
};

function cleanModelOutput(raw: string): string {
  let out = raw.trim();
  // Strip wrapping quotes the model occasionally adds.
  out = out.replace(/^[«"'`]+/, '').replace(/[»"'`]+$/, '').trim();
  // Strip a leading "Texte corrigé :" style prefix.
  out = out.replace(/^(texte corrigé\s*[:\-–]\s*)/i, '').trim();
  return out;
}

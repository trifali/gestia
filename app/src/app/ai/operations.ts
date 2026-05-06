import { HttpError } from 'wasp/server';
import type { MagicCorrect, GenerateTemplateContent } from 'wasp/server/operations';
import {
  MAGIC_CORRECT_SYSTEM_PROMPT,
  TEMPLATE_TYPE_LABELS,
  buildCompanyContextBlock,
  buildTemplateSystemPrompt,
  buildTemplateUserPrompt,
} from './prompts';

// ─── magicCorrect ─────────────────────────────────────────────────────────────

const REPLICATE_CORRECT_MODEL = 'meta/meta-llama-3-8b-instruct';
const REPLICATE_CORRECT_URL = `https://api.replicate.com/v1/models/${REPLICATE_CORRECT_MODEL}/predictions`;

const MAX_INPUT_CHARS = 5000;

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
    res = await fetch(REPLICATE_CORRECT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=30',
      },
      body: JSON.stringify({
        input: {
          prompt,
          system_prompt: MAGIC_CORRECT_SYSTEM_PROMPT,
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

// ─── generateTemplateContent ──────────────────────────────────────────────────

const TEMPLATE_GEN_MODEL = 'meta/meta-llama-3-70b-instruct';
const TEMPLATE_GEN_URL = `https://api.replicate.com/v1/models/${TEMPLATE_GEN_MODEL}/predictions`;

type GenerateArgs = { description: string; type: string; currentContent?: string };
type GenerateResult = { markdown: string };

export const generateTemplateContent: GenerateTemplateContent<GenerateArgs, GenerateResult> = async (
  { description, type, currentContent },
  context,
) => {
  if (!context.user) throw new HttpError(401);
  const companyId: string = (context.user as any).companyId;
  if (!companyId) throw new HttpError(403, 'Aucune entreprise associée');

  const company = await (context.entities as any).Company.findUnique({ where: { id: companyId } });
  if (!company) throw new HttpError(404);

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new HttpError(500, 'REPLICATE_API_TOKEN manquant.');

  const companyCtx = buildCompanyContextBlock(company);
  const typeLabel = TEMPLATE_TYPE_LABELS[type] ?? 'Document professionnel';
  const isEditing = !!(currentContent?.trim());

  const systemPrompt = buildTemplateSystemPrompt(companyCtx, isEditing);
  const userPrompt = buildTemplateUserPrompt(description, typeLabel, isEditing, currentContent);

  let res: Response;
  try {
    res = await fetch(TEMPLATE_GEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=60',
      },
      body: JSON.stringify({
        input: { prompt: userPrompt, system_prompt: systemPrompt, max_tokens: 2000, temperature: 0.4, top_p: 0.9 },
      }),
    });
  } catch {
    throw new HttpError(502, 'Service IA indisponible.');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HttpError(502, `Replicate ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { output?: string | string[]; error?: string | null; status?: string };
  if (json.error) throw new HttpError(502, json.error);

  const raw = Array.isArray(json.output) ? json.output.join('') : (json.output ?? '');
  const markdown = raw.trim().replace(/^```(?:markdown)?\n?/, '').replace(/\n?```$/, '').trim();

  if (!markdown) throw new HttpError(502, "La génération n'a pas retourné de contenu.");
  return { markdown };
};

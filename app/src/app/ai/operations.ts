import { HttpError } from 'wasp/server';
import type { MagicCorrect, GenerateTemplateContent, GenerateDocumentDraft } from 'wasp/server/operations';
import {
  MAGIC_CORRECT_SYSTEM_PROMPT,
  TEMPLATE_TYPE_LABELS,
  buildCompanyContextBlock,
  buildTemplateSystemPrompt,
  buildTemplateUserPrompt,
  buildProspectEmailPrompts,
  buildProspectEmailTemplatePrompts,
  buildDocumentDraftPrompts,
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

// ─── generateProspectEmail ───────────────────────────────────────────────────

const PROSPECT_EMAIL_MODEL = 'meta/meta-llama-3-70b-instruct';
const PROSPECT_EMAIL_URL = `https://api.replicate.com/v1/models/${PROSPECT_EMAIL_MODEL}/predictions`;

type ProspectEmailArgs = {
  searchId: string;
  leadName: string;
  leadCategory?: string | null;
  leadAddress?: string | null;
  leadEmail?: string | null;
  currentSubject?: string | null;
  currentBody?: string | null;
};
type ProspectEmailResult = { subject: string; body: string };

export const generateProspectEmail = async (
  args: ProspectEmailArgs,
  context: any,
): Promise<ProspectEmailResult> => {
  if (!context.user) throw new HttpError(401);
  const companyId: string = (context.user as any).companyId;
  if (!companyId) throw new HttpError(403, 'Aucune entreprise associée');

  const [company, search, user] = await Promise.all([
    (context.entities as any).Company.findUnique({
      where: { id: companyId },
      select: { name: true, email: true, website: true, brandTagline: true, brandEmailSignature: true, brandDescription: true },
    }),
    (context.entities as any).LeadSearch.findUnique({
      where: { id: args.searchId },
      select: { title: true, purpose: true, companyId: true },
    }),
    Promise.resolve(context.user),
  ]);

  if (!company) throw new HttpError(404, 'Entreprise introuvable');
  if (!search || search.companyId !== companyId) throw new HttpError(404, 'Recherche introuvable');

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new HttpError(500, 'REPLICATE_API_TOKEN manquant.');

  const { system, user: userPrompt } = buildProspectEmailPrompts({
    companyName: company.name,
    companyTagline: company.brandTagline,
    companyDescription: (company as any).brandDescription,
    companyWebsite: company.website,
    companyEmail: company.email,
    brandEmailSignature: company.brandEmailSignature,
    senderName: (user as any).fullName || null,
    leadName: args.leadName,
    leadCategory: args.leadCategory,
    leadAddress: args.leadAddress,
    leadEmail: args.leadEmail,
    purpose: (search as any).purpose ?? null,
    searchTitle: search.title,
    currentSubject: args.currentSubject,
    currentBody: args.currentBody,
  });

  let res: Response;
  try {
    res = await fetch(PROSPECT_EMAIL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=60',
      },
      body: JSON.stringify({
        input: { prompt: userPrompt, system_prompt: system, max_tokens: 600, temperature: 0.5, top_p: 0.9 },
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

  // Drop any preamble lines before the first SUJET: or CORPS: marker
  // (the model sometimes starts with "Voici le courriel amélioré :" etc.)
  const lines = raw.split('\n');
  const firstMarkerIdx = lines.findIndex(l => /^(SUJET|CORPS)\s*:/i.test(l.trim()));
  const clean = firstMarkerIdx >= 0 ? lines.slice(firstMarkerIdx).join('\n') : raw;

  // Subject is hardcoded — not AI-generated
  const subject = `${args.leadName} - Prise de contact`;

  // Extract body: everything after "CORPS:" (with optional space/newline)
  const bodyMatch = clean.match(/CORPS\s*:\s*[\n\r]+([\s\S]+)/im);
  let rawBody: string;
  if (bodyMatch) {
    rawBody = bodyMatch[1].trim();
  } else {
    // Fallback: drop every "SUJET: ..." and "CORPS:" header line
    rawBody = clean
      .split('\n')
      .filter(line => !/^(SUJET|CORPS)\s*:/i.test(line.trim()))
      .join('\n')
      .trim();
  }
  // Strip any remaining "SUJET: ..." lines the model leaked into the body
  const body = rawBody.replace(/^SUJET\s*:.*(\n|$)/gim, '').trim();

  // Append the company signature verbatim after the AI body
  const sig = company.brandEmailSignature?.trim() ||
    [(user as any).fullName, company.name].filter(Boolean).join('\n');
  const bodyWithSig = sig ? `${body}\n\n${sig}` : body;

  if (!subject && !bodyWithSig) throw new HttpError(502, "La génération n'a pas retourné de contenu.");
  return { subject, body: bodyWithSig };
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

// ─── generateDocumentDraft ───────────────────────────────────────────────────

const DOC_DRAFT_MODEL = 'meta/meta-llama-3-70b-instruct';
const DOC_DRAFT_URL = `https://api.replicate.com/v1/models/${DOC_DRAFT_MODEL}/predictions`;

const MAX_DRAFT_INPUT_CHARS = 2000;
const MAX_DRAFT_TITLE_CHARS = 120;

type DocumentDraftArgs = {
  /** Free-form notes typed by the user in the magic popover. */
  input: string;
  type: 'quote' | 'invoice';
  clientId?: string | null;
  projectId?: string | null;
  /** Line item descriptions already entered in the form. */
  itemLabels?: string[];
  currentTitle?: string | null;
  currentDescription?: string | null;
};
type DocumentDraftResult = { title: string; description: string };

export const generateDocumentDraft: GenerateDocumentDraft<DocumentDraftArgs, DocumentDraftResult> = async (
  args,
  context,
) => {
  if (!context.user) throw new HttpError(401);
  const companyId: string = (context.user as any).companyId;
  if (!companyId) throw new HttpError(403, 'Aucune entreprise associée');

  const input = (args.input ?? '').toString().trim();
  if (!input) throw new HttpError(400, 'Décrivez le document en quelques mots.');
  if (input.length > MAX_DRAFT_INPUT_CHARS) {
    throw new HttpError(400, 'Texte trop long pour la génération.');
  }

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new HttpError(500, 'REPLICATE_API_TOKEN manquant.');

  // Names are resolved server-side and scoped to the company so the client
  // can't inject arbitrary context through the prompt.
  const [company, client, project] = await Promise.all([
    (context.entities as any).Company.findUnique({
      where: { id: companyId },
      select: { name: true, brandTagline: true, brandDescription: true },
    }),
    args.clientId
      ? (context.entities as any).Client.findFirst({
          where: { id: args.clientId, companyId },
          select: { name: true },
        })
      : Promise.resolve(null),
    args.projectId
      ? (context.entities as any).Project.findFirst({
          where: { id: args.projectId, companyId },
          select: { name: true },
        })
      : Promise.resolve(null),
  ]);

  if (!company) throw new HttpError(404, 'Entreprise introuvable');

  const { system, user: userPrompt } = buildDocumentDraftPrompts({
    docType: args.type === 'invoice' ? 'invoice' : 'quote',
    companyName: company.name,
    companyTagline: company.brandTagline,
    companyDescription: company.brandDescription,
    clientName: client?.name ?? null,
    projectName: project?.name ?? null,
    itemLabels: (args.itemLabels ?? [])
      .map((l) => (l ?? '').toString().trim())
      .filter(Boolean)
      .slice(0, 20),
    currentTitle: args.currentTitle,
    currentDescription: args.currentDescription,
    input,
  });

  let res: Response;
  try {
    res = await fetch(DOC_DRAFT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=45',
      },
      body: JSON.stringify({
        input: { prompt: userPrompt, system_prompt: system, max_tokens: 400, temperature: 0.4, top_p: 0.9 },
      }),
    });
  } catch {
    throw new HttpError(502, 'Service IA indisponible.');
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new HttpError(502, `Replicate ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const json = (await res.json()) as { output?: string | string[]; error?: string | null; status?: string };
  if (json.error) throw new HttpError(502, json.error);
  if (json.status && json.status !== 'succeeded') throw new HttpError(504, 'Génération expirée, réessayez.');

  const raw = Array.isArray(json.output) ? json.output.join('') : (json.output ?? '');

  // Drop any preamble before the first TITRE:/DESCRIPTION: marker.
  const lines = raw.split('\n');
  const firstMarker = lines.findIndex((l) => /^(TITRE|DESCRIPTION)\s*:/i.test(l.trim()));
  const text = (firstMarker >= 0 ? lines.slice(firstMarker).join('\n') : raw).trim();

  const titleMatch = text.match(/^TITRE\s*:\s*(.+)$/im);
  // Description runs to the end so multi-line output is preserved.
  const descMatch = text.match(/^DESCRIPTION\s*:\s*([\s\S]+)$/im);

  const title = cleanModelOutput(titleMatch?.[1] ?? '').slice(0, MAX_DRAFT_TITLE_CHARS);
  const description = cleanModelOutput(descMatch?.[1] ?? '')
    .replace(/^TITRE\s*:.*(\n|$)/gim, '')
    .trim();

  if (!title && !description) throw new HttpError(502, "La génération n'a pas retourné de contenu.");
  return { title, description };
};

// ─── generateProspectEmailTemplate ───────────────────────────────────────────

const EMAIL_TMPL_MODEL = 'meta/meta-llama-3-70b-instruct';
const EMAIL_TMPL_URL = `https://api.replicate.com/v1/models/${EMAIL_TMPL_MODEL}/predictions`;

type EmailTmplArgs = {
  searchId: string;
  currentSubject?: string | null;
  currentBody?: string | null;
};
type EmailTmplResult = { subject: string; body: string };

export const generateProspectEmailTemplate = async (
  args: EmailTmplArgs,
  context: any,
): Promise<EmailTmplResult> => {
  if (!context.user) throw new HttpError(401);
  const companyId: string = (context.user as any).companyId;
  if (!companyId) throw new HttpError(403, 'Aucune entreprise associée');

  const [company, search] = await Promise.all([
    (context.entities as any).Company.findUnique({
      where: { id: companyId },
      select: { name: true, email: true, website: true, brandTagline: true, brandDescription: true },
    }),
    (context.entities as any).LeadSearch.findUnique({
      where: { id: args.searchId },
      select: { title: true, purpose: true, companyId: true },
    }),
  ]);

  if (!company) throw new HttpError(404, 'Entreprise introuvable');
  if (!search || search.companyId !== companyId) throw new HttpError(404, 'Recherche introuvable');

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new HttpError(500, 'REPLICATE_API_TOKEN manquant.');

  const { system, user: userPrompt } = buildProspectEmailTemplatePrompts({
    companyName: company.name,
    companyTagline: company.brandTagline,
    companyDescription: (company as any).brandDescription,
    companyWebsite: company.website,
    companyEmail: company.email,
    senderName: (context.user as any).fullName || null,
    searchTitle: search.title,
    purpose: search.purpose,
    currentSubject: args.currentSubject,
    currentBody: args.currentBody,
  });

  let res: Response;
  try {
    res = await fetch(EMAIL_TMPL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=60',
      },
      body: JSON.stringify({
        input: { prompt: userPrompt, system_prompt: system, max_tokens: 600, temperature: 0.5, top_p: 0.9 },
      }),
    });
  } catch {
    throw new HttpError(502, 'Service IA indisponible.');
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new HttpError(502, `Replicate ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const json = (await res.json()) as { output?: string | string[]; error?: string | null; status?: string };
  if (json.error) throw new HttpError(502, json.error);
  if (json.status && json.status !== 'succeeded') throw new HttpError(504, 'Génération expirée, réessayez.');

  const raw = Array.isArray(json.output) ? json.output.join('') : (json.output ?? '');
  const text = raw.trim();

  // Parse OBJET: / CORPS:
  const objMatch = text.match(/^OBJET\s*:\s*(.+)$/im);
  const corpsMatch = text.match(/^CORPS\s*:\s*([\s\S]+)$/im);

  const subject = (objMatch?.[1] ?? '').trim();
  const body = (corpsMatch?.[1] ?? text).trim();

  if (!subject && !body) throw new HttpError(502, "La génération n'a pas retourné de contenu.");
  return { subject, body };
};

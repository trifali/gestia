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
  buildProspectSmsTemplatePrompts,
  buildDocumentDraftPrompts,
  buildFieldCleanupPrompts,
} from './prompts';
import { requireAdmin } from '../../server/tenant';
import {
  isValidPattern,
  MAX_PATTERN_CHARS,
  type Transform,
  type TransformOp,
} from '../../shared/leadIntakeTransforms';

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
  /** 'email' (default) or 'sms' — an SMS model is a single short body. */
  channel?: 'email' | 'sms';
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

  const isSms = args.channel === 'sms';
  const promptCtx = {
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
  };
  const { system, user: userPrompt } = isSms
    ? buildProspectSmsTemplatePrompts(promptCtx)
    : buildProspectEmailTemplatePrompts(promptCtx);

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

  // An SMS is one block of text: strip the markers the model may add out of
  // habit, plus the quotes it likes to wrap the message in.
  if (isSms) {
    const smsBody = text
      .replace(/^(OBJET|CORPS|SMS)\s*:.*(\n|$)/gim, '')
      .trim()
      .replace(/^["«»']+|["«»']+$/g, '')
      .trim();
    if (!smsBody) throw new HttpError(502, "La génération n'a pas retourné de contenu.");
    return { subject: '', body: smsBody };
  }

  // Parse OBJET: / CORPS:
  const objMatch = text.match(/^OBJET\s*:\s*(.+)$/im);
  const corpsMatch = text.match(/^CORPS\s*:\s*([\s\S]+)$/im);

  const subject = (objMatch?.[1] ?? '').trim();
  const body = (corpsMatch?.[1] ?? text).trim();

  if (!subject && !body) throw new HttpError(502, "La génération n'a pas retourné de contenu.");
  return { subject, body };
};

// ─── suggestFieldCleanup ─────────────────────────────────────────────────────
//
// « Enlève le p: devant le numéro » → une suite d'opérations de nettoyage,
// affichée dans l'écran de correspondance avec son effet sur l'échantillon, et
// enregistrée seulement si l'utilisateur la garde.
//
// Deux garde-fous encadrent la réponse du modèle, parce qu'elle finira par
// s'exécuter sur chaque appel entrant :
//
//   · Chaque ligne est relue par `parseTransformLine`, qui n'accepte que les
//     opérations connues et jette silencieusement le reste. Un modèle qui invente
//     `OP: uppercase_first` perd sa ligne, pas la réponse entière.
//   · Les motifs passent par `isValidPattern` — celui-là même que
//     `saveLeadIntakeMapping` applique. Un modèle ne peut donc pas faire entrer
//     une expression coûteuse par une porte que la validation d'écriture aurait
//     fermée.
//
// L'action ne touche à aucune entité : elle propose une règle, elle n'enregistre
// rien.

const CLEANUP_MODEL = 'meta/meta-llama-3-70b-instruct';
const CLEANUP_URL = `https://api.replicate.com/v1/models/${CLEANUP_MODEL}/predictions`;

/** Au-delà, ce n'est plus un nettoyage de champ mais un programme. */
const MAX_SUGGESTED_TRANSFORMS = 5;
const MAX_INSTRUCTION_CHARS = 400;

type FieldCleanupArgs = {
  fieldLabel: string;
  path: string;
  samples?: string[];
  instruction?: string;
  /** `regex` quand la demande vient de l'éditeur d'expression régulière. */
  prefer?: 'auto' | 'regex';
};
type FieldCleanupResult = { transforms: Transform[] };

/**
 * `nom=valeur ; autre=valeur` → `{ nom: 'valeur', autre: 'valeur' }`.
 *
 * Le point-virgule sépare, jamais la virgule : un `remove | chars=,.` ou un
 * `replace | replace=, ` sont des consignes parfaitement légitimes, et couper sur
 * la virgule les détruirait. Le premier `=` seulement fait paramètre — une valeur
 * peut en contenir (`replace | find==`).
 */
function parseParams(rest: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of rest.split(';')) {
    const part = chunk.trim();
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) {
      // Paramètre positionnel : `case | lower`, `keep | digits`, `replace | regex`.
      out[part.toLowerCase()] = '';
      continue;
    }
    out[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  return out;
}

/** Retire les guillemets et accolades dont le modèle habille volontiers ses valeurs. */
function unquote(value: string): string {
  return value.replace(/^["'`«»\s]+|["'`«»\s]+$/g, '');
}

/**
 * Une ligne `OP: …` → une opération, ou `null` si elle n'est pas reconnue.
 *
 * Tout ce qui n'est pas explicitement accepté est rejeté : le modèle propose, ce
 * module décide. C'est la même liste blanche que le schéma zod d'écriture, à
 * dessein — une suggestion qui passerait ici mais échouerait à l'enregistrement
 * ne serait qu'une déception différée.
 */
function parseTransformLine(line: string): Transform | null {
  const match = /^\s*OP\s*:\s*([a-z_]+)\s*(?:\|\s*(.*))?$/i.exec(line.trim());
  if (!match) return null;

  const op = match[1].toLowerCase() as TransformOp;
  const params = parseParams(match[2] ?? '');
  const has = (key: string) => key in params;
  const value = (key: string) => unquote(params[key] ?? '');

  switch (op) {
    case 'trim':
      return { op: 'trim' };

    case 'case': {
      const to = has('to') ? value('to') : ['lower', 'upper', 'title'].find(has);
      return to === 'lower' || to === 'upper' || to === 'title' ? { op: 'case', to } : null;
    }

    case 'strip': {
      const prefix = value('prefix');
      const suffix = value('suffix');
      if (!prefix && !suffix) return null;
      return { op: 'strip', ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) };
    }

    case 'remove': {
      const chars = value('chars');
      return chars ? { op: 'remove', chars: chars.slice(0, 60) } : null;
    }

    case 'keep': {
      const only = has('only') ? value('only') : ['digits', 'letters', 'alnum'].find(has);
      return only === 'digits' || only === 'letters' || only === 'alnum' ? { op: 'keep', only } : null;
    }

    case 'replace': {
      const find = value('find');
      if (!find || find.length > MAX_PATTERN_CHARS) return null;
      const isRegex = has('regex');
      if (isRegex && !isValidPattern(find)) return null;
      return {
        op: 'replace',
        find,
        replace: value('replace').slice(0, 200),
        ...(isRegex ? { regex: true } : {}),
      };
    }

    case 'extract': {
      const pattern = value('pattern') || value('find');
      if (!isValidPattern(pattern)) return null;
      const group = Number.parseInt(value('group'), 10);
      return {
        op: 'extract',
        pattern,
        ...(Number.isInteger(group) && group >= 0 && group <= 9 ? { group } : {}),
      };
    }

    case 'phone':
      return { op: 'phone' };

    case 'date': {
      const to = has('to') ? value('to') : ['day', 'daytime', 'iso'].find(has);
      return to === 'day' || to === 'daytime' || to === 'iso' ? { op: 'date', to } : null;
    }

    case 'truncate': {
      const max = Number.parseInt(value('max'), 10);
      return Number.isInteger(max) && max >= 1 && max <= 2000 ? { op: 'truncate', max } : null;
    }

    case 'fallback': {
      const fallback = value('value');
      return fallback ? { op: 'fallback', value: fallback.slice(0, 200) } : null;
    }

    default:
      return null;
  }
}

export const suggestFieldCleanup = async (
  args: FieldCleanupArgs,
  context: any,
): Promise<FieldCleanupResult> => {
  if (!context.user) throw new HttpError(401);
  // Régler une correspondance est réservé aux administrateurs (`requireIntake`) ;
  // en proposer le nettoyage ne doit pas être plus ouvert, sinon l'action devient
  // un accès au modèle pour n'importe quel membre.
  requireAdmin(context.user);

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new HttpError(500, 'REPLICATE_API_TOKEN manquant.');

  const { system, user: userPrompt } = buildFieldCleanupPrompts({
    fieldLabel: (args.fieldLabel ?? 'Champ').toString().slice(0, 80),
    path: (args.path ?? '').toString().slice(0, 200),
    samples: (args.samples ?? []).map(s => (s ?? '').toString()).filter(Boolean).slice(0, 3),
    instruction: (args.instruction ?? '').toString().slice(0, MAX_INSTRUCTION_CHARS),
    prefer: args.prefer === 'regex' ? 'regex' : 'auto',
  });

  // En mode expression régulière, la réponse tient sur une ligne. Le plafond
  // strict évite qu'un modèle bavard remplisse l'éditeur de motifs de trois
  // opérations dont on n'a pas voulu.
  const maxTransforms = args.prefer === 'regex' ? 1 : MAX_SUGGESTED_TRANSFORMS;

  let res: Response;
  try {
    res = await fetch(CLEANUP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=30',
      },
      body: JSON.stringify({
        // Température basse : on veut une règle reproductible, pas une variation
        // créative sur le thème de l'expression régulière.
        input: { prompt: userPrompt, system_prompt: system, max_tokens: 300, temperature: 0.1, top_p: 0.9 },
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

  const transforms: Transform[] = [];
  for (const line of raw.split('\n')) {
    const parsed = parseTransformLine(line);
    // En mode expression régulière, une opération dédiée (`keep | digits`) est une
    // esquive de la question posée : l'éditeur attend un motif, et le reste n'y a
    // pas de place pour s'afficher.
    if (parsed && (args.prefer !== 'regex' || parsed.op === 'replace' || parsed.op === 'extract')) {
      // Un modèle qui oublie le marqueur `regex` sur une ligne demandée en mode
      // expression donnerait un remplacement littéral : `\d+` chercherait alors
      // la chaîne « \d+ », qu'aucune valeur ne contient. On rétablit l'intention,
      // mais seulement si le motif compile — sinon la ligne est jetée comme les
      // autres, plutôt que promue en regex fautive.
      if (args.prefer === 'regex' && parsed.op === 'replace' && !parsed.regex) {
        if (!isValidPattern(parsed.find)) continue;
        transforms.push({ ...parsed, regex: true });
      } else {
        transforms.push(parsed);
      }
    }
    if (transforms.length >= maxTransforms) break;
  }

  if (!transforms.length) {
    // Distingué d'une panne : le modèle a répondu, mais rien d'exploitable. La
    // consigne est reformulable, ce que « service indisponible » ne suggère pas.
    throw new HttpError(
      422,
      args.prefer === 'regex'
        ? "L'assistant n'a pas produit d'expression exploitable. Précisez ce qu'il faut garder ou enlever."
        : "L'assistant n'a pas produit de nettoyage exploitable. Reformulez la consigne.",
    );
  }

  return { transforms };
};

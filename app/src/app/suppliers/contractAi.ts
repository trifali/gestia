import { HttpError } from 'wasp/server';
import { applyVars, buildSupplierContractVars, findUnresolvedVars, formatRate, supplierTypeLabel } from '../../shared/supplier';
import { formatDate } from '../../shared/format';
import { ensureCompany } from './serverUtils';

// Rédaction assistée d'une entente fournisseur.
//
// Pourquoi pas `generateTemplateContent` : son prompt est écrit pour les
// documents remis aux clients (l'entreprise y est le prestataire), il demande de
// remplacer les montants par des variables, et il réécrit tout le document à
// chaque modification — ce qui, sur un contrat de 3 000 jetons, finissait tronqué
// et perdait des clauses et des montants en route.
//
// Ici : un modèle plus capable, les faits de l'entente donnés tels quels, et en
// modification l'IA ne renvoie QUE les sections qu'elle touche. Le reste du texte
// n'est jamais retranscrit, donc jamais altéré. Rien n'est enregistré : la
// proposition revient à l'éditeur, qui la fait relire avant de l'appliquer.

const MODEL = 'anthropic/claude-sonnet-5';
const MODEL_URL = `https://api.replicate.com/v1/models/${MODEL}/predictions`;
const DELETE_MARKER = 'SUPPRIMER';
const MAX_WAIT_MS = 180_000;

// ─── Sections ────────────────────────────────────────────────────────────────

type Section = { heading: string; body: string };

/** Le texte avant le premier `## `, puis une entrée par section `## …`. */
export function splitSections(md: string): { preamble: string; sections: Section[] } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const preamble: string[] = [];
  const sections: Section[] = [];
  for (const line of lines) {
    if (/^## /.test(line)) sections.push({ heading: line.trim(), body: '' });
    else if (sections.length) sections[sections.length - 1].body += `${line}\n`;
    else preamble.push(line);
  }
  return { preamble: preamble.join('\n'), sections: sections.map((s) => ({ ...s, body: s.body.replace(/\n+$/, '') })) };
}

function joinSections(preamble: string, sections: Section[]): string {
  const parts = preamble.trim() ? [preamble.trim()] : [];
  for (const s of sections) parts.push(s.body.trim() ? `${s.heading}\n\n${s.body.trim()}` : s.heading);
  return `${parts.join('\n\n')}\n`;
}

/** « ## 5. Commission » et « ## 5 - Commission » désignent la même section. */
function headingKey(heading: string): { num: string | null; title: string } {
  const raw = heading.replace(/^##\s*/, '').trim();
  const m = /^(\d+(?:\.\d+)*)\s*[.)\-–—:]?\s*(.*)$/.exec(raw);
  const title = (m ? m[2] : raw)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return { num: m ? m[1] : null, title };
}

function findSection(sections: Section[], heading: string): number {
  const k = headingKey(heading);
  const byTitle = sections.findIndex((s) => headingKey(s.heading).title === k.title && k.title !== '');
  if (byTitle >= 0) return byTitle;
  if (k.num) return sections.findIndex((s) => headingKey(s.heading).num === k.num);
  return -1;
}

type MergeReport = { modified: string[]; added: string[]; removed: string[] };

/** Applique les sections renvoyées par l'IA : remplace, ajoute avant les signatures, ou supprime. */
export function mergeSections(current: string, proposal: string): { content: string; report: MergeReport } {
  const base = splitSections(current);
  const patch = splitSections(proposal);
  const sections = [...base.sections];
  const report: MergeReport = { modified: [], added: [], removed: [] };

  for (const p of patch.sections) {
    const idx = findSection(sections, p.heading);
    if (p.body.trim() === DELETE_MARKER) {
      if (idx >= 0) { report.removed.push(sections[idx].heading.replace(/^##\s*/, '')); sections.splice(idx, 1); }
      continue;
    }
    if (idx >= 0) {
      if (sections[idx].body.trim() !== p.body.trim() || sections[idx].heading !== p.heading) {
        report.modified.push(p.heading.replace(/^##\s*/, ''));
        sections[idx] = p;
      }
      continue;
    }
    // Une nouvelle clause se place avant le bloc des signatures, qui doit rester le dernier.
    const sig = sections.findIndex((s) => /signature/i.test(s.heading));
    sections.splice(sig >= 0 ? sig : sections.length, 0, p);
    report.added.push(p.heading.replace(/^##\s*/, ''));
  }
  return { content: joinSections(base.preamble, sections), report };
}

// ─── Vérification des faits ──────────────────────────────────────────────────

const MONTHS = 'janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre';

/** Montants, pourcentages, dates et durées : ce qu'une réécriture ne doit pas perdre en silence. */
function extractFacts(md: string): string[] {
  const norm = md.replace(/ | /g, ' ');
  const patterns = [
    /\d[\d ]*(?:,\d{2})? ?\$/g,
    /\d+(?:,\d+)? ?%/g,
    new RegExp(`\\d{1,2}(?:er)? (?:${MONTHS}) \\d{4}`, 'gi'),
    /\(\d+\) (?:jours?|mois|ans?)/g,
  ];
  return [...new Set(patterns.flatMap((re) => norm.match(re) ?? []).map((f) => f.trim()))];
}

function lostFacts(before: string, after: string): string[] {
  const kept = new Set(extractFacts(after));
  return extractFacts(before).filter((f) => !kept.has(f));
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

function factsBlock(supplier: any, company: any, contract: any): string {
  const addr = (p: any) => [p.address, p.city, p.province, p.postalCode].filter(Boolean).join(', ') || 'non précisée';
  return [
    `LE CLIENT (l'entreprise qui retient et paie les services) : ${company.name}`,
    `  Adresse : ${addr(company)}`,
    company.neq ? `  NEQ : ${company.neq}` : null,
    '',
    `LE PRESTATAIRE (${supplierTypeLabel(supplier.type).toLowerCase()}, travailleur autonome) : ${supplier.name}`,
    supplier.contactName ? `  Représenté par : ${supplier.contactName}` : null,
    `  Adresse : ${addr(supplier)}`,
    supplier.specialty ? `  Expertise / services : ${supplier.specialty}` : null,
    supplier.neq ? `  NEQ : ${supplier.neq}` : null,
    `  Inscrit aux taxes : ${supplier.taxNumberGst || supplier.taxNumberQst ? `oui (TPS ${supplier.taxNumberGst || '—'}, TVQ ${supplier.taxNumberQst || '—'})` : 'non indiqué'}`,
    '',
    'CONDITIONS CONVENUES',
    `  Début : ${contract.startDate ? formatDate(contract.startDate) : 'à la signature'}`,
    `  Fin : ${contract.endDate ? formatDate(contract.endDate) : 'non précisée'}`,
    `  Rémunération : ${formatRate(contract.rate, contract.rateType) || 'telle que décrite dans le document'}`,
    `  Délai de paiement des factures : ${supplier.paymentTermsDays != null ? `${supplier.paymentTermsDays} jours` : '30 jours'}`,
  ].filter((l) => l !== null).join('\n');
}

const SYSTEM_PROMPT = `Tu es juriste et rédacteur au Québec. Tu rédiges et révises des ententes de services entre une entreprise (le « Client ») et un fournisseur externe — consultant, travailleur autonome, sous-traitant ou apporteur d'affaires — (le « Prestataire »). Ce sont des contrats de service au sens des articles 2098 et suivants du Code civil du Québec.

RÔLES — ne jamais les inverser : l'entreprise est le Client, elle retient et paie. Le fournisseur est le Prestataire, il exécute et facture. Désigne-les « le Client » et « le Prestataire » dans tout le texte.
SIGNATURE — l'entente est émise par le Client et seul le Prestataire la signe. N'ajoute jamais de bloc de signature pour le Client.

FIDÉLITÉ AUX FAITS
- Reprends à l'identique les noms, montants, pourcentages, barèmes, dates et délais présents dans le document ou dans les conditions convenues. N'en modifie aucun sauf si l'instruction le demande explicitement.
- N'invente aucun chiffre, nom, date ou numéro. Si une information nécessaire manque, écris « ______ ».
- N'utilise jamais de variables entre accolades ({{…}}).

QUALITÉ DU FRANÇAIS
- Français du Québec, registre juridique clair et moderne ; phrases courtes ; une obligation par phrase autant que possible.
- Aucun anglicisme (« prendre place » → « avoir lieu », « en charge de » → « responsable de », « à date » → « à ce jour », « canceller » → « annuler », « charger » → « facturer »).
- Typographie : guillemets « », espace avant le deux-points, majuscule à « Client » et « Prestataire », montants comme « 1 500,00 $ », pourcentages comme « 10 % », nombres de jours en lettres suivis des chiffres : « trente (30) jours ».
- Formules précises plutôt que vagues : « dans les quinze (15) jours suivant », pas « rapidement ».

MISE EN FORME (Markdown limité, rendu en PDF)
- Sections : « ## N. Titre », numérotation continue. Sous-sections : « ### ». Listes : « - ». Gras : **…**.
- Pas de tableau, pas de bloc de code, pas de titre « # », pas de commentaire ni d'explication hors du document.`;

function editPrompt(facts: string, current: string, instruction: string): string {
  return `${facts}

DOCUMENT ACTUEL
<<<
${current.trim()}
>>>

INSTRUCTION
${instruction.trim()}

RÉPONSE ATTENDUE
- Renvoie UNIQUEMENT les sections que tu modifies ou ajoutes, chacune complète, en commençant par sa ligne de titre « ## » exacte. Pour une section existante, garde exactement le même titre.
- Une nouvelle section reçoit le numéro suivant ; ne renumérote pas les autres (les renvois « article N » doivent rester justes).
- Pour supprimer une section, renvoie sa ligne de titre suivie d'une ligne contenant seulement : ${DELETE_MARKER}
- Ne renvoie aucune section inchangée, aucun préambule, aucun commentaire.
- Si l'instruction concerne tout le document (ton, style, langue), renvoie chaque section qui change réellement.`;
}

function generatePrompt(facts: string, instruction: string): string {
  return `${facts}

INSTRUCTION
Rédige une entente de services complète entre le Client et le Prestataire. ${instruction.trim()}

Structure attendue : un paragraphe d'ouverture identifiant les parties, puis des sections numérotées couvrant l'objet, la description des services, la durée, le statut d'autonome du Prestataire (sans lien de subordination, art. 2099 C.c.Q.), la rémunération et la facturation, la confidentialité, la propriété intellectuelle si pertinente, la résiliation (art. 2125 et 2129 C.c.Q.), les dispositions générales et la loi applicable, et en dernier une section « ## Signature du Prestataire » avec des lignes Nom / Date / Signature pour le Prestataire seulement : l'entente est émise par le Client, qui ne la signe pas.
Renvoie le document complet, sans commentaire.`;
}

// ─── Appel du modèle ─────────────────────────────────────────────────────────

async function runModel(system: string, prompt: string): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new HttpError(500, 'REPLICATE_API_TOKEN manquant.');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  let res: Response;
  try {
    res = await fetch(MODEL_URL, {
      method: 'POST',
      headers: { ...headers, Prefer: 'wait=60' },
      body: JSON.stringify({ input: { prompt, system_prompt: system, max_tokens: 16000, effort: 'low' } }),
    });
  } catch {
    throw new HttpError(502, 'Service IA indisponible.');
  }
  if (!res.ok) throw new HttpError(502, `Replicate ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);

  // Une entente complète peut dépasser l'attente synchrone : on suit la prédiction.
  let pred = (await res.json()) as { status: string; output?: string[] | string | null; error?: string | null; urls?: { get?: string } };
  const started = Date.now();
  while (!['succeeded', 'failed', 'canceled'].includes(pred.status)) {
    if (Date.now() - started > MAX_WAIT_MS || !pred.urls?.get) throw new HttpError(504, "L'IA a mis trop de temps à répondre. Réessayez.");
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(pred.urls.get, { headers });
    if (!poll.ok) throw new HttpError(502, `Replicate ${poll.status}`);
    pred = await poll.json();
  }
  if (pred.status !== 'succeeded') throw new HttpError(502, pred.error || "La génération IA a échoué.");

  const raw = Array.isArray(pred.output) ? pred.output.join('') : pred.output ?? '';
  return raw.trim().replace(/^```(?:markdown|md)?\n?/, '').replace(/\n?```$/, '').trim();
}

// ─── Action ──────────────────────────────────────────────────────────────────

type DraftArgs = { contractId: string; instruction: string; currentContent: string };

export type DraftResult = {
  content: string;
  mode: 'generate' | 'edit';
  modified: string[];
  added: string[];
  removed: string[];
  /** Montants, dates, délais présents avant et absents de la proposition. */
  lostFacts: string[];
  /** Variables que l'IA aurait laissées et qu'aucune valeur ne remplit. */
  unresolved: string[];
};

export const draftSupplierContractWithAi = async ({ contractId, instruction, currentContent }: DraftArgs, context: any): Promise<DraftResult> => {
  const companyId = ensureCompany(context.user);
  if (!instruction?.trim()) throw new HttpError(400, 'Décrivez ce que vous voulez écrire ou modifier.');
  const contract = await context.entities.SupplierContract.findUnique({ where: { id: contractId }, include: { supplier: true } });
  if (!contract || contract.supplier.companyId !== companyId) throw new HttpError(404, 'Entente introuvable');
  if (contract.signedAt) throw new HttpError(400, 'Cette entente est signée : dupliquez-la pour la modifier.');
  const company = await context.entities.Company.findUnique({ where: { id: companyId } });
  if (!company) throw new HttpError(404);

  const supplier = contract.supplier;
  const vars = buildSupplierContractVars(supplier, company, contract);
  const facts = factsBlock(supplier, company, contract);
  const current = applyVars(currentContent ?? '', vars);
  const editing = splitSections(current).sections.length > 0;

  const output = await runModel(SYSTEM_PROMPT, editing ? editPrompt(facts, current, instruction) : generatePrompt(facts, instruction));
  if (!output) throw new HttpError(502, "L'IA n'a rien renvoyé. Reformulez la demande.");

  let content: string;
  let report: MergeReport;
  if (editing) {
    if (!splitSections(output).sections.length) {
      throw new HttpError(502, "L'IA n'a renvoyé aucune section exploitable. Précisez la section à modifier (ex. « l'article 5 »).");
    }
    ({ content, report } = mergeSections(current, output));
  } else {
    content = `${output}\n`;
    report = { modified: [], added: splitSections(output).sections.map((s) => s.heading.replace(/^##\s*/, '')), removed: [] };
  }
  content = applyVars(content, vars);

  return {
    content,
    mode: editing ? 'edit' : 'generate',
    ...report,
    lostFacts: editing ? lostFacts(current, content) : [],
    unresolved: findUnresolvedVars(content),
  };
};

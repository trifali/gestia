// ─── Prompt definitions for all AI operations ────────────────────────────────
// Each section is self-contained so it can be read and tuned independently.

// ─── magicCorrect ─────────────────────────────────────────────────────────────

export const MAGIC_CORRECT_SYSTEM_PROMPT =
  'Tu es un correcteur de texte professionnel. ' +
  'Tu corriges uniquement les fautes (orthographe, grammaire, accents, ponctuation, espaces) ' +
  'sans changer le sens, le ton ni la langue. ' +
  'Tu réponds STRICTEMENT avec le texte corrigé, sans guillemets, sans préfixe, sans explication, ' +
  'sans liste à puces. Si le texte est déjà correct, renvoie-le tel quel.';

// ─── generateTemplateContent — shared knowledge ───────────────────────────────

export const TEMPLATE_VARIABLES_DOC = `
Variables dynamiques disponibles (syntaxe : {{variable}}) :

Dates
- {{date}}          → Date du jour
- {{date_expiry}}   → Date d'expiration du document

Client
- {{client.name}}    → Nom complet du client
- {{client.company}} → Entreprise du client
- {{client.email}}   → Email du client
- {{client.phone}}   → Téléphone du client
- {{client.address}} → Adresse du client

Entreprise prestataire
- {{company.name}}    → Nom de l'entreprise
- {{company.email}}   → Email
- {{company.phone}}   → Téléphone
- {{company.address}} → Adresse
- {{company.neq}}     → NEQ / numéro d'enregistrement
- {{company.tps}}     → Numéro de TPS (fédéral)
- {{company.tvq}}     → Numéro de TVQ (provincial)
Paiement
- {{payment.link}} → Lien de paiement en ligne
`.trim();

export const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  contract:           'Contrat de prestation',
  cahier_des_charges: 'Cahier des charges',
  hebergement:        "Contrat d'hébergement",
  maintenance:        'Contrat de maintenance',
  autre:              'Document professionnel',
};

// ─── generateTemplateContent — prompt builders ────────────────────────────────

export type CompanyContext = {
  name: string | null;
  brandTagline?: string | null;
  modalityContractTerms?: string | null;
  modalityCancellationPolicy?: string | null;
  modalityPaymentTermsDays?: number | null;
  modalityDownpaymentPercent?: number | null;
  modalityLateFeePercent?: number | null;
  modalityWarrantyMonths?: number | null;
  modalityWarrantyDetails?: string | null;
};

/** Formats the company fields into a readable block for the system prompt. */
export function buildCompanyContextBlock(c: CompanyContext): string {
  return [
    `Nom de l'entreprise : ${c.name ?? 'N/A'}`,
    c.brandTagline               ? `Slogan : ${c.brandTagline}` : null,
    c.modalityContractTerms      ? `Conditions générales : ${c.modalityContractTerms}` : null,
    c.modalityCancellationPolicy ? `Politique d'annulation : ${c.modalityCancellationPolicy}` : null,
    c.modalityPaymentTermsDays   != null ? `Délai de paiement : ${c.modalityPaymentTermsDays} jours` : null,
    c.modalityDownpaymentPercent != null ? `Acompte requis : ${c.modalityDownpaymentPercent}%` : null,
    c.modalityLateFeePercent     != null ? `Pénalités de retard : ${c.modalityLateFeePercent}%` : null,
    c.modalityWarrantyMonths     != null ? `Garantie : ${c.modalityWarrantyMonths} mois` : null,
    c.modalityWarrantyDetails    ? `Détails garantie : ${c.modalityWarrantyDetails}` : null,
  ].filter(Boolean).join('\n');
}

/**
 * Builds the system prompt for template generation/editing.
 * @param companyCtx  Pre-formatted company context block (from buildCompanyContextBlock)
 * @param isEditing   True when an existing document is being modified
 */
export function buildTemplateSystemPrompt(companyCtx: string, isEditing: boolean): string {
  const rule7 = isEditing
    ? `7. Le document existant t'est fourni. Tu dois UNIQUEMENT appliquer la modification demandée ` +
      `en conservant le reste du document intact. Ne réécris pas les sections non concernées. ` +
      `Retourne le document COMPLET modifié.`
    : `7. Inclus toutes les clauses essentielles pour le type de document : objet, durée, prix, ` +
      `paiement, obligations des parties, responsabilités, résiliation, loi applicable.`;

  return [
    `Tu es un expert juridique et rédacteur de documents professionnels pour une entreprise de ` +
    `services numériques (web, logiciel, hébergement, maintenance).`,
    ``,
    `Tu génères et modifies des templates de documents en Markdown pur, en français, prêts à ` +
    `être remplis avec des variables dynamiques.`,
    ``,
    TEMPLATE_VARIABLES_DOC,
    ``,
    `Informations sur l'entreprise prestataire :`,
    companyCtx || 'Non renseignées',
    ``,
    `Règles STRICTES :`,
    `1. Réponds UNIQUEMENT avec le contenu Markdown final complet, sans bloc de code (pas de \`\`\`), sans commentaire, sans explication.`,
    `2. Utilise les variables {{...}} là où c'est pertinent (date, client, montants, taxes, etc.).`,
    `3. Structure le document avec des titres Markdown (# pour le titre principal, ## pour les sections, ### pour les sous-sections).`,
    `4. Adapte les clauses aux modalités de l'entreprise si elles sont renseignées.`,
    `5. Rédige de manière professionnelle, claire et juridiquement solide.`,
    `6. N'invente pas de montants ou de durées spécifiques — utilise les variables dynamiques.`,
    rule7,
  ].join('\n');
}

/**
 * Builds the user-turn prompt.
 * @param description   What the user typed in the AI popover
 * @param typeLabel     Human-readable template type (e.g. "Contrat de prestation")
 * @param isEditing     True when an existing document is being modified
 * @param currentContent  Current markdown content (only used when isEditing)
 */
export function buildTemplateUserPrompt(
  description: string,
  typeLabel: string,
  isEditing: boolean,
  currentContent?: string,
): string {
  if (isEditing && currentContent?.trim()) {
    return `Document existant :\n\n${currentContent.trim()}\n\n---\n\nInstruction : ${description.trim()}`;
  }
  return `Génère un template de type "${typeLabel}" avec la description suivante :\n\n${description.trim()}`;
}

// ─── generateProspectEmail ───────────────────────────────────────────────────

export type ProspectEmailContext = {
  companyName: string;
  companyTagline?: string | null;
  companyDescription?: string | null;
  companyWebsite?: string | null;
  companyEmail?: string | null;
  brandEmailSignature?: string | null;
  senderName?: string | null;
  leadName: string;
  leadCategory?: string | null;
  leadAddress?: string | null;
  leadEmail?: string | null;
  purpose?: string | null;
  searchTitle: string;
  currentSubject?: string | null;
  currentBody?: string | null;
};

export function buildProspectEmailPrompts(ctx: ProspectEmailContext): { system: string; user: string } {
  const isEnhancing = !!(ctx.currentSubject?.trim() || ctx.currentBody?.trim());

  const system =
    'Tu rédiges de vrais courriels de prospection en FRANÇAIS uniquement — courts, directs, humains. ' +
    'Chaque mot du sujet et du corps doit être en français. Jamais d\'anglais, même partiel. ' +
    'Ton honnête et professionnel : pas de blague, pas d\'humour, pas d\'autodérision. ' +
    'Ne complimente PAS le prospect sur son entreprise ou ses services. ' +
    'Ne dis PAS que tu es impressionné, frappé, convaincu ou quoi que ce soit de flatteur envers le prospect. ' +
    'PAS de superlatif, pas d\'exclamation. Rien qui sonne faux ou commercial. ' +
    'Longueur : 3 paragraphes courts (6-8 phrases au total). C\'est tout. ' +
    'Règle ABSOLUE 1 : le corps NE DOIT PAS contenir la ligne de sujet ni le mot "SUJET:". ' +
    'Règle ABSOLUE 2 : NE commence JAMAIS par "Voici le courriel" ou toute autre phrase d\'introduction. ' +
    'Règle ABSOLUE 3 : PAS de signature — le corps se termine à la dernière phrase du message. ' +
    `Règle ABSOLUE 4 : le corps commence TOUJOURS par une salutation personnalisée sur la première ligne. ` +
    `Si un prénom est identifiable (via l'adresse courriel ou le nom de l'entreprise), utilise "Bonjour [Prénom],". ` +
    `Sinon, utilise le nom de l'entreprise avec le bon accord : ` +
    `"Bonjour à l'équipe de [Nom]," pour les entreprises génériques, ` +
    `ou "Bonjour [Nom]," si le nom sonne comme une personne (ex: "Chez Mario" → "Bonjour Mario,"). ` +
    `Ne commence JAMAIS par juste "Bonjour," sans rien après. ` +
    `Règle ABSOLUE 5 : l'avant-dernière phrase du corps nomme clairement le service proposé et son bénéfice concret pour le prospect. ` +
    `La dernière phrase est une question simple adaptée à l'objectif, facile à répondre oui ou non, qui mentionne info@trifali.com. ` +
    `L'adresse courriel à utiliser est TOUJOURS info@trifali.com — ne la change pas. ` +
    'CORPS:\n<corps du courriel sans signature>\n' +
    'Ne mets aucun autre texte, explication, ligne SUJET ou balise.';

  const companyLine = [
    ctx.companyName,
    ctx.companyTagline ? `« ${ctx.companyTagline} »` : null,
    ctx.companyWebsite ? `(${ctx.companyWebsite})` : null,
  ].filter(Boolean).join(' — ');
  const companyDesc = ctx.companyDescription?.trim()
    ? ctx.companyDescription.trim()
    : null;
  const baseContext =
    `Mon entreprise : ${companyLine}\n` +
    (ctx.companyEmail ? `Courriel de contact : ${ctx.companyEmail}\n` : '') +
    `Expéditeur : ${ctx.senderName ?? ctx.companyName}\n` +
    `Prospect : ${ctx.leadName}` +
    (ctx.leadCategory ? ` (${ctx.leadCategory})` : '') +
    (ctx.leadAddress ? ` — ${ctx.leadAddress}` : '') +
    (ctx.leadEmail ? ` — courriel : ${ctx.leadEmail}` : '') + '\n' +
    `Contexte de la recherche (pourquoi on contacte ce prospect) : ${ctx.searchTitle}` +
    (ctx.purpose?.trim() ? `\nObjectif de cet email : ${ctx.purpose.trim()}` : '') + '\n\n' +
    `Si l'adresse courriel du prospect contient un prénom (ex: raphael@..., j.martin@...), ` +
    `utilise-le pour la salutation ("Bonjour Raphaël,"). ` +
    `Sinon, essaie de deviner un prénom à partir du nom de l'entreprise si c'est un nom de personne ` +
    `(ex: "Chez Mario" → "Bonjour Mario,"). ` +
    `Si aucun prénom n'est identifiable, utilise le nom de l'entreprise avec le bon accord : ` +
    `"Bonjour à l'équipe de [Nom entreprise]," ou simplement "Bonjour [Nom]," si le nom est court.`;

  let user: string;
  if (isEnhancing) {
    user =
      `Améliore ce courriel. Assure-toi qu'il mentionne brièvement ce que fait notre entreprise ` +
      `et pourquoi ça pourrait intéresser le prospect. Reste humain, supprime tout ce qui sonne "marketing".\n\n` +
      baseContext + '\n\n' +
      `Courriel actuel :\n` +
      (ctx.currentSubject ? `SUJET: ${ctx.currentSubject}\n` : '') +
      `CORPS:\n${ctx.currentBody ?? ''}\n\n` +
      (ctx.purpose?.trim() ? `Objectif prioritaire : ${ctx.purpose.trim()}\n\n` : '') +
      `Retourne le courriel amélioré en respectant le format CORPS.`;
  } else {
    user =
      `Écris un courriel de prospection en 3 paragraphes courts.\n\n` +
      baseContext + '\n\n' +
      `Structure :\n` +
      `1. Mentionne simplement que tu as trouvé le prospect en ligne (Google, recherche web) — une phrase courte, directe, sans humour ni autodérision.\n` +
      `2. Présente notre entreprise en 1-2 phrases en utilisant UNIQUEMENT les informations fournies dans le contexte (nom, description, slogan). ` +
      `Ne invente rien, ne généralise pas. Si aucune description n'est fournie, dis simplement ce que fait l'entreprise d'après son nom.\n` +
      `3. Une phrase directe et concrète sur ce qu'on propose, formulée en lien avec l'objectif de la prospection. ` +
      `Elle doit nommer clairement le service et son bénéfice pour le prospect (ex: si l'objectif est un site web, ` +
      `quelque chose comme "J'aimerais vous proposer un site web moderne qui reflète vraiment la qualité de votre travail et attire plus de clients."). ` +
      `Pas de vague, pas de mystère — sois direct sur ce que tu offres. ` +
      `Termine avec une invitation adaptée à l'objectif : une question simple à laquelle il est facile de répondre oui ou non, ` +
      `en mentionnant info@trifali.com (ex: "Ça vous intéresse ? Répondez-moi à info@trifali.com et je vous montre ce qu'on peut faire.").`;
  }

  return { system, user };
}

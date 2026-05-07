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

  const ctaEmail = ctx.companyEmail || 'info@trifali.com';

  const system =
    'Tu rédiges de vrais courriels de prospection courts en FRANÇAIS uniquement — sincères, directs, humains.\n' +
    'Pas de blague, pas d\'humour, pas de superlatif, pas d\'exclamation.\n\n' +
    'STRUCTURE OBLIGATOIRE — exactement 3 paragraphes (6-8 phrases au total) :\n\n' +
    'SALUTATION (ligne séparée avant le 1er paragraphe) :\n' +
    '  • Si un prénom est identifiable dans l\'adresse courriel du prospect\n' +
    '    (ex: claude@..., raphael@..., j.tremblay@...) → extrait-le et utilise "Bonjour [Prénom],"\n' +
    '  • Si le nom de l\'entreprise contient un prénom de personne\n' +
    '    (ex: "Mario Gagnon Plomberie" → Mario, "Chez Claude" → Claude, "Clinique Marie-Josée" → Marie-Josée) → "Bonjour [Prénom],"\n' +
    '  • Sinon → "Bonjour à l\'équipe de [Nom complet de l\'entreprise],"\n' +
    '  • JAMAIS "Bonjour," seul sans rien après.\n\n' +
    'PARAGRAPHE 1 (2 phrases) :\n' +
    '  • Phrase 1 : Mention courte que tu as trouvé le prospect en ligne (Google) + observation positive et sincère sur leur domaine ou leur travail (basée sur leur catégorie ou secteur).\n' +
    '    Exemple : "Je vous ai trouvé sur Google et j\'ai été intéressé par l\'importance que votre entreprise accorde à la qualité de ses réalisations."\n' +
    '  • Phrase 2 : Question rhétorique qui crée un besoin — suggère que leur présence en ligne (site web, visibilité) ne reflète peut-être pas encore leur vrai niveau.\n' +
    '    Exemple : "Je me demande si votre site web actuel reflète vraiment votre expertise et votre savoir-faire."\n\n' +
    'PARAGRAPHE 2 (2 phrases) :\n' +
    '  • Phrase 1 : "Nous sommes [nom de l\'entreprise], [ce que vous faites en une phrase courte]." — utilise UNIQUEMENT la description fournie, n\'invente rien.\n' +
    '    Exemple : "Nous sommes Trifali Concept inc, une équipe qui conçoit des sites web pour aider les entreprises à se démarquer en ligne."\n' +
    '  • Phrase 2 : Lien direct avec la situation du prospect — "Nous pouvons vous aider à [bénéfice spécifique et concret]."\n\n' +
    'PARAGRAPHE 3 (2 phrases) :\n' +
    '  • Phrase 1 : Question de vision — "Pouvez-vous vous imaginer [avoir X qui fait Y et Z] ?" Formule un résultat concret et attrayant.\n' +
    '    Exemple : "Pouvez-vous vous imaginer avoir un site web qui vous aide à attirer de nouveaux clients et à renforcer votre réputation ?"\n' +
    '  • Phrase 2 : CTA simple oui/non — "Répondez-moi simplement oui ou non à [CTA_EMAIL] et je vous envoie les détails."\n\n' +
    'RÈGLES ABSOLUES :\n' +
    '1. Réponds UNIQUEMENT avec le corps (salutation + 3 paragraphes). Rien d\'autre.\n' +
    '2. PAS de signature — le corps s\'arrête après la phrase CTA.\n' +
    '3. Aucun préfixe "CORPS:", "SUJET:", "Voici", ou commentaire méta.\n' +
    `4. L'adresse courriel CTA est TOUJOURS : ${ctaEmail} — ne la change jamais.`;

  const companyLine = [
    ctx.companyName,
    ctx.companyTagline ? `« ${ctx.companyTagline} »` : null,
    ctx.companyWebsite ? `(${ctx.companyWebsite})` : null,
  ].filter(Boolean).join(' — ');

  const baseContext =
    `Mon entreprise : ${companyLine}\n` +
    (ctx.companyDescription ? `Ce que fait notre entreprise : ${ctx.companyDescription}\n` : '') +
    `Courriel CTA : ${ctaEmail}\n` +
    `Expéditeur : ${ctx.senderName ?? ctx.companyName}\n` +
    `Prospect : ${ctx.leadName}` +
    (ctx.leadCategory ? ` (${ctx.leadCategory})` : '') +
    (ctx.leadAddress ? ` — ${ctx.leadAddress}` : '') +
    (ctx.leadEmail ? ` — courriel : ${ctx.leadEmail}` : '') + '\n' +
    `Contexte de prospection : ${ctx.searchTitle}` +
    (ctx.purpose?.trim() ? `\nObjectif : ${ctx.purpose.trim()}` : '');

  let user: string;
  if (isEnhancing) {
    user =
      `Améliore ce courriel en respectant STRICTEMENT la structure en 3 paragraphes définie dans le système.\n\n` +
      baseContext + '\n\n' +
      `Courriel actuel :\n` +
      (ctx.currentSubject ? `Objet : ${ctx.currentSubject}\n` : '') +
      `${ctx.currentBody ?? ''}\n\n` +
      `Assure-toi que :\n` +
      `- La salutation identifie correctement un prénom si possible\n` +
      `- Para 1 : trouvé en ligne + observation sur leur domaine + question rhétorique sur leur présence web\n` +
      `- Para 2 : "Nous sommes [entreprise]..." + bénéfice lié à leur situation\n` +
      `- Para 3 : question de vision + CTA oui/non avec ${ctaEmail}`;
  } else {
    user =
      `Écris un courriel de prospection en suivant EXACTEMENT la structure en 3 paragraphes définie dans le système.\n\n` +
      baseContext + '\n\n' +
      `Instructions :\n` +
      `- Salutation : analyse le courriel du prospect "${ctx.leadEmail ?? ''}" et le nom "${ctx.leadName}" pour décider si tu peux utiliser un prénom ou si tu dois utiliser "à l'équipe de [Nom]"\n` +
      `- Para 1 : adapte l'observation au secteur du prospect (${ctx.leadCategory ?? 'secteur non précisé'})\n` +
      `- Para 2 : utilise UNIQUEMENT la description fournie pour parler de l'entreprise\n` +
      `- Para 3 : formule une vision concrète liée à "${ctx.purpose?.trim() || ctx.searchTitle}", termine avec CTA vers ${ctaEmail}`;
  }

  return { system, user };
}

// ─── generateProspectEmailTemplate ───────────────────────────────────────────

/** Available variable tokens the model may use in the email template. */
const EMAIL_TEMPLATE_VARS_DOC = `
Variables disponibles (syntaxe {{variable}}) :
- {{lead.name}}     → Nom de l'entreprise prospect
- {{lead.email}}    → Courriel du prospect
- {{lead.phone}}    → Téléphone du prospect
- {{lead.website}}  → Site web du prospect
- {{lead.address}}  → Adresse du prospect
- {{lead.category}} → Catégorie / secteur du prospect
- {{company.name}}  → Nom de mon entreprise
- {{company.email}} → Courriel de mon entreprise
- {{sender.name}}   → Nom de l'expéditeur
`.trim();

export type ProspectEmailTemplateContext = {
  companyName: string;
  companyTagline?: string | null;
  companyDescription?: string | null;
  companyWebsite?: string | null;
  companyEmail?: string | null;
  senderName?: string | null;
  searchTitle: string;
  purpose?: string | null;
  currentSubject?: string | null;
  currentBody?: string | null;
};

export function buildProspectEmailTemplatePrompts(ctx: ProspectEmailTemplateContext): { system: string; user: string } {
  const isEditing = !!(ctx.currentSubject?.trim() || ctx.currentBody?.trim());

  const ctaEmail = ctx.companyEmail || '{{company.email}}';

  const companyLine = [
    ctx.companyName,
    ctx.companyTagline ? `« ${ctx.companyTagline} »` : null,
    ctx.companyWebsite ? `(${ctx.companyWebsite})` : null,
  ].filter(Boolean).join(' — ');

  const system =
    'Tu rédiges des MODÈLES de courriels de prospection en FRANÇAIS.\n' +
    'Un modèle utilise des variables dynamiques — les tokens {{...}} restent LITTÉRALEMENT dans le texte retourné, ils ne sont PAS remplacés.\n\n' +
    'STRUCTURE OBLIGATOIRE — exactement 3 paragraphes (6-8 phrases au total) :\n\n' +
    'SALUTATION (ligne séparée) :\n' +
    '  • Utilise "Bonjour à l\'équipe de {{lead.name}}," comme salutation par défaut dans le modèle.\n' +
    '    Note dans la salutation : quand ce modèle sera utilisé, si un prénom est connu, il pourra être substitué manuellement.\n\n' +
    'PARAGRAPHE 1 (2 phrases) :\n' +
    '  • Phrase 1 : Trouvé en ligne + observation positive sur le secteur de {{lead.category}} (ou {{lead.name}} si pas de catégorie).\n' +
    '  • Phrase 2 : Question rhétorique — leur site web / présence en ligne reflète-t-il vraiment leur expertise ?\n\n' +
    'PARAGRAPHE 2 (2 phrases) :\n' +
    '  • Phrase 1 : "Nous sommes {{company.name}}, [description de ce qu\'on fait]." — utilise la description fournie.\n' +
    '  • Phrase 2 : "Nous pouvons vous aider à [bénéfice concret lié à leur situation]."\n\n' +
    'PARAGRAPHE 3 (2 phrases) :\n' +
    '  • Phrase 1 : Question de vision — "Pouvez-vous vous imaginer [avoir X qui fait Y] ?"\n' +
    `  • Phrase 2 : CTA — "Répondez-moi simplement oui ou non à ${ctaEmail} et je vous envoie les détails."\n\n` +
    'RÈGLES ABSOLUES :\n' +
    '1. Réponds au format : OBJET: [sujet sur une ligne]\\n\\nCORPS:\\n[corps complet]\n' +
    '2. Les variables {{...}} restent TELLES QUELLES dans le texte — ne les remplace jamais par de vraies valeurs.\n' +
    '3. PAS de signature dans le corps.\n' +
    '4. Aucun commentaire méta, aucun texte hors du format OBJET/CORPS.\n\n' +
    EMAIL_TEMPLATE_VARS_DOC;

  const contextBlock =
    `Mon entreprise : ${companyLine}\n` +
    (ctx.companyEmail ? `Courriel de contact : ${ctx.companyEmail}\n` : '') +
    (ctx.companyDescription ? `Ce que fait notre entreprise : ${ctx.companyDescription}\n` : '') +
    `Expéditeur : ${ctx.senderName ?? ctx.companyName}\n` +
    `Contexte de la prospection : ${ctx.searchTitle}` +
    (ctx.purpose?.trim() ? `\nObjectif : ${ctx.purpose.trim()}` : '');

  let user: string;
  if (isEditing) {
    user =
      `Améliore ce modèle de courriel en respectant STRICTEMENT la structure définie dans le système. Garde les variables {{...}} existantes et utilises-en d'autres si pertinent.\n\n` +
      contextBlock + '\n\n' +
      `Modèle actuel :\nOBJET: ${ctx.currentSubject ?? ''}\nCORPS:\n${ctx.currentBody ?? ''}\n\n` +
      `Retourne le modèle amélioré au format OBJET: / CORPS:.`;
  } else {
    user =
      `Génère un modèle de courriel de prospection en suivant EXACTEMENT la structure définie dans le système.\n\n` +
      contextBlock + '\n\n' +
      `Instructions :\n` +
      `- Salutation : "Bonjour à l'équipe de {{lead.name}},"\n` +
      `- Para 1 : observation sur {{lead.category}} + question rhétorique sur leur présence en ligne\n` +
      `- Para 2 : intro "Nous sommes {{company.name}}..." + bénéfice lié à "${ctx.purpose?.trim() || ctx.searchTitle}"\n` +
      `- Para 3 : vision concrète + CTA vers ${ctaEmail}\n` +
      `Retourne le résultat au format OBJET: / CORPS:.`;
  }

  return { system, user };
}

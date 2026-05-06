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

// Opérations de l'assistant « Nouveau tableau » côté webhook : créer la source,
// révéler ou faire tourner le secret, capturer un échantillon, régler la
// correspondance, consulter le journal, rejouer un appel.
//
// Le secret n'est jamais dans la réponse d'une requête de routine : il a sa
// propre opération, `revealLeadIntakeSecret`. C'est la différence avec
// `telnyxApiKey` ou `smtpPassword`, qu'on ne renvoie jamais du tout — celui-ci
// est fait pour être recopié dans Zapier, mais pas pour traîner dans chaque
// réponse de l'écran de prospection.

import { HttpError, config } from 'wasp/server';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { requireAdmin } from '../../server/tenant';
import { resolveIntakeStatus } from './operations';
import { insertMappedLead, registerLeadSources } from '../../server/leadIntake/persist';
import {
  applyMapping,
  flattenPaths,
  isMappingConfigured,
  isUsableLead,
  LEAD_INTAKE_PATH,
  suggestMapping,
  type DetectedPath,
  type JsonValue,
  type LeadIntakeMapping,
} from '../../shared/leadIntake';
import {
  isSafeRegexSource,
  isValidPattern,
  MAX_PATTERN_CHARS,
  MAX_TRANSFORMS,
} from '../../shared/leadIntakeTransforms';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

/** Le tableau et son webhook, après vérification qu'ils sont bien à cette entreprise. */
async function requireIntake(context: any, searchId: string, opts: { admin?: boolean } = {}) {
  const companyId = ensureCompany(context.user);
  if (opts.admin) requireAdmin(context.user);
  const webhook = await context.entities.LeadInboundWebhook.findUnique({
    where: { searchId },
    include: { search: { select: { id: true, companyId: true, title: true } } },
  });
  if (!webhook || webhook.companyId !== companyId) {
    throw new HttpError(404, 'Cette source de prospects est introuvable.');
  }
  return { companyId, webhook };
}

function intakeUrl(publicId: string): string {
  return `${config.serverUrl}${LEAD_INTAKE_PATH}/${publicId}`;
}

/**
 * `pk_` + 12 hexadécimaux. Court assez pour être recopié à la main sans erreur,
 * long assez pour n'être pas devinable — et il ne protège rien tout seul : c'est
 * le secret qui authentifie.
 */
function generatePublicId(): string {
  return `pk_${randomBytes(6).toString('hex')}`;
}

function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

// ─── createLeadBoard ──────────────────────────────────────────────────────────

/**
 * Crée un tableau qui n'a pas besoin d'aller chercher ses prospects : webhook
 * (ils arrivent tout seuls) ou manuel (on les saisit à la main).
 *
 * La troisième façon de remplir un tableau, la recherche Google Maps, reste
 * `searchLeads` : elle bloque le temps du scrutage, là où ces deux-ci doivent
 * rendre la main immédiatement — pour un webhook, l'adresse doit exister avant
 * qu'on puisse déclencher l'appel de test qui sert à régler la correspondance.
 *
 * Un tableau manuel n'a délibérément aucun webhook : pas d'adresse, pas de
 * secret, rien à faire tourner. C'est un tableau vide dans lequel on ajoute des
 * cartes avec le « + » de la première colonne.
 */
export const createLeadBoard = async (
  args: { title: string; description?: string; kind?: 'webhook' | 'manual' },
  context: any,
): Promise<{ searchId: string; kind: 'webhook' | 'manual' }> => {
  const companyId = ensureCompany(context.user);

  const kind = args.kind === 'manual' ? 'manual' : 'webhook';
  // Un tableau manuel n'expose aucun point d'entrée : tout membre peut en créer.
  // Un webhook ouvre une adresse sur l'extérieur, donc administrateurs seulement.
  if (kind === 'webhook') requireAdmin(context.user);

  const title = args.title?.trim();
  if (!title) throw new HttpError(400, 'Le nom du tableau est requis.');

  const search = await context.entities.LeadSearch.create({
    data: {
      companyId,
      title,
      description: args.description?.trim() || null,
      kind,
      status: 'done',
      totalFound: 0,
      filters: { source: kind === 'webhook' ? 'inbound' : 'manual' },
    },
    select: { id: true },
  });

  if (kind === 'webhook') {
    await context.entities.LeadInboundWebhook.create({
      data: {
        companyId,
        searchId: search.id,
        publicId: generatePublicId(),
        secret: generateSecret(),
      },
    });
  }

  return { searchId: search.id, kind };
};

// ─── Lecture ──────────────────────────────────────────────────────────────────

export type LeadIntakeConfig = {
  searchId: string;
  boardTitle: string;
  publicId: string;
  url: string;
  mapping: LeadIntakeMapping | null;
  configured: boolean;
  isActive: boolean;
  receivedCount: number;
  lastReceivedAt: Date | null;
  errorCount: number;
  /** Alertes demandées pour cette source. */
  notifyByEmail: boolean;
  notifyBySms: boolean;
  /**
   * Où partiraient ces alertes, et si c'est possible.
   *
   * Renvoyé pour que l'écran puisse dire « à quelle adresse » plutôt qu'un
   * interrupteur nu, et griser ce qui ne mènerait nulle part : une alerte
   * activée qui ne prévient personne est pire qu'une alerte éteinte.
   */
  alertEmail: string | null;
  alertPhone: string | null;
  canAlertBySms: boolean;
};

export const getLeadIntakeConfig = async (
  { searchId }: { searchId: string },
  context: any,
): Promise<LeadIntakeConfig> => {
  const { webhook } = await requireIntake(context, searchId);

  // Les appels en échec des dernières 24 h : c'est ce qui justifie la pastille
  // d'alerte sur le bouton, et ce qu'on veut voir en ouvrant le panneau.
  const errorCount = await context.entities.LeadInboundEvent.count({
    where: {
      webhookId: webhook.id,
      status: { in: ['rejected', 'error'] },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
    },
  });

  const company = await context.entities.Company.findUnique({
    where: { id: webhook.companyId },
    select: { email: true, phone: true, telnyxPhoneNumber: true, telnyxApiKey: true },
  });

  const mapping = isMappingConfigured(webhook.mapping) ? (webhook.mapping as LeadIntakeMapping) : null;
  return {
    searchId,
    boardTitle: webhook.search.title,
    publicId: webhook.publicId,
    url: intakeUrl(webhook.publicId),
    mapping,
    configured: !!mapping,
    isActive: webhook.isActive,
    receivedCount: webhook.receivedCount,
    lastReceivedAt: webhook.lastReceivedAt,
    errorCount,
    notifyByEmail: webhook.notifyByEmail,
    notifyBySms: webhook.notifyBySms,
    alertEmail: company?.email?.trim() || null,
    alertPhone: company?.phone?.trim() || null,
    // Le SMS demande en plus un numéro et une clé Telnyx : c'est Gestia qui
    // l'émet, pas le serveur de courriel de l'entreprise.
    canAlertBySms: !!(company?.telnyxPhoneNumber && company?.telnyxApiKey && company?.phone?.trim()),
  };
};

/** Opération à part, réservée aux administrateurs : le secret ne voyage pas seul. */
export const revealLeadIntakeSecret = async (
  { searchId }: { searchId: string },
  context: any,
): Promise<{ secret: string }> => {
  const { webhook } = await requireIntake(context, searchId, { admin: true });
  return { secret: webhook.secret };
};

export type IntakeEvent = {
  id: string;
  createdAt: Date;
  status: string;
  errorMsg: string | null;
  dedupeKey: string | null;
  sourceIp: string | null;
  leadIds: string[];
  /**
   * Combien des prospects créés par cet appel existent encore.
   *
   * `leadIds` est une trace, pas un état : supprimer une carte du tableau ne la
   * retire pas de la liste. C'est ce compte, et non la longueur de `leadIds`, qui
   * dit si l'appel a encore quelque chose sur le tableau — donc s'il peut être
   * rejoué.
   */
  liveLeadCount: number;
  payload: JsonValue;
};

export const getLeadIntakeEvents = async (
  { searchId, limit }: { searchId: string; limit?: number },
  context: any,
): Promise<IntakeEvent[]> => {
  const { webhook } = await requireIntake(context, searchId);
  const events = await context.entities.LeadInboundEvent.findMany({
    where: { webhookId: webhook.id },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit ?? 50, 1), 200),
    select: {
      id: true,
      createdAt: true,
      status: true,
      errorMsg: true,
      dedupeKey: true,
      sourceIp: true,
      leadIds: true,
      payload: true,
    },
  });

  // Une seule requête pour toute la page, quelle que soit sa longueur : les
  // identifiants de tous les appels d'un coup, puis on répartit.
  const ids = [...new Set(events.flatMap((e: { leadIds: string[] }) => e.leadIds))];
  const alive = ids.length
    ? new Set(
        (await context.entities.Lead.findMany({
          where: { id: { in: ids }, searchId },
          select: { id: true },
        })).map((l: { id: string }) => l.id),
      )
    : new Set<string>();

  return events.map((e: Omit<IntakeEvent, 'liveLeadCount'>) => ({
    ...e,
    liveLeadCount: e.leadIds.filter(id => alive.has(id)).length,
  }));
};

export type IntakeSample = {
  eventId: string;
  receivedAt: Date;
  payload: JsonValue;
  paths: DetectedPath[];
  /** Correspondance proposée, seulement quand aucune n'est encore enregistrée. */
  suggested: LeadIntakeMapping | null;
} | null;

/**
 * Le dernier appel reçu, prêt à servir d'échantillon.
 *
 * C'est ce que scrute le panneau d'écoute de l'assistant : l'utilisateur
 * déclenche sa source, et la forme réelle de ce qu'elle envoie apparaît. Régler
 * une correspondance sur un vrai appel plutôt que sur une documentation, c'est
 * toute la différence entre « ça devrait marcher » et « ça marche ».
 *
 * Une seule requête Prisma, contrairement aux autres opérations d'ici qui
 * passent par `requireIntake` : c'est la seule qui soit interrogée en boucle, et
 * le pool de connexions est petit. Deux allers-retours par battement, ça se
 * remarque ; un seul, non. L'appartenance à l'entreprise est donc vérifiée à la
 * main juste en dessous, exactement comme le ferait `requireIntake`.
 */
export const getLatestIntakeSample = async (
  { searchId, eventId }: { searchId: string; eventId?: string },
  context: any,
): Promise<IntakeSample> => {
  const companyId = ensureCompany(context.user);

  const webhook = await context.entities.LeadInboundWebhook.findUnique({
    where: { searchId },
    select: {
      companyId: true,
      mapping: true,
      events: {
        where: eventId ? { id: eventId } : undefined,
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, createdAt: true, payload: true },
      },
    },
  });
  if (!webhook || webhook.companyId !== companyId) {
    throw new HttpError(404, 'Cette source de prospects est introuvable.');
  }

  const event = webhook.events[0];
  if (!event) return null;

  const paths = flattenPaths(event.payload);
  return {
    eventId: event.id,
    receivedAt: event.createdAt,
    payload: event.payload,
    paths,
    suggested: isMappingConfigured(webhook.mapping)
      ? null
      // Sans argument, `suggestMapping` déduit la provenance de l'appel lui-même.
      : suggestMapping(paths),
  };
};

// ─── Écriture ─────────────────────────────────────────────────────────────────

/**
 * Un motif d'expression régulière, refusé s'il ne compile pas ou si son coût peut
 * exploser.
 *
 * Le contrôle a lieu **à l'enregistrement**, pas à la réception : une regex
 * fautive doit donner un message dans l'écran de correspondance, là où
 * l'administrateur peut la corriger. La découvrir à la réception voudrait dire
 * l'apprendre par un prospect abîmé, ou par un point d'entrée qui rame.
 */
const patternSchema = z
  .string()
  .min(1, 'Indiquez une expression régulière.')
  .max(MAX_PATTERN_CHARS, `Expression régulière trop longue (${MAX_PATTERN_CHARS} caractères au plus).`)
  .refine(source => isSafeRegexSource(source), {
    message: 'Expression régulière trop coûteuse (quantificateur imbriqué).',
  })
  .refine(source => isValidPattern(source), { message: 'Expression régulière invalide.' });

/** Drapeaux acceptés — `y` est exclu, il rend le motif dépendant de `lastIndex`. */
const flagsSchema = z.string().max(5).regex(/^[gimsu]*$/, 'Drapeau non reconnu.').optional();

const transformSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('trim') }),
  z.object({ op: z.literal('case'), to: z.enum(['lower', 'upper', 'title']) }),
  z.object({
    op: z.literal('strip'),
    prefix: z.string().max(60).optional(),
    suffix: z.string().max(60).optional(),
  }),
  z.object({ op: z.literal('remove'), chars: z.string().max(60) }),
  z.object({ op: z.literal('keep'), only: z.enum(['digits', 'letters', 'alnum']) }),
  // `find` n'est un motif que si `regex` est vrai : un remplacement littéral peut
  // parfaitement contenir `(` ou `*` sans être une expression régulière fautive.
  z.object({
    op: z.literal('replace'),
    find: z
      .string()
      .min(1, 'Indiquez le texte à rechercher.')
      .max(MAX_PATTERN_CHARS, `Recherche trop longue (${MAX_PATTERN_CHARS} caractères au plus).`),
    replace: z.string().max(200).default(''),
    regex: z.boolean().optional(),
    flags: flagsSchema,
  }).refine(t => !t.regex || isValidPattern(t.find, t.flags), {
    message: 'Expression régulière invalide ou trop coûteuse.',
    path: ['find'],
  }),
  z.object({
    op: z.literal('extract'),
    pattern: patternSchema,
    flags: flagsSchema,
    group: z.number().int().min(0).max(9).optional(),
  }),
  z.object({ op: z.literal('phone') }),
  z.object({ op: z.literal('date'), to: z.enum(['day', 'daytime', 'iso']) }),
  z.object({ op: z.literal('truncate'), max: z.number().int().min(1).max(2000) }),
  z.object({ op: z.literal('fallback'), value: z.string().max(200) }),
]);

const transformsSchema = z.array(transformSchema).max(MAX_TRANSFORMS).optional();

const fieldRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), path: z.string().min(1).max(400), transforms: transformsSchema }),
  z.object({ kind: z.literal('template'), template: z.string().min(1).max(800), transforms: transformsSchema }),
  z.object({ kind: z.literal('const'), value: z.string().max(200), transforms: transformsSchema }),
  z.object({ kind: z.literal('none') }),
]);

const noteEntrySchema = z.object({
  path: z.string().min(1).max(400),
  label: z.string().max(80).optional(),
  transforms: transformsSchema,
});

const mappingSchema = z.object({
  version: z.literal(1),
  rootPath: z.string().max(400).nullable().optional(),
  dedupePath: z.string().max(400).nullable().optional(),
  fields: z.object({
    name: fieldRuleSchema,
    email: fieldRuleSchema,
    phone: fieldRuleSchema,
    website: fieldRuleSchema,
    address: fieldRuleSchema,
    category: fieldRuleSchema,
    source: fieldRuleSchema,
  }),
  notes: z.object({
    mode: z.enum(['unmapped', 'selected', 'none']),
    // Ancienne forme, encore acceptée en écriture : une correspondance
    // enregistrée avant `entries` est renvoyée telle quelle par
    // `getLeadIntakeConfig`, et la refuser au premier réenregistrement ferait
    // échouer une sauvegarde qui n'a rien changé.
    paths: z.array(z.string().max(400)).max(200).optional(),
    entries: z.array(noteEntrySchema).max(200).optional(),
  }),
});

export const saveLeadIntakeMapping = async (
  { searchId, mapping }: { searchId: string; mapping: unknown },
  context: any,
): Promise<{ saved: true }> => {
  const { webhook } = await requireIntake(context, searchId, { admin: true });
  const parsed = mappingSchema.safeParse(mapping);
  if (!parsed.success) {
    // L'emplacement autant que le motif : « Correspondance invalide : expression
    // régulière invalide » laisserait chercher laquelle parmi sept champs et une
    // liste de notes.
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? ` (${issue.path.join(' › ')})` : '';
    throw new HttpError(400, `Correspondance invalide${where} : ${issue?.message}`);
  }
  await context.entities.LeadInboundWebhook.update({
    where: { id: webhook.id },
    data: { mapping: parsed.data as any },
  });
  return { saved: true };
};

export const rotateLeadIntakeSecret = async (
  { searchId }: { searchId: string },
  context: any,
): Promise<{ secret: string }> => {
  const { webhook } = await requireIntake(context, searchId, { admin: true });
  const secret = generateSecret();
  // `publicId` n'est pas touché : c'est précisément l'intérêt de le séparer du
  // secret. L'adresse recopiée dans Zapier, dans un script Sheets et dans le HTML
  // d'un site reste valide ; seule la clé change.
  await context.entities.LeadInboundWebhook.update({
    where: { id: webhook.id },
    data: { secret, secretRotatedAt: new Date() },
  });
  return { secret };
};

/**
 * Les réglages de la source elle-même : sa mise en pause et ses alertes.
 *
 * Chaque champ est optionnel et n'est écrit que s'il est présent — l'écran bascule
 * un interrupteur à la fois, et une requête ne doit pas réinitialiser les autres
 * en passant.
 */
export const updateLeadIntakeWebhook = async (
  {
    searchId,
    isActive,
    notifyByEmail,
    notifyBySms,
  }: {
    searchId: string;
    isActive?: boolean;
    notifyByEmail?: boolean;
    notifyBySms?: boolean;
  },
  context: any,
): Promise<{ isActive: boolean; notifyByEmail: boolean; notifyBySms: boolean }> => {
  const { companyId, webhook } = await requireIntake(context, searchId, { admin: true });

  const data: Record<string, boolean> = {};
  if (isActive !== undefined) data.isActive = !!isActive;
  if (notifyByEmail !== undefined) data.notifyByEmail = !!notifyByEmail;
  if (notifyBySms !== undefined) data.notifyBySms = !!notifyBySms;

  // Refuser d'allumer un canal sans destination : sinon l'interrupteur affiche
  // « activé » alors que la tâche n'aura personne à prévenir, et l'utilisateur
  // n'apprendra son erreur qu'en constatant l'absence d'alerte.
  if (data.notifyByEmail || data.notifyBySms) {
    const company = await context.entities.Company.findUnique({
      where: { id: companyId },
      select: { email: true, phone: true, telnyxPhoneNumber: true, telnyxApiKey: true },
    });
    if (data.notifyByEmail && !company?.email?.trim()) {
      throw new HttpError(400, "Ajoutez d'abord un courriel d'entreprise dans Paramètres › Entreprise.");
    }
    if (data.notifyBySms) {
      if (!company?.phone?.trim()) {
        throw new HttpError(400, "Ajoutez d'abord un téléphone d'entreprise dans Paramètres › Entreprise.");
      }
      if (!company?.telnyxPhoneNumber || !company?.telnyxApiKey) {
        throw new HttpError(400, "Configurez d'abord l'envoi de SMS dans Paramètres › Intégrations.");
      }
    }
  }

  const updated = await context.entities.LeadInboundWebhook.update({
    where: { id: webhook.id },
    data,
    select: { isActive: true, notifyByEmail: true, notifyBySms: true },
  });
  return updated;
};

/**
 * Écrit un appel d'exemple, sans passer par le réseau.
 *
 * Permet d'explorer la correspondance avant même d'avoir configuré la vraie
 * source : on voit le tableau de correspondance et l'aperçu de carte tout de
 * suite, plutôt que d'attendre d'avoir monté un Zapier pour découvrir à quoi
 * ressemble l'écran.
 */
export const simulateLeadIntakeCall = async (
  { searchId }: { searchId: string },
  context: any,
): Promise<{ eventId: string }> => {
  const { companyId, webhook } = await requireIntake(context, searchId, { admin: true });
  const payload = {
    external_id: `exemple-${randomBytes(3).toString('hex')}`,
    full_name: 'Jean Tremblay',
    email: 'jean.tremblay@exemple.com',
    phone_number: '+15145551234',
    city: 'Laval',
    province: 'QC',
    budget: '5 000 $ – 10 000 $',
  };
  const event = await context.entities.LeadInboundEvent.create({
    data: {
      webhookId: webhook.id,
      companyId,
      dedupeKey: payload.external_id,
      status: 'captured',
      payload,
      sourceIp: 'simulation',
    },
    select: { id: true },
  });
  return { eventId: event.id };
};

/**
 * Rejoue un appel journalisé à travers la correspondance actuelle.
 *
 * Deux usages : créer le prospect de l'appel de test juste après avoir
 * enregistré la correspondance, et rattraper les appels arrivés pendant qu'elle
 * était absente ou fausse. Rien n'a été perdu entre-temps — le journal garde la
 * charge utile complète, c'est justement à ça qu'il sert.
 */
export const replayIntakeEvent = async (
  { searchId, eventId }: { searchId: string; eventId: string },
  context: any,
): Promise<{ created: number; warnings: string[] }> => {
  const { companyId, webhook } = await requireIntake(context, searchId, { admin: true });
  if (!isMappingConfigured(webhook.mapping)) {
    throw new HttpError(400, 'Réglez d\'abord la correspondance des champs.');
  }

  const event = await context.entities.LeadInboundEvent.findFirst({
    where: { id: eventId, webhookId: webhook.id },
    select: { id: true, payload: true, status: true, leadIds: true, dedupeKey: true },
  });
  if (!event) throw new HttpError(404, 'Appel introuvable.');
  if (event.status === 'ok' && event.leadIds.length > 0) {
    // Le garde-fou porte sur les fiches, pas sur la trace. `leadIds` conserve les
    // identifiants d'origine et la suppression d'une carte ne les efface pas :
    // s'en tenir au statut refusait de recréer un prospect qui n'existe plus, et
    // le journal n'offrait alors aucun moyen de revenir en arrière.
    const alive = await context.entities.Lead.count({
      where: { id: { in: event.leadIds }, searchId },
    });
    if (alive > 0) throw new HttpError(400, 'Cet appel a déjà créé un prospect.');
  }

  const { leads, warnings } = applyMapping(event.payload, webhook.mapping as LeadIntakeMapping);
  const usable = leads.filter(isUsableLead);
  if (usable.length === 0) {
    const reason = 'Aucun prospect exploitable avec la correspondance actuelle.';
    await context.entities.LeadInboundEvent.update({
      where: { id: event.id },
      data: { status: 'rejected', errorMsg: reason },
    });
    throw new HttpError(422, reason);
  }

  const status = await resolveIntakeStatus(context.entities, companyId, searchId);
  const { resolved: sourceMap } = await registerLeadSources(
    context.entities,
    companyId,
    usable,
  );
  const created: string[] = [];
  for (const lead of usable) {
    const row = await insertMappedLead(context.entities, {
      searchId,
      companyId,
      status,
      lead,
      fallbackExternalId: event.dedupeKey,
      sourceMap,
    });
    created.push(row.id);
  }

  await context.entities.LeadSearch.update({
    where: { id: searchId },
    data: { totalFound: { increment: created.length } },
  });
  await context.entities.LeadInboundWebhook.update({
    where: { id: webhook.id },
    data: { receivedCount: { increment: created.length }, lastReceivedAt: new Date() },
  });
  await context.entities.LeadInboundEvent.update({
    where: { id: event.id },
    data: { status: 'ok', leadIds: created, errorMsg: warnings.length ? warnings.join(' ') : null },
  });

  return { created: created.length, warnings };
};

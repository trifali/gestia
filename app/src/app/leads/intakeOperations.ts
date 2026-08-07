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
import { insertLeadOnTop, resolveIntakeStatus } from './operations';
import { normalizeLeadSource, type LeadSourceKey } from '../../shared/leadSources';
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
 * Crée un tableau alimenté par webhook, avec son adresse et son secret.
 *
 * Le pendant Google Maps de l'assistant reste `searchLeads` : cette action ne
 * couvre que la branche webhook, parce qu'elle a besoin de rendre la main
 * immédiatement (l'adresse doit exister pour qu'on puisse déclencher un appel de
 * test) là où une recherche Google bloque le temps du scrutage.
 */
export const createWebhookBoard = async (
  args: { title: string; description?: string; defaultSource?: string },
  context: any,
): Promise<{ searchId: string; publicId: string; url: string; secret: string }> => {
  const companyId = ensureCompany(context.user);
  requireAdmin(context.user);

  const title = args.title?.trim();
  if (!title) throw new HttpError(400, 'Le nom du tableau est requis.');

  const defaultSource: LeadSourceKey = normalizeLeadSource(args.defaultSource);
  const publicId = generatePublicId();
  const secret = generateSecret();

  const search = await context.entities.LeadSearch.create({
    data: {
      companyId,
      title,
      description: args.description?.trim() || null,
      kind: 'webhook',
      status: 'done',
      totalFound: 0,
      // `filters` reste le sac à dos du tableau : y consigner la provenance par
      // défaut évite une colonne de plus, et l'assistant s'en sert pour
      // pré-remplir la correspondance au premier échantillon.
      filters: { source: 'inbound', defaultSource },
    },
    select: { id: true },
  });

  await context.entities.LeadInboundWebhook.create({
    data: { companyId, searchId: search.id, publicId, secret },
  });

  return { searchId: search.id, publicId, url: intakeUrl(publicId), secret };
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
  defaultSource: LeadSourceKey;
  errorCount: number;
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
    defaultSource: normalizeLeadSource((webhook.search as any)?.filters?.defaultSource),
    errorCount,
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
  payload: JsonValue;
};

export const getLeadIntakeEvents = async (
  { searchId, limit }: { searchId: string; limit?: number },
  context: any,
): Promise<IntakeEvent[]> => {
  const { webhook } = await requireIntake(context, searchId);
  return context.entities.LeadInboundEvent.findMany({
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
 */
export const getLatestIntakeSample = async (
  { searchId, eventId }: { searchId: string; eventId?: string },
  context: any,
): Promise<IntakeSample> => {
  const { webhook } = await requireIntake(context, searchId);
  const event = eventId
    ? await context.entities.LeadInboundEvent.findFirst({
        where: { id: eventId, webhookId: webhook.id },
        select: { id: true, createdAt: true, payload: true },
      })
    : await context.entities.LeadInboundEvent.findFirst({
        where: { webhookId: webhook.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, payload: true },
      });
  if (!event) return null;

  const paths = flattenPaths(event.payload);
  return {
    eventId: event.id,
    receivedAt: event.createdAt,
    payload: event.payload,
    paths,
    suggested: isMappingConfigured(webhook.mapping)
      ? null
      : suggestMapping(paths, normalizeLeadSource((webhook.search as any)?.filters?.defaultSource)),
  };
};

// ─── Écriture ─────────────────────────────────────────────────────────────────

const fieldRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), path: z.string().min(1).max(400) }),
  z.object({ kind: z.literal('template'), template: z.string().min(1).max(800) }),
  z.object({ kind: z.literal('const'), value: z.string().max(200) }),
  z.object({ kind: z.literal('none') }),
]);

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
    paths: z.array(z.string().max(400)).max(200).optional(),
  }),
});

export const saveLeadIntakeMapping = async (
  { searchId, mapping }: { searchId: string; mapping: unknown },
  context: any,
): Promise<{ saved: true }> => {
  const { webhook } = await requireIntake(context, searchId, { admin: true });
  const parsed = mappingSchema.safeParse(mapping);
  if (!parsed.success) {
    throw new HttpError(400, 'Correspondance invalide : ' + parsed.error.issues[0]?.message);
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

export const updateLeadIntakeWebhook = async (
  { searchId, isActive }: { searchId: string; isActive: boolean },
  context: any,
): Promise<{ isActive: boolean }> => {
  const { webhook } = await requireIntake(context, searchId, { admin: true });
  const updated = await context.entities.LeadInboundWebhook.update({
    where: { id: webhook.id },
    data: { isActive: !!isActive },
    select: { isActive: true },
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
    throw new HttpError(400, 'Cet appel a déjà créé un prospect.');
  }

  const { leads, warnings } = applyMapping(event.payload, webhook.mapping as LeadIntakeMapping, {
    boardLabel: webhook.search.title,
    receivedAt: new Date(),
  });
  const usable = leads.filter(isUsableLead);
  if (usable.length === 0) {
    const reason = 'Aucun prospect exploitable avec la correspondance actuelle.';
    await context.entities.LeadInboundEvent.update({
      where: { id: event.id },
      data: { status: 'rejected', errorMsg: reason },
    });
    throw new HttpError(422, reason);
  }

  const status = await resolveIntakeStatus(context.entities, companyId);
  const created: string[] = [];
  for (const lead of usable) {
    const row = await insertLeadOnTop(context.entities, {
      searchId,
      status,
      data: {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        website: lead.website,
        address: lead.address,
        category: lead.category,
        notes: lead.notes,
        source: lead.source,
        externalId: lead.externalId ?? event.dedupeKey,
      },
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

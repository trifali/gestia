import { HttpError } from 'wasp/server';
import { UNKNOWN_STATUS_KEY } from '../../shared/leadStatus';
import {
  DEFAULT_LEAD_SOURCES,
  FALLBACK_SOURCE_KEY,
  MAX_SOURCES_PER_COMPANY,
  MAX_SOURCE_LABEL_CHARS,
  cleanSourceLabel,
  humanizeSourceKey,
  leadSourceLabel,
  normalizeLeadSource,
  slugifyLeadSource,
} from '../../shared/leadSources';
import { normalizeLeadExtras } from '../../shared/leadIntake';
import { findPlaces } from '../../server/googlePlaces';
import { archiveLeads, prospectHistory } from '../../server/prospectArchive';
import { getEmailCapability } from '../company/emailSettings';
import { getSmsCapability } from '../company/smsSettings';
import {
  criteriaProblem,
  criteriaTitle,
  normalizeCriteria,
  RADIUS_CHOICES,
} from '../../shared/googleSearch';
import {
  coerceSharePermissions,
  FULL_SHARE_PERMISSIONS,
  normalizeSharePermissions,
  type LeadSharePermissionKey,
  type LeadSharePermissions,
} from '../../shared/leadShare';
import { DEFAULT_CARD_FIELDS, hasDetailToggle, isLockedCardField } from '../../shared/leadCardFields';
import { randomBytes } from 'crypto';
import { sendEmailWithAttachment, companySmtp } from '../../server/mail';
import {
  QUOTED_HISTORY_LIMIT,
  buildEmailHtml,
  buildQuotedHistory,
  buildThreadHeaders,
} from '../../shared/mailThread';
import { sendSms, toE164, resolveSmsCredentials, isDirectIdentifier } from '../../server/sms';
import type {
  GetLeadSearches,
  GetLeadSearchDetail,
  SearchLeads,
  UpdateLead,
  // @ts-ignore -- generated on next Wasp restart
  UpdateLeadSearch,
  DeleteLeadSearch,
  ExportLeads,
  GetLeadStatusConfigs,
  CreateLeadStatusConfig,
  UpdateLeadStatusConfig,
  DeleteLeadStatusConfig,
} from 'wasp/server/operations';
import type { LeadSearch, Lead, LeadStatusConfig } from 'wasp/entities';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}


// ─── Types ────────────────────────────────────────────────────────────────────

type LeadSearchWithLeads = LeadSearch & { leads: (Lead & { duplicateSearchTitles?: string[] })[] };
type LeadSearchSummary = LeadSearch & { leads: { id: string }[] };

// ─── Queries ──────────────────────────────────────────────────────────────────

export const getLeadSearches: GetLeadSearches<void, LeadSearchSummary[]> = async (
  _args,
  context,
) => {
  const companyId = ensureCompany(context.user);
  return context.entities.LeadSearch.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    include: {
      leads: { select: { id: true } },
      // De quoi distinguer une carte de tableau webhook sans révéler ni son
      // adresse ni son secret : la liste n'en a pas besoin.
      inboundWebhook: { select: { isActive: true, lastReceivedAt: true, receivedCount: true } },
    },
  }) as any;
};

export const getLeadSearchDetail: GetLeadSearchDetail<
  { searchId: string },
  LeadSearchWithLeads
> = async ({ searchId }, context) => {
  const companyId = ensureCompany(context.user);
  const search = await context.entities.LeadSearch.findUnique({
    where: { id: searchId },
    include: {
      leads: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
      inboundWebhook: { select: { isActive: true, lastReceivedAt: true, receivedCount: true } },
    },
  });
  if (!search || search.companyId !== companyId) throw new HttpError(404);

  // Où chaque entreprise est déjà passée : autres tableaux et archive des
  // prospects supprimés (voir server/prospectArchive). Reconnue par Google, par
  // téléphone ou par courriel — pas seulement par Google comme auparavant.
  //
  // Un complément, pas le tableau : si l'historique ne peut pas être lu (table
  // absente avant sa migration, par exemple), le tableau s'affiche sans lui
  // plutôt que de ne pas s'afficher du tout. La suppression, elle, reste stricte :
  // sans archive, pas de suppression (voir `archiveBeforeDelete`).
  const labels = statusLabelCache(context.entities, companyId);
  let history = new Map<string, any[]>();
  try {
    history = await prospectHistory(context.entities, companyId, search.leads, labels.get);
  } catch (err) {
    console.error('[prospection] historique des prospects indisponible', err);
  }
  const leadsWithDups = search.leads.map(l => {
    const past = history.get(l.id) ?? [];
    return {
      ...l,
      history: past,
      duplicateSearchTitles: [...new Set(past.filter(h => h.kind === 'board').map(h => h.boardTitle))],
    };
  });

  const flags = await leadContactFlags(context.entities, companyId, search.leads);
  const leadsWithFlags = leadsWithDups.map(l => ({ ...l, ...flags.get(l.id) }));

  return { ...search, leads: leadsWithFlags } as any;
};

export type LeadContactFlags = {
  noteCount: number;
  hasNotes: boolean;
  hasEmailSent: boolean;
  hasEmailDraft: boolean;
  hasSmsSent: boolean;
  smsUnreadCount: number;
  hasSmsReply: boolean;
};

/**
 * Ce qui s'est passé avec chaque carte : notes, courriels (envoyés, brouillon),
 * SMS (envoyés, réponses, non lus). Le même calcul pour le tableau de
 * l'application et pour celui d'un lien de partage — qui en retire ensuite ce
 * que ses droits ne montrent pas.
 */
async function leadContactFlags(
  entities: any,
  companyId: string,
  leads: { id: string; placeId?: string | null }[],
): Promise<Map<string, LeadContactFlags>> {
  const identifiers = leads.map(l => l.placeId ?? l.id);
  const [noteCounts, emailedIdentifiers, draftIdentifiers, smsedIdentifiers, smsUnread, smsRepliedIdentifiers] = identifiers.length
    ? await Promise.all([
        entities.LeadNote.groupBy({
          by: ['identifier'],
          where: { companyId, identifier: { in: identifiers } },
          _count: { id: true },
        }),
        entities.LeadEmailLog.findMany({
          where: { companyId, identifier: { in: identifiers } },
          select: { identifier: true },
          distinct: ['identifier'],
        }),
        entities.LeadEmailDraft.findMany({
          where: { companyId, identifier: { in: identifiers } },
          select: { identifier: true },
        }),
        entities.LeadSmsLog.findMany({
          where: { companyId, identifier: { in: identifiers }, direction: 'outbound' },
          select: { identifier: true },
          distinct: ['identifier'],
        }),
        entities.LeadSmsLog.groupBy({
          by: ['identifier'],
          where: {
            companyId,
            identifier: { in: identifiers },
            direction: 'inbound',
            readAt: null,
          },
          _count: { id: true },
        }),
        // Any reply at all, read or not — the unread count above empties as soon
        // as a thread is opened, so it can't answer "who has answered us?".
        entities.LeadSmsLog.findMany({
          where: { companyId, identifier: { in: identifiers }, direction: 'inbound' },
          select: { identifier: true },
          distinct: ['identifier'],
        }),
      ])
    : [[], [], [], [], [], []];
  const noteCountMap = new Map<string, number>((noteCounts as any[]).map((n: any) => [n.identifier, n._count.id]));
  const emailSet = new Set<string>(emailedIdentifiers.map((e: any) => e.identifier));
  const draftSet = new Set<string>(draftIdentifiers.map((d: any) => d.identifier));
  const smsSet = new Set<string>((smsedIdentifiers as any[]).map((s: any) => s.identifier));
  const smsUnreadMap = new Map<string, number>(
    (smsUnread as any[]).map((s: any) => [s.identifier, s._count.id]),
  );
  const smsRepliedSet = new Set<string>((smsRepliedIdentifiers as any[]).map((s: any) => s.identifier));

  const out = new Map<string, LeadContactFlags>();
  for (const l of leads) {
    const id = l.placeId ?? l.id;
    out.set(l.id, {
      noteCount: noteCountMap.get(id) ?? 0,
      hasNotes: noteCountMap.has(id),
      hasEmailSent: emailSet.has(id),
      hasEmailDraft: draftSet.has(id),
      hasSmsSent: smsSet.has(id),
      smsUnreadCount: smsUnreadMap.get(id) ?? 0,
      hasSmsReply: smsRepliedSet.has(id),
    });
  }
  return out;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export const searchLeads: SearchLeads<
  { title: string; description?: string; purpose?: string; filters: Record<string, any> },
  LeadSearchWithLeads
> = async ({ title, description, purpose, filters }, context) => {
  const companyId = ensureCompany(context.user);
  const apiKey = requirePlacesKey();

  const criteria = normalizeCriteria(filters);
  const problem = criteriaProblem(criteria);
  if (problem) throw new HttpError(400, problem);

  const exclude = criteria.skipKnown
    ? await knownPlaces(context.entities, companyId, null)
    : undefined;
  const { places: rawLeads } = await findPlaces(criteria, { apiKey, exclude });

  // Carry over persistent prospect status for known placeIds
  const placeIds = rawLeads.map(l => l.placeId).filter(Boolean) as string[];
  const existingStatuses = placeIds.length
    ? await (context.entities as any).ProspectStatus.findMany({
        where: { companyId, placeId: { in: placeIds } },
        select: { placeId: true, status: true, notes: true },
      })
    : [];
  const statusMap = new Map<string, { placeId: string; status: string; notes: string | null }>(
    existingStatuses.map((s: any) => [s.placeId, s])
  );

  // Persist results
  const savedSearch = await context.entities.LeadSearch.create({
    data: {
      companyId,
      title: title?.trim() || criteriaTitle(criteria),
      description,
      purpose: purpose || null,
      filters: criteria as any,
      status: 'done',
      totalFound: rawLeads.length,
      leads: {
        create: rawLeads.map((l, i) => {
          const saved = l.placeId ? statusMap.get(l.placeId) : undefined;
          return {
            order: i,
            source: 'google_maps',
            name: l.name,
            address: l.address ?? null,
            phone: l.phone ?? null,
            website: l.website ?? null,
            email: l.email ?? null,
            rating: l.rating ?? null,
            reviewCount: l.reviewCount ?? null,
            category: l.category ?? null,
            placeId: l.placeId ?? null,
            mapsUrl: l.mapsUrl ?? null,
            latitude: l.latitude ?? null,
            longitude: l.longitude ?? null,
            isOpen: l.isOpen ?? null,
            status: saved?.status ?? 'nouveau',
            notes: saved?.notes ?? null,
          };
        }),
      },
    },
    include: { leads: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
  });

  return savedSearch as any;
};

export const updateLead: UpdateLead<
  {
    id: string;
    status?: string;
    notes?: string;
    email?: string;
    name?: string;
    phone?: string;
    website?: string;
    address?: string;
    category?: string;
    source?: string;
    /**
     * Les informations de la carte, réécrites en bloc.
     *
     * Câblées par une correspondance sur un tableau webhook, saisies à la main
     * partout ailleurs — et modifiables à la main dans les deux cas : ce qu'un
     * formulaire a envoyé n'est pas plus intouchable que le téléphone qu'il a
     * envoyé aussi. La liste entière et pas une ligne à la fois, parce que
     * l'ordre en fait partie et qu'il se règle en déplaçant les lignes.
     */
    extras?: { label?: string; value?: string }[];
  },
  Lead
> = async ({ id, status, notes, email, name, phone, website, address, category, source, extras }, context) => {
  const companyId = ensureCompany(context.user);
  const lead = await context.entities.Lead.findUnique({
    where: { id },
    include: { search: { select: { companyId: true } } },
  });
  if (!lead || (lead as any).search.companyId !== companyId) throw new HttpError(404);

  // La provenance vient d'un `<select>` alimenté par le registre : une clé hors
  // registre n'est pas une saisie à rattraper, c'est un appel forgé ou un bogue.
  const safeSource =
    source === undefined ? undefined : await requireKnownSource(context.entities, companyId, source);

  const updated = await context.entities.Lead.update({
    where: { id },
    data: {
      ...(status !== undefined && { status, statusUpdatedAt: new Date() }),
      ...(notes !== undefined && { notes }),
      ...(email !== undefined && { email }),
      ...(name !== undefined && { name }),
      ...(phone !== undefined && { phone }),
      ...(website !== undefined && { website }),
      ...(address !== undefined && { address }),
      ...(category !== undefined && { category }),
      ...(safeSource !== undefined && { source: safeSource }),
      // `normalizeLeadExtras` est le même passage que celui qu'applique le
      // webhook : une carte saisie à la main et une carte reçue portent donc des
      // informations de la même forme, avec les mêmes plafonds.
      ...(extras !== undefined && { extras: normalizeLeadExtras(extras) }),
    },
  });

  // Persist status/notes to ProspectStatus so they survive search deletion
  if ((status !== undefined || notes !== undefined) && lead.placeId) {
    const currentStatus = status ?? lead.status;
    const currentNotes = notes !== undefined ? notes : lead.notes;
    await (context.entities as any).ProspectStatus.upsert({
      where: { companyId_placeId: { companyId, placeId: lead.placeId } },
      create: { companyId, placeId: lead.placeId, status: currentStatus, notes: currentNotes ?? null },
      update: {
        ...(status !== undefined && { status }),
        ...(notes !== undefined && { notes }),
      },
    });
  }

  return updated;
};

// ─── Manual card order inside a kanban column ────────────────────────────────

// Rewrites the `order` of one column. `orderedIds` is that column exactly as the
// client displays it. Leads of the column that are missing from the list (hidden
// by a search filter) keep the slots they already occupy, so reordering a
// filtered board never shuffles the cards the user cannot see.
async function applyLeadOrder(
  entities: any,
  searchId: string,
  status: string,
  orderedIds: string[],
): Promise<void> {
  const column: { id: string; order: number }[] = await entities.Lead.findMany({
    where: { searchId, status },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, order: true },
  });

  const present = new Set(column.map(c => c.id));
  const moved = orderedIds.filter(id => present.has(id));
  const slots = column.map((c, i) => (moved.includes(c.id) ? i : -1)).filter(i => i >= 0);

  const final = column.map(c => c.id);
  slots.forEach((slot, i) => {
    final[slot] = moved[i];
  });

  const currentOrder = new Map(column.map(c => [c.id, c.order]));
  await Promise.all(
    final
      .map((id, i) => (currentOrder.get(id) === i ? null : { id, order: i }))
      .filter((u): u is { id: string; order: number } => u !== null)
      .map(u => entities.Lead.update({ where: { id: u.id }, data: { order: u.order } })),
  );
}

export const reorderLeads = async (
  { searchId, status, orderedIds }: { searchId: string; status: string; orderedIds: string[] },
  context: any,
): Promise<{ ok: true }> => {
  const companyId = ensureCompany(context.user);
  const search = await context.entities.LeadSearch.findUnique({ where: { id: searchId } });
  if (!search || search.companyId !== companyId) throw new HttpError(404);
  await applyLeadOrder(context.entities, searchId, status, orderedIds);
  return { ok: true };
};

export const deleteLeadSearch: DeleteLeadSearch<{ id: string }, { id: string }> = async (
  { id },
  context,
) => {
  const companyId = ensureCompany(context.user);
  const search = await context.entities.LeadSearch.findUnique({ where: { id } });
  if (!search || search.companyId !== companyId) throw new HttpError(404);
  // Le tableau emporte ses cartes en cascade : elles passent d'abord à l'archive.
  await archiveBeforeDelete(context.entities, companyId, { searchId: id }, 'board_deleted');
  await context.entities.LeadSearch.delete({ where: { id } });
  return { id };
};

export const updateLeadSearch = async (
  { id, title, purpose }: { id: string; title: string; purpose?: string | null },
  context: any,
): Promise<{ id: string }> => {
  const companyId = ensureCompany(context.user);
  const search = await context.entities.LeadSearch.findUnique({ where: { id } });
  if (!search || search.companyId !== companyId) throw new HttpError(404);
  await context.entities.LeadSearch.update({
    where: { id },
    data: { title: title.trim(), purpose: purpose?.trim() || null },
  });
  return { id };
};

// Returns serialised CSV string for the client to download
export const exportLeads: ExportLeads<{ searchId: string }, { csv: string }> = async (
  { searchId },
  context,
) => leadsCsv(context.entities, ensureCompany(context.user), searchId, { withNotes: true });

/**
 * Le CSV d'un tableau. `withNotes: false` vide la colonne « Notes » : un lien qui
 * ne peut pas lire les notes ne doit pas les retrouver dans l'export.
 */
async function leadsCsv(
  entities: any,
  companyId: string,
  searchId: string,
  { withNotes }: { withNotes: boolean },
): Promise<{ csv: string }> {
  const context = { entities };
  const search = await context.entities.LeadSearch.findUnique({
    where: { id: searchId },
    include: {
      leads: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
      inboundWebhook: { select: { isActive: true, lastReceivedAt: true, receivedCount: true } },
    },
  });
  if (!search || search.companyId !== companyId) throw new HttpError(404);

  // Les étiquettes plutôt que les clés : un tableur ouvert par un humain doit
  // afficher « Salon Habitation 2026 », pas `salon_habitation_2026`.
  const sourceConfigs = await effectiveSourceConfigs(context.entities, companyId);

  const headers = ['Nom', 'Catégorie', 'Adresse', 'Téléphone', 'Courriel', 'Site web', 'Note', 'Avis', 'Statut', 'Provenance', 'Notes', 'Google Maps'];
  const rows = (search.leads as Lead[]).map(l => [
    l.name,
    l.category ?? '',
    l.address ?? '',
    l.phone ?? '',
    l.email ?? '',
    l.website ?? '',
    l.rating?.toString() ?? '',
    l.reviewCount?.toString() ?? '',
    l.status,
    (l as any).source ? leadSourceLabel((l as any).source, sourceConfigs) : '',
    withNotes ? l.notes ?? '' : '',
    l.mapsUrl ?? '',
  ]);

  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');
  return { csv };
}

// ─── Default statuses ─────────────────────────────────────────────────────────

export { UNKNOWN_STATUS_KEY } from '../../shared/leadStatus';

const DEFAULT_STATUSES = [
  { key: 'nouveau',  label: 'Nouveau',  color: '#3b82f6', order: 0 },
  { key: 'contacte', label: 'Contacté', color: '#f59e0b', order: 1 },
  { key: 'qualifie', label: 'Qualifié',  color: '#10b981', order: 2 },
  { key: 'rejete',   label: 'Rejeté',   color: '#ef4444', order: 3 },
];

// Virtual entry always appended to the list (not stored in DB)
const VIRTUAL_UNKNOWN: any = {
  id: '__unknown__',
  createdAt: new Date(0),
  companyId: '',
  key: UNKNOWN_STATUS_KEY,
  label: 'Statut inconnu',
  color: '#9ca3af',
  order: 9999,
};

/**
 * Les statuts qui font foi pour un tableau donné.
 *
 * Règle unique, d'où tout le reste découle : **un tableau qui possède ses propres
 * statuts n'hérite plus de ceux de l'entreprise, pas même partiellement.** Un
 * héritage partiel obligerait à fusionner deux jeux de colonnes ordonnées, et
 * renommer un statut d'entreprise donnerait des résultats imprévisibles selon les
 * tableaux. Tout ou rien se raisonne, se lit à l'écran, et se défait.
 *
 * Sans `searchId`, ou pour un tableau sans surcharge, ce sont les statuts de
 * l'entreprise — semés au premier accès s'ils n'existent pas encore.
 */
export async function effectiveStatusConfigs(
  entities: any,
  companyId: string,
  searchId?: string | null,
): Promise<any[]> {
  if (searchId) {
    const own = await entities.LeadStatusConfig.findMany({
      where: { companyId, searchId },
      orderBy: { order: 'asc' },
    });
    if (own.length > 0) return own;
  }

  const shared = await entities.LeadStatusConfig.findMany({
    where: { companyId, searchId: null },
    orderBy: { order: 'asc' },
  });
  if (shared.length > 0) return shared;

  // Premier accès de l'entreprise : on sème le jeu par défaut.
  return Promise.all(
    DEFAULT_STATUSES.map(status =>
      entities.LeadStatusConfig.create({ data: { companyId, searchId: null, ...status } }),
    ),
  );
}

/**
 * La colonne où doit atterrir un prospect arrivé sans que personne ne choisisse.
 *
 * La première colonne *du tableau concerné*, pas « nouveau » en dur : une
 * entreprise qui a renommé ou réordonné ses statuts — ou un tableau qui a les
 * siens — attend que ses arrivées tombent dans sa propre première colonne. Repli
 * sur `nouveau` seulement si rien n'a encore été semé, et jamais sur `unknown`,
 * qui est une colonne de rattrapage et non une destination.
 */
export async function resolveIntakeStatus(
  entities: any,
  companyId: string,
  searchId?: string | null,
): Promise<string> {
  const configs = await effectiveStatusConfigs(entities, companyId, searchId);
  return configs.find(c => c.key !== UNKNOWN_STATUS_KEY)?.key ?? 'nouveau';
}

// ─── Champs de carte ──────────────────────────────────────────────────────────

/**
 * Les champs qui s'appliquent réellement à un tableau.
 *
 * Jumelle exacte d'`effectiveStatusConfigs`, y compris le semis au premier accès :
 * les siens s'il en a, ceux de l'entreprise sinon, et le jeu par défaut si
 * l'entreprise n'a encore rien réglé. Le semis vit ici et pas dans une migration
 * parce qu'une entreprise créée demain doit obtenir le même jeu qu'une entreprise
 * migrée aujourd'hui — une migration ne couvre que les lignes déjà en base.
 */
export async function effectiveCardFieldConfigs(
  entities: any,
  companyId: string,
  searchId?: string | null,
): Promise<any[]> {
  if (searchId) {
    const own = await entities.LeadCardFieldConfig.findMany({
      where: { companyId, searchId },
      orderBy: { order: 'asc' },
    });
    if (own.length > 0) return own;
  }

  const shared = await entities.LeadCardFieldConfig.findMany({
    where: { companyId, searchId: null },
    orderBy: { order: 'asc' },
  });
  if (shared.length > 0) return shared;

  return Promise.all(
    DEFAULT_CARD_FIELDS.map((field, order) =>
      entities.LeadCardFieldConfig.create({
        data: { companyId, searchId: null, ...field, order },
      }),
    ),
  );
}

/**
 * Les champs de carte, à deux portées — même contrat que `getLeadStatusConfigs`.
 *
 * Les lignes portent leur `searchId`, ce qui suffit au client pour afficher le
 * bandeau « ce tableau a ses propres champs » sans une requête de plus.
 */
export const getLeadCardFields = async (
  args: { searchId?: string } | void,
  context: any,
): Promise<any[]> => {
  const companyId = ensureCompany(context.user);
  const searchId = (args as any)?.searchId as string | undefined;
  if (searchId) {
    const search = await context.entities.LeadSearch.findUnique({
      where: { id: searchId },
      select: { companyId: true },
    });
    if (!search || search.companyId !== companyId) throw new HttpError(404);
  }
  return effectiveCardFieldConfigs(context.entities, companyId, searchId);
};

/** Plafond : au-delà, la liste de réglage cesse d'être lisible autant que la carte. */
const MAX_CARD_FIELDS = 24;

/**
 * Réécrit en bloc le jeu de champs d'une portée.
 *
 * En bloc et non ligne à ligne : l'écran règle l'ordre, les étoiles, les intitulés
 * et les ajouts d'un même geste, et six actions séparées laisseraient l'affichage
 * dans un état intermédiaire à chaque enregistrement partiel. Le jeu envoyé est le
 * jeu qui vaut.
 */
export const saveLeadCardFields = async (
  {
    searchId,
    fields,
  }: {
    searchId?: string;
    fields: { key: string; label: string; onCard: boolean; onDetail?: boolean }[];
  },
  context: any,
): Promise<any[]> => {
  const companyId = ensureCompany(context.user);
  const scope = await requireStatusScope(context, companyId, searchId);

  if (!Array.isArray(fields) || fields.length === 0) {
    throw new HttpError(400, 'Au moins un champ est requis.');
  }
  if (fields.length > MAX_CARD_FIELDS) {
    throw new HttpError(400, `Pas plus de ${MAX_CARD_FIELDS} champs.`);
  }

  const seen = new Set<string>();
  const rows = fields.map((field, order) => {
    const key = String(field.key ?? '').trim();
    if (!key) throw new HttpError(400, 'Un champ sans clé ne peut pas être enregistré.');
    if (seen.has(key)) throw new HttpError(400, `Le champ « ${key} » est présent deux fois.`);
    seen.add(key);
    const label = String(field.label ?? '').trim().slice(0, 40);
    if (!label) throw new HttpError(400, `Le champ « ${key} » n'a pas d'intitulé.`);
    return {
      companyId,
      searchId: scope,
      key,
      label,
      // Le nom passe toujours, quoi qu'annonce le client : la garde est la même
      // que celle de `visibleCardFields`, appliquée avant l'écriture pour qu'une
      // configuration enregistrée ne puisse pas décrire une carte anonyme.
      onCard: isLockedCardField(key) ? true : !!field.onCard,
      // `?? true` et non `!!` : un appelant qui ne connaît pas encore l'œil — la
      // correspondance, qui ne règle que les étoiles — ne doit pas masquer de la
      // fiche tout ce qu'il enregistre au passage.
      onDetail: hasDetailToggle(key) ? (field.onDetail ?? true) : false,
      order,
    };
  });

  if (!seen.has('name')) throw new HttpError(400, 'Le nom ne peut pas être retiré de la carte.');

  // Remplacement et non fusion : c'est la même règle « tout ou rien » que les
  // statuts, et elle est ce qui rend une surcharge de tableau raisonnable.
  await context.entities.LeadCardFieldConfig.deleteMany({ where: { companyId, searchId: scope } });
  for (const row of rows) {
    await context.entities.LeadCardFieldConfig.create({ data: row });
  }

  return effectiveCardFieldConfigs(context.entities, companyId, scope);
};

/**
 * Rend un tableau au jeu de l'entreprise en supprimant ses lignes propres.
 *
 * L'inverse exact de la surcharge, et le seul moyen d'en sortir : sans cela, un
 * tableau ayant un jour dévié resterait figé sur sa copie et cesserait de suivre
 * les évolutions de l'entreprise, sans que rien ne l'indique.
 */
export const resetLeadCardFields = async (
  { searchId }: { searchId: string },
  context: any,
): Promise<any[]> => {
  const companyId = ensureCompany(context.user);
  const scope = await requireStatusScope(context, companyId, searchId);
  if (!scope) throw new HttpError(400, 'Un tableau est requis.');
  await context.entities.LeadCardFieldConfig.deleteMany({ where: { companyId, searchId: scope } });
  return effectiveCardFieldConfigs(context.entities, companyId, scope);
};

// ─── Lead status config operations ───────────────────────────────────────────

/**
 * Les colonnes du kanban.
 *
 * Sans `searchId` : les statuts de l'entreprise, ceux que règle « Statuts » sur
 * la page Prospection. Avec : ceux qui s'appliquent réellement à ce tableau —
 * les siens s'il en a, ceux de l'entreprise sinon. Les lignes portent leur
 * `searchId`, ce qui suffit au client pour savoir s'il regarde une surcharge.
 */
export const getLeadStatusConfigs: GetLeadStatusConfigs<
  { searchId?: string } | void,
  LeadStatusConfig[]
> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  const searchId = (args as any)?.searchId as string | undefined;

  if (searchId) {
    const search = await context.entities.LeadSearch.findUnique({
      where: { id: searchId },
      select: { companyId: true },
    });
    if (!search || search.companyId !== companyId) throw new HttpError(404);
  }

  const configs = await effectiveStatusConfigs(context.entities, companyId, searchId);
  // Always append the virtual unknown column at the end
  return [...configs, VIRTUAL_UNKNOWN];
};

export const createLeadStatusConfig: CreateLeadStatusConfig<
  { key: string; label: string; color: string; order: number; searchId?: string },
  LeadStatusConfig
> = async ({ key, label, color, order, searchId }, context) => {
  const companyId = ensureCompany(context.user);
  // Normalise key: lowercase, spaces to underscores, only alphanumeric/_
  const safeKey = key.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (!safeKey) throw new HttpError(400, 'Clé invalide');
  if (safeKey === UNKNOWN_STATUS_KEY) throw new HttpError(400, 'Cette clé est réservée');

  const scope = await requireStatusScope(context, companyId, searchId);

  // Vérification explicite plutôt que de s'en remettre à la contrainte d'unicité :
  // `@@unique([companyId, searchId, key])` ne protège pas les statuts d'entreprise
  // entre eux, Postgres considérant deux NULL comme distincts. Et un message clair
  // vaut mieux qu'une P2002 remontée telle quelle.
  const clash = await (context.entities as any).LeadStatusConfig.findFirst({
    where: { companyId, searchId: scope, key: safeKey },
    select: { id: true },
  });
  if (clash) throw new HttpError(400, `Le statut « ${safeKey} » existe déjà.`);

  return (context.entities as any).LeadStatusConfig.create({
    data: { companyId, searchId: scope, key: safeKey, label, color, order },
  });
};

/** Valide la portée demandée et renvoie le `searchId` à écrire (null = entreprise). */
async function requireStatusScope(
  context: any,
  companyId: string,
  searchId?: string,
): Promise<string | null> {
  if (!searchId) return null;
  const search = await context.entities.LeadSearch.findUnique({
    where: { id: searchId },
    select: { companyId: true },
  });
  if (!search || search.companyId !== companyId) throw new HttpError(404);
  return searchId;
}

export const updateLeadStatusConfig: UpdateLeadStatusConfig<
  { id: string; label?: string; color?: string; order?: number },
  LeadStatusConfig
> = async ({ id, label, color, order }, context) => {
  const companyId = ensureCompany(context.user);
  const config = await (context.entities as any).LeadStatusConfig.findUnique({ where: { id } });
  if (!config || config.companyId !== companyId) throw new HttpError(404);
  if (config.key === UNKNOWN_STATUS_KEY) throw new HttpError(400, 'Ce statut ne peut pas être modifié');
  return (context.entities as any).LeadStatusConfig.update({
    where: { id },
    data: {
      ...(label !== undefined && { label }),
      ...(color !== undefined && { color }),
      ...(order !== undefined && { order }),
    },
  });
};

export const deleteLeadStatusConfig: DeleteLeadStatusConfig<{ id: string }, { id: string }> = async (
  { id },
  context,
) => {
  const companyId = ensureCompany(context.user);
  const config = await (context.entities as any).LeadStatusConfig.findUnique({ where: { id } });
  if (!config || config.companyId !== companyId) throw new HttpError(404);
  if (config.key === UNKNOWN_STATUS_KEY) throw new HttpError(400, 'Ce statut ne peut pas être supprimé');

  // Les prospects orphelins vont dans « Statut inconnu » — mais seulement ceux
  // que ce statut concernait réellement.
  //
  //  · Statut propre à un tableau : ses prospects à lui, personne d'autre.
  //  · Statut d'entreprise : tous les tableaux *sauf* ceux qui ont leurs propres
  //    statuts. Ceux-là ne suivent plus l'entreprise ; déplacer leurs cartes
  //    parce qu'une clé de même nom disparaît ailleurs serait un dégât collatéral
  //    parfaitement invisible.
  const where: any = { status: config.key };
  if (config.searchId) {
    where.searchId = config.searchId;
  } else {
    const overriding = await (context.entities as any).LeadStatusConfig.findMany({
      where: { companyId, searchId: { not: null } },
      select: { searchId: true },
      distinct: ['searchId'],
    });
    where.search = { companyId };
    const ids = overriding.map((o: any) => o.searchId).filter(Boolean);
    if (ids.length) where.searchId = { notIn: ids };
  }
  await context.entities.Lead.updateMany({ where, data: { status: UNKNOWN_STATUS_KEY } });

  await (context.entities as any).LeadStatusConfig.delete({ where: { id } });
  return { id };
};

// ─── Surcharge des statuts par tableau ────────────────────────────────────────

/**
 * Donne à ce tableau ses propres statuts, recopiés de ceux qu'il applique déjà.
 *
 * On copie l'état effectif plutôt que de partir d'une liste vide : on part de ce
 * qu'on a sous les yeux, aucune carte ne change de colonne au moment de basculer,
 * et on ajuste ensuite. Commencer de zéro enverrait tous les prospects du tableau
 * dans « Statut inconnu » d'un seul clic.
 */
export const overrideBoardStatuses = async (
  { searchId }: { searchId: string },
  context: any,
): Promise<{ created: number }> => {
  const companyId = ensureCompany(context.user);
  const scope = await requireStatusScope(context, companyId, searchId);
  if (!scope) throw new HttpError(400, 'Tableau requis');

  const existing = await (context.entities as any).LeadStatusConfig.count({
    where: { companyId, searchId: scope },
  });
  if (existing > 0) throw new HttpError(400, 'Ce tableau a déjà ses propres statuts.');

  const source = await effectiveStatusConfigs(context.entities, companyId, null);
  await Promise.all(
    source.map((c: any) =>
      (context.entities as any).LeadStatusConfig.create({
        data: { companyId, searchId: scope, key: c.key, label: c.label, color: c.color, order: c.order },
      }),
    ),
  );
  return { created: source.length };
};

/**
 * Ramène le tableau aux statuts de l'entreprise.
 *
 * Les prospects dont la colonne n'existe pas dans le jeu de l'entreprise sont
 * déplacés vers « Statut inconnu » — la même convention que la suppression d'un
 * statut. Ils restent visibles et rattrapables ; le compte est renvoyé pour que
 * l'interface puisse l'annoncer *avant* de basculer.
 */
export const resetBoardStatuses = async (
  { searchId }: { searchId: string },
  context: any,
): Promise<{ orphaned: number }> => {
  const companyId = ensureCompany(context.user);
  const scope = await requireStatusScope(context, companyId, searchId);
  if (!scope) throw new HttpError(400, 'Tableau requis');

  const shared = await effectiveStatusConfigs(context.entities, companyId, null);
  const keptKeys = shared.map((c: any) => c.key);

  const { count } = await context.entities.Lead.updateMany({
    where: { searchId: scope, status: { notIn: [...keptKeys, UNKNOWN_STATUS_KEY] } },
    data: { status: UNKNOWN_STATUS_KEY },
  });

  await (context.entities as any).LeadStatusConfig.deleteMany({
    where: { companyId, searchId: scope },
  });
  return { orphaned: count };
};

export const reorderLeadStatusConfigs = async (
  { items }: { items: { id: string; order: number }[] },
  context: any,
): Promise<void> => {
  const companyId = ensureCompany(context.user);
  await Promise.all(
    items.map(({ id, order }: { id: string; order: number }) =>
      (context.entities as any).LeadStatusConfig.updateMany({
        where: { id, companyId },
        data: { order },
      })
    )
  );
};

// ─── Provenances ──────────────────────────────────────────────────────────────

/**
 * Le registre des provenances de l'entreprise, semé au premier accès.
 *
 * Même patron que `effectiveStatusConfigs`, sans la notion de portée : une
 * provenance décrit d'où vient le prospect, ce qui ne dépend pas du tableau
 * depuis lequel on le regarde.
 *
 * L'amorçage fait deux choses, et la seconde compte autant que la première.
 * Après les huit provenances d'origine, on balaie les valeurs de `Lead.source`
 * déjà en base pour enregistrer celles qui n'y figurent pas : `createLead` et
 * `updateLead` n'ont jamais validé ce champ, donc des clés hors liste peuvent
 * exister depuis longtemps. Sans ce rattrapage elles deviendraient des onglets
 * sans étiquette et des cartes impossibles à reclasser.
 *
 * Ce balayage ne tourne qu'une fois, quand l'entreprise n'a encore aucune ligne.
 */
export async function effectiveSourceConfigs(entities: any, companyId: string): Promise<any[]> {
  const existing = await entities.LeadSourceConfig.findMany({
    where: { companyId },
    orderBy: { order: 'asc' },
  });
  if (existing.length > 0) return existing;

  await entities.LeadSourceConfig.createMany({
    data: DEFAULT_LEAD_SOURCES.map(s => ({
      companyId,
      key: s.key,
      label: s.label,
      color: s.color,
      order: s.order,
      isSystem: true,
    })),
    skipDuplicates: true,
  });

  const seen = new Set<string>(DEFAULT_LEAD_SOURCES.map(s => s.key));
  const inUse = await entities.Lead.findMany({
    where: { search: { companyId } },
    select: { source: true },
    distinct: ['source'],
  });
  const strays = inUse
    .map((l: any) => slugifyLeadSource(l.source))
    .filter((key: string) => key && !seen.has(key));

  if (strays.length > 0) {
    await entities.LeadSourceConfig.createMany({
      data: [...new Set<string>(strays)].map((key, i) => ({
        companyId,
        key,
        label: humanizeSourceKey(key),
        color: '#6366f1',
        order: DEFAULT_LEAD_SOURCES.length + i,
        learned: true,
      })),
      skipDuplicates: true,
    });
  }

  return entities.LeadSourceConfig.findMany({ where: { companyId }, orderBy: { order: 'asc' } });
}

/** Les clés acceptables pour un `source` choisi dans une liste. */
async function allowedSourceKeys(entities: any, companyId: string): Promise<string[]> {
  const configs = await effectiveSourceConfigs(entities, companyId);
  return configs.map((c: any) => c.key);
}

/**
 * Valide un `source` reçu d'un `<select>` et lève une 400 s'il est inconnu.
 *
 * Les deux appelants (`createLead`, `updateLead`) alimentent leur liste depuis le
 * registre : une clé hors registre y signale un bogue client ou un appel forgé,
 * pas une saisie maladroite à rattraper en silence.
 */
async function requireKnownSource(entities: any, companyId: string, source: string): Promise<string> {
  const key = normalizeLeadSource(source, await allowedSourceKeys(entities, companyId));
  if (!key) throw new HttpError(400, `Provenance inconnue : « ${source} »`);
  return key;
}

function ensureSourceAdmin(user: any): void {
  if (!(user?.role === 'admin' || user?.isAdmin === true)) {
    throw new HttpError(403, 'Réservé aux administrateurs');
  }
}

export const getLeadSourceConfigs = async (_args: any, context: any): Promise<any[]> => {
  const companyId = ensureCompany(context.user);
  return effectiveSourceConfigs(context.entities, companyId);
};

export const createLeadSourceConfig = async (
  { label, color }: { label: string; color?: string },
  context: any,
): Promise<any> => {
  const companyId = ensureCompany(context.user);
  ensureSourceAdmin(context.user);

  const trimmed = cleanSourceLabel(label);
  if (!trimmed) throw new HttpError(400, 'Nom requis');
  if ((label ?? '').trim().length > MAX_SOURCE_LABEL_CHARS) {
    throw new HttpError(400, `Nom trop long (maximum ${MAX_SOURCE_LABEL_CHARS} caractères).`);
  }

  // La clé se déduit de l'étiquette plutôt que d'être saisie : contrairement aux
  // statuts, une provenance n'est jamais désignée par sa clé dans l'interface, et
  // demander les deux ferait saisir deux fois la même chose.
  const key = slugifyLeadSource(trimmed);
  if (key === FALLBACK_SOURCE_KEY && trimmed.toLowerCase() !== 'autre') {
    throw new HttpError(400, 'Ce nom ne produit aucune clé utilisable.');
  }

  const configs = await effectiveSourceConfigs(context.entities, companyId);
  if (configs.some((c: any) => c.key === key)) {
    throw new HttpError(400, `La provenance « ${trimmed} » existe déjà.`);
  }
  if (configs.length >= MAX_SOURCES_PER_COMPANY) {
    throw new HttpError(400, `Maximum ${MAX_SOURCES_PER_COMPANY} provenances par entreprise.`);
  }

  return context.entities.LeadSourceConfig.create({
    data: {
      companyId,
      key,
      label: trimmed,
      color: color ?? '#6366f1',
      order: Math.max(-1, ...configs.map((c: any) => c.order)) + 1,
    },
  });
};

/**
 * Renomme ou recolore une provenance.
 *
 * La clé ne bouge jamais — c'est elle qui est écrite sur chaque prospect, et la
 * renommer imposerait de réécrire toutes les cartes pour un changement purement
 * cosmétique. Une provenance système garde donc sa clé mais s'habille librement :
 * « Ajout manuel » peut devenir « Saisie bureau ».
 */
export const updateLeadSourceConfig = async (
  { id, label, color, order }: { id: string; label?: string; color?: string; order?: number },
  context: any,
): Promise<any> => {
  const companyId = ensureCompany(context.user);
  ensureSourceAdmin(context.user);

  const config = await context.entities.LeadSourceConfig.findUnique({ where: { id } });
  if (!config || config.companyId !== companyId) throw new HttpError(404);

  const trimmed = label === undefined ? undefined : cleanSourceLabel(label);
  if (label !== undefined && !trimmed) throw new HttpError(400, 'Nom requis');
  if ((label ?? '').trim().length > MAX_SOURCE_LABEL_CHARS) {
    throw new HttpError(400, `Nom trop long (maximum ${MAX_SOURCE_LABEL_CHARS} caractères).`);
  }

  return context.entities.LeadSourceConfig.update({
    where: { id },
    data: {
      ...(trimmed !== undefined && { label: trimmed }),
      ...(color !== undefined && { color }),
      ...(order !== undefined && { order }),
      // Un humain vient de s'en occuper : la ligne n'est plus « détectée
      // automatiquement », et la pastille qui invitait à faire le ménage disparaît.
      learned: false,
    },
  });
};

/**
 * Supprime une provenance en réaffectant ses prospects.
 *
 * `mergeInto` compte plus ici que pour les statuts : les provenances apprises
 * arrivent en variantes proches d'une même campagne (`salon_2026`,
 * `salon_habitation_2026`), et tout renvoyer vers « Autre » perdrait justement ce
 * qu'on cherchait à distinguer. Sans cible explicite, repli sur « Autre ».
 *
 * La réaffectation précède la suppression : dans l'autre ordre, un échec en cours
 * de route laisserait des cartes pointant sur une clé disparue.
 */
export const deleteLeadSourceConfig = async (
  { id, mergeInto }: { id: string; mergeInto?: string },
  context: any,
): Promise<{ id: string; moved: number }> => {
  const companyId = ensureCompany(context.user);
  ensureSourceAdmin(context.user);

  const config = await context.entities.LeadSourceConfig.findUnique({ where: { id } });
  if (!config || config.companyId !== companyId) throw new HttpError(404);
  if (config.key === FALLBACK_SOURCE_KEY) {
    throw new HttpError(400, '« Autre » ne peut pas être supprimée : elle sert de repli.');
  }
  if (config.isSystem) {
    throw new HttpError(400, 'Une provenance d’origine ne peut pas être supprimée. Renommez-la.');
  }

  const target = mergeInto ?? FALLBACK_SOURCE_KEY;
  if (target === config.key) throw new HttpError(400, 'Cible de fusion invalide.');
  const known = await allowedSourceKeys(context.entities, companyId);
  if (!known.includes(target)) throw new HttpError(400, 'Cible de fusion inconnue.');

  const { count } = await context.entities.Lead.updateMany({
    where: { source: config.key, search: { companyId } },
    data: { source: target },
  });

  await context.entities.LeadSourceConfig.delete({ where: { id } });
  return { id, moved: count };
};

export const reorderLeadSourceConfigs = async (
  { items }: { items: { id: string; order: number }[] },
  context: any,
): Promise<void> => {
  const companyId = ensureCompany(context.user);
  ensureSourceAdmin(context.user);
  await Promise.all(
    items.map(({ id, order }) =>
      context.entities.LeadSourceConfig.updateMany({ where: { id, companyId }, data: { order } }),
    ),
  );
};

/** Le nombre de prospects portant chaque provenance — pour l'écran « Provenances ». */
export const getLeadSourceUsage = async (
  _args: any,
  context: any,
): Promise<Record<string, number>> => {
  const companyId = ensureCompany(context.user);
  const rows = await context.entities.Lead.groupBy({
    by: ['source'],
    where: { search: { companyId } },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r: any) => [r.source, r._count._all]));
};

// ─── Lead notes (timeline) ────────────────────────────────────────────────────

export const getLeadNotes = async (
  { identifier }: { identifier: string },
  context: any,
): Promise<any[]> => {
  const companyId = ensureCompany(context.user);
  return (context.entities as any).LeadNote.findMany({
    where: { companyId, identifier },
    orderBy: { createdAt: 'asc' },
  });
};

export const addLeadNote = async (
  { leadId, text }: { leadId: string; text: string },
  context: any,
): Promise<any> => {
  const companyId = ensureCompany(context.user);
  const lead = await context.entities.Lead.findUnique({
    where: { id: leadId },
    include: { search: { select: { companyId: true } } },
  });
  if (!lead || (lead as any).search.companyId !== companyId) throw new HttpError(404);
  const identifier = lead.placeId ?? lead.id;
  return (context.entities as any).LeadNote.create({
    data: { companyId, identifier, text: text.trim() },
  });
};

export const deleteLeadNote = async (
  { id }: { id: string },
  context: any,
): Promise<{ id: string }> => {
  const companyId = ensureCompany(context.user);
  const note = await (context.entities as any).LeadNote.findUnique({ where: { id } });
  if (!note || note.companyId !== companyId) throw new HttpError(404);
  await (context.entities as any).LeadNote.delete({ where: { id } });
  return { id };
};

export const sendProspectEmail = async (
  args: { identifier: string; to: string; cc?: string | null; subject: string; body: string },
  context: any,
): Promise<{ ok: true }> => {
  const companyId = ensureCompany(context.user);
  const to = args.to.trim();
  if (!to) throw new HttpError(400, 'Destinataire requis');
  if (!args.subject?.trim()) throw new HttpError(400, 'Objet requis');

  const company = await (context.entities as any).Company.findUnique({
    where: { id: companyId },
    select: {
      name: true, email: true,
      smtpHost: true, smtpPort: true, smtpUsername: true, smtpPassword: true,
      smtpFromName: true, smtpFromEmail: true, copySentEmailsToCompany: true,
    },
  });
  const smtp = companySmtp(company);
  if (!smtp) throw new HttpError(400, 'Courriel non configuré. Ajoutez votre propre serveur SMTP dans Paramètres → Intégrations.');

  // Relance : les envois précédents sont cités sous le nouveau message et les
  // en-têtes de fil les rattachent à la même conversation chez le prospect.
  const previous: any[] = await (context.entities as any).LeadEmailLog.findMany({
    where: { companyId, identifier: args.identifier },
    orderBy: { createdAt: 'desc' },
    take: QUOTED_HISTORY_LIMIT,
  });
  const quoted = buildQuotedHistory(previous);
  const { inReplyTo, references } = buildThreadHeaders(previous);

  const html = buildEmailHtml(args.body, quoted);

  // Sender name/address, Reply-To and the optional Cci copy all come from the
  // company's SMTP configuration — the prospect answers to the company inbox,
  // never to the mailbox the message happened to be sent through.
  const fromName = smtp.fromName;
  const replyTo = smtp.replyTo ?? undefined;

  const sent = await sendEmailWithAttachment({
    smtp,
    to,
    cc: args.cc?.trim() || undefined,
    subject: args.subject.trim(),
    text: args.body + quoted.text,
    html,
    clientFacing: true,
    inReplyTo,
    references,
  });

  // Log the sent email. `body` ne garde que le texte saisi : c'est lui qui sera
  // cité au prochain envoi, et une citation de citation gonflerait chaque relance.
  await (context.entities as any).LeadEmailLog.create({
    data: {
      companyId,
      identifier: args.identifier,
      to,
      cc: args.cc?.trim() || null,
      subject: args.subject.trim(),
      body: args.body,
      replyTo: replyTo ?? null,
      fromName,
      fromEmail: smtp.fromEmail,
      messageId: sent.messageId ?? null,
    },
  });

  // Clear the draft after successful send
  await (context.entities as any).LeadEmailDraft.deleteMany({
    where: { companyId, identifier: args.identifier },
  });

  return { ok: true };
};

export const getLeadEmailLogs = async (
  { identifier }: { identifier: string },
  context: any,
): Promise<any[]> => {
  const companyId = ensureCompany(context.user);
  return (context.entities as any).LeadEmailLog.findMany({
    where: { companyId, identifier },
    orderBy: { createdAt: 'desc' },
  });
};

export const getLeadEmailDraft = async (
  { identifier }: { identifier: string },
  context: any,
): Promise<any | null> => {
  const companyId = ensureCompany(context.user);
  return (context.entities as any).LeadEmailDraft.findUnique({
    where: { companyId_identifier: { companyId, identifier } },
  });
};

export const saveLeadEmailDraft = async (
  args: { identifier: string; to: string; cc: string; subject: string; body: string },
  context: any,
): Promise<{ ok: true }> => {
  const companyId = ensureCompany(context.user);
  await (context.entities as any).LeadEmailDraft.upsert({
    where: { companyId_identifier: { companyId, identifier: args.identifier } },
    create: {
      companyId,
      identifier: args.identifier,
      to: args.to,
      cc: args.cc,
      subject: args.subject,
      body: args.body,
    },
    update: {
      to: args.to,
      cc: args.cc,
      subject: args.subject,
      body: args.body,
    },
  });
  return { ok: true };
};

export const clearLeadEmailSent = async (
  { identifier }: { identifier: string },
  context: any,
): Promise<{ ok: true }> => {
  const companyId = ensureCompany(context.user);
  await (context.entities as any).LeadEmailLog.deleteMany({
    where: { companyId, identifier },
  });
  return { ok: true };
};

// ─── Prospect message templates (email + sms) ────────────────────────────────

type TemplateChannel = 'email' | 'sms';

function normalizeChannel(channel?: string | null): TemplateChannel {
  return channel === 'sms' ? 'sms' : 'email';
}

async function ensureOwnedSearch(searchId: string, companyId: string, entities: any) {
  const search = await entities.LeadSearch.findUnique({ where: { id: searchId } });
  if (!search || search.companyId !== companyId) throw new HttpError(404);
  return search;
}

export const getProspectTemplates = async (
  { searchId }: { searchId: string },
  context: any,
): Promise<any[]> => {
  const companyId = ensureCompany(context.user);
  await ensureOwnedSearch(searchId, companyId, context.entities);
  return (context.entities as any).ProspectTemplate.findMany({
    where: { searchId },
    orderBy: [{ channel: 'asc' }, { createdAt: 'asc' }],
  });
};

export const upsertProspectTemplate = async (
  args: {
    id?: string | null;
    searchId: string;
    channel?: string;
    name: string;
    subject?: string;
    body: string;
    defaultStatus?: string | null;
  },
  context: any,
): Promise<any> => {
  const companyId = ensureCompany(context.user);
  await ensureOwnedSearch(args.searchId, companyId, context.entities);

  const channel = normalizeChannel(args.channel);
  const name = args.name?.trim() || (channel === 'sms' ? 'Modèle SMS' : 'Modèle courriel');
  if (!args.body?.trim()) throw new HttpError(400, 'Le message ne peut pas être vide');
  const defaultStatus = args.defaultStatus?.trim() || null;

  const data = {
    name,
    channel,
    // A text message has no subject line, so it is never stored for sms.
    subject: channel === 'sms' ? '' : (args.subject ?? '').trim(),
    body: args.body,
    defaultStatus,
  };

  let template: any;
  if (args.id) {
    const existing = await (context.entities as any).ProspectTemplate.findUnique({ where: { id: args.id } });
    if (!existing || existing.companyId !== companyId) throw new HttpError(404);
    template = await (context.entities as any).ProspectTemplate.update({
      where: { id: args.id },
      data,
    });
  } else {
    template = await (context.entities as any).ProspectTemplate.create({
      data: { ...data, searchId: args.searchId, companyId },
    });
  }

  // A status can only propose one model per channel, so the previous holder
  // gives it up rather than the send modal having to pick between two.
  if (defaultStatus) {
    await (context.entities as any).ProspectTemplate.updateMany({
      where: {
        searchId: args.searchId,
        channel,
        defaultStatus,
        id: { not: template.id },
      },
      data: { defaultStatus: null },
    });
  }

  return template;
};

export const deleteProspectTemplate = async (
  { id }: { id: string },
  context: any,
): Promise<{ deleted: boolean }> => {
  const companyId = ensureCompany(context.user);
  const tmpl = await (context.entities as any).ProspectTemplate.findUnique({ where: { id } });
  if (!tmpl || tmpl.companyId !== companyId) throw new HttpError(404);
  await (context.entities as any).ProspectTemplate.delete({ where: { id } });
  return { deleted: true };
};

/**
 * Les tableaux où l'on peut aller chercher des modèles à recopier : ceux de
 * l'entreprise qui en ont au moins un, celui d'où l'on regarde exclu.
 *
 * Les modèles voyagent avec la liste plutôt que derrière un second appel par
 * tableau : ils servent à la fois à cocher ce qu'on recopie et à en montrer un
 * aperçu, et une entreprise a des dizaines de tableaux, pas des milliers.
 */
export const getProspectTemplateSources = async (
  args: { searchId?: string | null } | void,
  context: any,
): Promise<any[]> => {
  const companyId = ensureCompany(context.user);
  // Sans tableau d'arrivée — l'assistant « Nouveau tableau », où il n'existe pas
  // encore — il n'y a rien à exclure : tous les tableaux pourvus sont candidats.
  const searchId = (args as any)?.searchId ?? null;
  if (searchId) await ensureOwnedSearch(searchId, companyId, context.entities);

  return (context.entities as any).LeadSearch.findMany({
    where: {
      companyId,
      ...(searchId ? { id: { not: searchId } } : {}),
      templates: { some: {} },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      templates: {
        orderBy: [{ channel: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          channel: true,
          subject: true,
          body: true,
          defaultStatus: true,
        },
      },
    },
  });
};

/**
 * Recopie des modèles d'un autre tableau dans celui-ci.
 *
 * Une copie, pas un partage : le nouveau tableau repart avec ses propres lignes,
 * que l'on peut retoucher sans que l'original ne bouge. C'est ce qu'attend
 * quelqu'un qui vient de créer un tableau et veut y retrouver ses messages.
 */
export const copyProspectTemplates = async (
  { searchId, templateIds }: { searchId: string; templateIds: string[] },
  context: any,
): Promise<{ copied: number; templates: any[] }> => {
  const companyId = ensureCompany(context.user);
  await ensureOwnedSearch(searchId, companyId, context.entities);

  const ids = Array.from(new Set((templateIds ?? []).filter(Boolean)));
  if (ids.length === 0) throw new HttpError(400, 'Aucun modèle sélectionné');

  const sources = await (context.entities as any).ProspectTemplate.findMany({
    where: { id: { in: ids }, companyId },
    orderBy: [{ channel: 'asc' }, { createdAt: 'asc' }],
  });
  if (sources.length !== ids.length) throw new HttpError(404);
  if (sources.some((t: any) => t.searchId === searchId)) {
    throw new HttpError(400, 'Ces modèles appartiennent déjà à ce tableau.');
  }

  // Un statut ne propose qu'un modèle par canal (voir `upsertProspectTemplate`).
  // La copie ne revendique donc le sien que si ce tableau connaît ce statut — il
  // peut avoir les siens — et que personne ne l'y a déjà pris. Sinon elle arrive
  // sans statut : mieux vaut un modèle à rattacher à la main qu'un modèle en
  // place délogé par une importation.
  const statusKeys = new Set(
    (await effectiveStatusConfigs(context.entities, companyId, searchId)).map((s: any) => s.key),
  );
  const claimed = new Set(
    (
      await (context.entities as any).ProspectTemplate.findMany({
        where: { searchId, defaultStatus: { not: null } },
        select: { channel: true, defaultStatus: true },
      })
    ).map((t: any) => `${t.channel}:${t.defaultStatus}`),
  );

  const created: any[] = [];
  for (const src of sources) {
    const key = `${src.channel}:${src.defaultStatus}`;
    const defaultStatus =
      src.defaultStatus && statusKeys.has(src.defaultStatus) && !claimed.has(key)
        ? src.defaultStatus
        : null;
    if (defaultStatus) claimed.add(key);

    created.push(
      await (context.entities as any).ProspectTemplate.create({
        data: {
          companyId,
          searchId,
          name: src.name,
          channel: src.channel,
          subject: src.subject,
          body: src.body,
          defaultStatus,
        },
      }),
    );
  }

  // Les copies sont renvoyées : l'écran ouvre l'éditeur sur la première d'entre
  // elles, qui n'a pas l'identifiant de son original.
  return { copied: created.length, templates: created };
};

// ─── Prospect SMS ─────────────────────────────────────────────────────────────

export const sendProspectSms = async (
  args: { identifier: string; leadId: string; to: string; body: string },
  context: any,
): Promise<{ ok: true }> => {
  const companyId = ensureCompany(context.user);

  const lead = await context.entities.Lead.findUnique({
    where: { id: args.leadId },
    include: { search: { select: { companyId: true } } },
  });
  if (!lead || (lead as any).search.companyId !== companyId) throw new HttpError(404);

  const text = (args.body ?? '').trim();
  if (!text) throw new HttpError(400, 'Message requis');

  const to = toE164(args.to ?? '');
  if (!to) throw new HttpError(400, 'Numéro de téléphone invalide');

  const company = await context.entities.Company.findUnique({
    where: { id: companyId },
    select: { telnyxPhoneNumber: true, telnyxApiKey: true },
  });
  const credentials = resolveSmsCredentials(company);
  if (!credentials) {
    throw new HttpError(400, 'SMS non configuré. Ajoutez votre numéro et votre clé API Telnyx dans Paramètres → Intégrations.');
  }

  let providerId: string | null = null;
  try {
    ({ id: providerId } = await sendSms({ to, text, credentials }));
  } catch (e: any) {
    throw new HttpError(502, e?.message ?? "Erreur lors de l'envoi du SMS");
  }

  await (context.entities as any).LeadSmsLog.create({
    data: {
      companyId,
      identifier: args.identifier,
      to,
      fromNumber: credentials.from,
      body: text,
      providerId,
      direction: 'outbound',
      // Telnyx accepted it; the real state arrives later via the webhook.
      status: 'queued',
    },
  });

  return { ok: true };
};

// Chronological, so the modal can render it as a conversation.
export const getLeadSmsLogs = async (
  { identifier }: { identifier: string },
  context: any,
): Promise<any[]> => {
  const companyId = ensureCompany(context.user);
  return (context.entities as any).LeadSmsLog.findMany({
    where: { companyId, identifier },
    orderBy: { createdAt: 'asc' },
  });
};

// Resets the "SMS sent" flag. Inbound replies are deliberately spared — they are
// the prospect's messages, not a status we own.
//
// Pour effacer un fil entier, réponses comprises, voir deleteSmsConversation
// (sms/operations.ts) : ce sont les deux seuls chemins qui suppriment des
// LeadSmsLog.
export const clearLeadSmsSent = async (
  { identifier }: { identifier: string },
  context: any,
): Promise<{ ok: true }> => {
  const companyId = ensureCompany(context.user);
  // Sur une conversation autonome, « réinitialiser l'envoi » supprimerait toute
  // la moitié sortante d'un vrai échange. L'action n'a de sens que pour le
  // drapeau « SMS envoyé » d'une carte de prospection.
  if (isDirectIdentifier(identifier)) {
    throw new HttpError(400, "Cette action ne s'applique qu'aux conversations de prospection.");
  }
  await (context.entities as any).LeadSmsLog.deleteMany({
    where: { companyId, identifier, direction: 'outbound' },
  });
  return { ok: true };
};

/**
 * Company-wide count of unread SMS replies, plus a per-search breakdown so the
 * sidebar can flag "Prospection" and each search card can flag itself. Without
 * this, an unread reply is only visible inside the one search it belongs to.
 *
 * Les compteurs sont séparés parce qu'ils n'ouvrent pas les mêmes écrans :
 * `leadTotal` (= somme de `bySearch`) est ce qui a une carte de prospect à
 * ouvrir, donc la seule chose que la pastille « Prospection » a le droit de
 * compter ; `otherTotal` — fils autonomes et fils dont le prospect a été
 * supprimé — ne se lit que dans la boîte SMS.
 */
export const getSmsReplyAlerts = async (
  _args: void,
  context: any,
): Promise<{
  total: number;
  bySearch: Record<string, number>;
  leadTotal: number;
  otherTotal: number;
  inboxEnabled: boolean;
}> => {
  const companyId = ensureCompany(context.user);

  const [unread, company] = await Promise.all([
    (context.entities as any).LeadSmsLog.groupBy({
      by: ['identifier'],
      where: { companyId, direction: 'inbound', readAt: null },
      _count: { id: true },
    }),
    context.entities.Company.findUnique({
      where: { id: companyId },
      select: { smsInboxEnabled: true },
    }),
  ]);
  const inboxEnabled = !!(company as any)?.smsInboxEnabled;
  if (!unread.length) {
    return { total: 0, bySearch: {}, leadTotal: 0, otherTotal: 0, inboxEnabled };
  }

  // identifier is the placeId when Google Maps supplied one, else the lead's id.
  const identifiers = (unread as any[]).map((u: any) => u.identifier);
  const leads = await context.entities.Lead.findMany({
    where: {
      search: { companyId },
      OR: [{ placeId: { in: identifiers } }, { id: { in: identifiers } }],
    },
    select: { id: true, placeId: true, searchId: true },
  });
  const searchByIdentifier = new Map<string, string>(
    (leads as any[]).map((l: any) => [l.placeId ?? l.id, l.searchId]),
  );

  const bySearch: Record<string, number> = {};
  let total = 0;
  let leadTotal = 0;
  for (const u of unread as any[]) {
    total += u._count.id;
    const searchId = searchByIdentifier.get(u.identifier);
    if (searchId) {
      leadTotal += u._count.id;
      bySearch[searchId] = (bySearch[searchId] ?? 0) + u._count.id;
    }
  }
  return { total, bySearch, leadTotal, otherTotal: total - leadTotal, inboxEnabled };
};

/**
 * Note qu'une fiche de prospect a été ouverte.
 *
 * Une seule écriture par prospect, pour toujours : `viewedAt: null` dans le
 * `where` fait que les ouvertures suivantes ne touchent pas la base. Ce n'est pas
 * un historique de consultation — la seule question posée est « quelqu'un l'a-t-il
 * déjà vu ? », et c'est l'alerte d'arrivée (`jobs/leadIntake`) qui la pose.
 *
 * Portée par la requête plutôt que par une vérification préalable, comme
 * `markLeadSmsRead` : un prospect d'une autre entreprise ne correspond
 * simplement à rien, et l'appel est sans effet.
 *
 * `marked` dit si cette ouverture est bien la première. C'est ce qui permet à
 * l'écran de ne recharger le tableau que dans ce cas — la pastille « jamais
 * ouvert » vient de s'éteindre — au lieu d'à chaque consultation.
 */
export const markLeadViewed = async (
  { leadId }: { leadId: string },
  context: any,
): Promise<{ ok: true; marked: boolean }> => {
  const companyId = ensureCompany(context.user);
  const { count } = await (context.entities as any).Lead.updateMany({
    where: { id: leadId, viewedAt: null, search: { companyId } },
    data: { viewedAt: new Date() },
  });
  return { ok: true, marked: count > 0 };
};

/** Clears the unread badge once someone has actually opened the thread. */
export const markLeadSmsRead = async (
  { identifier }: { identifier: string },
  context: any,
): Promise<{ ok: true }> => {
  const companyId = ensureCompany(context.user);
  await (context.entities as any).LeadSmsLog.updateMany({
    where: { companyId, identifier, direction: 'inbound', readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
};

// ─── fetchMoreLeads ───────────────────────────────────────────────────────────

export const fetchMoreLeads = async (
  { searchId, radiusOverride, filters }: { searchId: string; radiusOverride?: number; filters?: unknown },
  context: any,
): Promise<{ added: number; exhausted: boolean; nextExpandedRadiusKm: number | null; located: boolean }> => {
  const companyId = ensureCompany(context.user);
  const apiKey = requirePlacesKey();

  const search = await context.entities.LeadSearch.findUnique({
    where: { id: searchId },
    include: { leads: { select: { placeId: true, name: true } } },
  });
  if (!search || search.companyId !== companyId) throw new HttpError(404);

  // De nouveaux critères remplacent ceux du tableau avant de chercher : c'est ce
  // qu'affichera l'en-tête, et ce que reprendra le prochain « Chercher plus ».
  // Un élargissement de zone est retenu de la même façon.
  let criteria = normalizeCriteria(filters === undefined ? search.filters : filters);
  if (radiusOverride !== undefined) {
    if (!RADIUS_CHOICES.includes(radiusOverride as any)) throw new HttpError(400, 'Rayon non reconnu.');
    criteria = { ...criteria, radius: radiusOverride };
  }
  const problem = criteriaProblem(criteria);
  if (problem) throw new HttpError(400, problem);
  if (filters !== undefined || radiusOverride !== undefined) {
    await context.entities.LeadSearch.update({ where: { id: searchId }, data: { filters: criteria as any } });
  }

  // Ce tableau d'abord, puis — si demandé — tout ce que l'entreprise connaît.
  const exclude = {
    placeIds: new Set<string>((search.leads as any[]).map(l => l.placeId).filter(Boolean)),
    names: new Set<string>((search.leads as any[]).map(l => String(l.name ?? '').toLowerCase())),
  };
  if (criteria.skipKnown) {
    const known = await knownPlaces(context.entities, companyId, searchId);
    known.placeIds.forEach(id => exclude.placeIds.add(id));
  }

  const { places: rawLeads, located } = await findPlaces(criteria, { apiKey, exclude });
  const larger = RADIUS_CHOICES.find(r => r > criteria.radius) ?? null;
  const nextExpandedRadiusKm = larger ? larger / 1000 : null;

  if (rawLeads.length === 0) return { added: 0, exhausted: true, nextExpandedRadiusKm, located };

  // Insert the batch on top of the Nouveau column — where they all land — while
  // keeping the order Google returned them in.
  const minOrder = await context.entities.Lead.aggregate({
    where: { searchId, status: 'nouveau' },
    _min: { order: true },
  });
  const orderBase = (minOrder._min.order ?? 0) - rawLeads.length;

  await context.entities.Lead.createMany({
    data: rawLeads.map((l, i) => ({
      searchId,
      order: orderBase + i,
      source: 'google_maps',
      name: l.name,
      address: l.address ?? null,
      phone: l.phone ?? null,
      website: l.website ?? null,
      email: l.email ?? null,
      rating: l.rating ?? null,
      reviewCount: l.reviewCount ?? null,
      category: l.category ?? null,
      placeId: l.placeId ?? null,
      mapsUrl: l.mapsUrl ?? null,
      latitude: l.latitude ?? null,
      longitude: l.longitude ?? null,
      isOpen: l.isOpen ?? null,
      status: 'nouveau',
      notes: null,
    })),
  });

  await syncTotalFound(context.entities, searchId);

  return { added: rawLeads.length, exhausted: false, nextExpandedRadiusKm, located };
};

function requirePlacesKey(): string {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new HttpError(
      500,
      'Clé API Google Places non configurée. Ajoutez GOOGLE_PLACES_API_KEY dans votre fichier .env.server.',
    );
  }
  return apiKey;
}

/**
 * Les entreprises que l'entreprise a déjà dans ses tableaux (sauf `exceptSearchId`)
 * ou dans son archive, pour « Ignorer les entreprises déjà prospectées ». Par identifiant Google
 * seulement : deux commerces peuvent porter le même nom dans deux villes.
 */
async function knownPlaces(entities: any, companyId: string, exceptSearchId: string | null) {
  const rows = await entities.Lead.findMany({
    where: {
      placeId: { not: null },
      search: { companyId },
      ...(exceptSearchId ? { searchId: { not: exceptSearchId } } : {}),
    },
    select: { placeId: true },
  });
  // Et ceux qui ont été retirés d'un tableau : déjà prospectés eux aussi.
  const archived = await entities.ProspectArchive.findMany({
    where: { companyId, placeId: { not: null } },
    select: { placeId: true },
  });
  return {
    placeIds: new Set<string>([...rows, ...archived].map((r: any) => r.placeId)),
    names: new Set<string>(),
  };
}

// ─── insertLeadOnTop ──────────────────────────────────────────────────────────

/**
 * Insère un prospect en tête de sa colonne.
 *
 * Extrait de `createLead` pour que la réception par webhook produise des cartes
 * qui se comportent exactement comme un ajout manuel — par construction, et non
 * par recopie d'un bout de code qui divergerait à la première correction. Toute
 * autre source de prospects à venir doit passer par ici.
 *
 * `entities` plutôt qu'un `context` : les appelants sont une action Wasp et un
 * gestionnaire d'API, qui n'ont pas la même forme de contexte. La vérification
 * d'appartenance à l'entreprise reste à l'appelant — cette fonction ne sait rien
 * du locataire et ne doit pas faire croire le contraire.
 */
export async function insertLeadOnTop(
  entities: any,
  args: { searchId: string; status: string; data: Record<string, unknown> },
): Promise<any> {
  // Land on top of its column so a freshly added prospect is the first thing
  // seen. Orders are re-normalised to 0..n-1 by applyLeadOrder on the next
  // drag, so going negative here is safe.
  const first = await entities.Lead.findFirst({
    where: { searchId: args.searchId, status: args.status },
    orderBy: { order: 'asc' },
    select: { order: true },
  });

  return entities.Lead.create({
    data: {
      ...args.data,
      searchId: args.searchId,
      status: args.status,
      statusUpdatedAt: new Date(),
      order: (first?.order ?? 0) - 1,
    },
  });
}

// ─── createLead (manual entry) ────────────────────────────────────────────────

type ManualLeadInput = {
  searchId: string;
  name: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  category?: string;
  status?: string;
  source?: string;
  /** Les informations propres au tableau (budget, créneau…), comme dans `updateLead`. */
  extras?: { key?: string; label?: string; value?: string }[];
};

export const createLead = async (args: ManualLeadInput, context: any): Promise<any> => {
  const companyId = ensureCompany(context.user);
  const search = await context.entities.LeadSearch.findUnique({ where: { id: args.searchId } });
  if (!search || search.companyId !== companyId) throw new HttpError(404);
  return insertManualLead(context.entities, companyId, args);
};

/** La saisie à la main, partagée par l'application et le lien de partage. */
async function insertManualLead(entities: any, companyId: string, args: ManualLeadInput): Promise<any> {
  const name = args.name?.trim();
  if (!name) throw new HttpError(400, "Le nom de l'entreprise est requis");

  const status = args.status?.trim() || 'nouveau';
  const clean = (v?: string) => {
    const t = v?.trim();
    return t ? t : null;
  };

  const row = await insertLeadOnTop(entities, {
    searchId: args.searchId,
    status,
    data: {
      name,
      phone: clean(args.phone),
      email: clean(args.email),
      website: clean(args.website),
      address: clean(args.address),
      category: clean(args.category),
      source: args.source?.trim()
        ? await requireKnownSource(entities, companyId, args.source)
        : 'manual',
      extras: normalizeLeadExtras(args.extras ?? []),
    },
  });
  await syncTotalFound(entities, args.searchId);
  return row;
}

// ─── totalFound ───────────────────────────────────────────────────────────────

/**
 * Remet `LeadSearch.totalFound` sur le compte réel des prospects.
 *
 * La colonne est un cache : c'est elle qu'affiche la vignette d'un tableau tant
 * que ses prospects ne sont pas chargés. Elle était tenue à coups d'`increment`
 * aux seules créations en lot — une suppression ne la touchait pas, une saisie
 * manuelle non plus, et le compte n'avait plus qu'un rapport lointain avec le
 * tableau. Supprimer puis rejouer un appel entrant la faisait monter deux fois.
 *
 * Recompter plutôt que décrémenter : c'est exact quel que soit l'écart déjà
 * accumulé, donc chaque passage répare le passé. Les créations en lot gardent
 * leur `increment` — elles sont justes, et le point d'entrée d'un webhook n'a pas
 * à payer un `count` par appel reçu.
 */
async function syncTotalFound(entities: any, searchId: string): Promise<void> {
  const totalFound = await entities.Lead.count({ where: { searchId } });
  await entities.LeadSearch.update({ where: { id: searchId }, data: { totalFound } });
}

// ─── Archive avant suppression ───────────────────────────────────────────────

/** Les intitulés de statut par tableau, lus une fois par tableau. */
function statusLabelCache(entities: any, companyId: string) {
  const boards = new Map<string, Promise<Map<string, string>>>();
  const load = (searchId: string) => {
    if (!boards.has(searchId)) {
      boards.set(searchId, effectiveStatusConfigs(entities, companyId, searchId)
        .then((rows: any[]) => new Map(rows.map(r => [r.key, r.label])))
        .catch(() => new Map()));
    }
    return boards.get(searchId)!;
  };
  return {
    get: async (searchId: string, status: string) => (await load(searchId)).get(status) ?? null,
    load,
  };
}

/**
 * Recopie dans l'archive les prospects qui vont être supprimés, puis rend leurs
 * lignes. Toute suppression de carte passe par ici : un prospect retiré d'un
 * tableau doit pouvoir être reconnu le jour où il revient.
 */
async function archiveBeforeDelete(
  entities: any,
  companyId: string,
  where: Record<string, unknown>,
  reason: 'lead_deleted' | 'board_deleted',
): Promise<any[]> {
  const leads = await entities.Lead.findMany({
    where: { ...where, search: { companyId } },
    include: { search: { select: { title: true } } },
  });
  if (leads.length === 0) return leads;
  const labels = statusLabelCache(entities, companyId);
  const loaded = new Map<string, Map<string, string>>();
  for (const searchId of new Set<string>(leads.map((l: any) => l.searchId))) loaded.set(searchId, await labels.load(searchId));
  await archiveLeads(entities, companyId, leads, {
    reason,
    boardTitle: searchId => leads.find((l: any) => l.searchId === searchId)?.search?.title ?? '',
    statusLabel: (searchId, status) => loaded.get(searchId)?.get(status) ?? null,
  });
  return leads;
}

// ─── deleteLead ───────────────────────────────────────────────────────────────

export const deleteLead = async (
  { leadId }: { leadId: string },
  context: any,
): Promise<{ deleted: boolean }> => {
  const companyId = ensureCompany(context.user);
  const lead = await context.entities.Lead.findUnique({
    where: { id: leadId },
    include: { search: { select: { companyId: true } } },
  });
  if (!lead || lead.search.companyId !== companyId) throw new HttpError(404);
  await archiveBeforeDelete(context.entities, companyId, { id: leadId }, 'lead_deleted');
  await context.entities.Lead.delete({ where: { id: leadId } });
  await syncTotalFound(context.entities, lead.searchId);
  return { deleted: true };
};

// ─── deleteLeads (bulk) ───────────────────────────────────────────────────────

export const deleteLeads = async (
  { leadIds }: { leadIds: string[] },
  context: any,
): Promise<{ deleted: number }> => {
  const companyId = ensureCompany(context.user);
  const ids = [...new Set(leadIds ?? [])];
  if (ids.length === 0) return { deleted: 0 };
  // The company scope lives on the parent search, so it is part of the filter —
  // ids belonging to another company are simply never matched. Reading the rows
  // first is what tells us which boards to recount afterwards: once deleted, the
  // ids no longer say where they lived.
  const doomed = await archiveBeforeDelete(context.entities, companyId, { id: { in: ids } }, 'lead_deleted');
  const { count } = await context.entities.Lead.deleteMany({
    where: { id: { in: ids }, search: { companyId } },
  });
  for (const searchId of new Set(doomed.map((l: { searchId: string }) => l.searchId))) {
    await syncTotalFound(context.entities, searchId as string);
  }
  return { deleted: count };
};

// ─── Share token helpers ──────────────────────────────────────────────────────

function generateShareToken(): string {
  return randomBytes(24).toString('hex');
}

/**
 * Le lien, ses droits, et la preuve qu'il est encore valide.
 *
 * Chaque opération `…ByToken` passe par ici puis par `requireSharePermission` :
 * l'écran du portail cache ce que le lien ne permet pas, mais c'est ce contrôle
 * qui l'interdit — le portail est public, ses appels peuvent être forgés.
 */
async function validateShareToken(token: string, entities: any) {
  const shareToken = await (entities as any).LeadSearchShareToken.findUnique({ where: { token } });
  if (!shareToken || shareToken.isRevoked) throw new HttpError(403, 'Lien invalide ou révoqué');
  // Update lastUsedAt
  await (entities as any).LeadSearchShareToken.update({
    where: { id: shareToken.id },
    data: { lastUsedAt: new Date() },
  });
  return { ...shareToken, perms: normalizeSharePermissions(shareToken.permissions) };
}

const SHARE_PERMISSION_REFUSALS: Record<LeadSharePermissionKey, string> = {
  move: 'Ce lien ne permet pas de déplacer les cartes.',
  edit: 'Ce lien ne permet pas de modifier les prospects.',
  notes: 'Ce lien ne permet pas de voir les notes.',
  writeNotes: "Ce lien ne permet pas d'écrire ni de supprimer des notes.",
  add: "Ce lien ne permet pas d'ajouter des prospects.",
  delete: 'Ce lien ne permet pas de supprimer des prospects.',
  email: "Ce lien ne permet pas d'envoyer de courriels.",
  sms: "Ce lien ne permet pas d'envoyer de SMS.",
  history: "Ce lien ne permet pas de voir l'historique.",
  statuses: 'Ce lien ne permet pas de modifier les statuts.',
  cardFields: 'Ce lien ne permet pas de modifier les cartes.',
  templates: 'Ce lien ne permet pas de gérer les modèles.',
  export: "Ce lien ne permet pas d'exporter les prospects.",
  source: 'Ce lien ne permet pas de régler la source de prospects.',
  criteria: 'Ce lien ne permet pas de lancer de recherche.',
};

/** Accordé si le lien a l'un des droits donnés ; le message est celui du premier. */
function requireSharePermission(
  perms: LeadSharePermissions,
  key: LeadSharePermissionKey | LeadSharePermissionKey[],
): void {
  const keys = Array.isArray(key) ? key : [key];
  if (!keys.some(k => perms[k])) throw new HttpError(403, SHARE_PERMISSION_REFUSALS[keys[0]]);
}

/** Le prospect, à condition qu'il soit sur le tableau du lien. */
async function leadOfShare(entities: any, searchId: string, leadId: string) {
  const lead = await entities.Lead.findUnique({
    where: { id: leadId },
    include: { search: { select: { id: true, companyId: true } } },
  });
  if (!lead || lead.search.id !== searchId) throw new HttpError(403);
  return lead;
}

/** Les droits reçus du formulaire, réduits aux seules clés connues. */
function parseSharePermissions(raw: unknown): LeadSharePermissions | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'Droits invalides');
  return coerceSharePermissions(raw as Record<string, unknown>);
}

/** Ce que l'écran de partage relit : le lien et ses droits, toujours complets. */
function shareTokenView(row: any) {
  return row ? { ...row, permissions: normalizeSharePermissions(row.permissions) } : row;
}

// ─── createLeadShareToken (auth) ──────────────────────────────────────────────

/**
 * Crée le lien, ou le régénère.
 *
 * Régénérer sans préciser de droits garde ceux de l'ancien lien : on change
 * d'adresse parce qu'elle a fuité, pas pour rendre à l'employé ce qu'on lui
 * avait retiré.
 */
export const createLeadShareToken = async (
  { searchId, label, permissions }: { searchId: string; label?: string; permissions?: Partial<LeadSharePermissions> },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const search = await context.entities.LeadSearch.findUnique({ where: { id: searchId } });
  if (!search || search.companyId !== companyId) throw new HttpError(404);

  const chosen = parseSharePermissions(permissions);

  // Upsert: if a token already exists for this search, regenerate it by deleting and creating
  const existing = await (context.entities as any).LeadSearchShareToken.findUnique({ where: { searchId } });
  if (existing) {
    await (context.entities as any).LeadSearchShareToken.delete({ where: { id: existing.id } });
  }

  const created = await (context.entities as any).LeadSearchShareToken.create({
    data: {
      companyId,
      searchId,
      token: generateShareToken(),
      label: label?.trim() || null,
      permissions: chosen ?? normalizeSharePermissions(existing?.permissions ?? FULL_SHARE_PERMISSIONS),
    },
  });
  return shareTokenView(created);
};

// ─── updateLeadShareToken (auth) ──────────────────────────────────────────────

/** Change les droits d'un lien déjà envoyé, sans changer son adresse. */
export const updateLeadShareToken = async (
  { searchId, permissions }: { searchId: string; permissions: Partial<LeadSharePermissions> },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const shareToken = await (context.entities as any).LeadSearchShareToken.findUnique({ where: { searchId } });
  if (!shareToken || shareToken.companyId !== companyId) throw new HttpError(404);
  const chosen = parseSharePermissions(permissions);
  if (!chosen) throw new HttpError(400, 'Droits manquants');
  const updated = await (context.entities as any).LeadSearchShareToken.update({
    where: { id: shareToken.id },
    data: { permissions: chosen },
  });
  return shareTokenView(updated);
};

// ─── revokeLeadShareToken (auth) ──────────────────────────────────────────────

export const revokeLeadShareToken = async (
  { searchId }: { searchId: string },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const shareToken = await (context.entities as any).LeadSearchShareToken.findUnique({ where: { searchId } });
  if (!shareToken || shareToken.companyId !== companyId) throw new HttpError(404);
  const updated = await (context.entities as any).LeadSearchShareToken.update({
    where: { id: shareToken.id },
    data: { isRevoked: true },
  });
  return shareTokenView(updated);
};

// ─── getLeadSearchByToken (public – no auth) ──────────────────────────────────

export const getLeadSearchByToken = async (
  { token }: { token: string },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  const { perms } = shareToken;
  const search = await context.entities.LeadSearch.findUnique({
    where: { id: shareToken.searchId },
    include: { leads: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
  });
  if (!search) throw new HttpError(404);

  // Ceux du tableau partagé, pas ceux de l'entreprise : un employé qui reçoit le
  // lien doit voir exactement les colonnes que voit son patron.
  const statusConfigs = await effectiveStatusConfigs(
    context.entities,
    search.companyId,
    search.id,
  );

  // Les mêmes indications que la fiche de l'application, droit par droit : un
  // lien sans courriel ne voit pas qu'un courriel est parti, un lien sans notes
  // ne voit pas qu'il en existe.
  const flags = await leadContactFlags(context.entities, search.companyId, (search as any).leads);
  let history = new Map<string, any[]>();
  if (perms.history) {
    try {
      const labels = statusLabelCache(context.entities, search.companyId);
      history = await prospectHistory(context.entities, search.companyId, (search as any).leads, labels.get);
    } catch (err) {
      console.error('[prospection] historique des prospects indisponible', err);
    }
  }
  const leadsWithFlags = (search as any).leads.map((l: any) => {
    const f = flags.get(l.id)!;
    return {
      ...l,
      notes: perms.notes ? l.notes : null,
      noteCount: perms.notes ? f.noteCount : 0,
      hasNotes: perms.notes && f.hasNotes,
      hasEmailSent: perms.email && f.hasEmailSent,
      hasEmailDraft: perms.email && f.hasEmailDraft,
      hasSmsSent: perms.sms && f.hasSmsSent,
      smsUnreadCount: perms.sms ? f.smsUnreadCount : 0,
      hasSmsReply: perms.sms && f.hasSmsReply,
      history: history.get(l.id) ?? [],
    };
  });

  // Le portail n'est pas authentifié, donc il ne peut pas interroger le registre
  // des provenances lui-même. Sans ces lignes, la pastille d'une carte afficherait
  // `salon_habitation_2026` dès qu'un appel entrant invente une provenance — soit
  // exactement les tableaux qu'on partage le plus.
  const sourceConfigs = await effectiveSourceConfigs(context.entities, search.companyId);

  // Ceux du tableau partagé, pour la même raison que les statuts : un employé qui
  // reçoit le lien doit voir exactement les cartes que voit son patron.
  const cardFields = await effectiveCardFieldConfigs(context.entities, search.companyId, search.id);

  return {
    search: {
      id: search.id,
      title: search.title,
      description: (search as any).description,
      purpose: (search as any).purpose ?? null,
      // La nature du tableau décide des réglages offerts : « Source » pour un
      // webhook, « Critères » pour une recherche Google.
      kind: (search as any).kind ?? null,
      filters: (search as any).filters,
    },
    leads: leadsWithFlags,
    statusConfigs,
    sourceConfigs,
    cardFields,
    permissions: perms,
  };
};

// ─── updateLeadByToken (public – no auth) ────────────────────────────────────

/**
 * Le statut relève du droit « déplacer », tout le reste du droit « modifier » :
 * on peut confier le suivi d'un tableau sans confier ses coordonnées.
 */
export const updateLeadByToken = async (
  { token, leadId, ...rest }: {
    token: string;
    leadId: string;
    status?: string;
    name?: string;
    phone?: string;
    email?: string;
    website?: string;
    address?: string;
    category?: string;
    source?: string;
    extras?: { key?: string; label?: string; value?: string }[];
  },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  const lead = await leadOfShare(context.entities, shareToken.searchId, leadId);

  const updateData: any = {};
  if (rest.status !== undefined) {
    requireSharePermission(shareToken.perms, 'move');
    updateData.status = rest.status;
    updateData.statusUpdatedAt = new Date();
  }
  const editsInfo = (['name', 'phone', 'email', 'website', 'address', 'category', 'source', 'extras'] as const)
    .some(k => rest[k] !== undefined);
  if (editsInfo) requireSharePermission(shareToken.perms, 'edit');
  if (rest.name !== undefined) {
    const name = rest.name.trim();
    if (!name) throw new HttpError(400, 'Le nom est requis');
    updateData.name = name;
  }
  if (rest.phone !== undefined) updateData.phone = rest.phone || null;
  if (rest.email !== undefined) updateData.email = rest.email || null;
  if (rest.website !== undefined) updateData.website = rest.website || null;
  if (rest.address !== undefined) updateData.address = rest.address || null;
  if (rest.category !== undefined) updateData.category = rest.category || null;
  if (rest.source !== undefined) {
    updateData.source = await requireKnownSource(context.entities, lead.search.companyId, rest.source);
  }
  if (rest.extras !== undefined) updateData.extras = normalizeLeadExtras(rest.extras);

  return context.entities.Lead.update({ where: { id: leadId }, data: updateData });
};

// ─── createLeadByToken (public – no auth) ────────────────────────────────────

export const createLeadByToken = async (
  { token, ...args }: { token: string } & Omit<ManualLeadInput, 'searchId'>,
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'add');
  // La colonne d'arrivée est un déplacement comme un autre : sans ce droit, le
  // prospect atterrit dans la première colonne, celle de tout nouveau venu.
  const status = shareToken.perms.move ? args.status : undefined;
  return insertManualLead(context.entities, shareToken.companyId, {
    ...args,
    status,
    searchId: shareToken.searchId,
  });
};

// ─── markLeadViewedByToken (public – no auth) ────────────────────────────────

/**
 * Ouvrir la fiche depuis le lien vaut « vu », comme dans l'application : c'est
 * ce qui annule l'alerte d'arrivée. Aucun droit requis — lire la fiche est ce
 * que tout lien permet.
 */
export const markLeadViewedByToken = async (
  { token, leadId }: { token: string; leadId: string },
  context: any,
): Promise<{ ok: true; marked: boolean }> => {
  const shareToken = await validateShareToken(token, context.entities);
  const { count } = await (context.entities as any).Lead.updateMany({
    where: { id: leadId, viewedAt: null, searchId: shareToken.searchId },
    data: { viewedAt: new Date() },
  });
  return { ok: true, marked: count > 0 };
};

// ─── reorderLeadsByToken (public – no auth) ──────────────────────────────────

export const reorderLeadsByToken = async (
  { token, status, orderedIds }: { token: string; status: string; orderedIds: string[] },
  context: any,
): Promise<{ ok: true }> => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'move');
  await applyLeadOrder(context.entities, shareToken.searchId, status, orderedIds);
  return { ok: true };
};

// ─── deleteLeadByToken (public – no auth) ────────────────────────────────────

export const deleteLeadByToken = async (
  { token, leadId }: { token: string; leadId: string },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'delete');
  const lead = await leadOfShare(context.entities, shareToken.searchId, leadId);
  await archiveBeforeDelete(context.entities, shareToken.companyId, { id: leadId }, 'lead_deleted');
  await context.entities.Lead.delete({ where: { id: leadId } });
  await syncTotalFound(context.entities, lead.searchId);
  return { deleted: true };
};

// ─── addLeadNoteByToken (public – no auth) ────────────────────────────────────

export const addLeadNoteByToken = async (
  { token, leadId, text }: { token: string; leadId: string; text: string },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'writeNotes');
  const lead = await leadOfShare(context.entities, shareToken.searchId, leadId);
  if (!text?.trim()) throw new HttpError(400, 'Le texte est requis');

  const identifier = lead.placeId ?? lead.id;
  return (context.entities as any).LeadNote.create({
    data: {
      companyId: lead.search.companyId,
      identifier,
      text: text.trim(),
    },
  });
};

// ─── getLeadNotesByToken (public – no auth) ───────────────────────────────────

export const getLeadNotesByToken = async (
  { token, leadId }: { token: string; leadId: string },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'notes');
  const lead = await leadOfShare(context.entities, shareToken.searchId, leadId);

  const identifier = lead.placeId ?? lead.id;
  return (context.entities as any).LeadNote.findMany({
    where: { companyId: lead.search.companyId, identifier },
    orderBy: { createdAt: 'asc' },
  });
};

// ─── deleteLeadNoteByToken (public – no auth) ─────────────────────────────────

/**
 * La note doit appartenir à un prospect du tableau partagé, pas seulement à
 * l'entreprise : sinon un lien vers un tableau pourrait effacer, par son
 * identifiant, une note laissée sur n'importe quel autre.
 */
export const deleteLeadNoteByToken = async (
  { token, noteId }: { token: string; noteId: string },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'writeNotes');
  const note = await (context.entities as any).LeadNote.findUnique({ where: { id: noteId } });
  if (!note || note.companyId !== shareToken.companyId) throw new HttpError(404);
  const onBoard = await context.entities.Lead.count({
    where: {
      searchId: shareToken.searchId,
      OR: [{ placeId: note.identifier }, { id: note.identifier }],
    },
  });
  if (!onBoard) throw new HttpError(403);
  await (context.entities as any).LeadNote.delete({ where: { id: noteId } });
  return { deleted: true };
};

// ─── getLeadShareToken (auth) ──────────────────────────────────────────────────

export const getLeadShareToken = async (
  { searchId }: { searchId: string },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const search = await context.entities.LeadSearch.findUnique({ where: { id: searchId } });
  if (!search || search.companyId !== companyId) throw new HttpError(404);
  return shareTokenView(await (context.entities as any).LeadSearchShareToken.findUnique({ where: { searchId } }));
};

// ─── Réglages du tableau par lien (public – no auth) ──────────────────────────
//
// Chaque opération ci-dessous vérifie le lien et son droit, ramène la portée au
// seul tableau partagé, puis confie le travail à l'opération de l'application :
// une seule implémentation des règles (statut réservé, colonne orpheline, jeu de
// champs complet…), et le lien ne peut jamais viser la portée entreprise ni un
// autre tableau — c'est tout l'enjeu, les opérations de l'application acceptant
// l'une et l'autre.

/**
 * Le contexte prêté à l'opération de l'application : l'entreprise du lien, avec
 * le rôle administrateur que ces réglages exigent dans l'application. Sans
 * identifiant d'utilisateur — aucune des opérations déléguées n'en lit un.
 *
 * Ce rôle ne sort jamais d'une opération déjà ramenée au tableau du lien et
 * gardée par son droit : c'est le propriétaire qui l'a accordé en cochant la case.
 */
function shareActor(shareToken: { companyId: string }, entities: any) {
  return { user: { companyId: shareToken.companyId, role: 'admin' }, entities };
}

/**
 * La version « lien » d'une opération de l'application qui porte sur un tableau.
 *
 * Vérifie le lien et son droit, remplace le `searchId` reçu par celui du lien —
 * c'est ce qui empêche de viser un autre tableau —, puis exécute l'opération de
 * l'application. À réserver aux opérations dont tout le reste des arguments est
 * déjà rapporté au tableau par l'opération elle-même (journal d'une source, par
 * exemple) ; celles qui prennent l'identifiant d'une ligne ont leur version
 * écrite à la main, avec la vérification qui va avec.
 */
export function viaShareLink<R>(
  permission: LeadSharePermissionKey | LeadSharePermissionKey[] | null,
  impl: (args: any, context: any) => Promise<R>,
) {
  return async ({ token, searchId: _ignored, ...args }: { token: string; searchId?: string; [k: string]: unknown }, context: any): Promise<R> => {
    const shareToken = await validateShareToken(token, context.entities);
    if (permission) requireSharePermission(shareToken.perms, permission);
    return impl({ ...args, searchId: shareToken.searchId }, shareActor(shareToken, context.entities));
  };
}

/** Une ligne de statut, à condition qu'elle appartienne aux statuts propres du tableau. */
async function boardStatusRow(entities: any, searchId: string, id: string) {
  const row = await entities.LeadStatusConfig.findUnique({ where: { id } });
  // Un statut d'entreprise s'applique à tous les tableaux qui le suivent : le
  // modifier depuis un lien changerait des colonnes que ce lien ne montre pas.
  if (!row || row.searchId !== searchId) throw new HttpError(403, 'Ce statut ne fait pas partie de ce tableau.');
  return row;
}

async function requireBoardOwnStatuses(entities: any, shareToken: any) {
  const own = await entities.LeadStatusConfig.count({
    where: { companyId: shareToken.companyId, searchId: shareToken.searchId },
  });
  if (!own) throw new HttpError(400, "Ce tableau suit les statuts de l'entreprise : personnalisez-les d'abord.");
}

export const overrideBoardStatusesByToken = async ({ token }: { token: string }, context: any) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'statuses');
  return overrideBoardStatuses({ searchId: shareToken.searchId }, shareActor(shareToken, context.entities));
};

export const resetBoardStatusesByToken = async ({ token }: { token: string }, context: any) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'statuses');
  return resetBoardStatuses({ searchId: shareToken.searchId }, shareActor(shareToken, context.entities));
};

export const createLeadStatusConfigByToken = async (
  { token, key, label, color, order }: { token: string; key: string; label: string; color: string; order: number },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'statuses');
  // Ajouter une seule colonne à un tableau qui suit l'entreprise lui donnerait
  // un jeu propre réduit à cette colonne : tous ses prospects tomberaient dans
  // « Statut inconnu ». L'écran demande donc de personnaliser d'abord.
  await requireBoardOwnStatuses(context.entities, shareToken);
  return (createLeadStatusConfig as any)(
    { key, label, color, order, searchId: shareToken.searchId },
    shareActor(shareToken, context.entities),
  );
};

export const updateLeadStatusConfigByToken = async (
  { token, id, label, color, order }: { token: string; id: string; label?: string; color?: string; order?: number },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'statuses');
  await boardStatusRow(context.entities, shareToken.searchId, id);
  return (updateLeadStatusConfig as any)({ id, label, color, order }, shareActor(shareToken, context.entities));
};

export const deleteLeadStatusConfigByToken = async ({ token, id }: { token: string; id: string }, context: any) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'statuses');
  await boardStatusRow(context.entities, shareToken.searchId, id);
  return (deleteLeadStatusConfig as any)({ id }, shareActor(shareToken, context.entities));
};

export const reorderLeadStatusConfigsByToken = async (
  { token, items }: { token: string; items: { id: string; order: number }[] },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'statuses');
  for (const item of items ?? []) await boardStatusRow(context.entities, shareToken.searchId, item.id);
  return reorderLeadStatusConfigs({ items }, shareActor(shareToken, context.entities));
};

export const saveLeadCardFieldsByToken = async (
  { token, fields }: { token: string; fields: { key: string; label: string; onCard: boolean; onDetail?: boolean }[] },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  // La correspondance d'une source déclare aussi les champs des cartes.
  requireSharePermission(shareToken.perms, ['cardFields', 'source']);
  return saveLeadCardFields({ searchId: shareToken.searchId, fields }, shareActor(shareToken, context.entities));
};

export const resetLeadCardFieldsByToken = async ({ token }: { token: string }, context: any) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'cardFields');
  return resetLeadCardFields({ searchId: shareToken.searchId }, shareActor(shareToken, context.entities));
};

/** Un modèle, à condition qu'il soit de ce tableau. */
async function boardTemplate(entities: any, searchId: string, id: string) {
  const row = await entities.ProspectTemplate.findUnique({ where: { id } });
  if (!row || row.searchId !== searchId) throw new HttpError(403, 'Ce modèle ne fait pas partie de ce tableau.');
  return row;
}

export const getProspectTemplatesByToken = async ({ token }: { token: string }, context: any) => {
  const shareToken = await validateShareToken(token, context.entities);
  // Lire les modèles sert aussi à écrire : celui qui envoie s'en sert.
  requireSharePermission(shareToken.perms, ['templates', 'email', 'sms']);
  return getProspectTemplates({ searchId: shareToken.searchId }, shareActor(shareToken, context.entities));
};

export const upsertProspectTemplateByToken = async (
  { token, ...args }: {
    token: string;
    id?: string | null;
    channel?: string;
    name: string;
    subject?: string;
    body: string;
    defaultStatus?: string | null;
  },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'templates');
  if (args.id) await boardTemplate(context.entities, shareToken.searchId, args.id);
  return upsertProspectTemplate({ ...args, searchId: shareToken.searchId }, shareActor(shareToken, context.entities));
};

export const deleteProspectTemplateByToken = async ({ token, id }: { token: string; id: string }, context: any) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'templates');
  await boardTemplate(context.entities, shareToken.searchId, id);
  return deleteProspectTemplate({ id }, shareActor(shareToken, context.entities));
};

/**
 * Ce que l'aperçu d'un modèle affiche : nom, courriel et signature de
 * l'entreprise, adresse d'expédition. Une sélection, jamais la fiche entreprise
 * entière — elle porte des identifiants SMTP et Telnyx.
 */
export const getTemplateContextByToken = async ({ token }: { token: string }, context: any) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, ['templates', 'email', 'sms']);
  const company = await context.entities.Company.findUnique({
    where: { id: shareToken.companyId },
    select: {
      name: true, email: true, brandEmailSignature: true, copySentEmailsToCompany: true,
      smtpHost: true, smtpPort: true, smtpUsername: true, smtpPassword: true,
      smtpFromName: true, smtpFromEmail: true,
    },
  });
  const smtp = companySmtp(company);
  return {
    company: company ? { name: company.name, email: company.email, brandEmailSignature: company.brandEmailSignature } : null,
    sender: { fromEmail: smtp?.fromEmail ?? '', fromName: smtp?.fromName ?? '' },
    copyToCompany: smtp?.copyTo ?? null,
  };
};

export const exportLeadsByToken = async ({ token }: { token: string }, context: any) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'export');
  return leadsCsv(context.entities, shareToken.companyId, shareToken.searchId, { withNotes: shareToken.perms.notes });
};

// Lectures dont le portail a besoin hors de sa charge initiale (la source les
// relit après avoir déclaré un champ) : rien de plus que ce que le lien montre déjà.
export const getLeadCardFieldsByToken = viaShareLink(null, getLeadCardFields);
export const getLeadSourceConfigsByToken = viaShareLink(null, getLeadSourceConfigs);

export const fetchMoreLeadsByToken = viaShareLink('criteria', fetchMoreLeads);

// ─── Courriels, SMS et historique par lien (public – no auth) ─────────────────
//
// La fiche d'un lien montre ce que montre celle de l'application, droit par droit.
// Chaque opération qui porte sur un prospect par sa clé (`identifier` : placeId,
// sinon l'id de la carte) vérifie d'abord que cette clé est celle d'une carte du
// tableau partagé : sans cela, un lien pourrait lire ou écrire la conversation
// de n'importe quel prospect de l'entreprise.

async function requireBoardIdentifier(entities: any, shareToken: { searchId: string }, identifier: string) {
  const onBoard = await entities.Lead.count({
    where: { searchId: shareToken.searchId, OR: [{ placeId: identifier }, { id: identifier }] },
  });
  if (!onBoard) throw new HttpError(403, "Ce prospect n'est pas sur ce tableau.");
}

/** Vérifie le lien, le droit et la clé, puis exécute l'opération de l'application. */
function viaShareIdentifier<R>(
  permission: LeadSharePermissionKey | LeadSharePermissionKey[],
  impl: (args: any, context: any) => Promise<R>,
) {
  return async ({ token, ...args }: { token: string; identifier: string; [k: string]: unknown }, context: any): Promise<R> => {
    const shareToken = await validateShareToken(token, context.entities);
    requireSharePermission(shareToken.perms, permission);
    await requireBoardIdentifier(context.entities, shareToken, String(args.identifier ?? ''));
    return impl(args, shareActor(shareToken, context.entities));
  };
}

export const getLeadEmailLogsByToken = viaShareIdentifier('email', getLeadEmailLogs);
export const getLeadEmailDraftByToken = viaShareIdentifier('email', getLeadEmailDraft);
export const saveLeadEmailDraftByToken = viaShareIdentifier('email', saveLeadEmailDraft);
export const sendProspectEmailByToken = viaShareIdentifier('email', sendProspectEmail);
export const getLeadSmsLogsByToken = viaShareIdentifier('sms', getLeadSmsLogs);
export const markLeadSmsReadByToken = viaShareIdentifier('sms', markLeadSmsRead);

/** Le SMS porte aussi la carte : elle doit être sur le tableau, et la clé être la sienne. */
export const sendProspectSmsByToken = async (
  { token, ...args }: { token: string; identifier: string; leadId: string; to: string; body: string },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'sms');
  const lead = await leadOfShare(context.entities, shareToken.searchId, args.leadId);
  if ((lead.placeId ?? lead.id) !== args.identifier) throw new HttpError(403);
  return sendProspectSms(args, shareActor(shareToken, context.entities));
};

/**
 * Ce que l'envoi permet, vu d'un lien : comme dans l'application, sans jamais
 * proposer de configurer — un visiteur sans compte n'a pas accès aux réglages.
 */
export const getEmailCapabilityByToken = async ({ token }: { token: string }, context: any) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'email');
  const cap: any = await (getEmailCapability as any)({}, shareActor(shareToken, context.entities));
  return { ...cap, canConfigure: false };
};

export const getSmsCapabilityByToken = async ({ token }: { token: string }, context: any) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'sms');
  const cap: any = await (getSmsCapability as any)({}, shareActor(shareToken, context.entities));
  return { ...cap, canConfigure: false };
};

/**
 * Les notes d'une fiche passée (historique), en lecture. La clé doit figurer dans
 * l'historique d'une carte du tableau : un lien ne lit pas les notes d'un prospect
 * qui n'a rien à voir avec lui.
 */
export const getPastNotesByToken = async ({ token, identifier }: { token: string; identifier: string }, context: any) => {
  const shareToken = await validateShareToken(token, context.entities);
  requireSharePermission(shareToken.perms, 'history');
  requireSharePermission(shareToken.perms, 'notes');
  const leads = await context.entities.Lead.findMany({
    where: { searchId: shareToken.searchId },
    select: { id: true, searchId: true, placeId: true, phone: true, email: true },
  });
  const labels = statusLabelCache(context.entities, shareToken.companyId);
  const history = await prospectHistory(context.entities, shareToken.companyId, leads, labels.get);
  const known = [...history.values()].flat().some(h => h.identifier === identifier);
  if (!known) throw new HttpError(403);
  return context.entities.LeadNote.findMany({
    where: { companyId: shareToken.companyId, identifier },
    orderBy: { createdAt: 'asc' },
  });
};

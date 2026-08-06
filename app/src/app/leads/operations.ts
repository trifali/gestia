import { HttpError } from 'wasp/server';
import { randomBytes } from 'crypto';
import { sendEmailWithAttachment, companySmtp } from '../../server/mail';
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

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Attempt to extract an email from a business website (best-effort, no errors thrown).
async function extractEmailFromWebsite(websiteUrl: string): Promise<string> {
  const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
  const NOISE_DOMAINS = [
    'sentry.io', 'google.com', 'facebook.com', 'twitter.com', 'instagram.com',
    'example.com', 'wixpress.com', 'squarespace.com', 'wordpress.com',
    'cloudflare.com', 'googleapis.com', 'github.com', 'npmjs.com',
    'w3.org', 'schema.org', 'jquery.com', 'adobe.com', 'microsoft.com',
  ];

  function isNoise(email: string): boolean {
    return NOISE_DOMAINS.some(d => email.toLowerCase().includes('@' + d));
  }

  function firstEmail(html: string): string {
    // Prefer mailto: links first
    const mailtoRe = /mailto:([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/gi;
    let m = mailtoRe.exec(html);
    while (m) {
      if (!isNoise(m[1])) return m[1].toLowerCase();
      m = mailtoRe.exec(html);
    }
    // Fall back to plain email pattern
    let m2 = EMAIL_RE.exec(html);
    while (m2) {
      if (!isNoise(m2[0])) return m2[0].toLowerCase();
      m2 = EMAIL_RE.exec(html);
    }
    return '';
  }

  async function safeGet(url: string): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gestia/1.0; +https://gestia.app)' },
        redirect: 'follow',
      });
      clearTimeout(timer);
      if (!r.ok) return '';
      const ct = r.headers.get('content-type') ?? '';
      if (!ct.includes('text') && !ct.includes('html')) return '';
      return r.text();
    } catch {
      clearTimeout(timer);
      return '';
    }
  }

  try {
    const base = new URL(websiteUrl);
    // Try homepage first
    const homepageHtml = await safeGet(base.href);
    const fromHome = firstEmail(homepageHtml);
    if (fromHome) return fromHome;

    // Try /contact or /contact-us
    for (const path of ['/contact', '/contact-us', '/nous-joindre', '/coordonnees']) {
      const html = await safeGet(`${base.origin}${path}`);
      const found = firstEmail(html);
      if (found) return found;
    }
  } catch {
    // malformed URL or network error
  }
  return '';
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type SearchFilters = {
  businessType: string;
  city: string;
  province?: string;
  radius?: number;         // meters, default 10000
  minRating?: number;      // 0 | 3 | 4 | 4.5
  requireWebsite?: boolean;
  maxResults?: number;     // 10 | 20 | 40
  language?: string;       // fr | en
};

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
    include: { leads: { select: { id: true } } },
  }) as any;
};

export const getLeadSearchDetail: GetLeadSearchDetail<
  { searchId: string },
  LeadSearchWithLeads
> = async ({ searchId }, context) => {
  const companyId = ensureCompany(context.user);
  const search = await context.entities.LeadSearch.findUnique({
    where: { id: searchId },
    include: { leads: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
  });
  if (!search || search.companyId !== companyId) throw new HttpError(404);

  // Duplicate detection: find placeIds that appear in other searches of this company
  const placeIds = search.leads.map(l => l.placeId).filter(Boolean) as string[];
  const duplicates = placeIds.length
    ? await context.entities.Lead.findMany({
        where: {
          placeId: { in: placeIds },
          searchId: { not: searchId },
          search: { companyId },
        },
        select: { placeId: true, search: { select: { title: true } } },
      })
    : [];

  // Build a map: placeId → list of other search titles
  const dupMap = new Map<string, string[]>();
  for (const d of duplicates) {
    if (!d.placeId) continue;
    if (!dupMap.has(d.placeId)) dupMap.set(d.placeId, []);
    const title = (d as any).search?.title;
    if (title && !dupMap.get(d.placeId)!.includes(title)) {
      dupMap.get(d.placeId)!.push(title);
    }
  }

  const leadsWithDups = search.leads.map(l => ({
    ...l,
    duplicateSearchTitles: l.placeId ? (dupMap.get(l.placeId) ?? []) : [],
  }));

  // Attach note count + email flags (per placeId or lead.id)
  const identifiers = search.leads.map(l => l.placeId ?? l.id);
  const [noteCounts, emailedIdentifiers, draftIdentifiers, smsedIdentifiers, smsUnread, smsRepliedIdentifiers] = identifiers.length
    ? await Promise.all([
        (context.entities as any).LeadNote.groupBy({
          by: ['identifier'],
          where: { companyId, identifier: { in: identifiers } },
          _count: { id: true },
        }),
        (context.entities as any).LeadEmailLog.findMany({
          where: { companyId, identifier: { in: identifiers } },
          select: { identifier: true },
          distinct: ['identifier'],
        }),
        (context.entities as any).LeadEmailDraft.findMany({
          where: { companyId, identifier: { in: identifiers } },
          select: { identifier: true },
        }),
        (context.entities as any).LeadSmsLog.findMany({
          where: { companyId, identifier: { in: identifiers }, direction: 'outbound' },
          select: { identifier: true },
          distinct: ['identifier'],
        }),
        (context.entities as any).LeadSmsLog.groupBy({
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
        (context.entities as any).LeadSmsLog.findMany({
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

  const leadsWithFlags = leadsWithDups.map(l => ({
    ...l,
    noteCount: noteCountMap.get(l.placeId ?? l.id) ?? 0,
    hasNotes: noteCountMap.has(l.placeId ?? l.id),
    hasEmailSent: emailSet.has(l.placeId ?? l.id),
    hasEmailDraft: draftSet.has(l.placeId ?? l.id),
    hasSmsSent: smsSet.has(l.placeId ?? l.id),
    smsUnreadCount: smsUnreadMap.get(l.placeId ?? l.id) ?? 0,
    hasSmsReply: smsRepliedSet.has(l.placeId ?? l.id),
  }));

  return { ...search, leads: leadsWithFlags } as any;
};

// ─── Actions ──────────────────────────────────────────────────────────────────

export const searchLeads: SearchLeads<
  { title: string; description?: string; purpose?: string; filters: SearchFilters },
  LeadSearchWithLeads
> = async ({ title, description, purpose, filters }, context) => {
  const companyId = ensureCompany(context.user);

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new HttpError(
      500,
      'Clé API Google Places non configurée. Ajoutez GOOGLE_PLACES_API_KEY dans votre fichier .env.server.',
    );
  }

  const {
    businessType,
    city,
    province = 'QC',
    radius = 10000,
    minRating = 0,
    requireWebsite = false,
    maxResults = 20,
    language = 'fr',
  } = filters;

  if (!businessType?.trim()) throw new HttpError(400, 'Type d\'entreprise requis');
  if (!city?.trim()) throw new HttpError(400, 'Ville requise');

  // Build query string
  const queryStr = encodeURIComponent(`${businessType} ${city} ${province} Canada`);

  // Helper to get one page of text-search results
  async function getPage(pageToken?: string): Promise<{ results: any[]; nextPageToken?: string }> {
    let url = `${PLACES_BASE}/textsearch/json?query=${queryStr}&radius=${radius}&language=${language}&key=${apiKey}`;
    if (pageToken) url += `&pagetoken=${pageToken}`;
    const data = await fetchJson(url);
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new HttpError(502, `Google Places: ${data.status} — ${data.error_message ?? ''}`);
    }
    return { results: data.results ?? [], nextPageToken: data.next_page_token };
  }

  // Collect up to maxResults place stubs (max 3 pages × 20)
  let stubs: any[] = [];
  let pageToken: string | undefined;
  const pages = Math.min(Math.ceil(maxResults / 20), 3);

  for (let p = 0; p < pages && stubs.length < maxResults; p++) {
    if (p > 0 && pageToken) {
      // Google requires a short wait before using next_page_token
      await new Promise(r => setTimeout(r, 2000));
    }
    const { results, nextPageToken } = await getPage(pageToken);
    stubs.push(...results);
    pageToken = nextPageToken;
    if (!nextPageToken) break;
  }

  stubs = stubs.slice(0, maxResults);

  // For each stub, fetch place details (in parallel, batches of 5)
  async function getDetails(placeId: string): Promise<any> {
    const fields = [
      'name', 'formatted_address', 'formatted_phone_number',
      'website', 'rating', 'user_ratings_total', 'geometry',
      'types', 'business_status', 'url', 'opening_hours',
    ].join('%2C');
    const url = `${PLACES_BASE}/details/json?place_id=${placeId}&fields=${fields}&language=${language}&key=${apiKey}`;
    const data = await fetchJson(url);
    return data.result ?? {};
  }

  async function batchRun<T>(items: T[], fn: (item: T) => Promise<any>, batchSize = 5): Promise<any[]> {
    const results: any[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const settled = await Promise.allSettled(batch.map(fn));
      results.push(...settled.map(s => (s.status === 'fulfilled' ? s.value : null)));
    }
    return results;
  }

  const details = await batchRun(stubs, (s: any) => getDetails(s.place_id));

  // Merge stubs + details, filter, scrape emails
  type RawLead = {
    name: string;
    address?: string;
    phone?: string;
    website?: string;
    email?: string;
    rating?: number;
    reviewCount?: number;
    category?: string;
    placeId?: string;
    mapsUrl?: string;
    latitude?: number;
    longitude?: number;
    isOpen?: boolean;
  };

  let rawLeads: RawLead[] = (stubs
    .map((stub: any, i: number) => {
      const d = details[i] ?? {};
      const rating = d.rating ?? stub.rating ?? null;
      if (minRating > 0 && (rating === null || rating < minRating)) return null;
      const website = d.website ?? null;
      if (requireWebsite && !website) return null;
      const raw: RawLead = {
        name: d.name ?? stub.name,
        address: d.formatted_address ?? stub.formatted_address ?? undefined,
        phone: d.formatted_phone_number ?? undefined,
        website: website ?? undefined,
        rating: rating ?? undefined,
        reviewCount: d.user_ratings_total ?? stub.user_ratings_total ?? undefined,
        category: (d.types ?? stub.types ?? [])[0]?.replace(/_/g, ' ') ?? undefined,
        placeId: stub.place_id ?? undefined,
        mapsUrl: d.url ?? undefined,
        latitude: d.geometry?.location?.lat ?? stub.geometry?.location?.lat ?? undefined,
        longitude: d.geometry?.location?.lng ?? stub.geometry?.location?.lng ?? undefined,
        isOpen: d.opening_hours?.open_now ?? stub.opening_hours?.open_now ?? undefined,
      };
      return raw;
    })
    .filter((l): l is RawLead => l !== null));

  // Scrape emails in parallel (batch 5), timeout per site
  const websitesForScraping = rawLeads.map(l => l.website ?? '');
  const emailResults = await batchRun(
    websitesForScraping,
    (url: string) => (url ? extractEmailFromWebsite(url) : Promise.resolve('')),
    5,
  );
  rawLeads = rawLeads.map((l, i) => ({ ...l, email: emailResults[i] || null }));

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
      title,
      description,
      purpose: purpose || null,
      filters: filters as any,
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
  { id: string; status?: string; notes?: string; email?: string; name?: string; phone?: string; website?: string; address?: string; category?: string; source?: string },
  Lead
> = async ({ id, status, notes, email, name, phone, website, address, category, source }, context) => {
  const companyId = ensureCompany(context.user);
  const lead = await context.entities.Lead.findUnique({
    where: { id },
    include: { search: { select: { companyId: true } } },
  });
  if (!lead || (lead as any).search.companyId !== companyId) throw new HttpError(404);

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
      ...(source !== undefined && { source }),
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
) => {
  const companyId = ensureCompany(context.user);
  const search = await context.entities.LeadSearch.findUnique({
    where: { id: searchId },
    include: { leads: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
  });
  if (!search || search.companyId !== companyId) throw new HttpError(404);

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
    (l as any).source ?? '',
    l.notes ?? '',
    l.mapsUrl ?? '',
  ]);

  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');
  return { csv };
};

// ─── Default statuses ─────────────────────────────────────────────────────────

export const UNKNOWN_STATUS_KEY = 'unknown';

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

// ─── Lead status config operations ───────────────────────────────────────────

export const getLeadStatusConfigs: GetLeadStatusConfigs<void, LeadStatusConfig[]> = async (_args, context) => {
  const companyId = ensureCompany(context.user);
  const configs = await (context.entities as any).LeadStatusConfig.findMany({
    where: { companyId },
    orderBy: { order: 'asc' },
  });
  if (configs.length === 0) {
    // Seed defaults on first access
    const created = await Promise.all(
      DEFAULT_STATUSES.map(s =>
        (context.entities as any).LeadStatusConfig.create({
          data: { companyId, ...s },
        })
      )
    );
    return [...created, VIRTUAL_UNKNOWN];
  }
  // Always append the virtual unknown column at the end
  return [...configs, VIRTUAL_UNKNOWN];
};

export const createLeadStatusConfig: CreateLeadStatusConfig<
  { key: string; label: string; color: string; order: number },
  LeadStatusConfig
> = async ({ key, label, color, order }, context) => {
  const companyId = ensureCompany(context.user);
  // Normalise key: lowercase, spaces to underscores, only alphanumeric/_
  const safeKey = key.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (!safeKey) throw new HttpError(400, 'Clé invalide');
  return (context.entities as any).LeadStatusConfig.create({
    data: { companyId, key: safeKey, label, color, order },
  });
};

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
  // Reassign leads with this status to 'unknown'
  await context.entities.Lead.updateMany({
    where: { status: config.key, search: { companyId } },
    data: { status: UNKNOWN_STATUS_KEY },
  });
  await (context.entities as any).LeadStatusConfig.delete({ where: { id } });
  return { id };
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

  const html = `<div style="font-family: Arial, sans-serif; font-size: 14px; color:#1a1a1a; white-space: pre-wrap;">${args.body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')}</div>`;

  // Sender name/address, Reply-To and the optional Cci copy all come from the
  // company's SMTP configuration — the prospect answers to the company inbox,
  // never to the mailbox the message happened to be sent through.
  const fromName = smtp.fromName;
  const replyTo = smtp.replyTo ?? undefined;

  await sendEmailWithAttachment({
    smtp,
    to,
    cc: args.cc?.trim() || undefined,
    subject: args.subject.trim(),
    text: args.body,
    html,
    clientFacing: true,
  });

  // Log the sent email
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
  { searchId, radiusOverride }: { searchId: string; radiusOverride?: number },
  context: any,
): Promise<{ added: number; exhausted: boolean; nextExpandedRadiusKm: number }> => {
  const companyId = ensureCompany(context.user);

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new HttpError(500, 'Clé API Google Places non configurée.');

  const search = await context.entities.LeadSearch.findUnique({
    where: { id: searchId },
    include: { leads: { select: { placeId: true, name: true } } },
  });
  if (!search || search.companyId !== companyId) throw new HttpError(404);

  const filters = search.filters as SearchFilters;
  const {
    businessType,
    city,
    province = 'QC',
    radius = 10000,
    minRating = 0,
    requireWebsite = false,
    maxResults = 20,
    language = 'fr',
  } = filters;

  // Build dedup sets from existing leads
  const existingPlaceIds = new Set(
    (search.leads as any[]).map((l: any) => l.placeId).filter(Boolean),
  );
  const existingNames = new Set(
    (search.leads as any[]).map((l: any) => l.name.toLowerCase()),
  );

  const queryStr = encodeURIComponent(`${businessType} ${city} ${province} Canada`);
  const searchRadius = radiusOverride ?? radius;
  const nextExpandedM = Math.min(Math.round(searchRadius * 2.5), 50000);

  async function fetchAllPages(searchRadius: number): Promise<any[]> {
    const results: any[] = [];
    let token: string | undefined;
    for (let p = 0; p < 3; p++) {
      if (p > 0 && token) await new Promise(r => setTimeout(r, 2000));
      let url = `${PLACES_BASE}/textsearch/json?query=${queryStr}&radius=${searchRadius}&language=${language}&key=${apiKey}`;
      if (token) url += `&pagetoken=${token}`;
      const data = await fetchJson(url);
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') break;
      results.push(...(data.results ?? []));
      token = data.next_page_token;
      if (!token) break;
    }
    return results;
  }

  function filterNew(stubs: any[]): any[] {
    return stubs.filter((s: any) => {
      if (s.place_id && existingPlaceIds.has(s.place_id)) return false;
      if (!s.place_id && existingNames.has((s.name ?? '').toLowerCase())) return false;
      return true;
    });
  }

  const allStubs = await fetchAllPages(searchRadius);
  const newStubs = filterNew(allStubs).slice(0, maxResults);
  const exhausted = newStubs.length === 0;

  if (exhausted) return { added: 0, exhausted: true, nextExpandedRadiusKm: nextExpandedM / 1000 };

  async function getDetails(placeId: string): Promise<any> {
    const fields = [
      'name', 'formatted_address', 'formatted_phone_number',
      'website', 'rating', 'user_ratings_total', 'geometry',
      'types', 'business_status', 'url', 'opening_hours',
    ].join('%2C');
    const url = `${PLACES_BASE}/details/json?place_id=${placeId}&fields=${fields}&language=${language}&key=${apiKey}`;
    const data = await fetchJson(url);
    return data.result ?? {};
  }

  async function batchRun<T>(items: T[], fn: (item: T) => Promise<any>, batchSize = 5): Promise<any[]> {
    const results: any[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const settled = await Promise.allSettled(batch.map(fn));
      results.push(...settled.map(s => (s.status === 'fulfilled' ? s.value : null)));
    }
    return results;
  }

  const details = await batchRun(newStubs, (s: any) => getDetails(s.place_id));

  type RawLead = {
    name: string; address?: string; phone?: string; website?: string;
    email?: string; rating?: number; reviewCount?: number; category?: string;
    placeId?: string; mapsUrl?: string; latitude?: number; longitude?: number; isOpen?: boolean;
  };

  let rawLeads: RawLead[] = newStubs
    .map((stub: any, i: number) => {
      const d = details[i] ?? {};
      const rating = d.rating ?? stub.rating ?? null;
      if (minRating > 0 && (rating === null || rating < minRating)) return null;
      const website = d.website ?? null;
      if (requireWebsite && !website) return null;
      const resolvedName = (d.name ?? stub.name ?? '').toLowerCase();
      if (existingNames.has(resolvedName)) return null;
      return {
        name: d.name ?? stub.name,
        address: d.formatted_address ?? stub.formatted_address ?? undefined,
        phone: d.formatted_phone_number ?? undefined,
        website: website ?? undefined,
        rating: rating ?? undefined,
        reviewCount: d.user_ratings_total ?? stub.user_ratings_total ?? undefined,
        category: (d.types ?? stub.types ?? [])[0]?.replace(/_/g, ' ') ?? undefined,
        placeId: stub.place_id ?? undefined,
        mapsUrl: d.url ?? undefined,
        latitude: d.geometry?.location?.lat ?? stub.geometry?.location?.lat ?? undefined,
        longitude: d.geometry?.location?.lng ?? stub.geometry?.location?.lng ?? undefined,
        isOpen: d.opening_hours?.open_now ?? stub.opening_hours?.open_now ?? undefined,
      } as RawLead;
    })
    .filter((l): l is RawLead => l !== null);

  // Scrape emails
  const emailResults = await batchRun(
    rawLeads.map(l => l.website ?? ''),
    (url: string) => (url ? extractEmailFromWebsite(url) : Promise.resolve('')),
    5,
  );
  rawLeads = rawLeads.map((l, i) => ({ ...l, email: emailResults[i] || null }));

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

  // Update totalFound
  await context.entities.LeadSearch.update({
    where: { id: searchId },
    data: { totalFound: { increment: rawLeads.length } },
  });

  return { added: rawLeads.length, exhausted: false, nextExpandedRadiusKm: nextExpandedM / 1000 };
};

// ─── createLead (manual entry) ────────────────────────────────────────────────

export const createLead = async (
  args: {
    searchId: string;
    name: string;
    phone?: string;
    email?: string;
    website?: string;
    address?: string;
    category?: string;
    status?: string;
    source?: string;
  },
  context: any,
): Promise<any> => {
  const companyId = ensureCompany(context.user);
  const search = await context.entities.LeadSearch.findUnique({ where: { id: args.searchId } });
  if (!search || search.companyId !== companyId) throw new HttpError(404);

  const name = args.name?.trim();
  if (!name) throw new HttpError(400, "Le nom de l'entreprise est requis");

  const status = args.status?.trim() || 'nouveau';
  const clean = (v?: string) => {
    const t = v?.trim();
    return t ? t : null;
  };

  // Land on top of its column so a freshly added prospect is the first thing
  // seen. Orders are re-normalised to 0..n-1 by applyLeadOrder on the next
  // drag, so going negative here is safe.
  const first = await context.entities.Lead.findFirst({
    where: { searchId: args.searchId, status },
    orderBy: { order: 'asc' },
    select: { order: true },
  });

  return context.entities.Lead.create({
    data: {
      searchId: args.searchId,
      name,
      phone: clean(args.phone),
      email: clean(args.email),
      website: clean(args.website),
      address: clean(args.address),
      category: clean(args.category),
      status,
      source: args.source?.trim() || 'manual',
      statusUpdatedAt: new Date(),
      order: (first?.order ?? 0) - 1,
    },
  });
};

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
  await context.entities.Lead.delete({ where: { id: leadId } });
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
  // ids belonging to another company are simply never matched.
  const { count } = await context.entities.Lead.deleteMany({
    where: { id: { in: ids }, search: { companyId } },
  });
  return { deleted: count };
};

// ─── Share token helpers ──────────────────────────────────────────────────────

function generateShareToken(): string {
  return randomBytes(24).toString('hex');
}

async function validateShareToken(token: string, entities: any) {
  const shareToken = await (entities as any).LeadSearchShareToken.findUnique({ where: { token } });
  if (!shareToken || shareToken.isRevoked) throw new HttpError(403, 'Lien invalide ou révoqué');
  // Update lastUsedAt
  await (entities as any).LeadSearchShareToken.update({
    where: { id: shareToken.id },
    data: { lastUsedAt: new Date() },
  });
  return shareToken;
}

// ─── createLeadShareToken (auth) ──────────────────────────────────────────────

export const createLeadShareToken = async (
  { searchId, label }: { searchId: string; label?: string },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const search = await context.entities.LeadSearch.findUnique({ where: { id: searchId } });
  if (!search || search.companyId !== companyId) throw new HttpError(404);

  // Upsert: if a token already exists for this search, regenerate it by deleting and creating
  const existing = await (context.entities as any).LeadSearchShareToken.findUnique({ where: { searchId } });
  if (existing) {
    await (context.entities as any).LeadSearchShareToken.delete({ where: { id: existing.id } });
  }

  return (context.entities as any).LeadSearchShareToken.create({
    data: {
      companyId,
      searchId,
      token: generateShareToken(),
      label: label?.trim() || null,
    },
  });
};

// ─── revokeLeadShareToken (auth) ──────────────────────────────────────────────

export const revokeLeadShareToken = async (
  { searchId }: { searchId: string },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  const shareToken = await (context.entities as any).LeadSearchShareToken.findUnique({ where: { searchId } });
  if (!shareToken || shareToken.companyId !== companyId) throw new HttpError(404);
  return (context.entities as any).LeadSearchShareToken.update({
    where: { id: shareToken.id },
    data: { isRevoked: true },
  });
};

// ─── getLeadSearchByToken (public – no auth) ──────────────────────────────────

export const getLeadSearchByToken = async (
  { token }: { token: string },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  const search = await context.entities.LeadSearch.findUnique({
    where: { id: shareToken.searchId },
    include: { leads: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
  });
  if (!search) throw new HttpError(404);

  const statusConfigs = await (context.entities as any).LeadStatusConfig.findMany({
    where: { companyId: search.companyId },
    orderBy: { order: 'asc' },
  });

  // Attach note counts
  const identifiers = (search as any).leads.map((l: any) => l.placeId ?? l.id);
  const noteCounts = identifiers.length
    ? await (context.entities as any).LeadNote.groupBy({
        by: ['identifier'],
        where: { companyId: search.companyId, identifier: { in: identifiers } },
        _count: { id: true },
      })
    : [];
  const noteCountMap = new Map<string, number>((noteCounts as any[]).map((n: any) => [n.identifier, n._count.id]));

  const leadsWithFlags = (search as any).leads.map((l: any) => ({
    ...l,
    noteCount: noteCountMap.get(l.placeId ?? l.id) ?? 0,
    hasNotes: noteCountMap.has(l.placeId ?? l.id),
  }));

  return {
    search: {
      id: search.id,
      title: search.title,
      description: (search as any).description,
      filters: (search as any).filters,
    },
    leads: leadsWithFlags,
    statusConfigs,
  };
};

// ─── updateLeadByToken (public – no auth) ────────────────────────────────────

export const updateLeadByToken = async (
  { token, leadId, ...rest }: { token: string; leadId: string; status?: string; name?: string; phone?: string; email?: string; website?: string; address?: string; category?: string },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  const lead = await context.entities.Lead.findUnique({
    where: { id: leadId },
    include: { search: { select: { id: true } } },
  });
  if (!lead || lead.search.id !== shareToken.searchId) throw new HttpError(403);

  const updateData: any = {};
  if (rest.status !== undefined) {
    updateData.status = rest.status;
    updateData.statusUpdatedAt = new Date();
  }
  if (rest.name !== undefined) updateData.name = rest.name;
  if (rest.phone !== undefined) updateData.phone = rest.phone || null;
  if (rest.email !== undefined) updateData.email = rest.email || null;
  if (rest.website !== undefined) updateData.website = rest.website || null;
  if (rest.address !== undefined) updateData.address = rest.address || null;
  if (rest.category !== undefined) updateData.category = rest.category || null;

  return context.entities.Lead.update({ where: { id: leadId }, data: updateData });
};

// ─── reorderLeadsByToken (public – no auth) ──────────────────────────────────

export const reorderLeadsByToken = async (
  { token, status, orderedIds }: { token: string; status: string; orderedIds: string[] },
  context: any,
): Promise<{ ok: true }> => {
  const shareToken = await validateShareToken(token, context.entities);
  await applyLeadOrder(context.entities, shareToken.searchId, status, orderedIds);
  return { ok: true };
};

// ─── deleteLeadByToken (public – no auth) ────────────────────────────────────

export const deleteLeadByToken = async (
  { token, leadId }: { token: string; leadId: string },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  const lead = await context.entities.Lead.findUnique({
    where: { id: leadId },
    include: { search: { select: { id: true } } },
  });
  if (!lead || lead.search.id !== shareToken.searchId) throw new HttpError(403);
  await context.entities.Lead.delete({ where: { id: leadId } });
  return { deleted: true };
};

// ─── addLeadNoteByToken (public – no auth) ────────────────────────────────────

export const addLeadNoteByToken = async (
  { token, leadId, text }: { token: string; leadId: string; text: string },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  const lead = await context.entities.Lead.findUnique({
    where: { id: leadId },
    include: { search: { select: { id: true, companyId: true } } },
  });
  if (!lead || lead.search.id !== shareToken.searchId) throw new HttpError(403);
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
  const lead = await context.entities.Lead.findUnique({
    where: { id: leadId },
    include: { search: { select: { id: true, companyId: true } } },
  });
  if (!lead || lead.search.id !== shareToken.searchId) throw new HttpError(403);

  const identifier = lead.placeId ?? lead.id;
  return (context.entities as any).LeadNote.findMany({
    where: { companyId: lead.search.companyId, identifier },
    orderBy: { createdAt: 'asc' },
  });
};

// ─── deleteLeadNoteByToken (public – no auth) ─────────────────────────────────

export const deleteLeadNoteByToken = async (
  { token, noteId }: { token: string; noteId: string },
  context: any,
) => {
  const shareToken = await validateShareToken(token, context.entities);
  const note = await (context.entities as any).LeadNote.findUnique({ where: { id: noteId } });
  if (!note) throw new HttpError(404);
  // Verify the note belongs to the correct search by checking companyId matches token's search
  const search = await context.entities.LeadSearch.findUnique({ where: { id: shareToken.searchId } });
  if (!search || search.companyId !== note.companyId) throw new HttpError(403);
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
  return (context.entities as any).LeadSearchShareToken.findUnique({ where: { searchId } });
};

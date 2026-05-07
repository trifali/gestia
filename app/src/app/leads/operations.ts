import { HttpError } from 'wasp/server';
import type {
  GetLeadSearches,
  GetLeadSearchDetail,
  SearchLeads,
  UpdateLead,
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
    include: { leads: { orderBy: { createdAt: 'asc' } } },
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

  return { ...search, leads: leadsWithDups } as any;
};

// ─── Actions ──────────────────────────────────────────────────────────────────

export const searchLeads: SearchLeads<
  { title: string; description?: string; filters: SearchFilters },
  LeadSearchWithLeads
> = async ({ title, description, filters }, context) => {
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
      filters: filters as any,
      status: 'done',
      totalFound: rawLeads.length,
      leads: {
        create: rawLeads.map(l => {
          const saved = l.placeId ? statusMap.get(l.placeId) : undefined;
          return {
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
    include: { leads: { orderBy: { createdAt: 'asc' } } },
  });

  return savedSearch as any;
};

export const updateLead: UpdateLead<
  { id: string; status?: string; notes?: string; email?: string; name?: string; phone?: string; website?: string; address?: string; category?: string },
  Lead
> = async ({ id, status, notes, email, name, phone, website, address, category }, context) => {
  const companyId = ensureCompany(context.user);
  const lead = await context.entities.Lead.findUnique({
    where: { id },
    include: { search: { select: { companyId: true } } },
  });
  if (!lead || (lead as any).search.companyId !== companyId) throw new HttpError(404);

  const updated = await context.entities.Lead.update({
    where: { id },
    data: {
      ...(status !== undefined && { status }),
      ...(notes !== undefined && { notes }),
      ...(email !== undefined && { email }),
      ...(name !== undefined && { name }),
      ...(phone !== undefined && { phone }),
      ...(website !== undefined && { website }),
      ...(address !== undefined && { address }),
      ...(category !== undefined && { category }),
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

// Returns serialised CSV string for the client to download
export const exportLeads: ExportLeads<{ searchId: string }, { csv: string }> = async (
  { searchId },
  context,
) => {
  const companyId = ensureCompany(context.user);
  const search = await context.entities.LeadSearch.findUnique({
    where: { id: searchId },
    include: { leads: { orderBy: { createdAt: 'asc' } } },
  });
  if (!search || search.companyId !== companyId) throw new HttpError(404);

  const headers = ['Nom', 'Catégorie', 'Adresse', 'Téléphone', 'Courriel', 'Site web', 'Note', 'Avis', 'Statut', 'Notes', 'Google Maps'];
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
    l.notes ?? '',
    l.mapsUrl ?? '',
  ]);

  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');
  return { csv };
};

// ─── Default statuses ─────────────────────────────────────────────────────────

const DEFAULT_STATUSES = [
  { key: 'nouveau',  label: 'Nouveau',  color: '#3b82f6', order: 0 },
  { key: 'contacte', label: 'Contacté', color: '#f59e0b', order: 1 },
  { key: 'qualifie', label: 'Qualifié',  color: '#10b981', order: 2 },
  { key: 'rejete',   label: 'Rejeté',   color: '#ef4444', order: 3 },
];

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
    return created;
  }
  return configs;
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
  // Reassign leads with this status to 'nouveau'
  await context.entities.Lead.updateMany({
    where: { status: config.key, search: { companyId } },
    data: { status: 'nouveau' },
  });
  await (context.entities as any).LeadStatusConfig.delete({ where: { id } });
  return { id };
};

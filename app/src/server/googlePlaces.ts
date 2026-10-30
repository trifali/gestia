// Recherche d'entreprises sur Google Maps (API Places), pour les tableaux de
// prospection — à la création (`searchLeads`) comme pour « Chercher plus » et
// les nouvelles recherches d'un tableau existant (`fetchMoreLeads`).
//
// Pourquoi un moteur plutôt que deux boucles : les deux chemins dupliquaient la
// même requête, et partageaient les mêmes défauts.
//
//   · Le rayon n'était jamais appliqué. La recherche textuelle de Google ignore
//     `radius` sans `location` ; on situe donc d'abord la ville, puis on cherche
//     autour d'elle et on écarte ce qui tombe hors du cercle — Google ne fait que
//     *favoriser* la zone, il n'en exclut rien.
//   · Les filtres passaient après la collecte : demander 20 entreprises notées
//     4+ en rendait parfois 6. On continue maintenant de parcourir les pages
//     jusqu'à atteindre le nombre demandé, ou le bout de ce que Google rend.
//   · La note est vérifiée avant de demander la fiche détaillée : chaque fiche
//     est facturée, et la note figure déjà dans le résultat de recherche.

import { HttpError } from 'wasp/server';
import { provinceName, type GoogleSearchCriteria } from '../shared/googleSearch';

export const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

/**
 * Le numéro d'une fiche Google, dans une forme que Telnyx pourra composer.
 *
 * `formatted_phone_number` est au format *local* du pays : « (514) 574-2228 »
 * au Québec, mais « 01 42 68 53 00 » en France et « 020 7946 0958 » au
 * Royaume-Uni. Sans indicatif pays, `toE164` applique sa règle nord-américaine
 * et fabrique un numéro faux — mais valide : le français devient
 * `+10142685300`, que plus rien en aval ne peut détecter comme erroné.
 *
 * `international_phone_number` porte l'indicatif (« +33 1 42 68 53 00 ») : le
 * « + » suffit à désarmer la règle des dix chiffres, pour tous les pays d'un
 * coup. On le stocke tel quel — lisible pour un humain, et sans ambiguïté pour
 * `toE164`. Le format local ne sert que de repli quand Google ne le fournit pas.
 */
export function placePhone(d: any): string | undefined {
  const intl = (d?.international_phone_number ?? '').trim();
  if (intl) return intl;
  return (d?.formatted_phone_number ?? '').trim() || undefined;
}

export async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Attempt to extract an email from a business website (best-effort, no errors thrown).
export async function extractEmailFromWebsite(websiteUrl: string): Promise<string> {
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

// ─── Moteur ──────────────────────────────────────────────────────────────────

export type FoundPlace = {
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  email?: string | null;
  rating?: number;
  reviewCount?: number;
  category?: string;
  placeId?: string;
  mapsUrl?: string;
  latitude?: number;
  longitude?: number;
  isOpen?: boolean;
};

/** Ce que le moteur demande au monde extérieur — remplaçable dans les tests. */
export type PlacesDeps = {
  fetchJson: (url: string) => Promise<any>;
  wait: (ms: number) => Promise<void>;
  scrapeEmail: (website: string) => Promise<string>;
};

const DEFAULT_DEPS: PlacesDeps = {
  fetchJson,
  wait: ms => new Promise(r => setTimeout(r, ms)),
  scrapeEmail: extractEmailFromWebsite,
};

/** Une recherche textuelle rend au plus trois pages de vingt. */
const MAX_PAGES = 3;
/** Google exige une courte attente avant d'utiliser le jeton de la page suivante. */
const NEXT_PAGE_DELAY_MS = 2000;
/** Marge sur le rayon : une adresse à la limite reste dans la zone. */
const RADIUS_TOLERANCE = 1.1;

const DETAIL_FIELDS = [
  'name', 'formatted_address', 'formatted_phone_number', 'international_phone_number',
  'website', 'rating', 'user_ratings_total', 'geometry',
  'types', 'business_status', 'url', 'opening_hours',
].join('%2C');

/** Distance en mètres entre deux points (formule de haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function batchRun<T, R>(items: T[], fn: (item: T) => Promise<R>, size = 5): Promise<(R | null)[]> {
  const out: (R | null)[] = [];
  for (let i = 0; i < items.length; i += size) {
    const settled = await Promise.allSettled(items.slice(i, i + size).map(fn));
    out.push(...settled.map(s => (s.status === 'fulfilled' ? s.value : null)));
  }
  return out;
}

/**
 * Cherche les entreprises qui répondent aux critères.
 *
 * `exclude` écarte ce que le tableau (ou l'entreprise) connaît déjà — par
 * identifiant Google, et par nom pour les fiches sans identifiant. `radius`
 * remplace celui des critères (« Élargir à 25 km »).
 *
 * `located` est faux quand la ville n'a pas pu être située : la recherche se
 * fait alors sans zone, comme avant, plutôt que d'échouer.
 */
export async function findPlaces(
  criteria: GoogleSearchCriteria,
  opts: {
    apiKey: string;
    exclude?: { placeIds: Set<string>; names: Set<string> };
    radius?: number;
    deps?: Partial<PlacesDeps>;
  },
): Promise<{ places: FoundPlace[]; located: boolean }> {
  const deps = { ...DEFAULT_DEPS, ...opts.deps };
  const { apiKey } = opts;
  const radius = opts.radius ?? criteria.radius;
  const lang = criteria.language;
  const excludedIds = opts.exclude?.placeIds ?? new Set<string>();
  const excludedNames = opts.exclude?.names ?? new Set<string>();

  // 1. Situer la ville.
  const where = `${criteria.city}, ${provinceName(criteria.province)}, Canada`;
  let center: { lat: number; lng: number } | null = null;
  try {
    const found = await deps.fetchJson(
      `${PLACES_BASE}/findplacefromtext/json?input=${encodeURIComponent(where)}&inputtype=textquery&fields=geometry&language=${lang}&key=${apiKey}`,
    );
    const loc = found?.candidates?.[0]?.geometry?.location;
    if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') center = { lat: loc.lat, lng: loc.lng };
  } catch {
    // Sans centre, on cherche sans zone plutôt que de ne rien trouver.
  }

  const accepted: FoundPlace[] = [];
  const seen = new Set<string>();

  // 2. Parcourir chaque type, page par page, jusqu'à en avoir assez.
  for (const type of criteria.businessTypes) {
    if (accepted.length >= criteria.maxResults) break;
    const query = encodeURIComponent(`${type} ${criteria.city} ${criteria.province}`);
    const zone = center ? `&location=${center.lat},${center.lng}&radius=${radius}` : '';
    let token: string | undefined;

    for (let page = 0; page < MAX_PAGES && accepted.length < criteria.maxResults; page++) {
      if (page > 0) {
        if (!token) break;
        await deps.wait(NEXT_PAGE_DELAY_MS);
      }
      const url = `${PLACES_BASE}/textsearch/json?query=${query}${zone}&region=ca&language=${lang}&key=${apiKey}`
        + (token ? `&pagetoken=${token}` : '');
      const data = await deps.fetchJson(url);
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        // Une page suivante qui échoue n'annule pas ce qu'on a déjà ; une
        // toute première requête refusée (clé, quota) doit, elle, se voir.
        if (accepted.length === 0 && page === 0 && type === criteria.businessTypes[0]) {
          throw new HttpError(502, `Google Places : ${data.status}${data.error_message ? ` — ${data.error_message}` : ''}`);
        }
        break;
      }
      token = data.next_page_token;

      // Ce que le résultat de recherche permet déjà d'écarter, sans payer de fiche.
      const candidates = (data.results ?? []).filter((stub: any) => {
        const id = stub.place_id as string | undefined;
        const name = String(stub.name ?? '').toLowerCase();
        if (id ? excludedIds.has(id) || seen.has(id) : excludedNames.has(name) || seen.has(name)) return false;
        if (stub.business_status === 'CLOSED_PERMANENTLY') return false;
        if (criteria.minRating > 0 && (stub.rating == null || stub.rating < criteria.minRating)) return false;
        if (criteria.maxRating > 0) {
          if (stub.rating == null ? !criteria.includeUnrated : stub.rating > criteria.maxRating) return false;
        }
        const loc = stub.geometry?.location;
        if (center && loc && distanceMeters(center, loc) > radius * RADIUS_TOLERANCE) return false;
        return true;
      });
      candidates.forEach((stub: any) => seen.add(stub.place_id ?? String(stub.name ?? '').toLowerCase()));

      // La fiche détaillée tranche le reste : site web et téléphone.
      for (let i = 0; i < candidates.length && accepted.length < criteria.maxResults; i += 5) {
        const batch = candidates.slice(i, i + 5);
        const details = await batchRun(batch, (stub: any) =>
          deps.fetchJson(`${PLACES_BASE}/details/json?place_id=${stub.place_id}&fields=${DETAIL_FIELDS}&language=${lang}&key=${apiKey}`)
            .then((r: any) => r?.result ?? {}),
        );
        batch.forEach((stub: any, j: number) => {
          if (accepted.length >= criteria.maxResults) return;
          const d = details[j] ?? {};
          if (d.business_status === 'CLOSED_PERMANENTLY') return;
          const name = d.name ?? stub.name;
          if (!name || excludedNames.has(String(name).toLowerCase())) return;
          const website = d.website ?? undefined;
          if (criteria.website === 'with' && !website) return;
          if (criteria.website === 'without' && website) return;
          const phone = placePhone(d);
          if (criteria.requirePhone && !phone) return;
          accepted.push({
            name,
            address: d.formatted_address ?? stub.formatted_address ?? undefined,
            phone,
            website,
            rating: d.rating ?? stub.rating ?? undefined,
            reviewCount: d.user_ratings_total ?? stub.user_ratings_total ?? undefined,
            category: (d.types ?? stub.types ?? [])[0]?.replace(/_/g, ' ') ?? undefined,
            placeId: stub.place_id ?? undefined,
            mapsUrl: d.url ?? undefined,
            latitude: d.geometry?.location?.lat ?? stub.geometry?.location?.lat ?? undefined,
            longitude: d.geometry?.location?.lng ?? stub.geometry?.location?.lng ?? undefined,
            isOpen: d.opening_hours?.open_now ?? stub.opening_hours?.open_now ?? undefined,
          });
        });
      }
    }
  }

  // 3. Les courriels, à partir des sites web retenus.
  const emails = await batchRun(accepted, p => (p.website ? deps.scrapeEmail(p.website) : Promise.resolve('')));
  return {
    places: accepted.map((p, i) => ({ ...p, email: emails[i] || null })),
    located: center !== null,
  };
}

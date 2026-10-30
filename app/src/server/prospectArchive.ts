// La mémoire des prospects : ce qu'on garde quand une carte disparaît, et ce
// qu'on retrouve quand la même entreprise revient.
//
// Supprimer un prospect (ou un tableau entier) n'efface jamais sa trace : la
// fiche est recopiée dans `ProspectArchive` juste avant. Ses notes, courriels et
// SMS n'ont jamais été supprimés avec la carte — ils portent leur propre clé,
// `identifier` — mais sans la carte, plus rien ne permettait d'y remonter.
//
// À l'inverse, quand une entreprise arrive sur un tableau, on cherche si elle est
// déjà passée ailleurs : sur un autre tableau encore actif, ou dans l'archive.
// Trois façons de la reconnaître, de la plus sûre à la moins sûre : l'identifiant
// Google, le téléphone (normalisé — « (514) 555-0100 » et « +1 514-555-0100 »
// sont le même numéro), le courriel.

import { toE164 } from '../shared/phone';

export type ProspectHistoryEntry = {
  /** `board` : encore sur un autre tableau ; `archived` : retiré d'un tableau. */
  kind: 'board' | 'archived';
  searchId: string | null;
  boardTitle: string;
  status: string;
  statusLabel: string | null;
  /** Arrivée sur ce tableau-là. */
  addedAt: Date;
  /** Retrait du tableau (archive seulement). */
  archivedAt: Date | null;
  /** lead_deleted | board_deleted (archive seulement). */
  reason: string | null;
  /** La clé des notes, courriels et SMS de cette fiche-là. */
  identifier: string;
  matchedBy: 'google' | 'phone' | 'email';
  emails: number;
  smsSent: number;
  smsReplies: number;
  notes: number;
};

type LeadKeys = { placeId?: string | null; phone?: string | null; email?: string | null };

export function prospectKeys(l: LeadKeys) {
  return {
    placeId: l.placeId?.trim() || null,
    phone: l.phone ? toE164(l.phone) : null,
    email: l.email?.trim().toLowerCase() || null,
  };
}

function matchedBy(a: ReturnType<typeof prospectKeys>, b: ReturnType<typeof prospectKeys>): ProspectHistoryEntry['matchedBy'] | null {
  if (a.placeId && a.placeId === b.placeId) return 'google';
  if (a.phone && a.phone === b.phone) return 'phone';
  if (a.email && a.email === b.email) return 'email';
  return null;
}

/** La clé que portent les notes, courriels et SMS d'une carte. */
export function leadIdentifier(l: { id: string; placeId?: string | null }): string {
  return l.placeId ?? l.id;
}

// ─── Archiver ────────────────────────────────────────────────────────────────

/**
 * Recopie des cartes dans l'archive, juste avant leur suppression.
 *
 * `boardTitle` et `statusLabel` sont lus par l'appelant, qui connaît le tableau
 * et ses statuts : ils sont figés ici tels qu'ils étaient ce jour-là.
 */
export async function archiveLeads(
  entities: any,
  companyId: string,
  leads: any[],
  {
    reason,
    boardTitle,
    statusLabel,
  }: {
    reason: 'lead_deleted' | 'board_deleted';
    boardTitle: (searchId: string) => string;
    statusLabel: (searchId: string, status: string) => string | null;
  },
): Promise<number> {
  if (leads.length === 0) return 0;
  const rows = leads.map(l => {
    const keys = prospectKeys(l);
    const { search: _search, ...snapshot } = l;
    return {
      companyId,
      identifier: leadIdentifier(l),
      placeId: keys.placeId,
      phone: keys.phone ?? (l.phone?.trim() || null),
      email: keys.email,
      name: l.name,
      searchId: l.searchId ?? null,
      boardTitle: boardTitle(l.searchId),
      status: l.status,
      statusLabel: statusLabel(l.searchId, l.status),
      source: l.source ?? 'google_maps',
      leadCreatedAt: l.createdAt ?? new Date(),
      reason,
      snapshot: JSON.parse(JSON.stringify(snapshot)),
    };
  });
  const { count } = await entities.ProspectArchive.createMany({ data: rows });
  return count;
}

// ─── Retrouver ───────────────────────────────────────────────────────────────

/**
 * Pour chaque carte, où l'entreprise est déjà passée : autres tableaux actifs et
 * archive, du plus récent au plus ancien, avec ce qui lui a été envoyé.
 *
 * Les autres cartes du même tableau ne comptent pas : ce sont des doublons, pas
 * un historique. Le tri se fait en mémoire — un téléphone ne se compare qu'une
 * fois normalisé, ce que la base ne sait pas faire — sur des colonnes légères.
 */
export async function prospectHistory(
  entities: any,
  companyId: string,
  leads: { id: string; searchId: string; placeId?: string | null; phone?: string | null; email?: string | null }[],
  statusLabel: (searchId: string, status: string) => Promise<string | null>,
): Promise<Map<string, ProspectHistoryEntry[]>> {
  const out = new Map<string, ProspectHistoryEntry[]>();
  if (leads.length === 0) return out;

  const targets = leads.map(l => ({ lead: l, keys: prospectKeys(l) })).filter(t => t.keys.placeId || t.keys.phone || t.keys.email);
  if (targets.length === 0) return out;
  const boardIds = new Set(leads.map(l => l.searchId));

  const [others, archived] = await Promise.all([
    entities.Lead.findMany({
      where: { search: { companyId }, searchId: { notIn: [...boardIds] } },
      select: {
        id: true, searchId: true, placeId: true, phone: true, email: true, status: true, createdAt: true,
        search: { select: { title: true } },
      },
    }),
    entities.ProspectArchive.findMany({
      where: { companyId },
      select: {
        identifier: true, searchId: true, placeId: true, phone: true, email: true, status: true, statusLabel: true,
        boardTitle: true, leadCreatedAt: true, archivedAt: true, reason: true,
      },
    }),
  ]);
  const candidates = [
    ...others.map((o: any) => ({ row: o, kind: 'board' as const, keys: prospectKeys(o) })),
    ...archived.map((a: any) => ({ row: a, kind: 'archived' as const, keys: prospectKeys(a) })),
  ].filter(c => c.keys.placeId || c.keys.phone || c.keys.email);

  const found = new Map<string, { c: (typeof candidates)[number]; by: ProspectHistoryEntry['matchedBy'] }[]>();
  for (const t of targets) {
    for (const c of candidates) {
      if (c.kind === 'board' && c.row.searchId === t.lead.searchId) continue;
      const by = matchedBy(t.keys, c.keys);
      if (!by) continue;
      if (!found.has(t.lead.id)) found.set(t.lead.id, []);
      found.get(t.lead.id)!.push({ c, by });
    }
  }
  if (found.size === 0) return out;

  // Ce qui a été envoyé à chacune de ces fiches.
  const identifiers = [...new Set([...found.values()].flat().map(({ c }) =>
    c.kind === 'board' ? leadIdentifier(c.row) : c.row.identifier))];
  const [emailCounts, smsCounts, noteCounts] = await Promise.all([
    entities.LeadEmailLog.groupBy({ by: ['identifier'], where: { companyId, identifier: { in: identifiers } }, _count: { id: true } }),
    entities.LeadSmsLog.groupBy({ by: ['identifier', 'direction'], where: { companyId, identifier: { in: identifiers } }, _count: { id: true } }),
    entities.LeadNote.groupBy({ by: ['identifier'], where: { companyId, identifier: { in: identifiers } }, _count: { id: true } }),
  ]);
  const count = (rows: any[], id: string, direction?: string) =>
    rows.filter(r => r.identifier === id && (!direction || r.direction === direction)).reduce((n, r) => n + r._count.id, 0);

  for (const [leadId, matches] of found) {
    const entries: ProspectHistoryEntry[] = [];
    for (const { c, by } of matches) {
      const identifier = c.kind === 'board' ? leadIdentifier(c.row) : c.row.identifier;
      entries.push({
        kind: c.kind,
        searchId: c.row.searchId ?? null,
        boardTitle: c.kind === 'board' ? c.row.search?.title ?? '' : c.row.boardTitle,
        status: c.row.status,
        statusLabel: c.kind === 'board' ? await statusLabel(c.row.searchId, c.row.status) : c.row.statusLabel ?? null,
        addedAt: c.kind === 'board' ? c.row.createdAt : c.row.leadCreatedAt,
        archivedAt: c.kind === 'archived' ? c.row.archivedAt : null,
        reason: c.kind === 'archived' ? c.row.reason : null,
        identifier,
        matchedBy: by,
        emails: count(emailCounts, identifier),
        smsSent: count(smsCounts, identifier, 'outbound'),
        smsReplies: count(smsCounts, identifier, 'inbound'),
        notes: count(noteCounts, identifier),
      });
    }
    entries.sort((a, b) => +new Date(b.archivedAt ?? b.addedAt) - +new Date(a.archivedAt ?? a.addedAt));
    out.set(leadId, entries);
  }
  return out;
}

/** Une entrée d'historique compte comme « contacté » dès qu'un message est parti. */
export function wasContacted(e: Pick<ProspectHistoryEntry, 'emails' | 'smsSent'>): boolean {
  return e.emails > 0 || e.smsSent > 0;
}

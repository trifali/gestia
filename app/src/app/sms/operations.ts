// Boîte SMS universelle.
//
// Réunit tous les fils SMS de l'entreprise — prospects, prospects supprimés,
// numéros inconnus — au-dessus de la table LeadSmsLog existante. Aucune seconde
// table de conversation : `identifier` y est déjà une chaîne opaque, à laquelle
// on ajoute simplement la convention `tel:+15145550100` pour les fils qui ne
// sont rattachés à aucun prospect (voir server/sms.ts).
//
// À part du module leads/ parce que la boîte n'est pas un outil de prospection :
// elle sert aussi à écrire à un client, à un fournisseur ou à un numéro qui vient
// de nous écrire.

import { HttpError } from 'wasp/server';
import { prisma } from 'wasp/server';
import {
  sendSms,
  toE164,
  resolveSmsCredentials,
  directIdentifier,
  parseDirectIdentifier,
  isDirectIdentifier,
} from '../../server/sms';
import {
  findClientsByE164,
  findLeadsByE164,
  MAX_DIRECTORY_SCAN,
} from '../../server/smsDirectory';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

/**
 * La boîte est opt-in : tant que l'interrupteur est éteint, aucune de ses
 * opérations ne répond. Le widget est masqué côté client, mais c'est ici que la
 * décision est réellement appliquée.
 */
async function ensureInbox(context: any): Promise<{ companyId: string; company: any }> {
  const companyId = ensureCompany(context.user);
  const company = await context.entities.Company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      smsInboxEnabled: true,
      telnyxPhoneNumber: true,
      telnyxApiKey: true,
    },
  });
  if (!company?.smsInboxEnabled) {
    throw new HttpError(403, 'La boîte SMS est désactivée. Activez-la dans Paramètres → Intégrations.');
  }
  return { companyId, company };
}

/** Le numéro de l'interlocuteur : nous sommes toujours l'autre bout du message. */
function counterpartNumber(row: { direction: string; to: string; fromNumber: string }): string {
  return row.direction === 'inbound' ? row.fromNumber : row.to;
}

// ─── Liste des conversations ─────────────────────────────────────────────────

export type SmsConversation = {
  identifier: string;
  kind: 'lead' | 'number';
  /** E.164 joignable, ou null pour un code court / expéditeur alphanumérique. */
  phone: string | null;
  /** L'interlocuteur tel qu'il apparaît dans les messages, toujours affichable. */
  address: string;
  displayName: string | null; // null : le client affiche le numéro
  lastBody: string;
  lastDirection: 'inbound' | 'outbound';
  lastStatus: string | null;
  lastMessageAt: string;
  unreadCount: number;
  messageCount: number;
  leadId: string | null;
  searchId: string | null;
};

const CONVERSATIONS_PAGE = 30;
const CONVERSATIONS_MAX = 100;

/**
 * Une page de conversations, la plus récente d'abord.
 *
 * Prisma ne sait pas exprimer « la dernière ligne de chaque groupe » : un
 * `groupBy` rend `_max: { createdAt }` mais pas la ligne, et la reconstituer
 * demanderait un OR de N couples (fragile en cas d'ex æquo à la milliseconde) ou
 * N requêtes. D'où le SQL brut, avec un LATERAL qui fait une recherche d'index
 * par fil de la page.
 */
export const getSmsConversations = async (
  args: { limit?: number; offset?: number } | void,
  context: any,
): Promise<{ items: SmsConversation[]; hasMore: boolean; unreadTotal: number }> => {
  const { companyId } = await ensureInbox(context);
  const limit = Math.min(Math.max(1, (args as any)?.limit ?? CONVERSATIONS_PAGE), CONVERSATIONS_MAX);
  const offset = Math.max(0, (args as any)?.offset ?? 0);

  // Les COUNT sont castés en int : un bigint remonterait en BigInt, que la
  // sérialisation JSON de la réponse refuse.
  const rows = await prisma.$queryRaw<any[]>`
    SELECT s."identifier",
           s."lastAt",
           s."total",
           s."unread",
           l."body",
           l."direction",
           l."status",
           l."to",
           l."fromNumber"
    FROM (
      SELECT "identifier",
             MAX("createdAt") AS "lastAt",
             COUNT(*)::int AS "total",
             COUNT(*) FILTER (WHERE "direction" = 'inbound' AND "readAt" IS NULL)::int AS "unread"
      FROM "LeadSmsLog"
      WHERE "companyId" = ${companyId}
      GROUP BY "identifier"
    ) s
    JOIN LATERAL (
      SELECT m."body", m."direction", m."status", m."to", m."fromNumber"
      FROM "LeadSmsLog" m
      WHERE m."companyId" = ${companyId} AND m."identifier" = s."identifier"
      ORDER BY m."createdAt" DESC, m."id" DESC
      LIMIT 1
    ) l ON true
    ORDER BY s."lastAt" DESC
    LIMIT ${limit + 1} OFFSET ${offset}
  `;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const unreadTotal = await (context.entities as any).LeadSmsLog.count({
    where: { companyId, direction: 'inbound', readAt: null },
  });

  if (!page.length) return { items: [], hasMore: false, unreadTotal };

  // Résolution des noms, en quelques requêtes bornées à la page — jamais une
  // requête par ligne.
  const leadIdentifiers = page.map(r => r.identifier).filter(id => !isDirectIdentifier(id));
  const directPhones = page
    .map(r => parseDirectIdentifier(r.identifier))
    .filter((p): p is string => !!p);

  const [contacts, leads] = await Promise.all([
    directPhones.length
      ? (context.entities as any).SmsContact.findMany({
          where: { companyId, phone: { in: directPhones } },
          select: { phone: true, name: true },
        })
      : Promise.resolve([]),
    leadIdentifiers.length
      ? context.entities.Lead.findMany({
          where: {
            search: { companyId },
            OR: [{ placeId: { in: leadIdentifiers } }, { id: { in: leadIdentifiers } }],
          },
          select: { id: true, placeId: true, name: true, searchId: true },
        })
      : Promise.resolve([]),
  ]);

  const contactByPhone = new Map<string, string>((contacts as any[]).map(c => [c.phone, c.name]));
  const leadByIdentifier = new Map<string, any>(
    (leads as any[]).map((l: any) => [l.placeId ?? l.id, l]),
  );

  // Reste les numéros directs sans contact nommé : on tente le carnet clients
  // puis les prospects, par téléphone. Deux requêtes pour toute la page.
  const unnamed = new Set(directPhones.filter(p => !contactByPhone.has(p)));
  const [clientHits, leadHits] = await Promise.all([
    findClientsByE164(context.entities, companyId, unnamed),
    findLeadsByE164(context.entities, companyId, unnamed),
  ]);
  const byPhoneName = new Map<string, string>();
  for (const hit of [...leadHits, ...clientHits]) byPhoneName.set(hit.phone, hit.name);

  const items: SmsConversation[] = page.map(r => {
    // Un fil autonome tient son numéro de son identifiant ; un fil de prospect,
    // du dernier message — nous sommes toujours l'autre bout.
    const phone = isDirectIdentifier(r.identifier)
      ? parseDirectIdentifier(r.identifier)
      : counterpartNumber(r);
    const lead = leadByIdentifier.get(r.identifier);
    const displayName =
      lead?.name ??
      (phone ? contactByPhone.get(phone) ?? byPhoneName.get(phone) ?? null : null);

    return {
      identifier: r.identifier,
      kind: lead ? 'lead' : 'number',
      phone,
      address: counterpartNumber(r),
      displayName,
      lastBody: r.body ?? '',
      lastDirection: r.direction === 'inbound' ? 'inbound' : 'outbound',
      lastStatus: r.status ?? null,
      lastMessageAt: new Date(r.lastAt).toISOString(),
      unreadCount: Number(r.unread ?? 0),
      messageCount: Number(r.total ?? 0),
      leadId: lead?.id ?? null,
      searchId: lead?.searchId ?? null,
    };
  });

  return { items, hasMore, unreadTotal };
};

// ─── Envoi vers un numéro quelconque ─────────────────────────────────────────

const MAX_SMS_BODY = 1600;

/**
 * Envoie un SMS à n'importe quel numéro et le journalise dans le fil qui
 * convient — le fil existant si l'entreprise a déjà écrit à ce numéro, sinon une
 * conversation autonome. La résolution est faite ici et non côté client : sans
 * elle, écrire à un prospect depuis la boîte créerait un second fil pour le même
 * numéro, et l'attribution des réponses basculerait de l'un à l'autre.
 */
export const sendDirectSms = async (
  args: { to: string; body: string },
  context: any,
): Promise<{ ok: true; identifier: string; to: string }> => {
  const { companyId, company } = await ensureInbox(context);

  const text = (args.body ?? '').trim();
  if (!text) throw new HttpError(400, 'Message requis');
  if (text.length > MAX_SMS_BODY) {
    throw new HttpError(400, `Message trop long (${MAX_SMS_BODY} caractères maximum).`);
  }

  const to = toE164(args.to ?? '');
  if (!to) throw new HttpError(400, 'Numéro de téléphone invalide');

  const credentials = resolveSmsCredentials(company);
  if (!credentials) {
    throw new HttpError(
      400,
      'SMS non configuré. Ajoutez votre numéro et votre clé API Telnyx dans Paramètres → Intégrations.',
    );
  }
  if (to === credentials.from) {
    throw new HttpError(400, 'Vous ne pouvez pas envoyer un SMS à votre propre numéro Telnyx.');
  }

  // Même règle que le webhook : le fil retenu est celui depuis lequel on a écrit
  // à ce numéro le plus récemment.
  const lastOutbound = await (context.entities as any).LeadSmsLog.findFirst({
    where: { companyId, to, direction: 'outbound' },
    orderBy: { createdAt: 'desc' },
    select: { identifier: true },
  });
  const identifier: string = lastOutbound?.identifier ?? directIdentifier(to);

  let providerId: string | null = null;
  try {
    ({ id: providerId } = await sendSms({ to, text, credentials }));
  } catch (e: any) {
    // Rien n'est journalisé : une ligne sortante fantôme corromprait
    // l'attribution des réponses à venir.
    throw new HttpError(502, e?.message || "Échec de l'envoi du SMS");
  }

  await (context.entities as any).LeadSmsLog.create({
    data: {
      companyId,
      identifier,
      to,
      fromNumber: credentials.from,
      body: text,
      providerId,
      direction: 'outbound',
      status: 'queued',
    },
  });

  return { ok: true, identifier, to };
};

// ─── Destinataires ───────────────────────────────────────────────────────────

export type SmsRecipient = {
  phone: string;
  name: string;
  source: 'contact' | 'client' | 'lead' | 'raw';
  sourceId: string | null;
  identifier: string;
  hasThread: boolean;
};

const MIN_QUERY = 2;
const MIN_DIGITS = 3;
const MAX_RESULTS = 20;

/**
 * Autocomplétion du champ « À » : contacts nommés, clients, prospects, et le
 * numéro saisi tel quel. Un numéro valide est toujours proposé même s'il ne
 * correspond à rien — c'est tout l'intérêt d'une boîte ouverte.
 */
export const searchSmsRecipients = async (
  { q }: { q: string },
  context: any,
): Promise<{ items: SmsRecipient[]; truncated: boolean }> => {
  const { companyId } = await ensureInbox(context);
  const term = (q ?? '').trim();
  if (term.length < MIN_QUERY) return { items: [], truncated: false };

  const found: SmsRecipient[] = [];
  let truncated = false;

  const rawNumber = toE164(term);
  if (rawNumber) {
    found.push({
      phone: rawNumber,
      name: rawNumber,
      source: 'raw',
      sourceId: null,
      identifier: directIdentifier(rawNumber),
      hasThread: false,
    });
  }

  const [contacts, clients, leads] = await Promise.all([
    (context.entities as any).SmsContact.findMany({
      where: { companyId, name: { contains: term, mode: 'insensitive' } },
      select: { id: true, name: true, phone: true },
      take: 10,
    }),
    context.entities.Client.findMany({
      where: {
        companyId,
        phone: { not: null },
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { contactName: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, phone: true },
      take: 10,
    }),
    context.entities.Lead.findMany({
      where: {
        search: { companyId },
        phone: { not: null },
        name: { contains: term, mode: 'insensitive' },
      },
      select: { id: true, name: true, phone: true, placeId: true },
      take: 10,
    }),
  ]);

  for (const c of contacts as any[]) {
    found.push({
      phone: c.phone,
      name: c.name,
      source: 'contact',
      sourceId: c.id,
      identifier: directIdentifier(c.phone),
      hasThread: false,
    });
  }
  for (const c of clients as any[]) {
    const e164 = toE164(c.phone ?? '');
    if (!e164) continue;
    found.push({
      phone: e164,
      name: c.name,
      source: 'client',
      sourceId: c.id,
      identifier: directIdentifier(e164),
      hasThread: false,
    });
  }
  for (const l of leads as any[]) {
    const e164 = toE164(l.phone ?? '');
    if (!e164) continue;
    found.push({
      phone: e164,
      name: l.name,
      source: 'lead',
      sourceId: l.id,
      // Écrire à un prospect rejoint son fil de prospection existant.
      identifier: l.placeId ?? l.id,
      hasThread: false,
    });
  }

  // Recherche par chiffres. Les téléphones de Client et Lead sont du texte libre :
  // « (514) 555-0100 » ne contient pas « 514555 ». D'où le balayage normalisé en
  // JS, borné, et signalé au client quand il a été tronqué.
  const needle = term.replace(/\D/g, '');
  if (needle.length >= MIN_DIGITS) {
    const [clientRows, leadRows] = await Promise.all([
      context.entities.Client.findMany({
        where: { companyId, phone: { not: null } },
        select: { id: true, name: true, phone: true },
        take: MAX_DIRECTORY_SCAN,
        orderBy: { name: 'asc' },
      }),
      context.entities.Lead.findMany({
        where: { search: { companyId }, phone: { not: null } },
        select: { id: true, name: true, phone: true, placeId: true },
        take: MAX_DIRECTORY_SCAN,
        orderBy: { name: 'asc' },
      }),
    ]);
    truncated =
      (clientRows as any[]).length === MAX_DIRECTORY_SCAN ||
      (leadRows as any[]).length === MAX_DIRECTORY_SCAN;

    for (const c of clientRows as any[]) {
      const e164 = toE164(c.phone ?? '');
      if (e164?.includes(needle)) {
        found.push({
          phone: e164,
          name: c.name,
          source: 'client',
          sourceId: c.id,
          identifier: directIdentifier(e164),
          hasThread: false,
        });
      }
    }
    for (const l of leadRows as any[]) {
      const e164 = toE164(l.phone ?? '');
      if (e164?.includes(needle)) {
        found.push({
          phone: e164,
          name: l.name,
          source: 'lead',
          sourceId: l.id,
          identifier: l.placeId ?? l.id,
          hasThread: false,
        });
      }
    }
  }

  // Dédoublonnage par numéro. L'ordre d'insertion porte la priorité : un contact
  // nommé à la main l'emporte sur un client, qui l'emporte sur un prospect ; le
  // numéro brut ferme la marche puisqu'il n'apporte aucun nom.
  const PRIORITY: Record<SmsRecipient['source'], number> = { contact: 0, client: 1, lead: 2, raw: 3 };
  const byPhone = new Map<string, SmsRecipient>();
  for (const r of found.sort((a, b) => PRIORITY[a.source] - PRIORITY[b.source])) {
    if (!byPhone.has(r.phone)) byPhone.set(r.phone, r);
  }
  const items = [...byPhone.values()].slice(0, MAX_RESULTS);

  if (items.length) {
    const identifiers = items.map(i => i.identifier);
    const existing = await (context.entities as any).LeadSmsLog.findMany({
      where: { companyId, identifier: { in: identifiers } },
      select: { identifier: true },
      distinct: ['identifier'],
    });
    const withThread = new Set((existing as any[]).map(e => e.identifier));
    for (const item of items) item.hasThread = withThread.has(item.identifier);
  }

  return { items, truncated };
};

// ─── Répertoire ──────────────────────────────────────────────────────────────

export const upsertSmsContact = async (
  args: { id?: string | null; phone: string; name: string; note?: string | null },
  context: any,
): Promise<{ id: string; phone: string; name: string; note: string | null }> => {
  // Pas `ensureInbox` : nommer un numéro reste inoffensif si la boîte est
  // éteinte, et le seul point d'entrée est de toute façon le widget.
  const companyId = ensureCompany(context.user);

  const phone = toE164(args.phone ?? '');
  if (!phone) throw new HttpError(400, 'Numéro de téléphone invalide');
  const name = (args.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Nom requis');
  const note = args.note?.trim() || null;

  try {
    if (args.id) {
      const existing = await (context.entities as any).SmsContact.findUnique({
        where: { id: args.id },
        select: { companyId: true },
      });
      if (!existing || existing.companyId !== companyId) throw new HttpError(404);
      return await (context.entities as any).SmsContact.update({
        where: { id: args.id },
        data: { phone, name, note },
        select: { id: true, phone: true, name: true, note: true },
      });
    }
    // Idempotent par numéro : « nommer ce numéro » deux fois corrige le nom au
    // lieu d'échouer.
    return await (context.entities as any).SmsContact.upsert({
      where: { companyId_phone: { companyId, phone } },
      update: { name, note },
      create: { companyId, phone, name, note },
      select: { id: true, phone: true, name: true, note: true },
    });
  } catch (err: any) {
    if (err instanceof HttpError) throw err;
    if (err?.code === 'P2002') {
      throw new HttpError(400, 'Un contact existe déjà pour ce numéro.');
    }
    throw err;
  }
};

export const deleteSmsContact = async (
  { id }: { id: string },
  context: any,
): Promise<{ deleted: true }> => {
  const companyId = ensureCompany(context.user);
  const existing = await (context.entities as any).SmsContact.findUnique({
    where: { id },
    select: { companyId: true },
  });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  // La conversation survit et retombe sur le numéro brut : aucune clé étrangère
  // ne lie le répertoire aux messages, volontairement.
  await (context.entities as any).SmsContact.delete({ where: { id } });
  return { deleted: true };
};

// ─── Suppression d'un fil ────────────────────────────────────────────────────

/**
 * Efface définitivement une conversation, c'est-à-dire tous les LeadSmsLog de
 * l'entreprise portant cet identifiant.
 *
 * Rien d'autre à nettoyer : il n'existe pas de table de conversation, un fil
 * n'est qu'un regroupement de messages. Les non-lus et les échéances d'alerte
 * partent donc avec les lignes — les pastilles retombent seules et la tâche
 * planifiée n'a plus rien à envoyer, sans qu'aucun appelant ait à filtrer quoi
 * que ce soit.
 *
 * Voir aussi clearLeadSmsSent (leads/operations.ts) : les deux seuls chemins qui
 * suppriment des LeadSmsLog.
 */
export const deleteSmsConversation = async (
  { identifier }: { identifier: string },
  context: any,
): Promise<{ deleted: number }> => {
  const { companyId } = await ensureInbox(context);
  const id = (identifier ?? '').trim();
  if (!id) throw new HttpError(400, 'Conversation requise');

  // Le compte tient lieu de contrôle d'appartenance : `identifier` n'a pas de
  // table à interroger, donc « existe-t-il des messages de cette entreprise sur
  // ce fil » est la seule question qui ait un sens — et l'identifiant d'une
  // autre entreprise y répond zéro, donc 404 comme partout ailleurs.
  const existing = await (context.entities as any).LeadSmsLog.count({
    where: { companyId, identifier: id },
  });
  if (!existing) throw new HttpError(404);

  // Le répertoire survit : aucune clé étrangère ne lie SmsContact aux messages,
  // volontairement (cf. deleteSmsContact ci-dessus). Effacer ce qu'une personne
  // a écrit n'efface pas son nom — si elle réécrit, le fil renaît déjà nommé.
  // deleteSmsContact reste la porte pour l'autre besoin.
  const { count } = await (context.entities as any).LeadSmsLog.deleteMany({
    where: { companyId, identifier: id },
  });
  return { deleted: count };
};

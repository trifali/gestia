import { HttpError } from 'wasp/server';
import type { GetPipelineDocuments, GetActivityFeed, AddActivityNote } from 'wasp/server/operations';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type PipelineDocument = {
  id: string;
  number: string;
  title: string | null;
  type: string;
  status: string;
  total: number;
  amountPaid: number;
  dueDate: Date | null;
  issueDate: Date;
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  noteCount: number;
};

export type ActivityFeedItem = {
  id: string;
  createdAt: Date;
  type: string;
  message: string;
  clientId: string | null;
  clientName: string | null;
  documentId: string | null;
  userId: string | null;
  userName: string | null;
};

// ─── Queries ───────────────────────────────────────────────────────────────

/**
 * Returns all quotes (every status) and all non-terminal invoices
 * (brouillon, envoyee, acompte_recu, en_retard).
 * This is the full pipeline view — quotes show the full funnel (including
 * refusée/expirée), invoices only show the unpaid ones.
 */
export const getPipelineDocuments: GetPipelineDocuments<void, PipelineDocument[]> = async (
  _,
  context,
) => {
  const companyId = ensureCompany(context.user);

  const docs = await context.entities.Document.findMany({
    where: {
      companyId,
      OR: [
        { type: 'quote' },
        { type: 'invoice', status: { notIn: ['payee', 'annulee'] } },
      ],
    },
    include: {
      client: true,
      activities: { where: { type: 'note' }, select: { id: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return (docs as any[]).map((d) => ({
    id: d.id,
    number: d.number,
    title: d.title,
    type: d.type,
    status: d.status,
    total: d.total,
    amountPaid: d.amountPaid,
    dueDate: d.dueDate,
    issueDate: d.issueDate,
    clientId: d.clientId,
    clientName: d.client.name,
    clientEmail: d.client.email,
    clientPhone: d.client.phone,
    noteCount: (d.activities as any[]).length,
  }));
};

/**
 * Company-wide activity log, optionally filtered by client.
 */
export const getActivityFeed: GetActivityFeed<
  { clientId?: string; documentId?: string; limit?: number },
  ActivityFeedItem[]
> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  const where: any = { companyId };
  if (args?.clientId) where.clientId = args.clientId;
  if (args?.documentId) where.documentId = args.documentId;

  const rows = await context.entities.ActivityLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: args?.limit ?? 100,
    include: {
      client: { select: { id: true, name: true } },
      user: { select: { id: true, fullName: true, email: true } },
    },
  });

  return (rows as any[]).map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    type: r.type,
    message: r.message,
    clientId: r.clientId,
    clientName: r.client?.name ?? null,
    documentId: r.documentId,
    userId: r.userId,
    userName: r.user?.fullName || r.user?.email || null,
  }));
};

// ─── Actions ──────────────────────────────────────────────────────────────

/**
 * Manually records a note in the activity log, optionally linked to a client.
 */
export const addActivityNote: AddActivityNote<
  { clientId?: string; documentId?: string; message: string },
  void
> = async (args, context) => {
  const companyId = ensureCompany(context.user);

  if (!args.message?.trim()) throw new HttpError(400, 'Le message est requis');

  if (args.clientId) {
    const client = await context.entities.Client.findFirst({
      where: { id: args.clientId, companyId },
    });
    if (!client) throw new HttpError(404, 'Client introuvable');
  }

  await context.entities.ActivityLog.create({
    data: {
      companyId,
      userId: context.user?.id ?? null,
      clientId: args.clientId ?? null,
      documentId: args.documentId ?? null,
      type: 'note',
      message: args.message.trim(),
    },
  });
};

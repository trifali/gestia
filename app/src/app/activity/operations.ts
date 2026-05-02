import { HttpError } from 'wasp/server';
import type { GetClientActivities } from 'wasp/server/operations';
import type { ActivityLog } from 'wasp/entities';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

type ClientActivity = ActivityLog & {
  user: { id: string; fullName: string | null; email: string | null } | null;
};

export const getClientActivities: GetClientActivities<{ clientId: string; limit?: number }, ClientActivity[]> = async (
  { clientId, limit },
  context,
) => {
  const companyId = ensureCompany(context.user);
  return context.entities.ActivityLog.findMany({
    where: { companyId, clientId },
    orderBy: { createdAt: 'desc' },
    take: limit ?? 50,
    include: {
      user: { select: { id: true, fullName: true, email: true } },
    },
  }) as any;
};

/**
 * Server-side helper to record an activity. Failures are swallowed so they
 * never break the parent action.
 */
export async function logActivity(
  entities: any,
  params: {
    companyId: string;
    userId?: string | null;
    clientId?: string | null;
    documentId?: string | null;
    type: string;
    message: string;
    metadata?: any;
  },
): Promise<void> {
  try {
    await entities.ActivityLog.create({
      data: {
        companyId: params.companyId,
        userId: params.userId ?? null,
        clientId: params.clientId ?? null,
        documentId: params.documentId ?? null,
        type: params.type,
        message: params.message,
        metadata: params.metadata ?? undefined,
      },
    });
  } catch (err) {
    // Never let logging crash the parent action.
    console.error('[activity] log failed', err);
  }
}

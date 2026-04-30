import { HttpError } from 'wasp/server';
import type { GetDashboardStats } from 'wasp/server/operations';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

export type DashboardStats = {
  clientsCount: number;
  activeProjectsCount: number;
  pendingQuotesCount: number;
  unpaidInvoicesCount: number;
  unpaidTotal: number;
  paidThisMonth: number;
  upcomingMeetings: { id: string; title: string; startsAt: Date; clientName: string | null }[];
  recentInvoices: { id: string; number: string; total: number; status: string; clientName: string; createdAt: Date }[];
  monthlyRevenue: { month: string; total: number }[];
};

export const getDashboardStats: GetDashboardStats<void, DashboardStats> = async (_args, context) => {
  const companyId = ensureCompany(context.user);
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const [clientsCount, activeProjectsCount, pendingQuotesCount, unpaidInvoices, paidPayments, meetings, recentInvoicesRaw] =
    await Promise.all([
      context.entities.Client.count({ where: { companyId } }),
      context.entities.Project.count({ where: { companyId, status: { in: ['en_cours', 'brouillon'] } } }),
      context.entities.Quote.count({ where: { companyId, status: { in: ['brouillon', 'envoyee'] } } }),
      context.entities.Invoice.findMany({
        where: { companyId, status: { in: ['brouillon', 'envoyee', 'en_retard'] } },
        select: { id: true, total: true, amountPaid: true },
      }),
      context.entities.Payment.findMany({
        where: { companyId, paidAt: { gte: startOfMonth } },
        select: { amount: true },
      }),
      context.entities.Meeting.findMany({
        where: { companyId, startsAt: { gte: now }, status: { in: ['prevue', 'confirmee'] } },
        include: { client: true },
        orderBy: { startsAt: 'asc' },
        take: 5,
      }),
      context.entities.Invoice.findMany({
        where: { companyId },
        include: { client: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

  const unpaidTotal = unpaidInvoices.reduce((s, i) => s + (i.total - i.amountPaid), 0);
  const paidThisMonth = paidPayments.reduce((s, p) => s + p.amount, 0);

  // Monthly revenue (last 6 months)
  const allMonthPayments = await context.entities.Payment.findMany({
    where: { companyId, paidAt: { gte: sixMonthsAgo } },
    select: { amount: true, paidAt: true },
  });
  const monthMap = new Map<string, number>();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthMap.set(key, 0);
  }
  for (const p of allMonthPayments) {
    const d = new Date(p.paidAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthMap.set(key, (monthMap.get(key) || 0) + p.amount);
  }
  const monthlyRevenue = Array.from(monthMap.entries()).map(([month, total]) => ({ month, total: +total.toFixed(2) }));

  return {
    clientsCount,
    activeProjectsCount,
    pendingQuotesCount,
    unpaidInvoicesCount: unpaidInvoices.length,
    unpaidTotal: +unpaidTotal.toFixed(2),
    paidThisMonth: +paidThisMonth.toFixed(2),
    upcomingMeetings: meetings.map((m) => ({
      id: m.id,
      title: m.title,
      startsAt: m.startsAt,
      clientName: m.client?.name || null,
    })),
    recentInvoices: recentInvoicesRaw.map((i) => ({
      id: i.id,
      number: i.number,
      total: i.total,
      status: i.status,
      clientName: i.client.name,
      createdAt: i.createdAt,
    })),
    monthlyRevenue,
  };
};

import { HttpError } from 'wasp/server';
import type { User } from 'wasp/entities';

export type CompanyContext = { companyId: string; user: User & { companyId: string | null; role: string } };

export async function requireCompany(args: { user?: any }, prisma: any): Promise<CompanyContext> {
  const user = args.user;
  if (!user) throw new HttpError(401, 'Non authentifié');
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return { companyId: user.companyId, user };
}

export function isAdmin(user: any): boolean {
  return user?.role === 'admin' || user?.isAdmin === true;
}

export function requireAdmin(user: any) {
  if (!isAdmin(user)) throw new HttpError(403, 'Accès réservé aux administrateurs');
}

// Quebec sales tax rates (2026)
export const TAX_GST = 0.05;        // TPS
export const TAX_QST = 0.09975;     // TVQ

export function computeTotals(items: { quantity: number; unitPrice: number }[]) {
  const subtotal = items.reduce((s, it) => s + (it.quantity || 0) * (it.unitPrice || 0), 0);
  const taxGst = +(subtotal * TAX_GST).toFixed(2);
  const taxQst = +(subtotal * TAX_QST).toFixed(2);
  const total = +(subtotal + taxGst + taxQst).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), taxGst, taxQst, total };
}

export async function nextDocNumber(
  prisma: any,
  type: 'quote' | 'invoice',
  companyId: string,
  prefix: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const startsWith = `${prefix}-${year}-`;
  const existing = await prisma.Document.findMany({
    where: { companyId, number: { startsWith } },
    select: { number: true },
  });
  let max = 0;
  for (const d of existing as { number: string }[]) {
    const tail = d.number.slice(startsWith.length);
    const n = parseInt(tail, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  const next = (max + 1).toString().padStart(4, '0');
  return `${prefix}-${year}-${next}`;
}

import { HttpError } from 'wasp/server';
import type {
  GetCurrentCompany,
  CreateCompany,
  UpdateCompany,
} from 'wasp/server/operations';
import type { Company } from 'wasp/entities';
import { requireAdmin } from '../../server/tenant';

export const getCurrentCompany: GetCurrentCompany<void, (Company & { _userRole: string }) | null> = async (
  _args,
  context
) => {
  if (!context.user) throw new HttpError(401);
  if (!context.user.companyId) return null;
  const company = await context.entities.Company.findUnique({ where: { id: context.user.companyId } });
  if (!company) return null;
  return { ...company, _userRole: (context.user as any).role || 'client' };
};

type CreateCompanyArgs = { name: string };
export const createCompany: CreateCompany<CreateCompanyArgs, Company> = async (args, context) => {
  if (!context.user) throw new HttpError(401);
  if ((context.user as any).companyId) throw new HttpError(400, 'Une entreprise est déjà associée à votre compte.');
  const name = (args.name || '').trim();
  if (!name) throw new HttpError(400, 'Le nom de l\'entreprise est requis.');
  const company = await context.entities.Company.create({ data: { name } });
  await context.entities.User.update({
    where: { id: context.user.id },
    data: { companyId: company.id, role: 'admin' },
  });
  return company;
};

type UpdateCompanyArgs = Partial<{
  name: string; legalName: string; email: string; phone: string;
  address: string; city: string; province: string; postalCode: string;
  country: string; website: string; neq: string;
  taxNumberGst: string; taxNumberQst: string;
}>;
export const updateCompany: UpdateCompany<UpdateCompanyArgs, Company> = async (args, context) => {
  if (!context.user) throw new HttpError(401);
  requireAdmin(context.user);
  const companyId = (context.user as any).companyId;
  if (!companyId) throw new HttpError(403);
  return context.entities.Company.update({ where: { id: companyId }, data: args });
};

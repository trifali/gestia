import { HttpError } from 'wasp/server';
import type { GetClients, CreateClient, UpdateClient, DeleteClient } from 'wasp/server/operations';
import type { Client, Document, DocumentItem, Payment, Meeting, Project } from 'wasp/entities';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

export type ClientDetail = Client & {
  documents: (Document & { items: DocumentItem[]; payments: Payment[]; project: Project | null })[];
  meetings: Meeting[];
};

export const getClientDetail = async ({ clientId }: { clientId: string }, context: any): Promise<ClientDetail> => {
  const companyId = ensureCompany(context.user);
  const client = await context.entities.Client.findUnique({
    where: { id: clientId },
    include: {
      documents: {
        include: {
          items: true,
          payments: true,
          project: true,
          activities: {
            where: { type: 'document.email_sent' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      meetings: { orderBy: { startsAt: 'desc' } },
    },
  });
  if (!client || client.companyId !== companyId) throw new HttpError(404, 'Client introuvable');
  return client;
};

export const getClients: GetClients<void, Client[]> = async (_args, context) => {
  const companyId = ensureCompany(context.user);
  return context.entities.Client.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
  });
};

type CreateClientArgs = Partial<Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'companyId'>> & { name: string };
export const createClient: CreateClient<CreateClientArgs, Client> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  if (!args.name?.trim()) throw new HttpError(400, 'Le nom du client est requis.');
  return context.entities.Client.create({ data: { ...args, companyId } as any });
};

type UpdateClientArgs = { id: string } & Partial<Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'companyId'>>;
export const updateClient: UpdateClient<UpdateClientArgs, Client> = async ({ id, ...data }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Client.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  return context.entities.Client.update({ where: { id }, data });
};

export const deleteClient: DeleteClient<{ id: string }, { id: string }> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Client.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  await context.entities.Client.delete({ where: { id } });
  return { id };
};

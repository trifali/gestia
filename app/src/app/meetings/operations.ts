import { HttpError } from 'wasp/server';
import type { GetMeetings, CreateMeeting, UpdateMeeting, DeleteMeeting } from 'wasp/server/operations';
import type { Meeting, Client } from 'wasp/entities';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

export type MeetingWithClient = Meeting & { client: Client | null };

export const getMeetings: GetMeetings<void, MeetingWithClient[]> = async (_args, context) => {
  const companyId = ensureCompany(context.user);
  return context.entities.Meeting.findMany({
    where: { companyId },
    include: { client: true },
    orderBy: { startsAt: 'desc' },
  });
};

type CreateMeetingArgs = {
  title: string;
  description?: string;
  clientId?: string | null;
  startsAt: string;
  endsAt?: string | null;
  location?: string;
  meetingUrl?: string;
  status?: string;
};
export const createMeeting: CreateMeeting<CreateMeetingArgs, Meeting> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  if (!args.title?.trim()) throw new HttpError(400, 'Titre requis');
  if (!args.startsAt) throw new HttpError(400, 'Date de début requise');
  return context.entities.Meeting.create({
    data: {
      companyId,
      title: args.title,
      description: args.description,
      clientId: args.clientId || null,
      startsAt: new Date(args.startsAt),
      endsAt: args.endsAt ? new Date(args.endsAt) : null,
      location: args.location,
      meetingUrl: args.meetingUrl,
      status: args.status || 'prevue',
    } as any,
  });
};

type UpdateMeetingArgs = { id: string } & Partial<CreateMeetingArgs>;
export const updateMeeting: UpdateMeeting<UpdateMeetingArgs, Meeting> = async ({ id, startsAt, endsAt, ...rest }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Meeting.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  return context.entities.Meeting.update({
    where: { id },
    data: {
      ...rest,
      ...(startsAt !== undefined ? { startsAt: new Date(startsAt!) } : {}),
      ...(endsAt !== undefined ? { endsAt: endsAt ? new Date(endsAt) : null } : {}),
    },
  });
};

export const deleteMeeting: DeleteMeeting<{ id: string }, { id: string }> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Meeting.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);
  await context.entities.Meeting.delete({ where: { id } });
  return { id };
};

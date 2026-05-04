import { HttpError } from 'wasp/server';
import type { GetMeetings, CreateMeeting, UpdateMeeting, DeleteMeeting } from 'wasp/server/operations';
import type { Meeting, Client } from 'wasp/entities';
import {
  getCalendarClient,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from './googleCalendarHelper';

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

/** Load user with Google Calendar credentials from DB. */
async function loadUserWithCalendar(context: any) {
  return context.entities.User.findUnique({
    where: { id: context.user.id },
    select: {
      googleCalendarAccessToken: true,
      googleCalendarRefreshToken: true,
      googleCalendarTokenExpiry: true,
    },
  });
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

  const userCal = await loadUserWithCalendar(context);
  if (!userCal?.googleCalendarAccessToken) {
    throw new HttpError(403, 'Veuillez connecter Google Agenda dans Paramètres → Intégrations avant de créer une rencontre.');
  }

  const startsAt = new Date(args.startsAt);
  const endsAt = args.endsAt ? new Date(args.endsAt) : null;

  // Create in Google Calendar first so we can persist the event ID
  let googleCalendarEventId: string | undefined;
  try {
    const calendar = await getCalendarClient(userCal, async (accessToken, expiry) => {
      await context.entities.User.update({
        where: { id: context.user!.id },
        data: { googleCalendarAccessToken: accessToken, googleCalendarTokenExpiry: expiry } as any,
      });
    });
    googleCalendarEventId = await createCalendarEvent(calendar, {
      title: args.title,
      description: args.description,
      startsAt,
      endsAt,
      location: args.location,
      meetingUrl: args.meetingUrl,
    });
  } catch (err: any) {
    // Surface Google Calendar errors clearly
    throw new HttpError(500, `Erreur Google Agenda : ${err?.message ?? err}`);
  }

  return context.entities.Meeting.create({
    data: {
      companyId,
      title: args.title,
      description: args.description,
      clientId: args.clientId || null,
      startsAt,
      endsAt,
      location: args.location,
      meetingUrl: args.meetingUrl,
      status: args.status || 'prevue',
      googleCalendarEventId,
    } as any,
  });
};

type UpdateMeetingArgs = { id: string } & Partial<CreateMeetingArgs>;
export const updateMeeting: UpdateMeeting<UpdateMeetingArgs, Meeting> = async ({ id, startsAt, endsAt, ...rest }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Meeting.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);

  const newStartsAt = startsAt !== undefined ? new Date(startsAt!) : existing.startsAt;
  const newEndsAt = endsAt !== undefined ? (endsAt ? new Date(endsAt) : null) : (existing as any).endsAt;

  // Sync to Google Calendar if we have an event ID
  const calEventId = (existing as any).googleCalendarEventId;
  if (calEventId) {
    const userCal = await loadUserWithCalendar(context);
    if (userCal?.googleCalendarAccessToken) {
      try {
        const calendar = await getCalendarClient(userCal, async (accessToken, expiry) => {
          await context.entities.User.update({
            where: { id: context.user!.id },
            data: { googleCalendarAccessToken: accessToken, googleCalendarTokenExpiry: expiry } as any,
          });
        });
        await updateCalendarEvent(calendar, calEventId, {
          title: rest.title ?? existing.title,
          description: rest.description ?? existing.description,
          startsAt: newStartsAt,
          endsAt: newEndsAt,
          location: rest.location ?? existing.location,
          meetingUrl: rest.meetingUrl ?? (existing as any).meetingUrl,
        });
      } catch {
        // Non-fatal: DB update proceeds even if Calendar sync fails
      }
    }
  }

  return context.entities.Meeting.update({
    where: { id },
    data: {
      ...rest,
      ...(startsAt !== undefined ? { startsAt: newStartsAt } : {}),
      ...(endsAt !== undefined ? { endsAt: newEndsAt } : {}),
    },
  });
};

export const deleteMeeting: DeleteMeeting<{ id: string }, { id: string }> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Meeting.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);

  // Delete from Google Calendar
  const calEventId = (existing as any).googleCalendarEventId;
  if (calEventId) {
    const userCal = await loadUserWithCalendar(context);
    if (userCal?.googleCalendarAccessToken) {
      try {
        const calendar = await getCalendarClient(userCal, async (accessToken, expiry) => {
          await context.entities.User.update({
            where: { id: context.user!.id },
            data: { googleCalendarAccessToken: accessToken, googleCalendarTokenExpiry: expiry } as any,
          });
        });
        await deleteCalendarEvent(calendar, calEventId);
      } catch {
        // Non-fatal
      }
    }
  }

  await context.entities.Meeting.delete({ where: { id } });
  return { id };
};

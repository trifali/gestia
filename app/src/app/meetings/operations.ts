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
  /** Duration in minutes (default 60) */
  durationMinutes?: number;
  /** JSON array of attendee email strings */
  attendeeEmails?: string;
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
  const duration = (args.durationMinutes ?? 60) * 60 * 1000;
  const endsAt = new Date(startsAt.getTime() + duration);

  let emails: string[] = [];
  try { emails = args.attendeeEmails ? JSON.parse(args.attendeeEmails) : []; } catch { /* ignore */ }

  let googleCalendarEventId: string | undefined;
  let meetLink: string | null = null;
  try {
    const calendar = await getCalendarClient(userCal, async (accessToken, expiry) => {
      await context.entities.User.update({
        where: { id: context.user!.id },
        data: { googleCalendarAccessToken: accessToken, googleCalendarTokenExpiry: expiry } as any,
      });
    });
    const result = await createCalendarEvent(calendar, {
      title: args.title,
      description: args.description,
      startsAt,
      endsAt,
      attendeeEmails: emails,
    });
    googleCalendarEventId = result.eventId;
    meetLink = result.meetLink;
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (msg.includes('insufficient authentication scopes') || msg.includes('insufficientPermissions')) {
      throw new HttpError(403, 'Autorisations Google insuffisantes. Veuillez déconnecter puis reconnecter votre Google Agenda dans Paramètres → Intégrations.');
    }
    throw new HttpError(500, `Erreur Google Agenda : ${msg}`);
  }

  return context.entities.Meeting.create({
    data: {
      companyId,
      title: args.title,
      description: args.description,
      clientId: args.clientId || null,
      startsAt,
      endsAt,
      status: 'prevue',
      googleCalendarEventId,
      meetLink,
      attendeeEmails: args.attendeeEmails ?? '[]',
    } as any,
  });
};

type UpdateMeetingArgs = { id: string } & Partial<CreateMeetingArgs>;
export const updateMeeting: UpdateMeeting<UpdateMeetingArgs, Meeting> = async (
  { id, startsAt, durationMinutes, attendeeEmails, ...rest },
  context,
) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Meeting.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);

  const newStartsAt = startsAt !== undefined ? new Date(startsAt) : existing.startsAt;
  const newEndsAt = durationMinutes !== undefined
    ? new Date(newStartsAt.getTime() + durationMinutes * 60 * 1000)
    : (existing as any).endsAt ?? new Date(newStartsAt.getTime() + 60 * 60 * 1000);

  let emails: string[] = [];
  try {
    const raw = attendeeEmails ?? (existing as any).attendeeEmails ?? '[]';
    emails = JSON.parse(raw);
  } catch { /* ignore */ }

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
          attendeeEmails: emails,
        });
      } catch (err: any) {
        const msg: string = err?.message ?? String(err);
        const status: number = err?.status ?? err?.code ?? 0;
        if (msg.includes('insufficient authentication scopes') || msg.includes('insufficientPermissions')) {
          throw new HttpError(403, 'Autorisations Google insuffisantes. Veuillez déconnecter puis reconnecter votre Google Agenda dans Paramètres → Intégrations.');
        }
        // Event was deleted from Google Calendar directly — clear the stale ID and proceed
        if (status === 404 || status === 410 || msg.includes('Resource has been deleted') || msg.includes('Not Found')) {
          await context.entities.Meeting.update({ where: { id }, data: { googleCalendarEventId: null } as any });
        } else {
          throw new HttpError(500, `Erreur Google Agenda : ${msg}`);
        }
      }
    }
  }

  return context.entities.Meeting.update({
    where: { id },
    data: {
      ...rest,
      ...(startsAt !== undefined ? { startsAt: newStartsAt, endsAt: newEndsAt } : {}),
      ...(attendeeEmails !== undefined ? { attendeeEmails } : {}),
    },
  });
};

export const deleteMeeting: DeleteMeeting<{ id: string }, { id: string }> = async ({ id }, context) => {
  const companyId = ensureCompany(context.user);
  const existing = await context.entities.Meeting.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) throw new HttpError(404);

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


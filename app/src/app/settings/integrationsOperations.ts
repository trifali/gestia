import { HttpError } from 'wasp/server';
import type {
  GetGoogleCalendarStatus,
  GetGoogleCalendarAuthUrl,
  HandleGoogleCalendarCallback,
  DisconnectGoogleCalendar,
} from 'wasp/server/operations';
import { google } from 'googleapis';
import { getAuthUrl, exchangeCodeForTokens, getOAuth2Client } from '../meetings/googleCalendarHelper';

// ─── Query: get connection status ─────────────────────────────────────────────

type CalendarStatus = {
  connected: boolean;
  email: string | null;
};

export const getGoogleCalendarStatus: GetGoogleCalendarStatus<void, CalendarStatus> = async (
  _args,
  context,
) => {
  if (!context.user) throw new HttpError(401);
  const user = await context.entities.User.findUnique({
    where: { id: context.user.id },
    select: {
      googleCalendarAccessToken: true,
      googleCalendarEmail: true,
    },
  });
  return {
    connected: !!user?.googleCalendarAccessToken,
    email: user?.googleCalendarEmail ?? null,
  };
};

// ─── Action: get OAuth URL ────────────────────────────────────────────────────

export const getGoogleCalendarAuthUrl: GetGoogleCalendarAuthUrl<void, { url: string }> = async (
  _args,
  context,
) => {
  if (!context.user) throw new HttpError(401);
  const url = getAuthUrl();
  return { url };
};

// ─── Action: handle OAuth callback ───────────────────────────────────────────

export const handleGoogleCalendarCallback: HandleGoogleCalendarCallback<
  { code: string },
  { email: string | null }
> = async ({ code }, context) => {
  if (!context.user) throw new HttpError(401);
  if (!code?.trim()) throw new HttpError(400, 'Code OAuth manquant');

  const tokens = await exchangeCodeForTokens(code);

  if (!tokens.access_token) throw new HttpError(400, 'Impossible d\'obtenir le jeton d\'accès');

  // Get the calendar email from the id_token or via the userinfo endpoint
  let calendarEmail: string | null = null;
  try {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(tokens);
    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2Client });
    const info = await oauth2Api.userinfo.get();
    calendarEmail = info.data.email ?? null;
  } catch {
    // Non-fatal — email is cosmetic
  }

  await context.entities.User.update({
    where: { id: context.user.id },
    data: {
      googleCalendarAccessToken: tokens.access_token,
      googleCalendarRefreshToken: tokens.refresh_token ?? undefined,
      googleCalendarTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      googleCalendarEmail: calendarEmail,
    } as any,
  });

  return { email: calendarEmail };
};

// ─── Action: disconnect ───────────────────────────────────────────────────────

export const disconnectGoogleCalendar: DisconnectGoogleCalendar<void, void> = async (
  _args,
  context,
) => {
  if (!context.user) throw new HttpError(401);
  await context.entities.User.update({
    where: { id: context.user.id },
    data: {
      googleCalendarAccessToken: null,
      googleCalendarRefreshToken: null,
      googleCalendarTokenExpiry: null,
      googleCalendarEmail: null,
    } as any,
  });
};

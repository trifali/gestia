/**
 * Server-side Google Calendar helpers.
 * Handles OAuth2 client creation, token refresh, and CRUD on calendar events.
 */
import { google } from 'googleapis';

// Local alias avoids referencing the non-portable googleapis-common sub-path.
type OAuthTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  token_type?: string | null;
  id_token?: string | null;
  scope?: string;
};

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    process.env.GOOGLE_CALENDAR_REDIRECT_URI,
  );
}

export function getAuthUrl(): string {
  const oauth2 = getOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });
}

export async function exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
  const oauth2 = getOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  return tokens;
}

type UserCalendarInfo = {
  googleCalendarAccessToken: string | null;
  googleCalendarRefreshToken: string | null;
  googleCalendarTokenExpiry: Date | null;
};

/**
 * Returns an authenticated calendar client for the given user.
 * Automatically refreshes the access token if it is expired, and returns
 * updated token fields so the caller can persist them.
 */
export async function getCalendarClient(
  user: UserCalendarInfo,
  onTokenRefreshed?: (accessToken: string, expiry: Date) => Promise<void>,
) {
  if (!user.googleCalendarAccessToken || !user.googleCalendarRefreshToken) {
    throw new Error('Google Calendar non connecté');
  }
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({
    access_token: user.googleCalendarAccessToken,
    refresh_token: user.googleCalendarRefreshToken,
    expiry_date: user.googleCalendarTokenExpiry?.getTime(),
  });

  // Listen for token refreshes so we can persist the new access token
  oauth2.on('tokens', async (tokens) => {
    if (tokens.access_token && onTokenRefreshed && tokens.expiry_date) {
      await onTokenRefreshed(tokens.access_token, new Date(tokens.expiry_date));
    }
  });

  return google.calendar({ version: 'v3', auth: oauth2 });
}

type MeetingData = {
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  location?: string | null;
  meetingUrl?: string | null;
};

function buildEventBody(meeting: MeetingData) {
  const start = meeting.startsAt;
  const end = meeting.endsAt ?? new Date(start.getTime() + 60 * 60 * 1000); // default 1 h

  return {
    summary: meeting.title,
    description: meeting.description ?? undefined,
    location: meeting.location ?? undefined,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    ...(meeting.meetingUrl
      ? { conferenceData: undefined, hangoutLink: undefined, source: { url: meeting.meetingUrl } }
      : {}),
  };
}

export async function createCalendarEvent(
  calendar: Awaited<ReturnType<typeof getCalendarClient>>,
  meeting: MeetingData,
): Promise<string> {
  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: buildEventBody(meeting),
  });
  return res.data.id!;
}

export async function updateCalendarEvent(
  calendar: Awaited<ReturnType<typeof getCalendarClient>>,
  eventId: string,
  meeting: MeetingData,
): Promise<void> {
  await calendar.events.update({
    calendarId: 'primary',
    eventId,
    requestBody: buildEventBody(meeting),
  });
}

export async function deleteCalendarEvent(
  calendar: Awaited<ReturnType<typeof getCalendarClient>>,
  eventId: string,
): Promise<void> {
  await calendar.events.delete({
    calendarId: 'primary',
    eventId,
  });
}

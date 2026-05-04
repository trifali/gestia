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
      'https://www.googleapis.com/auth/calendar.readonly',
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

const TIMEZONE = 'America/Toronto'; // Montréal

type MeetingData = {
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  attendeeEmails?: string[];
};

function buildEventBody(meeting: MeetingData) {
  const start = meeting.startsAt;
  const end = meeting.endsAt ?? new Date(start.getTime() + 60 * 60 * 1000); // default 1 h

  // Always anchor the event to the Montréal timezone so Google displays the
  // correct local time regardless of where the server is running.
  const toLocalISO = (d: Date) => {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(d).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  };

  return {
    summary: meeting.title,
    description: meeting.description ?? undefined,
    start: { dateTime: toLocalISO(start), timeZone: TIMEZONE },
    end:   { dateTime: toLocalISO(end),   timeZone: TIMEZONE },
    attendees: (meeting.attendeeEmails ?? []).map((email) => ({ email })),
    conferenceData: {
      createRequest: {
        requestId: `gestia-${start.getTime()}-${Math.random().toString(36).slice(2, 9)}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  };
}

export type CalendarEventResult = { eventId: string; meetLink: string | null };

export async function createCalendarEvent(
  calendar: Awaited<ReturnType<typeof getCalendarClient>>,
  meeting: MeetingData,
): Promise<CalendarEventResult> {
  const res = await calendar.events.insert({
    calendarId: 'primary',
    conferenceDataVersion: 1,
    sendUpdates: 'all',
    requestBody: buildEventBody(meeting),
  });
  return {
    eventId: res.data.id!,
    meetLink: res.data.hangoutLink ?? null,
  };
}

export async function updateCalendarEvent(
  calendar: Awaited<ReturnType<typeof getCalendarClient>>,
  eventId: string,
  meeting: MeetingData,
): Promise<void> {
  await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    conferenceDataVersion: 1,
    sendUpdates: 'all',
    requestBody: buildEventBody(meeting),
  });
}

export async function deleteCalendarEvent(
  calendar: Awaited<ReturnType<typeof getCalendarClient>>,
  eventId: string,
): Promise<void> {
  // First cancel the event so attendees receive a proper "Meeting cancelled"
  // notification email. events.delete alone does not reliably notify attendees.
  await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    sendUpdates: 'all',
    requestBody: { status: 'cancelled' },
  });
  // Then remove the event from the calendar entirely.
  await calendar.events.delete({
    calendarId: 'primary',
    eventId,
    sendUpdates: 'all',
  });
}

/**
 * Returns the busy time slots for the given date (YYYY-MM-DD) from the user's primary calendar.
 *
 * Two sources are combined:
 * 1. freebusy API — timed events marked as Busy (gives exact start/end datetimes)
 * 2. events.list  — all-day events (freebusy omits them or misses timezone edge cases)
 *    All-day events cover the full day (00:00 – 23:59).
 */
export async function getBusySlots(
  calendar: Awaited<ReturnType<typeof getCalendarClient>>,
  date: string,
): Promise<Array<{ start: string; end: string }>> {
  // ── 1. Resolve the calendar's timezone ──────────────────────────────────
  let tz = 'UTC';
  try {
    const cal = await calendar.calendars.get({ calendarId: 'primary' });
    tz = cal.data.timeZone ?? 'UTC';
  } catch { /* fallback to UTC */ }

  // Midnight-to-midnight in the calendar's local timezone
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd   = new Date(`${date}T23:59:59`);

  // For freebusy we use a slightly padded UTC window to avoid off-by-one at DST boundaries
  const base     = new Date(`${date}T00:00:00.000Z`);
  const timeMin  = new Date(base.getTime() - 14 * 60 * 60_000).toISOString();
  const timeMax  = new Date(base.getTime() + 38 * 60 * 60_000).toISOString();

  // ── 2. Timed busy slots via freebusy API ─────────────────────────────────
  const fbRes = await calendar.freebusy.query({
    requestBody: { timeMin, timeMax, items: [{ id: 'primary' }] },
  });
  const timedBusy: Array<{ start: string; end: string }> =
    (fbRes.data.calendars?.primary?.busy as Array<{ start: string; end: string }>) ?? [];

  // ── 3. All-day events via events.list ────────────────────────────────────
  // singleEvents: true expands recurring all-day events; timeMin/timeMax in ISO
  const evRes = await calendar.events.list({
    calendarId: 'primary',
    timeMin: `${date}T00:00:00Z`,
    timeMax: `${date}T23:59:59Z`,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const allDayBusy: Array<{ start: string; end: string }> = [];
  for (const ev of evRes.data.items ?? []) {
    // All-day events have ev.start.date but no ev.start.dateTime.
    // Google returns the event if it overlaps the UTC query window, so we must
    // explicitly verify the event actually covers the selected date using the
    // date fields (not the UTC window) to avoid false positives in non-UTC timezones.
    const startDate = ev.start?.date;   // "YYYY-MM-DD"
    const endDate   = ev.end?.date;     // exclusive end, e.g. next day for single-day events
    if (startDate && !ev.start?.dateTime && startDate <= date && (!endDate || endDate > date)) {
      allDayBusy.push({
        start: `${date}T00:00:00.000Z`,
        end:   `${date}T23:59:59.000Z`,
      });
      break; // one all-day event is enough to block the whole day
    }
  }

  return [...timedBusy, ...allDayBusy];
}

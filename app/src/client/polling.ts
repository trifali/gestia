// Inbound prospect SMS arrive by Telnyx webhook, so nothing on the client knows
// about them until it asks. Every view that shows an unread-reply badge polls on
// this interval, which is what makes a reply appear without a manual refresh.
export const SMS_POLL_MS = 20_000;

// The open conversation refreshes faster — someone reading a thread expects the
// prospect's answer to land while they watch.
export const SMS_THREAD_POLL_MS = 8_000;

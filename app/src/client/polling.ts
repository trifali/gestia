// Inbound prospect SMS arrive by Telnyx webhook, so nothing on the client knows
// about them until it asks. Every view that shows an unread-reply badge polls on
// this interval, which is what makes a reply appear without a manual refresh.
export const SMS_POLL_MS = 20_000;

// The open conversation refreshes faster — someone reading a thread expects the
// prospect's answer to land while they watch.
export const SMS_THREAD_POLL_MS = 8_000;

// Le panneau d'écoute de l'assistant « Nouveau tableau », pendant qu'on attend
// un premier appel entrant. Plus rapide qu'un fil SMS parce que la personne
// vient de déclencher sa source et regarde l'écran en l'attendant — mais un
// battement, pas un martèlement : la connexion à la base est un bien rare
// (`connection_limit`), et cette requête n'est ouverte que quelques minutes.
export const INTAKE_LISTEN_POLL_MS = 4_000;

// Au-delà, on cesse d'interroger et on propose de relancer l'écoute. Sans ce
// plafond, un onglet oublié sur cet écran interrogerait la base indéfiniment.
export const INTAKE_LISTEN_MAX_MS = 5 * 60_000;

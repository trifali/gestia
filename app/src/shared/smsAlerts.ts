// Paramètres de l'alerte de réponse différée, partagés par la tâche planifiée
// qui les applique et par l'écran de réglages qui les explique. Un délai affiché
// à l'utilisateur mais faux serait pire que pas de délai du tout.
//
// « Alerte de réponse » et non « alerte SMS » : le déclencheur est un SMS reçu,
// mais les deux canaux de sortie — courriel et SMS — partagent la même échéance.

/**
 * Le sursis laissé à l'équipe pour lire la réponse dans Gestia avant qu'une
 * alerte ne parte. Assez long pour couvrir quelqu'un qui a l'application
 * ouverte, assez court pour qu'une réponse manquée ne dorme pas.
 */
export const REPLY_ALERT_DELAY_MINUTES = 5;

export const REPLY_ALERT_DELAY_MS = REPLY_ALERT_DELAY_MINUTES * 60_000;

/**
 * Passé ce délai, une alerte SMS qu'on n'a jamais réussi à envoyer est
 * abandonnée. Sans ce plafond, un numéro d'entreprise invalide ferait retenter
 * la tâche à chaque minute, indéfiniment.
 */
export const REPLY_ALERT_MAX_AGE_MS = 60 * 60_000;

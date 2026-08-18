// Relances par courriel : corps assemblé, citation des échanges précédents et
// en-têtes de fil.
//
// Extrait de `leads/operations` le jour où l'envoi d'une soumission ou d'une
// facture a dû se comporter comme une relance de prospection — même citation
// sous le message, même rattachement au fil chez le destinataire. Les deux
// appelants lisent la même table (LeadEmailLog) avec un `identifier` différent.
//
// Dans `shared/` et non `server/` parce que l'aperçu, côté client, doit montrer
// exactement ce qui partira. Deux implémentations du même assemblage finiraient
// par diverger, et un aperçu qui ment est pire que pas d'aperçu. Rien ici ne
// touche Prisma ni le réseau : ce ne sont que des chaînes.

import { formatMontrealTime } from './format';

/** Nombre d'échanges repris en citation au bas d'une relance. */
export const QUOTED_HISTORY_LIMIT = 10;

/** Une ligne de LeadEmailLog, réduite à ce dont la citation a besoin. */
export type SentEmailLog = {
  createdAt: Date | string;
  body?: string | null;
  messageId?: string | null;
};

/**
 * Un envoi passé, quelle que soit sa provenance : le journal d'envoi
 * (LeadEmailLog, complet) ou une activité `document.email_sent` d'avant que ce
 * journal existe. Les deux se citent et s'affichent de la même façon ; seuls les
 * en-têtes de fil distinguent vraiment les secondes, faute de Message-ID.
 */
export type SentEmailRecord = {
  key: string;
  createdAt: Date | string;
  to: string | null;
  cc: string | null;
  subject: string;
  body: string | null;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  messageId: string | null;
  /** 'quote' | 'invoice' quand on le sait — l'ancien journal le portait. */
  docType: string | null;
  legacy: boolean;
};

/**
 * L'historique d'envoi d'un destinataire : le journal d'abord, puis les
 * activités antérieures à sa première ligne. Ce recouvrement est la seule règle
 * qui compte — un envoi postérieur au journal y est forcément déjà, le reprendre
 * de l'activité le compterait deux fois.
 *
 * Les deux entrées arrivent du plus récent au plus ancien, et la sortie aussi.
 *
 * Partagé serveur/client pour que la citation partie, l'aperçu et la liste des
 * envois précédents montrent tous les trois la même chose.
 */
export function mergeSentHistory(
  logs: any[],
  activities: { createdAt: Date | string; metadata?: any }[],
): SentEmailRecord[] {
  const fromLogs: SentEmailRecord[] = (logs || []).map((l: any) => ({
    key: `log:${l.id}`,
    createdAt: l.createdAt,
    to: l.to ?? null,
    cc: l.cc ?? null,
    subject: l.subject || '(sans objet)',
    body: l.body ?? null,
    fromName: l.fromName ?? null,
    fromEmail: l.fromEmail ?? null,
    replyTo: l.replyTo ?? null,
    messageId: l.messageId ?? null,
    docType: null,
    legacy: false,
  }));

  const oldestLogged = fromLogs.length
    ? new Date(fromLogs[fromLogs.length - 1].createdAt).getTime()
    : Infinity;

  const fromActivities: SentEmailRecord[] = (activities || [])
    .filter(a => new Date(a.createdAt).getTime() < oldestLogged)
    .map(a => {
      const m = a.metadata || {};
      return {
        key: `activity:${new Date(a.createdAt).getTime()}:${m.number ?? ''}`,
        createdAt: a.createdAt,
        to: m.to ?? null,
        cc: m.cc ?? null,
        subject: m.subject || '(sans objet)',
        body: m.body ?? null,
        fromName: null,
        fromEmail: null,
        replyTo: null,
        // Jamais enregistré à l'époque : ces envois-là ne peuvent rattacher
        // aucun fil, seulement être cités.
        messageId: null,
        docType: m.type ?? null,
        legacy: true,
      };
    });

  return [...fromLogs, ...fromActivities];
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Reprend les courriels déjà envoyés à ce destinataire sous le nouveau message,
 * comme le ferait une réponse dans un client de messagerie : il retrouve le
 * contexte sans avoir à chercher dans sa boîte.
 *
 * `logs` arrive du plus récent au plus ancien. Les corps stockés ne contiennent
 * jamais de citation (voir les appelants), donc l'empilement reste linéaire au
 * lieu de doubler à chaque relance.
 */
export function buildQuotedHistory(logs: SentEmailLog[]): { text: string; html: string } {
  if (!logs.length) return { text: '', html: '' };
  const textParts: string[] = [];
  const htmlParts: string[] = [];
  for (const log of logs) {
    const header = `Le ${formatMontrealTime(log.createdAt)}, nous écrivions :`;
    const body = log.body || '';
    textParts.push(
      `\n\n──────────\n${header}\n` +
        body.split('\n').map((line: string) => `> ${line}`).join('\n'),
    );
    htmlParts.push(
      `<div style="margin-top:16px;color:#555;font-size:13px;">${escapeHtml(header)}</div>` +
        `<blockquote style="margin:4px 0 0 .8ex;border-left:2px solid #ddd;padding-left:1ex;color:#555;white-space:pre-wrap;">` +
        `${escapeHtml(body).replace(/\n/g, '<br/>')}</blockquote>`,
    );
  }
  return { text: textParts.join(''), html: htmlParts.join('') };
}

/**
 * In-Reply-To / References à partir des envois précédents (du plus récent au
 * plus ancien) : la relance atterrit dans la même conversation chez le
 * destinataire au lieu d'ouvrir un fil de plus.
 */
export function buildThreadHeaders(logs: SentEmailLog[]): {
  inReplyTo?: string;
  references: string[];
} {
  const inReplyTo = logs.find(l => l.messageId)?.messageId ?? undefined;
  const references = logs
    .map(l => l.messageId)
    .filter(Boolean)
    .reverse() as string[];
  return { inReplyTo, references };
}

/**
 * Le corps HTML tel qu'il part : le message saisi, puis la citation des échanges
 * précédents. Tout ce qui vient de l'utilisateur passe par `escapeHtml`, donc le
 * résultat est sûr à injecter dans l'aperçu.
 */
export function buildEmailHtml(message: string, quoted: { html: string }): string {
  return (
    `<div style="font-family: Arial, sans-serif; font-size: 14px; color:#1a1a1a; white-space: pre-wrap;">${escapeHtml(
      message,
    ).replace(/\n/g, '<br/>')}</div>` +
    (quoted.html
      ? `<div style="font-family: Arial, sans-serif; font-size: 14px;">${quoted.html}</div>`
      : '')
  );
}

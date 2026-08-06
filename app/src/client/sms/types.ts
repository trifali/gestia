// Miroir client du type retourné par `getSmsConversations`
// (app/src/app/sms/operations.ts). Dupliqué plutôt qu'importé : Wasp ne permet
// pas d'importer un module serveur côté client, et les types générés n'existent
// qu'après un redémarrage.

export type SmsConversationItem = {
  identifier: string;
  kind: 'lead' | 'number';
  /** E.164 joignable, ou null (code court, expéditeur alphanumérique). */
  phone: string | null;
  /** L'interlocuteur tel qu'il apparaît dans les messages, toujours affichable. */
  address: string;
  displayName: string | null;
  lastBody: string;
  lastDirection: 'inbound' | 'outbound';
  lastStatus: string | null;
  lastMessageAt: string;
  unreadCount: number;
  messageCount: number;
  leadId: string | null;
  searchId: string | null;
};

export type SmsRecipientItem = {
  phone: string;
  name: string;
  source: 'contact' | 'client' | 'lead' | 'raw';
  sourceId: string | null;
  identifier: string;
  hasThread: boolean;
};

// SMTP mailer for business email (documents, prospection, notifications).
// Wasp's built-in `emailSender` doesn't expose attachments, so we build a
// dedicated transport via `nodemailer` (already a transitive dependency).
//
// Configuration is per company (Paramètres → Intégrations). When a company has
// not set its own, the platform SMTP_* environment config is used. Note that
// Wasp's own auth emails (vérification, réinitialisation de mot de passe) always
// use the platform config — they are sent by Wasp itself, not through here.

// @ts-ignore - nodemailer ships without bundled types; we use it minimally.
import { createTransport } from 'nodemailer';

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  /**
   * Where replies must go — the company's own contact address. Sending mailboxes
   * are often unattended (no-reply@, a provider login), so a client answering the
   * message would otherwise write into a void.
   */
  replyTo: string | null;
  /** Company address to put in Cci of client sends, or null when not wanted. */
  copyTo: string | null;
  /** True when these values came from the company row rather than the platform. */
  isCompanyOwned: boolean;
};

/** The subset of Company this module needs. */
export type SmtpCompany = {
  name?: string | null;
  email?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUsername?: string | null;
  smtpPassword?: string | null;
  smtpFromName?: string | null;
  smtpFromEmail?: string | null;
  copySentEmailsToCompany?: boolean | null;
};

const DEFAULT_PORT = 465;
const FALLBACK_FROM = 'no-reply@trifali.app';

/** Transports are pooled per distinct endpoint so multi-company sending reuses connections. */
const transports = new Map<string, any>();

function transportFor(cfg: SmtpConfig): any {
  const key = `${cfg.host}:${cfg.port}:${cfg.user}`;
  const existing = transports.get(key);
  if (existing) return existing;
  const transport = createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  transports.set(key, transport);
  return transport;
}

/** Drops the cached transport for a config, so edited credentials take effect at once. */
export function forgetSmtpTransport(cfg: Pick<SmtpConfig, 'host' | 'port' | 'user'>): void {
  transports.delete(`${cfg.host}:${cfg.port}:${cfg.user}`);
}

/**
 * Platform-wide SMTP from the environment.
 *
 * Reserved for mail the platform itself sends and that has no company behind it:
 * Wasp's auth emails (vérification, mot de passe oublié) and the public contact
 * form. Company mail must NEVER use this — a company sends through its own
 * server or not at all. Use companySmtp() for anything company-related.
 */
export function platformSmtp(): SmtpConfig | null {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USERNAME || '').trim();
  const pass = (process.env.SMTP_PASSWORD || '').trim();
  if (!host || !user || !pass) return null;
  return {
    host,
    port: parseInt(process.env.SMTP_PORT || String(DEFAULT_PORT), 10) || DEFAULT_PORT,
    user,
    pass,
    fromName: 'Gestia',
    fromEmail: user || FALLBACK_FROM,
    replyTo: null,
    copyTo: null,
    isCompanyOwned: false,
  };
}

/**
 * A company's own SMTP, or null when it has not configured one — in which case
 * the caller must refuse to send rather than substituting anything else.
 */
export function companySmtp(company: SmtpCompany | null | undefined): SmtpConfig | null {
  const host = (company?.smtpHost || '').trim();
  const user = (company?.smtpUsername || '').trim();
  const pass = (company?.smtpPassword || '').trim();
  if (!host || !user || !pass) return null;
  const contact = (company?.email || '').trim() || null;
  return {
    host,
    port: company?.smtpPort || DEFAULT_PORT,
    user,
    pass,
    // The two "from" fields are optional in Paramètres → Intégrations; these are
    // the defaults the placeholders there announce.
    fromName: (company?.smtpFromName || company?.name || 'Gestia').trim(),
    fromEmail: (company?.smtpFromEmail || user).trim(),
    replyTo: contact,
    copyTo: company?.copySentEmailsToCompany ? contact : null,
    isCompanyOwned: true,
  };
}

// NOTE: there is deliberately no "smtpForCompany with fallback" helper. Business
// email uses companySmtp() and fails when it returns null, so a company can never
// send through the platform's server and credentials.

export type Attachment = {
  filename: string;
  /** Base64-encoded content. */
  contentBase64: string;
  contentType?: string;
};

export async function sendEmailWithAttachment(params: {
  /** Resolve with smtpForCompany() / platformSmtp() — never assumed. */
  smtp: SmtpConfig;
  to: string;
  cc?: string | string[];
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
  fromEmail?: string;
  /** Defaults to the company contact address; pass only to override it. */
  replyTo?: string;
  /**
   * Set on mail addressed to a client or a prospect. Such mail answers to the
   * company contact address and, when the company asked for it, is copied there
   * in Cci exactly as the recipient gets it. Internal alerts (notifications to
   * the company itself, tests) leave this off — the company does not need a copy
   * of what it just sent to itself.
   */
  clientFacing?: boolean;
  attachments?: Attachment[];
}): Promise<void> {
  const { smtp } = params;
  const fromName = params.fromName || smtp.fromName;
  const fromEmail = params.fromEmail || smtp.fromEmail;
  const replyTo = params.replyTo || smtp.replyTo || undefined;
  // Skip the copy when the company is already a recipient, so it does not get
  // the same message twice.
  const recipients = [params.to, ...(Array.isArray(params.cc) ? params.cc : [params.cc ?? ''])]
    .map(r => r.trim().toLowerCase())
    .filter(Boolean);
  const copyTo = params.clientFacing ? smtp.copyTo : null;
  const bcc = copyTo && !recipients.includes(copyTo.toLowerCase()) ? copyTo : undefined;

  await transportFor(smtp).sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: params.to,
    cc: params.cc,
    bcc,
    replyTo,
    subject: params.subject,
    text: params.text,
    html: params.html,
    attachments: (params.attachments || []).map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.contentBase64, 'base64'),
      contentType: a.contentType,
    })),
  });
}

/** Opens a connection and authenticates without sending, for the "Tester" button. */
export async function verifySmtp(cfg: SmtpConfig): Promise<void> {
  await transportFor(cfg).verify();
}

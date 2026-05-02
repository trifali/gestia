// Lightweight SMTP mailer for sending PDF attachments.
// Wasp's built-in `emailSender` doesn't expose attachments, so we reuse the
// same `SMTP_*` env vars Wasp itself uses and build a dedicated transport via
// `nodemailer` (already a transitive dependency of Wasp).

// @ts-ignore - nodemailer ships without bundled types; we use it minimally.
import { createTransport } from 'nodemailer';

let cached: any = null;

function getTransport(): any {
  if (cached) return cached;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const user = process.env.SMTP_USERNAME;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) {
    throw new Error('Configuration SMTP manquante (SMTP_HOST/SMTP_USERNAME/SMTP_PASSWORD).');
  }
  cached = createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return cached!;
}

export type Attachment = {
  filename: string;
  /** Base64-encoded content. */
  contentBase64: string;
  contentType?: string;
};

export async function sendEmailWithAttachment(params: {
  to: string;
  cc?: string | string[];
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  attachments?: Attachment[];
}): Promise<void> {
  const transport = getTransport();
  const fromName = params.fromName || 'Gestia';
  const fromEmail = params.fromEmail || process.env.SMTP_USERNAME || 'no-reply@trifali.app';
  await transport.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: params.to,
    cc: params.cc,
    replyTo: params.replyTo,
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

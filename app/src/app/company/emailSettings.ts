// Per-company outgoing email (SMTP) configuration — Paramètres → Intégrations.
//
// Covers business email: documents, prospection, project notifications and SMS
// reply alerts. Wasp's own auth emails (vérification, réinitialisation) are sent
// by Wasp itself from the platform SMTP_* environment config and are not
// affected by anything here.

import { HttpError } from 'wasp/server';
import { requireAdmin, isAdmin } from '../../server/tenant';
import {
  companySmtp,
  verifySmtp,
  forgetSmtpTransport,
  sendEmailWithAttachment,
} from '../../server/mail';

const SMTP_SELECT = {
  name: true,
  email: true,
  smtpHost: true,
  smtpPort: true,
  smtpUsername: true,
  smtpPassword: true,
  smtpFromName: true,
  smtpFromEmail: true,
  copySentEmailsToCompany: true,
} as const;

export type EmailSettings = {
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  /** Masked tail only — the stored password is never returned. */
  passwordPreview: string | null;
  smtpFromName: string | null;
  smtpFromEmail: string | null;
  /** Whether client sends are copied to the company address in Cci. */
  copySentEmailsToCompany: boolean;
  /** True once this company has a complete config of its own. Sending is
   *  impossible until then — there is no platform fallback for company mail. */
  isConfigured: boolean;
  /** The address business email will be sent from, or null when unconfigured. */
  effectiveFromEmail: string | null;
  /** The name business email will be sent under, or null when unconfigured. */
  effectiveFromName: string | null;
  /** Where a test message goes by default, and where client replies land. */
  companyEmail: string | null;
  /** Shown as the "Nom d'expéditeur" default when that field is left empty. */
  companyName: string | null;
};

function mask(secret: string | null | undefined): string | null {
  const s = (secret ?? '').trim();
  if (!s) return null;
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
}

function toSettings(c: any): EmailSettings {
  const own = companySmtp(c);
  return {
    smtpHost: c.smtpHost ?? null,
    smtpPort: c.smtpPort ?? null,
    smtpUsername: c.smtpUsername ?? null,
    passwordPreview: mask(c.smtpPassword),
    smtpFromName: c.smtpFromName ?? null,
    smtpFromEmail: c.smtpFromEmail ?? null,
    copySentEmailsToCompany: !!c.copySentEmailsToCompany,
    isConfigured: !!own,
    effectiveFromEmail: own?.fromEmail ?? null,
    effectiveFromName: own?.fromName ?? null,
    companyEmail: c.email ?? null,
    companyName: c.name ?? null,
  };
}

async function loadCompany(context: any) {
  if (!context.user) throw new HttpError(401);
  requireAdmin(context.user);
  const companyId = (context.user as any).companyId;
  if (!companyId) throw new HttpError(403);
  const c = await context.entities.Company.findUnique({
    where: { id: companyId },
    select: { ...SMTP_SELECT },
  });
  if (!c) throw new HttpError(404);
  return { companyId, company: c };
}

export const getEmailSettings = async (_args: void, context: any): Promise<EmailSettings> => {
  const { company } = await loadCompany(context);
  return toSettings(company);
};

export type EmailCapability = {
  canSend: boolean;
  /** Ready-to-display explanation when canSend is false, else null. */
  reason: string | null;
  canConfigure: boolean;
};

/**
 * Readable by every member of the company — unlike `getEmailSettings`, which is
 * admin-only — so the UI can disable its send buttons and explain why. Returns
 * booleans and a message only; no credential material.
 */
export const getEmailCapability = async (_args: void, context: any): Promise<EmailCapability> => {
  if (!context.user) throw new HttpError(401);
  const companyId = (context.user as any).companyId;
  const canConfigure = isAdmin(context.user);
  if (!companyId) {
    return { canSend: false, reason: 'Aucune entreprise associée à votre compte.', canConfigure };
  }

  const company = await context.entities.Company.findUnique({
    where: { id: companyId },
    select: { ...SMTP_SELECT },
  });
  if (companySmtp(company)) return { canSend: true, reason: null, canConfigure };

  const missing: string[] = [];
  if (!company?.smtpHost?.trim()) missing.push('l\'hôte');
  if (!company?.smtpUsername?.trim()) missing.push('le nom d\'utilisateur');
  if (!company?.smtpPassword?.trim()) missing.push('le mot de passe');
  const what = missing.length === 3 ? 'votre serveur SMTP' : missing.join(' et ');

  return {
    canSend: false,
    canConfigure,
    reason: canConfigure
      ? `Courriel non configuré : ajoutez ${what} dans Paramètres → Intégrations.`
      : `Courriel non configuré : demandez à un administrateur d'ajouter ${what} dans Paramètres → Intégrations.`,
  };
};

/**
 * `smtpPassword` follows the same three-state convention as the Telnyx secrets:
 * absent leaves it untouched, a non-empty string replaces it, `null` clears it.
 */
type UpdateEmailSettingsArgs = {
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUsername?: string | null;
  smtpPassword?: string | null;
  smtpFromName?: string | null;
  smtpFromEmail?: string | null;
  copySentEmailsToCompany?: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const updateEmailSettings = async (
  args: UpdateEmailSettingsArgs,
  context: any,
): Promise<EmailSettings> => {
  const { companyId, company: before } = await loadCompany(context);

  const data: any = {};
  for (const key of ['smtpHost', 'smtpUsername', 'smtpFromName', 'smtpFromEmail'] as const) {
    if (!(key in args)) continue;
    const value = (args[key] ?? '').toString().trim();
    data[key] = value || null;
  }

  if ('smtpPort' in args) {
    const raw = args.smtpPort;
    if (raw === null || raw === undefined || (raw as any) === '') {
      data.smtpPort = null;
    } else {
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new HttpError(400, 'Port SMTP invalide (1–65535).');
      }
      data.smtpPort = port;
    }
  }

  if ('smtpPassword' in args) {
    const value = args.smtpPassword;
    if (value === null) data.smtpPassword = null;
    else if (String(value).trim()) data.smtpPassword = String(value).trim();
    // empty string → leave the stored password alone
  }

  if (data.smtpFromEmail && !EMAIL_RE.test(data.smtpFromEmail)) {
    throw new HttpError(400, 'Adresse d\'expédition invalide.');
  }

  if ('copySentEmailsToCompany' in args) {
    // Refuse to turn the copy on with nowhere to send it — the same rule as the
    // SMS reply alerts, so the toggle never reads "on" while copying nobody.
    if (args.copySentEmailsToCompany && !before.email?.trim()) {
      throw new HttpError(400, "Ajoutez d'abord un courriel d'entreprise dans l'onglet Entreprise.");
    }
    data.copySentEmailsToCompany = !!args.copySentEmailsToCompany;
  }

  // The old transport is pooled by host:port:user; drop it so edited credentials
  // are not silently ignored in favour of a cached connection.
  const stale = companySmtp(before);
  if (stale) forgetSmtpTransport(stale);

  await context.entities.Company.update({ where: { id: companyId }, data });

  const after = await context.entities.Company.findUnique({
    where: { id: companyId },
    select: { ...SMTP_SELECT },
  });
  return toSettings(after);
};

/**
 * Opens an authenticated SMTP connection without sending, so a wrong password is
 * reported here rather than as a silently failed invoice email.
 */
export const testEmailConnection = async (_args: void, context: any): Promise<{ ok: true }> => {
  const { company } = await loadCompany(context);
  const smtp = companySmtp(company);
  if (!smtp) throw new HttpError(400, 'Renseignez votre hôte, nom d\'utilisateur et mot de passe SMTP avant de tester.');
  try {
    await verifySmtp(smtp);
  } catch (err: any) {
    throw new HttpError(400, `Connexion SMTP refusée : ${err?.message ?? 'erreur inconnue'}`);
  }
  return { ok: true };
};

/** Sends a real test message, to the company email unless another is given. */
export const sendTestEmail = async (
  args: { to?: string | null },
  context: any,
): Promise<{ ok: true; to: string }> => {
  const { company } = await loadCompany(context);

  const to = (args?.to ?? '').trim() || (company.email ?? '').trim();
  if (!to) {
    throw new HttpError(400, "Aucun destinataire : ajoutez un courriel d'entreprise ou saisissez une adresse.");
  }
  if (!EMAIL_RE.test(to)) throw new HttpError(400, 'Adresse de destination invalide.');

  const smtp = companySmtp(company);
  if (!smtp) {
    throw new HttpError(400, 'Courriel non configuré. Renseignez votre propre serveur SMTP ci-dessus.');
  }

  try {
    await sendEmailWithAttachment({
      smtp,
      to,
      subject: 'Gestia — test de configuration courriel',
      text:
        `Ce message confirme que l'envoi de courriels fonctionne.\n\n` +
        `De : ${smtp.fromName} <${smtp.fromEmail}>\n` +
        `Réponses vers : ${smtp.replyTo ?? '— aucun courriel d\'entreprise —'}\n` +
        `Serveur : ${smtp.host}:${smtp.port}\n`,
      html:
        `<p>Ce message confirme que l'envoi de courriels fonctionne.</p>` +
        `<ul>` +
        `<li>De : ${smtp.fromName} &lt;${smtp.fromEmail}&gt;</li>` +
        `<li>Réponses vers : ${smtp.replyTo ?? '— aucun courriel d\'entreprise —'}</li>` +
        `<li>Serveur : ${smtp.host}:${smtp.port}</li>` +
        `</ul>`,
    });
  } catch (err: any) {
    throw new HttpError(400, `Envoi échoué : ${err?.message ?? 'erreur inconnue'}`);
  }

  return { ok: true, to };
};

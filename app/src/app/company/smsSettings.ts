// Per-company SMS configuration (Paramètres → Intégrations).
//
// The Telnyx credentials live on the Company row rather than in .env.server so
// each company manages its own number. The API key and public key are secrets:
// they are written here but only ever read back as masked previews.

import { HttpError } from 'wasp/server';
import { config } from 'wasp/server';
import { requireAdmin, isAdmin } from '../../server/tenant';
import {
  toE164,
  sendSms,
  isValidTelnyxPublicKey,
  verifyTelnyxApiKey,
  resolveSmsCredentials,
  SMS_WEBHOOK_PATH,
  SMS_WEBHOOK_FAILOVER_PATH,
} from '../../server/sms';
import { toGsm7, clampGsm7 } from '../../shared/smsSegments';

export type SmsSettings = {
  telnyxPhoneNumber: string | null;
  /** Masked tail of the stored key, or null when unset. Never the full value. */
  apiKeyPreview: string | null;
  publicKeyPreview: string | null;
  notifySmsReplyByEmail: boolean;
  notifySmsReplyBySms: boolean;
  /** Whether the floating SMS inbox widget is on for this company. */
  smsInboxEnabled: boolean;
  /** The company contact details notifications go to, so the UI can show them. */
  companyEmail: string | null;
  companyPhone: string | null;
  /** True once sending is possible (number + API key present). */
  canSend: boolean;
  /** True once inbound webhooks can be verified (public key present). */
  canReceive: boolean;
  webhookUrl: string;
  webhookFailoverUrl: string;
};

/** Shows enough to recognise a key without revealing anything usable. */
function mask(secret: string | null | undefined): string | null {
  const s = (secret ?? '').trim();
  if (!s) return null;
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
}

export const getSmsSettings = async (_args: void, context: any): Promise<SmsSettings> => {
  if (!context.user) throw new HttpError(401);
  requireAdmin(context.user);
  const companyId = (context.user as any).companyId;
  if (!companyId) throw new HttpError(403);

  const c = await context.entities.Company.findUnique({ where: { id: companyId } });
  if (!c) throw new HttpError(404);

  return {
    telnyxPhoneNumber: c.telnyxPhoneNumber ?? null,
    apiKeyPreview: mask(c.telnyxApiKey),
    publicKeyPreview: mask(c.telnyxPublicKey),
    notifySmsReplyByEmail: c.notifySmsReplyByEmail,
    notifySmsReplyBySms: c.notifySmsReplyBySms,
    smsInboxEnabled: c.smsInboxEnabled,
    companyEmail: c.email ?? null,
    companyPhone: c.phone ?? null,
    canSend: !!(c.telnyxPhoneNumber && c.telnyxApiKey),
    canReceive: !!c.telnyxPublicKey,
    webhookUrl: `${config.serverUrl}${SMS_WEBHOOK_PATH}`,
    webhookFailoverUrl: `${config.serverUrl}${SMS_WEBHOOK_FAILOVER_PATH}`,
  };
};

/**
 * Sends a real SMS to prove the credentials work — to the company phone unless
 * another number is given. Deliberately not written to LeadSmsLog: a test is not
 * part of any prospect conversation, and logging it would corrupt the
 * "last outbound to this number" lookup that attributes inbound replies.
 */
export const sendTestSms = async (
  args: { to?: string | null },
  context: any,
): Promise<{ ok: true; to: string; providerId: string | null }> => {
  if (!context.user) throw new HttpError(401);
  requireAdmin(context.user);
  const companyId = (context.user as any).companyId;
  if (!companyId) throw new HttpError(403);

  const company = await context.entities.Company.findUnique({
    where: { id: companyId },
    select: { name: true, phone: true, telnyxPhoneNumber: true, telnyxApiKey: true },
  });
  if (!company) throw new HttpError(404);

  const credentials = resolveSmsCredentials(company);
  if (!credentials) {
    throw new HttpError(400, 'SMS non configuré : renseignez le numéro et la clé API Telnyx.');
  }

  const requested = (args?.to ?? '').trim() || (company.phone ?? '').trim();
  if (!requested) {
    throw new HttpError(400, "Aucun destinataire : ajoutez un téléphone d'entreprise ou saisissez un numéro.");
  }
  const to = toE164(requested);
  if (!to) throw new HttpError(400, 'Numéro de destination invalide.');

  // Texting our own Telnyx number would bounce straight back into the inbound
  // webhook, so refuse rather than create a self-message.
  if (to === credentials.from) {
    throw new HttpError(400, 'Le numéro de test ne peut pas être votre propre numéro Telnyx.');
  }

  try {
    // `toGsm7` n'est pas cosmétique : le « — » du gabarit d'origine, hors
    // alphabet GSM-7, faisait basculer ce test en UCS-2 (70 caractères par
    // segment) et le facturait donc deux segments au lieu d'un. Le clamp couvre
    // la raison sociale à rallonge. Voir shared/smsSegments.
    const { id } = await sendSms({
      to,
      text: clampGsm7(
        toGsm7(
          `Gestia - test de configuration SMS pour ${company.name ?? 'votre entreprise'}. ` +
            `Si vous recevez ce message, l'envoi fonctionne.`,
        ),
        160,
      ),
      credentials,
    });
    return { ok: true, to, providerId: id };
  } catch (e: any) {
    throw new HttpError(400, e?.message ?? "Échec de l'envoi du SMS de test.");
  }
};

export type SmsCapability = {
  /** Whether an outgoing SMS can actually be sent right now. */
  canSend: boolean;
  /** Ready-to-display explanation when canSend is false, else null. */
  reason: string | null;
  /** Whether this user could fix it themselves. */
  canConfigure: boolean;
  /**
   * Whether the floating SMS inbox should be shown. Mirrored here rather than
   * read from `getSmsSettings` because that one is admin-only and the widget is
   * for every member. Volontairement tolérant sur les identifiants : si la clé
   * casse, la boîte reste consultable et seul l'envoi est bloqué.
   */
  inboxEnabled: boolean;
};

/**
 * Readable by every member of the company — unlike `getSmsSettings`, which is
 * admin-only — so the prospection UI can disable its SMS buttons and explain
 * why. Returns booleans and a message only; no credential material.
 */
export const getSmsCapability = async (_args: void, context: any): Promise<SmsCapability> => {
  if (!context.user) throw new HttpError(401);
  const companyId = (context.user as any).companyId;
  const canConfigure = isAdmin(context.user);
  if (!companyId) {
    return {
      canSend: false,
      reason: 'Aucune entreprise associée à votre compte.',
      canConfigure,
      inboxEnabled: false,
    };
  }

  const company = await context.entities.Company.findUnique({
    where: { id: companyId },
    select: { telnyxPhoneNumber: true, telnyxApiKey: true, smsInboxEnabled: true },
  });
  const inboxEnabled = !!(company?.smsInboxEnabled && company?.telnyxPhoneNumber);
  if (resolveSmsCredentials(company)) {
    return { canSend: true, reason: null, canConfigure, inboxEnabled };
  }

  const missingNumber = !company?.telnyxPhoneNumber;
  const what = missingNumber && !company?.telnyxApiKey
    ? 'le numéro et la clé API Telnyx'
    : missingNumber ? 'le numéro Telnyx' : 'la clé API Telnyx';

  return {
    canSend: false,
    canConfigure,
    inboxEnabled,
    reason: canConfigure
      ? `SMS non configuré : ajoutez ${what} dans Paramètres → Intégrations.`
      : `SMS non configuré : demandez à un administrateur d'ajouter ${what} dans Paramètres → Intégrations.`,
  };
};

/**
 * Secret fields follow a three-state convention so the form never has to hold a
 * real key: `undefined`/absent leaves it untouched, a non-empty string replaces
 * it, and `null` clears it.
 */
type UpdateSmsSettingsArgs = {
  telnyxPhoneNumber?: string | null;
  telnyxApiKey?: string | null;
  telnyxPublicKey?: string | null;
  notifySmsReplyByEmail?: boolean;
  notifySmsReplyBySms?: boolean;
  smsInboxEnabled?: boolean;
};

export const updateSmsSettings = async (
  args: UpdateSmsSettingsArgs,
  context: any,
): Promise<SmsSettings> => {
  if (!context.user) throw new HttpError(401);
  requireAdmin(context.user);
  const companyId = (context.user as any).companyId;
  if (!companyId) throw new HttpError(403);

  const data: any = {};

  if ('telnyxPhoneNumber' in args) {
    const raw = (args.telnyxPhoneNumber ?? '').trim();
    if (!raw) {
      data.telnyxPhoneNumber = null;
    } else {
      const e164 = toE164(raw);
      if (!e164) throw new HttpError(400, 'Numéro Telnyx invalide (format attendu : +15145550100).');
      data.telnyxPhoneNumber = e164;
    }
  }

  for (const key of ['telnyxApiKey', 'telnyxPublicKey'] as const) {
    if (!(key in args)) continue; // absent → keep the stored secret
    const value = args[key];
    if (value === null) { data[key] = null; continue; } // explicit clear
    const trimmed = String(value).trim();
    if (!trimmed) continue; // empty string → no change

    if (key === 'telnyxPublicKey' && !isValidTelnyxPublicKey(trimmed)) {
      throw new HttpError(400, 'Clé publique Telnyx invalide (attendu : base64 d\'une clé Ed25519 de 32 octets).');
    }
    if (key === 'telnyxApiKey') {
      // Ask Telnyx whether the key works, using a read-only endpoint so nothing
      // is sent. Only an outright rejection blocks the save — if Telnyx is
      // unreachable we store the key rather than blaming the user for our outage.
      const verdict = await verifyTelnyxApiKey(trimmed);
      if (verdict === 'invalid') {
        throw new HttpError(400, 'Clé API Telnyx refusée par Telnyx. Vérifiez que vous avez copié la bonne clé.');
      }
      if (verdict === 'unknown') {
        console.warn('[telnyx] impossible de vérifier la clé API (Telnyx injoignable) — enregistrée sans validation.');
      }
    }
    data[key] = trimmed;
  }

  if ('notifySmsReplyByEmail' in args) data.notifySmsReplyByEmail = !!args.notifySmsReplyByEmail;
  if ('notifySmsReplyBySms' in args) data.notifySmsReplyBySms = !!args.notifySmsReplyBySms;
  if ('smsInboxEnabled' in args) data.smsInboxEnabled = !!args.smsInboxEnabled;

  // Une boîte de réception sans numéro ni clé API n'a rien à afficher et ne peut
  // rien envoyer. Le contrôle porte sur l'état *fusionné* : la clé peut très bien
  // être posée dans la même requête que l'activation.
  if (data.smsInboxEnabled) {
    const c = await context.entities.Company.findUnique({
      where: { id: companyId },
      select: { telnyxPhoneNumber: true, telnyxApiKey: true },
    });
    if (!resolveSmsCredentials({ ...c, ...data })) {
      throw new HttpError(
        400,
        "Configurez d'abord le numéro et la clé API Telnyx avant d'activer la messagerie.",
      );
    }
  }

  // Refuse to enable a channel with no destination — otherwise the toggle reads
  // as "on" while silently notifying nobody.
  if (data.notifySmsReplyByEmail || data.notifySmsReplyBySms) {
    const c = await context.entities.Company.findUnique({
      where: { id: companyId },
      select: { email: true, phone: true },
    });
    if (data.notifySmsReplyByEmail && !c?.email?.trim()) {
      throw new HttpError(400, "Ajoutez d'abord un courriel d'entreprise dans l'onglet Entreprise.");
    }
    if (data.notifySmsReplyBySms && !c?.phone?.trim()) {
      throw new HttpError(400, "Ajoutez d'abord un téléphone d'entreprise dans l'onglet Entreprise.");
    }
  }

  try {
    await context.entities.Company.update({ where: { id: companyId }, data });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw new HttpError(400, 'Ce numéro Telnyx est déjà utilisé par une autre entreprise.');
    }
    throw err;
  }

  return getSmsSettings(undefined as any, context);
};

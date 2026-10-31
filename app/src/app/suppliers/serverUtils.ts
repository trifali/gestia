import { HttpError } from 'wasp/server';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import { putObject, getPresignedUrl } from '../../server/storage';
import { companySmtp, sendEmailWithAttachment } from '../../server/mail';

const IMAGE_JPEG_QUALITY = 82;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

export async function ensureSupplierOwned(supplierId: string, companyId: string, entities: any) {
  const supplier = await entities.Supplier.findUnique({ where: { id: supplierId } });
  if (!supplier || supplier.companyId !== companyId) throw new HttpError(404, 'Fournisseur introuvable');
  return supplier;
}

export function uid(): string {
  return randomBytes(12).toString('hex');
}

export function generateToken(): string {
  return randomBytes(24).toString('hex');
}

export function supplierKey(companyId: string, supplierId: string, area: 'files' | 'invoices', filename: string): string {
  return `companies/${companyId}/suppliers/${supplierId}/${area}/${filename}`;
}

/**
 * Décode un data URL, compresse les photos (une facture prise au cellulaire pèse
 * vite 5 Mo) et dépose le tout dans MinIO.
 */
export async function storeDataUrl(
  dataUrl: string,
  originalName: string,
  keyFor: (filename: string) => string,
): Promise<{ key: string; mimeType: string; size: number }> {
  const m = /^data:([a-zA-Z0-9.+/\-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'Format de fichier invalide');
  let mimeType = m[1];
  let buffer: Buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > MAX_FILE_BYTES) throw new HttpError(400, 'Fichier trop volumineux (max 20 Mo)');

  let ext: string;
  if (['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff'].includes(mimeType)) {
    buffer = Buffer.from(await sharp(buffer).rotate().jpeg({ quality: IMAGE_JPEG_QUALITY, mozjpeg: true }).toBuffer());
    mimeType = 'image/jpeg';
    ext = 'jpg';
  } else {
    ext = originalName.includes('.') ? originalName.split('.').pop()!.toLowerCase() : 'bin';
  }

  const key = keyFor(`${uid()}.${ext}`);
  await putObject(key, buffer, mimeType);
  return { key, mimeType, size: buffer.length };
}

export async function urlFor(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  return getPresignedUrl(key).catch(() => null);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseAmount(v: unknown, field: string): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${field} invalide`);
  return round2(n);
}

/**
 * Une date de formulaire (« 2026-10-31 ») est ancrée à midi UTC : minuit UTC
 * tomberait la veille au soir à Montréal et s'afficherait un jour plus tôt.
 */
export function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const raw = String(v);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Courriel à l'entreprise elle-même quand un fournisseur agit dans son portail.
 * Silencieux sans SMTP configuré ou sans courriel d'entreprise : une alerte
 * manquée ne doit jamais faire échouer le dépôt d'une facture.
 */
export async function notifyCompany(
  entities: any,
  supplier: { companyId: string; name: string; notifyOnPortalActivity: boolean },
  subject: string,
  lines: string[],
): Promise<void> {
  if (!supplier.notifyOnPortalActivity) return;
  try {
    const company = await entities.Company.findUnique({ where: { id: supplier.companyId } });
    const smtp = companySmtp(company);
    const to = (company?.email || '').trim();
    if (!smtp || !to) return;
    const text = [...lines, '', 'Connectez-vous à Gestia, section Fournisseurs, pour la consulter.'].join('\n');
    const html = text
      .split('\n')
      .map((l) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
      .join('');
    await sendEmailWithAttachment({ smtp, to, subject, text, html, fromName: 'Gestia Notifications' });
  } catch (err) {
    console.error('[suppliers] notification failed:', err);
  }
}

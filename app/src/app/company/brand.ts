// Server operations for company branding (logo + colors + tagline).
// Logo is stored on MinIO under `companies/{companyId}/logo.jpg` after
// being optimized + converted to JPEG with sharp.

import { HttpError } from 'wasp/server';
import type {
  UploadCompanyLogo,
  RemoveCompanyLogo,
  UpdateCompanyBrand,
  GetCompanyBrandAssets,
} from 'wasp/server/operations';
import type { Company } from 'wasp/entities';
import sharp from 'sharp';
import { putObject, removeObject, getObjectBuffer } from '../../server/storage';
import { requireAdmin } from '../../server/tenant';

const MAX_LOGO_BYTES = 8 * 1024 * 1024; // 8 MB upload cap (raw input)
const LOGO_MAX_WIDTH = 800;
const LOGO_JPEG_QUALITY = 85;

function ensureCompany(user: any): string {
  if (!user) throw new HttpError(401);
  if (!user.companyId) throw new HttpError(403, 'Aucune entreprise associée');
  return user.companyId;
}

function decodeDataUrl(dataUrl: string): Buffer {
  const m = /^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, "Format d'image invalide (data URL attendu)");
  return Buffer.from(m[2], 'base64');
}

type UploadArgs = { dataUrl: string };

export const uploadCompanyLogo: UploadCompanyLogo<UploadArgs, Company> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  requireAdmin(context.user);
  if (!args?.dataUrl) throw new HttpError(400, 'Image manquante');

  const raw = decodeDataUrl(args.dataUrl);
  if (raw.length > MAX_LOGO_BYTES) {
    throw new HttpError(400, 'Image trop volumineuse (max 8 Mo)');
  }

  // Composite onto white so transparent PNGs become a clean JPG, then
  // resize down (no upscaling) and re-encode as progressive JPEG.
  let optimized: Buffer;
  try {
    optimized = await sharp(raw, { failOn: 'none' })
      .rotate() // honor EXIF
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize({ width: LOGO_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: LOGO_JPEG_QUALITY, progressive: true, mozjpeg: true })
      .toBuffer();
  } catch (e: any) {
    throw new HttpError(400, "Impossible de traiter l'image : " + (e?.message || 'erreur sharp'));
  }

  const key = `companies/${companyId}/logo.jpg`;
  await putObject(key, optimized, 'image/jpeg');

  return context.entities.Company.update({
    where: { id: companyId },
    data: { brandLogoKey: key },
  });
};

export const removeCompanyLogo: RemoveCompanyLogo<void, Company> = async (_args, context) => {
  const companyId = ensureCompany(context.user);
  requireAdmin(context.user);
  const company = await context.entities.Company.findUnique({ where: { id: companyId } });
  if (!company) throw new HttpError(404);
  if (company.brandLogoKey) {
    await removeObject(company.brandLogoKey);
  }
  return context.entities.Company.update({
    where: { id: companyId },
    data: { brandLogoKey: null },
  });
};

type BrandArgs = Partial<{
  brandPrimaryColor: string;
  brandAccentColor: string;
  brandTextColor: string;
  brandTagline: string;
}>;

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
function sanitizeColor(c: string | undefined, fallback: string): string {
  if (!c) return fallback;
  return HEX_RE.test(c) ? c : fallback;
}

export const updateCompanyBrand: UpdateCompanyBrand<BrandArgs, Company> = async (args, context) => {
  const companyId = ensureCompany(context.user);
  requireAdmin(context.user);
  return context.entities.Company.update({
    where: { id: companyId },
    data: {
      brandPrimaryColor: sanitizeColor(args.brandPrimaryColor, '#0E0E0E'),
      brandAccentColor: sanitizeColor(args.brandAccentColor, '#D4A24C'),
      brandTextColor: sanitizeColor(args.brandTextColor, '#1A1A1A'),
      brandTagline: (args.brandTagline ?? '').toString().slice(0, 200) || null,
    },
  });
};

type BrandAssets = {
  logoDataUrl: string | null;
  primaryColor: string;
  accentColor: string;
  textColor: string;
  tagline: string | null;
};

export const getCompanyBrandAssets: GetCompanyBrandAssets<void, BrandAssets> = async (
  _args,
  context,
) => {
  const companyId = ensureCompany(context.user);
  const company = await context.entities.Company.findUnique({ where: { id: companyId } });
  if (!company) throw new HttpError(404);

  let logoDataUrl: string | null = null;
  if (company.brandLogoKey) {
    try {
      const buf = await getObjectBuffer(company.brandLogoKey);
      logoDataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch {
      logoDataUrl = null;
    }
  }

  return {
    logoDataUrl,
    primaryColor: company.brandPrimaryColor || '#0E0E0E',
    accentColor: company.brandAccentColor || '#D4A24C',
    textColor: company.brandTextColor || '#1A1A1A',
    tagline: company.brandTagline,
  };
};

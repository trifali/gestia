-- AlterTable
ALTER TABLE "Company" ADD COLUMN "brandLogoKey" TEXT;
ALTER TABLE "Company" ADD COLUMN "brandPrimaryColor" TEXT DEFAULT '#0E0E0E';
ALTER TABLE "Company" ADD COLUMN "brandAccentColor" TEXT DEFAULT '#D4A24C';
ALTER TABLE "Company" ADD COLUMN "brandTextColor" TEXT DEFAULT '#1A1A1A';
ALTER TABLE "Company" ADD COLUMN "brandTagline" TEXT;

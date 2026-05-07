-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "contactedByEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "contactedByPhone" BOOLEAN NOT NULL DEFAULT false;

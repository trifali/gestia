-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "notifyInboundLeadByEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyInboundLeadBySms" BOOLEAN NOT NULL DEFAULT false;

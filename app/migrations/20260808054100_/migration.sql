/*
  Warnings:

  - You are about to drop the column `notifyInboundLeadByEmail` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `notifyInboundLeadBySms` on the `Company` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Company" DROP COLUMN "notifyInboundLeadByEmail",
DROP COLUMN "notifyInboundLeadBySms";

-- AlterTable
ALTER TABLE "LeadInboundWebhook" ADD COLUMN     "notifyByEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyBySms" BOOLEAN NOT NULL DEFAULT false;

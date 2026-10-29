-- AlterTable
ALTER TABLE "LeadSearchShareToken" ADD COLUMN     "permissions" JSONB NOT NULL DEFAULT '{}';

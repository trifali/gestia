-- AlterTable: add modality fields to Company
ALTER TABLE "Company" ADD COLUMN "modalityDownpaymentPercent" DOUBLE PRECISION;
ALTER TABLE "Company" ADD COLUMN "modalityPaymentMethods" TEXT;
ALTER TABLE "Company" ADD COLUMN "modalityPaymentTermsDays" INTEGER;
ALTER TABLE "Company" ADD COLUMN "modalityLateFeePercent" DOUBLE PRECISION;
ALTER TABLE "Company" ADD COLUMN "modalityDepositRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN "modalityWarrantyMonths" INTEGER;
ALTER TABLE "Company" ADD COLUMN "modalityWarrantyDetails" TEXT;
ALTER TABLE "Company" ADD COLUMN "modalityCancellationPolicy" TEXT;
ALTER TABLE "Company" ADD COLUMN "modalityContractTerms" TEXT;

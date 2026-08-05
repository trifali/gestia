-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "notifySmsReplyByEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifySmsReplyBySms" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telnyxApiKey" TEXT,
ADD COLUMN     "telnyxPhoneNumber" TEXT,
ADD COLUMN     "telnyxPublicKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Company_telnyxPhoneNumber_key" ON "Company"("telnyxPhoneNumber");

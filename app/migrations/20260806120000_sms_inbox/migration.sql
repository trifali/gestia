-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "smsInboxEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SmsContact" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "SmsContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsContact_companyId_name_idx" ON "SmsContact"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SmsContact_companyId_phone_key" ON "SmsContact"("companyId", "phone");

-- AddForeignKey
ALTER TABLE "SmsContact" ADD CONSTRAINT "SmsContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropIndex
DROP INDEX "LeadSmsLog_companyId_identifier_idx";

-- CreateIndex
-- La boîte de réception cherche le dernier message de chaque fil ; l'index à
-- trois colonnes couvre aussi l'ancien préfixe à deux.
CREATE INDEX "LeadSmsLog_companyId_identifier_createdAt_idx" ON "LeadSmsLog"("companyId", "identifier", "createdAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- Données : activation et reprise
-- ─────────────────────────────────────────────────────────────────────────────

-- Les entreprises qui ont déjà configuré Telnyx héritent de la messagerie
-- activée : elles n'ont pas à aller chercher un interrupteur pour une
-- fonctionnalité qui leur arrive.
UPDATE "Company"
SET "smsInboxEnabled" = true
WHERE "telnyxPhoneNumber" IS NOT NULL AND "telnyxApiKey" IS NOT NULL;

-- Les SMS entrants non attribués deviennent de vraies conversations `tel:+…`
-- sous l'entreprise propriétaire du numéro Telnyx destinataire. Les lignes
-- source restent en archive dans SmsInboundUnmatched ; celles dont "to" ne
-- correspond à aucune entreprise sont écartées par le JOIN interne.
INSERT INTO "LeadSmsLog" (
    "id", "createdAt", "companyId", "identifier",
    "to", "fromNumber", "body", "providerId",
    "direction", "status", "errorCode", "readAt"
)
SELECT
    gen_random_uuid()::text,
    u."createdAt",
    c."id",
    'tel:' || u."fromNumber",
    u."to",          -- entrant : "to" = notre numéro Telnyx
    u."fromNumber",  --           "fromNumber" = l'inconnu
    u."body",
    u."providerId",
    'inbound',
    'received',
    NULL,
    -- Personne ne les a jamais lus, donc non lus — sauf les anciens, qui
    -- allumeraient une pastille pour des messages que plus personne ne traitera.
    CASE WHEN u."createdAt" >= NOW() - INTERVAL '30 days' THEN NULL ELSE NOW() END
FROM "SmsInboundUnmatched" u
JOIN "Company" c ON c."telnyxPhoneNumber" = u."to"
ON CONFLICT ("providerId") DO NOTHING;

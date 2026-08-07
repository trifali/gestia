-- Alerte de réponse différée sur les deux canaux.
--
-- Le courriel partait à la réception, le SMS cinq minutes plus tard. Les deux
-- partagent désormais la même échéance : rien n'est envoyé si la réponse est lue
-- dans Gestia entre-temps. Les colonnes perdent donc leur préfixe « sms », qui
-- laissait croire que l'échéance ne concernait qu'un canal.

-- AlterTable
ALTER TABLE "LeadSmsLog" RENAME COLUMN "smsAlertDueAt" TO "replyAlertDueAt";
ALTER TABLE "LeadSmsLog" RENAME COLUMN "smsAlertSentAt" TO "replyAlertSentAt";

-- AlterIndex
ALTER INDEX "LeadSmsLog_smsAlertDueAt_idx" RENAME TO "LeadSmsLog_replyAlertDueAt_idx";

-- AlterTable
-- Le volet courriel se règle en une passe ; le SMS retente chaque minute. Sans
-- marqueur propre au courriel, chaque reprise SMS le renverrait.
ALTER TABLE "LeadSmsLog" ADD COLUMN "replyAlertEmailSentAt" TIMESTAMP(3);

-- Les alertes déjà en vol ont vu leur courriel partir immédiatement sous
-- l'ancien code : on referme leur volet courriel pour que la tâche ne le
-- réexpédie pas à l'échéance.
UPDATE "LeadSmsLog"
SET "replyAlertEmailSentAt" = CURRENT_TIMESTAMP
WHERE "replyAlertDueAt" IS NOT NULL AND "replyAlertSentAt" IS NULL;

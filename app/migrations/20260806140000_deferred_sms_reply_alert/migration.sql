-- Alerte SMS différée.
--
-- L'alerte SMS de réponse n'est plus postée à la réception du message : elle
-- est datée à +5 minutes, et la tâche planifiée `sendDueSmsReplyAlerts` ne
-- l'envoie que si le message est toujours non lu à l'échéance. Une réponse vue
-- dans Gestia entre-temps ne coûte donc plus rien.

-- AlterTable
ALTER TABLE "LeadSmsLog" ADD COLUMN     "smsAlertDueAt" TIMESTAMP(3),
ADD COLUMN     "smsAlertSentAt" TIMESTAMP(3);

-- CreateIndex
-- Balayage à la minute : sans index, chaque passage scanne toute la table alors
-- qu'une poignée de lignes seulement porte une échéance.
CREATE INDEX "LeadSmsLog_smsAlertDueAt_idx" ON "LeadSmsLog"("smsAlertDueAt");

-- Les entrants déjà en base n'ont jamais eu d'échéance : ils gardent
-- `smsAlertDueAt` NULL et ne déclencheront donc aucune alerte rétroactive. Rien
-- à reprendre — l'alerte immédiate de l'ancien code a déjà été envoyée ou non.

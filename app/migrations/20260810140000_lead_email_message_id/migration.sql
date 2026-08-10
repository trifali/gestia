-- AlterTable
ALTER TABLE "LeadEmailLog" ADD COLUMN     "messageId" TEXT;

-- Colonne nullable volontairement : les courriels déjà partis n'ont pas de
-- Message-ID conservé. Leur corps est stocké, donc ils restent citables dans une
-- relance — ils ne peuvent simplement pas être rattachés à un fil de discussion.

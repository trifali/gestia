-- AlterTable: remove dueDate from ProjectTask
ALTER TABLE "ProjectTask" DROP COLUMN IF EXISTS "dueDate";

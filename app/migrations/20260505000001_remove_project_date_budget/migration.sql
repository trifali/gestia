-- AlterTable: remove startDate, dueDate, budget from Project
ALTER TABLE "Project" DROP COLUMN IF EXISTS "startDate";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "dueDate";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "budget";

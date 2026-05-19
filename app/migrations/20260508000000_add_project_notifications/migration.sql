-- AddColumn
ALTER TABLE "Project" ADD COLUMN "notifyAdminOnClientActivity" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "notifyClientOnActivity" BOOLEAN NOT NULL DEFAULT false;

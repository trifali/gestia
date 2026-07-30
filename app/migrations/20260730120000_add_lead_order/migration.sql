-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- Backfill: keep the existing creation order as the explicit manual order.
UPDATE "Lead" AS l
SET "order" = r.rn
FROM (
  SELECT "id",
         (ROW_NUMBER() OVER (PARTITION BY "searchId" ORDER BY "createdAt" ASC, "id" ASC) - 1) AS rn
  FROM "Lead"
) AS r
WHERE l."id" = r."id";

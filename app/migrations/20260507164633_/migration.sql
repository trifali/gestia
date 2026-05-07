/*
  Warnings:

  - You are about to drop the column `contactedByEmail` on the `Lead` table. All the data in the column will be lost.
  - You are about to drop the column `contactedByPhone` on the `Lead` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Lead" DROP COLUMN "contactedByEmail",
DROP COLUMN "contactedByPhone";

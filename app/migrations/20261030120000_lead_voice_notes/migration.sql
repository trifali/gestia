-- AlterTable
ALTER TABLE "LeadNote" ADD COLUMN     "audioDuration" DOUBLE PRECISION,
ADD COLUMN     "audioKey" TEXT,
ADD COLUMN     "audioMime" TEXT,
ADD COLUMN     "audioPeaks" JSONB;

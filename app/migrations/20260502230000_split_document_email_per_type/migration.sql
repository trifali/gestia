-- Add per-type email subject/body, drop the previous combined columns.
ALTER TABLE "Document" ADD COLUMN "emailBodyInvoice" TEXT;
ALTER TABLE "Document" ADD COLUMN "emailBodyQuote" TEXT;
ALTER TABLE "Document" ADD COLUMN "emailSubjectInvoice" TEXT;
ALTER TABLE "Document" ADD COLUMN "emailSubjectQuote" TEXT;

-- Backfill existing data from the old combined columns based on the document's current type.
UPDATE "Document"
SET
  "emailSubjectQuote" = "emailSubject",
  "emailBodyQuote" = "emailBody"
WHERE "type" = 'quote' AND ("emailSubject" IS NOT NULL OR "emailBody" IS NOT NULL);

UPDATE "Document"
SET
  "emailSubjectInvoice" = "emailSubject",
  "emailBodyInvoice" = "emailBody"
WHERE "type" = 'invoice' AND ("emailSubject" IS NOT NULL OR "emailBody" IS NOT NULL);

ALTER TABLE "Document" DROP COLUMN "emailBody";
ALTER TABLE "Document" DROP COLUMN "emailSubject";

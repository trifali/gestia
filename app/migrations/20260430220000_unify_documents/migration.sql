-- Unify Quote + Invoice into a single Document model, plus DocumentItem.
-- Payment now points to Document.

-- 1. CreateTable Document
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'quote',
    "number" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'brouillon',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxGst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxQst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- 2. CreateTable DocumentItem
CREATE TABLE "DocumentItem" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentItem_pkey" PRIMARY KEY ("id")
);

-- 3. Migrate quotes -> documents (preserve ids so Payment FKs would still work
--    even if any quote-linked references existed; Payments only point at
--    invoices, but keeping ids is harmless and aids any future lookups).
INSERT INTO "Document" (
  "id", "createdAt", "updatedAt", "companyId", "clientId", "projectId",
  "type", "number", "title", "description", "status",
  "issueDate", "validUntil", "dueDate",
  "subtotal", "taxGst", "taxQst", "total", "amountPaid", "notes"
)
SELECT
  q."id", q."createdAt", q."updatedAt", q."companyId", q."clientId", q."projectId",
  'quote', q."number", q."title", q."description", q."status",
  q."issueDate", q."validUntil", NULL,
  q."subtotal", q."taxGst", q."taxQst", q."total", 0, q."notes"
FROM "Quote" q;

-- 4. Migrate invoices -> documents
INSERT INTO "Document" (
  "id", "createdAt", "updatedAt", "companyId", "clientId", "projectId",
  "type", "number", "title", "description", "status",
  "issueDate", "validUntil", "dueDate",
  "subtotal", "taxGst", "taxQst", "total", "amountPaid", "notes"
)
SELECT
  i."id", i."createdAt", i."updatedAt", i."companyId", i."clientId", i."projectId",
  'invoice', i."number", NULL, NULL, i."status",
  i."issueDate", NULL, i."dueDate",
  i."subtotal", i."taxGst", i."taxQst", i."total", i."amountPaid", i."notes"
FROM "Invoice" i;

-- 5. Migrate quote items -> document items
INSERT INTO "DocumentItem" ("id", "documentId", "description", "quantity", "unitPrice", "amount")
SELECT qi."id", qi."quoteId", qi."description", qi."quantity", qi."unitPrice", qi."amount"
FROM "QuoteItem" qi;

-- 6. Migrate invoice items -> document items
INSERT INTO "DocumentItem" ("id", "documentId", "description", "quantity", "unitPrice", "amount")
SELECT ii."id", ii."invoiceId", ii."description", ii."quantity", ii."unitPrice", ii."amount"
FROM "InvoiceItem" ii;

-- 7. Add documentId to Payment, copy from invoiceId, then drop old FK + column.
ALTER TABLE "Payment" ADD COLUMN "documentId" TEXT;
UPDATE "Payment" SET "documentId" = "invoiceId";
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_invoiceId_fkey";
ALTER TABLE "Payment" DROP COLUMN "invoiceId";
ALTER TABLE "Payment" ALTER COLUMN "documentId" SET NOT NULL;

-- 8. Drop old tables.
DROP TABLE "QuoteItem";
DROP TABLE "Quote";
DROP TABLE "InvoiceItem";
DROP TABLE "Invoice";

-- 9. Foreign keys for new tables
ALTER TABLE "Document" ADD CONSTRAINT "Document_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DocumentItem" ADD CONSTRAINT "DocumentItem_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

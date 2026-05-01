-- Enforce per-company uniqueness of Document.number.
CREATE UNIQUE INDEX "Document_companyId_number_key" ON "Document"("companyId", "number");

-- CreateTable
CREATE TABLE "LeadSearchShareToken" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "LeadSearchShareToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadSearchShareToken_searchId_key" ON "LeadSearchShareToken"("searchId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSearchShareToken_token_key" ON "LeadSearchShareToken"("token");

-- CreateIndex
CREATE INDEX "LeadSearchShareToken_companyId_idx" ON "LeadSearchShareToken"("companyId");

-- AddForeignKey
ALTER TABLE "LeadSearchShareToken" ADD CONSTRAINT "LeadSearchShareToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearchShareToken" ADD CONSTRAINT "LeadSearchShareToken_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "LeadSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

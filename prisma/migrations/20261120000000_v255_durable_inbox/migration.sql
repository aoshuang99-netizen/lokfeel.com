-- CreateTable
CREATE TABLE "BillingInboxEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deliveryId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "paymentId" TEXT,
    "subscriptionId" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastNote" TEXT,
    "providerTruth" JSONB,
    "resolutionCommands" JSONB,
    "appliedToLedger" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingInboxEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingInboxEvent_deliveryId_key" ON "BillingInboxEvent"("deliveryId");

-- CreateIndex
CREATE INDEX "BillingInboxEvent_organizationId_status_updatedAt_idx" ON "BillingInboxEvent"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "BillingInboxEvent_status_updatedAt_idx" ON "BillingInboxEvent"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "BillingInboxEvent_paymentId_idx" ON "BillingInboxEvent"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInboxEvent_organizationId_eventId_key" ON "BillingInboxEvent"("organizationId", "eventId");


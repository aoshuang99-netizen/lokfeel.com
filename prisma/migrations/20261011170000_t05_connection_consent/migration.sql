-- T05 · Consent & Trust —— 双边同意、审批、撤销
--
-- 权威来源：`npx prisma migrate diff --from-schema <T05 前快照> --to-schema prisma/schema --script`
-- 原样抄录，不做手写猜测（保证 Prisma client 与真实表结构不漂移）。
--
-- 与 T04 的差别：T04 是**零 DDL**（新增枚举成员对 TEXT 列不产生 DDL），
-- 本刀是**纯新增**（两张新表 + 10 个索引），无任何 ALTER / DROP，因此同样零停机。
-- 线上应用走 `node scripts/connection/migrate.mjs apply --batch=C2 --yes`（幂等）。

-- CreateTable
CREATE TABLE "ConnectionProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "proposerId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONSENT_PENDING',
    "rationale" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "introducedAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ConnectionProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConnectionProposal_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConnectionProposal_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConnectionProposal_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProposalDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProposalDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProposalDecision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ConnectionProposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProposalDecision_personId_fkey" FOREIGN KEY ("personId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ConnectionProposal_organizationId_status_idx" ON "ConnectionProposal"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ConnectionProposal_organizationId_missionId_idx" ON "ConnectionProposal"("organizationId", "missionId");

-- CreateIndex
CREATE INDEX "ConnectionProposal_proposerId_status_idx" ON "ConnectionProposal"("proposerId", "status");

-- CreateIndex
CREATE INDEX "ConnectionProposal_candidateId_status_idx" ON "ConnectionProposal"("candidateId", "status");

-- CreateIndex
CREATE INDEX "ConnectionProposal_expiresAt_idx" ON "ConnectionProposal"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectionProposal_missionId_proposerId_candidateId_key" ON "ConnectionProposal"("missionId", "proposerId", "candidateId");

-- CreateIndex
CREATE INDEX "ProposalDecision_organizationId_idx" ON "ProposalDecision"("organizationId");

-- CreateIndex
CREATE INDEX "ProposalDecision_personId_decidedAt_idx" ON "ProposalDecision"("personId", "decidedAt");

-- CreateIndex
CREATE INDEX "ProposalDecision_decision_idx" ON "ProposalDecision"("decision");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalDecision_proposalId_personId_key" ON "ProposalDecision"("proposalId", "personId");

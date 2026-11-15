-- V21 · 第二批「服务端真实闭环」—— 执行闭环三表 + 两个可选列
--
-- 变更记录：C05（2026-11-15）
-- 权威来源（不是手写猜测）：
--   npx prisma migrate diff \
--     --from-schema <迁移前 schema 快照> \
--     --to-schema prisma/schema --script
--   其中「迁移前快照」= 当前 prisma/schema 去掉 v21.prisma、并去掉 Mission.sourceRunId /
--   IdempotencyRecord.actorId 两行后的副本（见 docs/v21/batch3/C05_MIGRATION.md §2）。
--
-- 性质：**纯新增**。3 张新表 + 6 条索引 + 2 条 ALTER TABLE ADD COLUMN（均可空）。
--       无 DROP、无重建、无数据回填，因此零停机、对旧行零影响（旧行新列一律 NULL）。
--
-- ⚠️ 为什么不用 `--from-migrations`：
--   本仓 prisma/migrations 下的历史迁移是**变更记录**（见 20261010150000_t01_tenancy
--   抬头说明），其中 20250413 / 20250425 / 20260428 三个文件是 PostgreSQL 方言
--   （DO $$ ... CREATE TYPE / TEXT[] / ADD COLUMN IF NOT EXISTS / TIMESTAMP(3)），
--   无法在 SQLite shadow DB 上重放（P3006: near "DO": syntax error）。
--   故迁移基线用「迁移前 schema 快照」表达，等价且可复现；详见 C05_MIGRATION.md §3。
--
-- 应用方式（生产 / 预发）：
--   本文件**不是**幂等脚本（CREATE TABLE 无 IF NOT EXISTS），只能执行一次。
--   生产执行需 Owner 单独授权，执行前先备份，见 C05_MIGRATION.md §6。

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN "sourceRunId" TEXT;

-- AlterTable
ALTER TABLE "IdempotencyRecord" ADD COLUMN "actorId" TEXT;

-- CreateTable
CREATE TABLE "MissionSpecRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "specJson" TEXT NOT NULL,
    "goal" TEXT,
    "offer" TEXT,
    "successCriteria" TEXT,
    "expiresAt" TEXT,
    "changeNote" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExecutionVerification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "receiptRef" TEXT,
    "verdict" TEXT NOT NULL,
    "criteriaJson" TEXT NOT NULL,
    "evidenceNote" TEXT,
    "verifierId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AgentRunStageEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "detail" TEXT
);

-- CreateIndex
CREATE INDEX "MissionSpecRevision_organizationId_missionId_version_idx" ON "MissionSpecRevision"("organizationId", "missionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MissionSpecRevision_missionId_version_key" ON "MissionSpecRevision"("missionId", "version");

-- CreateIndex
CREATE INDEX "ExecutionVerification_organizationId_missionId_idx" ON "ExecutionVerification"("organizationId", "missionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionVerification_missionId_runId_key" ON "ExecutionVerification"("missionId", "runId");

-- CreateIndex
CREATE INDEX "AgentRunStageEvent_organizationId_runId_seq_idx" ON "AgentRunStageEvent"("organizationId", "runId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRunStageEvent_runId_seq_key" ON "AgentRunStageEvent"("runId", "seq");

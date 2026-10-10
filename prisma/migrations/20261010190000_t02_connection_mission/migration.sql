-- T02 · Connection OS · Mission 三表（批次 C0）
--
-- 状态：**已在生产 libSQL/Turso 执行**（2026-10-10），对账见
--       `node scripts/connection/migrate.mjs verify`。
--
-- ⚠️ 本文件是**变更记录**，不是可重复执行的迁移脚本。
--    真正的执行入口是：
--
--        node scripts/connection/migrate.mjs apply   --batch=C0 --yes
--        node scripts/connection/migrate.mjs rollback --batch=C0 --yes
--
--    与 T01 的 M0/M1/M2 不同，本批次是**纯新增**（不改既有表），
--    因此 DDL 全部带 `IF NOT EXISTS`，脚本天然幂等、可反复执行。
--
-- 血缘：表结构由 `npx prisma migrate diff --from-empty --to-schema prisma/schema --script`
--       生成后原样抄录，保证 Prisma client 与真实表结构不漂移。
--
-- 设计要点见 docs/implementation/T02/risks.md：
--   R1 分享页是匿名可达面 → 限流 + 白名单投影 + no-store
--   R2 JSON-in-String 单点 codec（constraints 为 TEXT，非 jsonb）
--   R3 名额竞态（先写再核对 + 补偿）与 RLS 缺失（应用级隔离）

-- ══════════════════════════════════════════════════════════════
-- C0 · Mission
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Mission" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "offer" TEXT NOT NULL,
  "constraints" TEXT,
  "successCriteria" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "shareToken" TEXT NOT NULL,
  "publicPreview" BOOLEAN NOT NULL DEFAULT true,
  "maxParticipants" INTEGER,
  "expiresAt" DATETIME,
  "publishedAt" DATETIME,
  "closedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Mission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Mission_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Mission_shareToken_key" ON "Mission"("shareToken");
CREATE INDEX IF NOT EXISTS "Mission_organizationId_status_idx" ON "Mission"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Mission_organizationId_createdAt_idx" ON "Mission"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Mission_expiresAt_idx" ON "Mission"("expiresAt");

-- ══════════════════════════════════════════════════════════════
-- C0 · MissionParticipation（成员 × Mission 的加入关系）
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "MissionParticipation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'INTERESTED',
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MissionParticipation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MissionParticipation_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MissionParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "MissionParticipation_missionId_userId_key" ON "MissionParticipation"("missionId", "userId");
CREATE INDEX IF NOT EXISTS "MissionParticipation_organizationId_status_idx" ON "MissionParticipation"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "MissionParticipation_userId_status_idx" ON "MissionParticipation"("userId", "status");

-- ══════════════════════════════════════════════════════════════
-- C0 · IdempotencyRecord（POST /missions 的 Idempotency-Key 落点）
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdempotencyRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyRecord_organizationId_scope_key_key" ON "IdempotencyRecord"("organizationId", "scope", "key");
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_organizationId_createdAt_idx" ON "IdempotencyRecord"("organizationId", "createdAt");

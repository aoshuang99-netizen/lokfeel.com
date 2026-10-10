-- T01 · 多租户底座（M0 / M1 / M2）
--
-- 状态：**已在生产 libSQL/Turso 执行完毕**（2026-10-10），对账 18/18 通过。
--
-- ⚠️ 本文件是**变更记录**，不是可重复执行的迁移脚本。
--    SQLite/libSQL 的 `ALTER TABLE ADD COLUMN` 不支持 `IF NOT EXISTS`，
--    重复执行会报 "duplicate column name"。真正的执行入口是：
--
--        node scripts/tenancy/migrate.mjs apply --batch=M0|M1|M2|ALL --yes
--
--    该脚本先查 `PRAGMA table_info` 再决定是否加列，因此**幂等可重跑**。
--    本文件用于其它环境手工对齐，以及为 M6（PostgreSQL 搬迁）保留血缘。
--
-- 设计原则见 docs/implementation/MIGRATION_PLAN.md §2.1「加列优先」：
--    先加**可空**列 → 回填 → 观察期后再加 NOT NULL/RLS（M5）。
--    因此本批次不改变任何既有查询的行为。

-- ══════════════════════════════════════════════════════════════
-- M0 · 租户三表 + 默认租户
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Organization" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX IF NOT EXISTS "Organization_status_idx" ON "Organization"("status");

CREATE TABLE IF NOT EXISTS "Membership" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'MEMBER',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "Membership_userId_status_idx" ON "Membership"("userId", "status");
CREATE INDEX IF NOT EXISTS "Membership_organizationId_role_idx" ON "Membership"("organizationId", "role");

CREATE TABLE IF NOT EXISTS "TenantAuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "safeMetadata" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TenantAuditEvent_organizationId_createdAt_idx" ON "TenantAuditEvent"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "TenantAuditEvent_organizationId_eventType_idx" ON "TenantAuditEvent"("organizationId", "eventType");
CREATE INDEX IF NOT EXISTS "TenantAuditEvent_resourceType_resourceId_idx" ON "TenantAuditEvent"("resourceType", "resourceId");

-- 默认租户：承接全部存量数据。slug='default' 是幂等锚点。
INSERT INTO "Organization" ("id", "name", "slug", "status", "createdAt", "updatedAt")
SELECT 'org_default', 'Default Organization', 'default', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Organization" WHERE "slug" = 'default');

-- ══════════════════════════════════════════════════════════════
-- M1 · 既有业务表加可空 organizationId（11 张）
-- ══════════════════════════════════════════════════════════════
--
-- 有意**不**纳入的表及理由：
--   User / Account / Session / VerificationToken —— 身份是全局的，租户归属靠 Membership 表达
--   Profile                                      —— 挂在 User 下的「人」的属性，随 User 跨租户
--   ConversationParticipant / MessageReceipt / MessageReaction / UserPresence —— 从属表，随父表
--   Admin* / Analytics* / SystemConfig / CustomRole —— 平台级，非租户资源
--   AuditLog                                     —— 保留原状；租户安全事件走新表 TenantAuditEvent

ALTER TABLE "Match" ADD COLUMN "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Match_organizationId_idx" ON "Match"("organizationId");

ALTER TABLE "Conversation" ADD COLUMN "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Conversation_organizationId_idx" ON "Conversation"("organizationId");

ALTER TABLE "IMMessage" ADD COLUMN "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "IMMessage_organizationId_idx" ON "IMMessage"("organizationId");

ALTER TABLE "ConsentRequest" ADD COLUMN "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ConsentRequest_organizationId_idx" ON "ConsentRequest"("organizationId");

ALTER TABLE "ConsentGrant" ADD COLUMN "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ConsentGrant_organizationId_idx" ON "ConsentGrant"("organizationId");

ALTER TABLE "PowerBoardRule" ADD COLUMN "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "PowerBoardRule_organizationId_idx" ON "PowerBoardRule"("organizationId");

ALTER TABLE "Subscription" ADD COLUMN "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Subscription_organizationId_idx" ON "Subscription"("organizationId");

ALTER TABLE "Payment" ADD COLUMN "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Payment_organizationId_idx" ON "Payment"("organizationId");

ALTER TABLE "Notification" ADD COLUMN "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Notification_organizationId_idx" ON "Notification"("organizationId");

ALTER TABLE "UserReport" ADD COLUMN "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "UserReport_organizationId_idx" ON "UserReport"("organizationId");

ALTER TABLE "Block" ADD COLUMN "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Block_organizationId_idx" ON "Block"("organizationId");

-- ══════════════════════════════════════════════════════════════
-- M2 · 回填默认租户
-- ══════════════════════════════════════════════════════════════
-- 实测回填行数（2026-10-10）：Match 114 / Conversation 109 / IMMessage 200 /
--   Subscription 2225 / Payment 56 / Notification 60，其余 0 —— 合计 2764 行。

UPDATE "Match" SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "Conversation" SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "IMMessage" SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "ConsentRequest" SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "ConsentGrant" SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "PowerBoardRule" SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "Subscription" SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "Payment" SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "Notification" SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "UserReport" SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "Block" SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;

-- ══════════════════════════════════════════════════════════════
-- 回滚（L3，见 MIGRATION_PLAN.md §4.1）
-- ══════════════════════════════════════════════════════════════
-- M2 回滚（把回填值置空）：
--   UPDATE "X" SET "organizationId" = NULL WHERE "organizationId" = 'org_default';
-- M1 回滚（SQLite 3.35+ 支持 DROP COLUMN）：
--   ALTER TABLE "X" DROP COLUMN "organizationId";
-- M0 回滚（仅当无任何外键指向时）：
--   DROP TABLE "TenantAuditEvent"; DROP TABLE "Membership"; DROP TABLE "Organization";
--
-- 注意：M0 之后**不要**直接 DROP "Organization" —— 必须先删 Membership/TenantAuditEvent
--       中的引用行，否则在启用 FK 强制的实例上会被拒。

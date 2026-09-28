-- P1-6 阶段 4：G-1 Vault 状态机迁移到终局模型 Conversation
--
-- 背景：Vault（24h 限时对话）的状态字段此前只存在于 ChatRoom。方案 A 确定
--      Conversation 为终局模型，若不先把这些列补过来，阶段 5 删除 ChatRoom 时会
--      整体丢失女性的「终结对话」权限、倒计时延长审计与截图取证数据。
--
-- 幂等性说明：本文件用 ADD COLUMN，SQLite 不支持 IF NOT EXISTS 语法于 ADD COLUMN。
-- 因此**实际建表以 `npx prisma db push` 为准**（本项目库结构由 db push 管理，
-- prisma/migrations 目录是早期 PostgreSQL 产物，不要执行 `prisma migrate deploy`）。
-- 本文件用于记录变更内容与在其它环境手工对齐。
--
-- 数据迁移见：scripts/chat-merge/migrate-vault.ts

-- Vault 四态：ACTIVE / EXTENDED / REVOKED / EXPIRED
ALTER TABLE "Conversation" ADD COLUMN "vaultStatus" TEXT NOT NULL DEFAULT 'ACTIVE';

-- 延长审计
ALTER TABLE "Conversation" ADD COLUMN "extensionCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Conversation" ADD COLUMN "extendedAt" DATETIME;
ALTER TABLE "Conversation" ADD COLUMN "extendedBy" TEXT;

-- 女性特权：终止对话
ALTER TABLE "Conversation" ADD COLUMN "revokedAt" DATETIME;
ALTER TABLE "Conversation" ADD COLUMN "revokedBy" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "revokeReason" TEXT;

-- 隐私防护
ALTER TABLE "Conversation" ADD COLUMN "screenshotCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Conversation" ADD COLUMN "lastScreenshotAt" DATETIME;

-- 状态查询索引（与 ChatRoom 侧保持一致）
CREATE INDEX IF NOT EXISTS "Conversation_vaultStatus_idx" ON "Conversation"("vaultStatus");

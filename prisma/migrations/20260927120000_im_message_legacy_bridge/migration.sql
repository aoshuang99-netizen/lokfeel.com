-- P1-6 阶段 3：双聊天系统合并 —— IMMessage 增加 Legacy 迁移桥字段
--
-- 背景：方案 A（见 docs/CHAT-MERGE-AUDIT.md §4）确定 IM（Conversation + IMMessage）
--       为终局消息模型。本字段用于把 Legacy Message 表的存量消息幂等迁入 IMMessage。
--
-- 作用：
--   1. 幂等锚点 —— 迁移脚本以 legacyMessageId 判定某条 Legacy 消息是否已迁入，
--      重复执行不会产生重复行。
--   2. 血缘追踪 —— 保留"这条 IM 消息来自哪条 Legacy 消息"的可审计链路。
--   3. 回滚依据 —— 阶段 3 若需回滚，条件即 WHERE legacyMessageId IS NOT NULL。
--
-- 生命周期：阶段 5（Legacy Message / ChatRoomMember 表删除）后本字段可一并移除。

ALTER TABLE "IMMessage" ADD COLUMN IF NOT EXISTS "legacyMessageId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "IMMessage_legacyMessageId_key"
  ON "IMMessage"("legacyMessageId");

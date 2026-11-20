-- V25.5 P0.1 · Durable Inbox 回滚
--
-- ⚠️ 纯新增表的逆操作：DROP 本表即可，不触碰 BillingEvent / Subscription 等既有账表。
-- 回滚前务必确认 inbox 中已无 REQUIRES_REVIEW / NEEDS_PROVIDER_RECONCILIATION 事件，
-- 否则这些待处理事件会随表一起消失。生产回滚需 Owner 授权 + 备份。
DROP TABLE IF EXISTS "BillingInboxEvent";

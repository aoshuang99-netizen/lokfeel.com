-- V21 · 第二批「服务端真实闭环」—— 回滚脚本
--
-- ⚠️ 这不是「一键回滚」，请在读完后按 §A / §B 分两步理解。
--
-- §A 可安全执行的部分：删除本批次**新增的三张表**
--   这三张表只被 V21 第二批代码写入；先回滚应用代码、再删表，不会留下悬空引用。
--   删表会丢失这三张表里的留痕数据 —— 回滚前必须备份（见 C05_MIGRATION.md §7）。
--
-- §B **不能**用 SQL 回滚的部分：Mission.sourceRunId / IdempotencyRecord.actorId
--   SQLite 的 `ALTER TABLE ... DROP COLUMN` 虽然 3.35+ 语法上存在，但：
--     1. 受索引 / 视图 / 触发器 / 生成列引用限制，失败模式随版本与 libSQL/Turso 实现漂移；
--     2. 语义上是**重写整表**（建新表 → 拷数据 → 删旧表 → 改名 → 重建索引），
--        对本仓的 Mission / IdempotencyRecord 这种带多张外键与唯一索引的表，
--        任何一步中断都会留下半张表；
--     3. 两个新列均为**可空、无默认值、无索引、无外键**，保留它们对旧代码**零影响**
--        （旧 Prisma Client 的 SELECT 不会读它们，INSERT 不写它们即为 NULL）。
--   因此本文件**刻意不执行列删除**，也不提供「假装能回滚」的语句。
--   真正需要物理移除列时：用迁移前备份恢复整库（推荐），或在维护窗口按
--   SQLite 官方 12 步表重建流程人工执行（禁止在生产热路径直接 DROP COLUMN）。
--
-- 应用方式（仅限已授权的环境）：
--   npx prisma db execute --file prisma/migrations/<本次迁移目录>/down.sql
--   执行前：确认应用代码已回滚到不引用新表的版本。

-- §A ─────────────────────────────────────────────────────────────
-- 顺序：先删无被引用的表；三张表之间没有外键依赖，顺序不影响结果。
DROP TABLE IF EXISTS "AgentRunStageEvent";
DROP TABLE IF EXISTS "ExecutionVerification";
DROP TABLE IF EXISTS "MissionSpecRevision";

-- §B ─────────────────────────────────────────────────────────────
-- 故意为空：见文件头 §B。不要在这里补 DROP COLUMN。

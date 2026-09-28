/**
 * 已读回执迁移谓词的唯一数据源（G-2）
 *
 * 为什么单独成文件：
 *   `migrate-receipts.ts`（写入 / 预演 / 复核）与 `retire-legacy.ts` 的 B6 门禁
 *   都必须回答同一个问题 ——「还有哪些 Legacy 已读消息在 IM 侧没有回执」。
 *   若各自写一份 SQL 谓词，就会出现"预演说 100 条、写入只写 80 条、门禁报 0 残留"
 *   这类三方不一致。本任务已多次踩到同一个模式（G-3），故收敛到此。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 对早期结论的更正（值得记录）
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 阶段 3 曾把 G-2 记为「`isRead` 是单布尔，语义上无法还原"谁已读"，属有意不回迁」。
 * **这个结论是错的**：它默认了群聊场景。本产品的会话**恒为 1:1**
 * （`IMMessage.receiverId` 是单值），"对方"唯一确定，因此 `isRead = true`
 * 可以被**无损还原**为「receiverId 的那一条回执」。
 *
 * 这类"把当时的误判写进文档、后来没人回头改"的注释，比没有注释更危险 ——
 * 它会让人基于错误前提做决策（比如"这项数据丢了也没关系"）。故在此显式更正，
 * 并同步修正 `docs/CHAT-MERGE-AUDIT.md` 与 `retire-legacy.ts` 的 B6。
 *
 * ⚠️ 若将来引入群聊，`receiverId` 不再唯一，本谓词与整个迁移都不再成立。
 *
 * @module scripts/chat-merge/shared/receipt-coverage
 */

/** IMMessage ↔ 其 Legacy 来源 Message 的关联片段 */
export const RECEIPT_JOIN_SOURCE = `FROM "IMMessage" i
       JOIN "Message" m ON m."id" = i."legacyMessageId"`;

/**
 * 「应建回执」的完整判定：
 *   已读（isRead = 1）+ 接收方有效 + 该 (messageId, userId) 尚无回执。
 *
 * 关键：**不含 `isRead = 0` 的行**。
 * 原因见 `src/app/api/im/conversations/[id]/route.ts` 的未读判定 ——
 * IM 侧"未读"= 回执行不存在。若为未读消息也写回执（即使 readAt 为 NULL），
 * 未读消息会被判为已读，未读徽章凭空归零。
 */
export const RECEIPTS_NEEDED_WHERE = `
     WHERE m."isRead" = 1
       AND i."receiverId" IS NOT NULL
       AND i."receiverId" <> i."senderId"
       AND NOT EXISTS (
         SELECT 1 FROM "MessageReceipt" r
          WHERE r."messageId" = i."id" AND r."userId" = i."receiverId"
       )`;

/** 「已读但接收方无效」—— 脏数据，单独计数而非静默丢弃 */
export const RECEIPTS_INVALID_RECEIVER_WHERE = `
     WHERE m."isRead" = 1
       AND (i."receiverId" IS NULL OR i."receiverId" = i."senderId")`;

/** 「Legacy 侧已读且接收方有效」的总量（= 应建回执的上界） */
export const RECEIPTS_SHOULD_HAVE_WHERE = `
     WHERE m."isRead" = 1
       AND i."receiverId" IS NOT NULL
       AND i."receiverId" <> i."senderId"`;

/** 以某别名引用表名时的便捷替换（供 `retire-legacy.ts` 复用） */
export const RECEIPTS_NEEDED_COUNT_SQL = `SELECT COUNT(*) AS n ${RECEIPT_JOIN_SOURCE} ${RECEIPTS_NEEDED_WHERE}`;

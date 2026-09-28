/**
 * P1-6 阶段 5 · 已读回执迁移（G-2）
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 迁移什么
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Legacy `Message.isRead`（单个布尔）→ IM `MessageReceipt`（逐人回执行）。
 *
 * 为什么这个迁移"能成立"：
 *   Legacy 是**单布尔**语义 —— "这条消息被**对方**读了"。它无法表达
 *   "谁读了"，但本产品的会话**恒为 1:1**（`ChatRoom` 只有两个成员，
 *   `IMMessage.receiverId` 是单值），因此"对方"是唯一确定的，
 *   缺失的维度在 1:1 场景下并不存在。所以这是**无损还原**，不是猜测。
 *   （若将来出现群聊，本脚本的映射不再成立 —— 已在 §局限 中标注。）
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 为什么必须只迁移 isRead = true 的行（关键设计决策）
 * ───────────────────────────────────────────────────────────────────────────
 *
 * IM 侧判定"未读"的方式是**回执行不存在**：
 *
 * ```ts
 * // src/app/api/im/conversations/[id]/route.ts
 * db.iMMessage.findMany({ where: { receipts: { none: { userId } } } })
 * ```
 *
 * 因此如果为 `isRead = false` 的消息也写一行回执（哪怕 `readAt` 为 NULL），
 * 该消息会被判为**已读** —— 未读徽章凭空归零，用户会漏掉未读消息。
 * 这是一个"看起来更完整、实际制造错误数据"的陷阱，所以本脚本**只写已读**。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 时间字段处理（遵循本仓库既有约束）
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 用 `COALESCE(m."readAt", m."createdAt")` **原值搬运**，绝不在 JS 里构造时间：
 *   · 不用 `strftime()` / `datetime()` —— 对非文本存储返回 NULL，会静默抹掉时间
 *   · `Message.readAt` 与 `MessageReceipt.readAt` 同为 Prisma `DateTime?`，
 *     存储格式一致，跨列复制是安全的
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 局限（诚实披露）
 * ───────────────────────────────────────────────────────────────────────────
 *
 * · 会话若存在 >2 名成员，本脚本会跳过（`receiverId === senderId` 或为 NULL），
 *   并在 S5 中计数 —— 当前数据模型下预期为 0。
 * · 无法还原"送达但未读"（`deliveredAt` 有值、`readAt` 为 NULL）的状态：
 *   Legacy 从未记录过送达。因此本脚本对未读消息**完全不建回执行**。
 * · 幂等依赖 `MessageReceipt` 的 `@@unique([messageId, userId])`。
 *
 * 用法：
 *   npm run chat:receipts                     # 预演（只读，不写任何数据）
 *   npm run chat:receipts:apply -- --limit=50 # 小范围试跑
 *   npm run chat:receipts:apply               # 全量
 *   npm run chat:receipts:verify              # 复核（只读）
 *
 * @see docs/CHAT-MERGE-AUDIT.md §11.3  缺口 G-2
 * @see docs/CHAT-MERGE-RUNBOOK.md §10   阶段 5 执行手册
 */

import { createClient, type Client } from '@libsql/client';
import * as dotenv from 'dotenv';

import {
  RECEIPTS_INVALID_RECEIVER_WHERE,
  RECEIPTS_NEEDED_WHERE,
  RECEIPTS_SHOULD_HAVE_WHERE,
  RECEIPT_JOIN_SOURCE as JOIN_LEGACY,
} from './shared/receipt-coverage';

dotenv.config({ path: '.env' });

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════

const argv = process.argv.slice(2);
const hasFlag = (n: string) => argv.includes(`--${n}`);
const readArg = (n: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};
const APPLY = hasFlag('apply');
const VERIFY_ONLY = hasFlag('verify');
const WANT_JSON = hasFlag('json');
const LIMIT = (() => {
  const v = readArg('limit');
  if (!v) return Number.POSITIVE_INFINITY;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
})();

const log = (...a: unknown[]) => console.log(...a);
const hr = (t: string) => log(`\n${'─'.repeat(66)}\n${t}\n${'─'.repeat(66)}`);

// ═══════════════════════════════════════════════════════════════════════════
// 连接
// ═══════════════════════════════════════════════════════════════════════════

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const AUTH_TOKEN = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim();

if (!DATABASE_URL) {
  console.error('✗ 缺少 DATABASE_URL（请检查 .env）');
  process.exit(1);
}

const client: Client = createClient({
  url: DATABASE_URL,
  ...(AUTH_TOKEN ? { authToken: AUTH_TOKEN } : {}),
});

type SqlArg = string | number | null;
type Row = Record<string, unknown>;

async function q(sql: string, args: SqlArg[] = []): Promise<Row[]> {
  const r = await client.execute({ sql, args });
  return r.rows as unknown as Row[];
}

async function safeQ(sql: string, args: SqlArg[] = []): Promise<Row[]> {
  try {
    return await q(sql, args);
  } catch (e) {
    console.warn(`  ⚠ 查询失败：${(e as Error).message}`);
    return [];
  }
}

const num = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// ═══════════════════════════════════════════════════════════════════════════
// SQL 谓词
//
// 「哪些行应建回执」的判定收敛在 `shared/receipt-coverage.ts` —— 预演、写入、
// 复核、以及 `retire-legacy.ts` 的 B6 门禁共用同一套。若各写一份，
// 三者迟早不一致（预演说 100 条、写入只写 80 条、门禁却报 0 残留）。
// ═══════════════════════════════════════════════════════════════════════════

const NEEDS_RECEIPT_WHERE = RECEIPTS_NEEDED_WHERE;
const INVALID_RECEIVER_WHERE = RECEIPTS_INVALID_RECEIVER_WHERE;
const SHOULD_HAVE_WHERE = RECEIPTS_SHOULD_HAVE_WHERE;

const countWhere = async (where: string): Promise<number> => {
  const rows = await safeQ(`SELECT COUNT(*) AS n ${JOIN_LEGACY} ${where}`);
  return num(rows[0]?.n);
};

// ═══════════════════════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════════════════════

interface Summary {
  /** 有 Legacy 血缘的 IMMessage 总数 */
  migratedMessages: number;
  /** 其中 Legacy 侧 isRead = 1（应建回执） */
  shouldHaveReceipt: number;
  /** 应建且已存在（幂等跳过） */
  alreadyExists: number;
  /** 本次待建 / 已建 */
  pending: number;
  created: number;
  /** 已读但接收方无效（知情项） */
  invalidReceiver: number;
  /** 未读（isRead = 0）却已有回执（知情项，属应用侧写入） */
  unreadWithReceipt: number;
  /** 复核后剩余不一致 */
  remaining: number;
}

const summary: Summary = {
  migratedMessages: 0,
  shouldHaveReceipt: 0,
  alreadyExists: 0,
  pending: 0,
  created: 0,
  invalidReceiver: 0,
  unreadWithReceipt: 0,
  remaining: 0,
};

async function main() {
  hr('P1-6 阶段 5 · 已读回执迁移（G-2）');
  log(`模式：${VERIFY_ONLY ? '复核（只读）' : APPLY ? '⚠ 执行写入' : '预演（只读，不写任何数据）'}`);
  log(`上限：${LIMIT === Number.POSITIVE_INFINITY ? '不限' : LIMIT}`);

  // ── 前置检查：表与列是否就绪 ──
  const receiptCols = new Set((await safeQ(`PRAGMA table_info("MessageReceipt")`)).map((c) => str(c.name)));
  if (receiptCols.size === 0) {
    console.error('\n✗ 找不到 MessageReceipt 表。请先执行：npx prisma db push && npx prisma generate');
    process.exit(1);
  }
  const requiredCols = ['id', 'messageId', 'conversationId', 'userId', 'deliveredAt', 'readAt', 'createdAt', 'updatedAt'];
  const missing = requiredCols.filter((c) => !receiptCols.has(c));
  if (missing.length > 0) {
    console.error(`\n✗ MessageReceipt 缺少列：${missing.join(', ')}`);
    console.error('  请先执行：npx prisma db push && npx prisma generate');
    process.exit(1);
  }
  log(`✓ MessageReceipt 就绪（${requiredCols.length} 个必需列全部存在）`);

  const imCols = new Set((await safeQ(`PRAGMA table_info("IMMessage")`)).map((c) => str(c.name)));
  if (!imCols.has('legacyMessageId') || !imCols.has('receiverId')) {
    console.error('\n✗ IMMessage 缺少 legacyMessageId 或 receiverId 列，无法判断血缘与接收方。');
    process.exit(1);
  }

  // ── S1 / S2 / S3 / S4 统计 ──
  hr('现状统计');
  summary.migratedMessages = num(
    (await safeQ(`SELECT COUNT(*) AS n FROM "IMMessage" WHERE "legacyMessageId" IS NOT NULL`))[0]?.n,
  );
  summary.shouldHaveReceipt = await countWhere(SHOULD_HAVE_WHERE);
  summary.pending = await countWhere(NEEDS_RECEIPT_WHERE);
  summary.alreadyExists = summary.shouldHaveReceipt - summary.pending;
  summary.invalidReceiver = await countWhere(INVALID_RECEIVER_WHERE);
  summary.unreadWithReceipt = num(
    (
      await safeQ(
        `SELECT COUNT(*) AS n ${JOIN_LEGACY}
          WHERE m."isRead" = 0
            AND EXISTS (
              SELECT 1 FROM "MessageReceipt" r
               WHERE r."messageId" = i."id" AND r."userId" = i."receiverId"
            )`,
      )
    )[0]?.n,
  );

  log(`有 Legacy 血缘的 IMMessage      : ${summary.migratedMessages}`);
  log(`其中 Legacy 侧"已读"            : ${summary.shouldHaveReceipt}   ← 应建回执的上界`);
  log(`  已存在回执（幂等跳过）        : ${summary.alreadyExists}`);
  log(`  待建回执                      : ${summary.pending}   ← 本次动作量`);
  log('');
  log(`知情项 1 · 已读但接收方无效      : ${summary.invalidReceiver}`);
  log(`知情项 2 · 未读却已有回执        : ${summary.unreadWithReceipt}`);
  if (summary.unreadWithReceipt > 0) {
    log('   说明：这些是应用侧（阶段 4 的标记已读接口）写入的，非本脚本产生。');
    log('   本脚本**不会**为 isRead=0 的行建回执 —— 那会让未读消息被判为已读。');
  }

  // ── 复核模式：到此为止 ──
  if (VERIFY_ONLY) {
    summary.remaining = summary.pending;
    hr('复核结果');
    if (summary.pending === 0) {
      log('✓ 剩余不一致 = 0 —— 已读回执迁移完整。');
    } else {
      log(`🔴 剩余不一致 = ${summary.pending} —— 仍有已读消息没有回执。`);
      log('   处置：npm run chat:receipts:apply');
      process.exitCode = 2;
    }
    emitJson();
    return;
  }

  // ── 预演：不写任何数据 ──
  if (!APPLY) {
    hr('预演样本（前 5 条待建回执）');
    const sample = await safeQ(
      `SELECT i."id" AS imId, i."legacyMessageId" AS legacyId, i."conversationId" AS convId,
              i."receiverId" AS receiverId, m."isRead" AS isRead, m."readAt" AS readAt, m."createdAt" AS createdAt
       ${JOIN_LEGACY} ${NEEDS_RECEIPT_WHERE}
       LIMIT 5`,
    );
    if (sample.length === 0) {
      log('（无需处理的行）');
    } else {
      for (const r of sample) {
        log(
          `  im=${str(r.imId).slice(0, 12)}…  legacy=${str(r.legacyId).slice(0, 12)}…  ` +
            `receiver=${str(r.receiverId).slice(0, 12)}…  ` +
            `readAt=${r.readAt === null ? '(null → 回退 createdAt)' : '有值'}`,
        );
      }
    }

    hr('预演结束');
    log('未写入任何数据。');
    log('建议先小范围试跑：npm run chat:receipts:apply -- --limit=20');
    emitJson();
    return;
  }

  // ── 执行写入 ──
  hr('执行迁移');
  const sql = `
    INSERT INTO "MessageReceipt"
      ("id","messageId","conversationId","userId","deliveredAt","readAt","createdAt","updatedAt")
    SELECT lower(hex(randomblob(16))), i."id", i."conversationId", i."receiverId",
           COALESCE(m."readAt", m."createdAt"),
           COALESCE(m."readAt", m."createdAt"),
           COALESCE(m."readAt", m."createdAt"),
           COALESCE(m."readAt", m."createdAt")
    ${JOIN_LEGACY} ${NEEDS_RECEIPT_WHERE}
     LIMIT ${LIMIT === Number.POSITIVE_INFINITY ? -1 : Math.floor(LIMIT)}`;

  const res = await client.execute({ sql, args: [] });
  summary.created = Number(res.rowsAffected ?? 0);
  log(`✓ 已创建 ${summary.created} 条已读回执`);

  // ── 复核 ──
  await verifyDrift();
  emitJson();
}

async function verifyDrift() {
  hr('复核');
  summary.remaining = await countWhere(NEEDS_RECEIPT_WHERE);
  log(`剩余不一致（已读但无回执）: ${summary.remaining}`);
  if (summary.remaining === 0) {
    log('✓ 通过 —— 所有 Legacy 已读消息在 IM 侧都有了逐人回执。');
  } else {
    log('⚠ 仍有残留。若刚跑过 --limit，这是预期（分批执行）；');
    log('  否则请检查是否有消息的 receiverId 为空或等于 senderId。');
  }

  // 反向断言：本脚本绝不应当产生"未读却已读"（这是比漏迁移更严重的错误）
  const badRows = await countWhere(
    ` WHERE m."isRead" = 0 AND EXISTS (
         SELECT 1 FROM "MessageReceipt" r
          WHERE r."messageId" = i."id" AND r."userId" = i."receiverId"
            AND r."readAt" = COALESCE(m."readAt", m."createdAt")
       )`,
  );
  log(`反向检查 · 由本脚本写入却对应未读的行: ${badRows}`);
  if (badRows > 0) {
    log('🔴 异常 —— 本脚本不应为未读消息建回执。请立即停止并排查。');
    process.exitCode = 2;
  } else {
    log('✓ 未读消息未被误标为已读。');
  }
}

function emitJson() {
  if (!WANT_JSON) return;
  log('\n' + JSON.stringify({ mode: VERIFY_ONLY ? 'verify' : APPLY ? 'apply' : 'dry-run', ...summary }, null, 2));
}

main()
  .catch((e) => {
    console.error('\n✗ 迁移失败：', e);
    process.exitCode = 1;
  })
  .finally(() => {
    // libSQL 客户端无需显式关闭；保持进程干净退出
  });

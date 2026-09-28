/**
 * P1-6 双聊天系统合并 —— 阶段 4：Vault 状态机迁移（G-1 缺口修复）
 *
 * 背景（为什么必须有这一步）：
 *   Vault（24h 限时对话）的全部状态字段此前只存在于 `ChatRoom`：
 *     · vaultStatus         四态：ACTIVE / EXTENDED / REVOKED / EXPIRED
 *     · extensionCount      延长次数（含 extendedAt / extendedBy 审计）
 *     · revokedAt/By/Reason 女性用户的「终结对话」权限凭据
 *     · screenshotCount     截图防护计数（含 lastScreenshotAt）
 *   `Conversation` 上只有 `vaultExpiresAt` 一个字段。
 *
 *   方案 A 确定 Conversation 为终局模型 ⇒ 阶段 5 删除 ChatRoom 时，若不先迁移，
 *   上述能力会**整体丢失且不可恢复**：女性无法再"终结对话"，倒计时延长审计与
 *   截图取证全部归零。这是阶段 5 的前置阻塞项。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 设计约束（与 migrate-messages.ts 同源，避免时间列被写坏）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 【时间一律原值往返】
 *   本库是 libSQL/SQLite，Prisma 的时间列底层可能是 TEXT 或 INTEGER。因此本脚本
 *   **从不把时间读进 JS 再写回**，而是用 `UPDATE ... SET col = (SELECT ... FROM ChatRoom ...)`
 *   让值在 SQL 内部原样搬运。同时**禁用 strftime()/datetime()** —— 对非文本存储会返回
 *   NULL，会静默把审计时间抹成空。
 *
 * 【幂等】
 *   迁移是「ChatRoom → Conversation 的字段复制」，重复执行结果一致。
 *   且只更新**确有差异**的行（先比对再写），重复运行不会产生额外写入。
 *
 * 【绝不覆盖更新的 Conversation 值】
 *   vaultExpiresAt 用 COALESCE：ChatRoom 有值则以其为准（阶段 5 前的事实来源），
 *   否则保留 Conversation 上已有的值 —— 避免把 Vault 清空。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 用法
 * ═══════════════════════════════════════════════════════════════════════════
 *   # 1) 只读预演（默认）
 *   npx tsx scripts/chat-merge/migrate-vault.ts
 *
 *   # 2) 小范围试跑
 *   npx tsx scripts/chat-merge/migrate-vault.ts --apply --limit=20
 *
 *   # 3) 全量执行
 *   npx tsx scripts/chat-merge/migrate-vault.ts --apply
 *
 *   # 4) 复核（只读）
 *   npx tsx scripts/chat-merge/migrate-vault.ts --verify
 *
 * 可选参数：
 *   --apply          真正写入（缺省 dry-run）
 *   --limit=N        最多处理 N 个会话
 *   --conversation=  只处理指定 Conversation.id
 *   --verify         只做迁移后一致性复核
 *   --json           额外输出机器可读 JSON
 *
 * 前置条件：
 *   npx prisma db push && npx prisma generate    # 使 Conversation 的 Vault 列生效
 *
 * @see docs/MULTI-TENANCY-DESIGN.md        阶段 5 的前置依赖清单
 * @see docs/CHAT-MERGE-AUDIT.md §11.3      缺口 G-1 的登记
 */

import { createClient, type Client } from '@libsql/client';
import * as dotenv from 'dotenv';

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
const ONLY_CONVERSATION = readArg('conversation');
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
// 迁移的字段映射（ChatRoom → Conversation）
//
// 字段清单、语义判定与差异表达式已收敛到 `shared/vault-diff.ts` ——
// 阶段 5 的 `retire-legacy.ts` 需要同一套定义来判定放行闸门。
// 若在此处再写一份，就会重演 G-3（同一套定义散落多处，改一处必漏其余）。
// ═══════════════════════════════════════════════════════════════════════════

import {
  COPY_FIELDS,
  MEANINGFUL_ROOM_CONDITION,
  REQUIRED_CONVERSATION_MIGRATION_COLUMNS,
  vaultDiffCondition as diffCondition,
} from './shared/vault-diff';

// ═══════════════════════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════════════════════

interface Summary {
  scanned: number;
  meaningful: number;
  drifted: number;
  updated: number;
  skippedNoRoom: number;
  preservedConvExpiry: number;
  driftRemaining: number;
}

const summary: Summary = {
  scanned: 0,
  meaningful: 0,
  drifted: 0,
  updated: 0,
  skippedNoRoom: 0,
  preservedConvExpiry: 0,
  driftRemaining: 0,
};

async function main() {
  hr('P1-6 阶段 4 · Vault 状态机迁移（G-1）');
  log(`模式：${VERIFY_ONLY ? '复核（只读）' : APPLY ? '⚠ 执行写入' : '预演（只读，不写任何数据）'}`);
  log(`范围：${ONLY_CONVERSATION ? `仅 ${ONLY_CONVERSATION}` : '全部已桥接会话'}  上限：${LIMIT === Number.POSITIVE_INFINITY ? '不限' : LIMIT}`);

  // ── 前置检查：目标列是否已存在 ──
  // 注：此处检查的是**全部 9 个会被写入的列**。改造前只检查了其中 6 个
  // （漏掉 extendedAt / extendedBy / lastScreenshotAt）—— 若这三列缺一，
  // 预演会通过、`--apply` 才会在 UPDATE 中途失败，属于「闸门形同虚设」。
  const cols = await safeQ(`PRAGMA table_info("Conversation")`);
  const colNames = new Set(cols.map((c) => str(c.name)));
  const required = REQUIRED_CONVERSATION_MIGRATION_COLUMNS;
  const missing = required.filter((c) => !colNames.has(c));
  if (missing.length > 0) {
    console.error(`\n✗ Conversation 缺少列：${missing.join(', ')}`);
    console.error('  请先执行：npx prisma db push && npx prisma generate');
    process.exit(1);
  }
  log(`✓ 目标列已就绪（${required.length} 个必需列全部存在）`);

  // ── 统计总量与"实质使用过 Vault"的量 ──
  const baseWhere = ONLY_CONVERSATION
    ? `c."id" = ?`
    : `c."chatRoomId" IS NOT NULL`;
  const baseArgs: SqlArg[] = ONLY_CONVERSATION ? [ONLY_CONVERSATION] : [];

  const [tot] = await q(
    `SELECT COUNT(*) AS n FROM "Conversation" c WHERE ${baseWhere}`,
    baseArgs,
  );
  summary.scanned = num(tot?.n);

  const [mean] = await q(
    `SELECT COUNT(*) AS n
       FROM "Conversation" c
       JOIN "ChatRoom" r ON r."id" = c."chatRoomId"
      WHERE ${baseWhere} AND ${MEANINGFUL_ROOM_CONDITION}`,
    baseArgs,
  );
  summary.meaningful = num(mean?.n);

  const [drift] = await q(
    `SELECT COUNT(*) AS n
       FROM "Conversation" c
       JOIN "ChatRoom" r ON r."id" = c."chatRoomId"
      WHERE ${baseWhere} AND (${diffCondition('c', 'r')})`,
    baseArgs,
  );
  summary.drifted = num(drift?.n);

  log(`\n已桥接会话数        : ${summary.scanned}`);
  log(`其中"真的用过 Vault" : ${summary.meaningful}`);
  log(`Vault 字段不一致    : ${summary.drifted}   ← 需要迁移的量`);

  if (summary.drifted === 0) {
    log('\n✓ 无需迁移：所有会话的 Vault 状态已与来源一致。');
    await verifyDrift(baseWhere, baseArgs);
    await finish();
    return;
  }

  // ── 展示待迁移样本 ──
  const samples = await safeQ(
    `SELECT c."id" AS covertid, r."vaultStatus" AS status, r."vaultExpiry" AS expiry,
            IFNULL(r."extensionCount",0) AS ext, IFNULL(r."screenshotCount",0) AS shots,
            r."revokedAt" AS revoked
       FROM "Conversation" c
       JOIN "ChatRoom" r ON r."id" = c."chatRoomId"
      WHERE ${baseWhere} AND (${diffCondition('c', 'r')})
      LIMIT 5`,
    baseArgs,
  );
  if (samples.length > 0) {
    log('\n样本（前 5 条，时间为原值示意）：');
    for (const s of samples) {
      log(`  ${str(s.covertid).slice(0, 12)}…  status=${str(s.status)}  ext=${num(s.ext)}  shots=${num(s.shots)}  revoked=${s.revoked ? 'yes' : 'no'}  expiry=${s.expiry === null ? '—' : '(有)'}`);
    }
  }

  if (VERIFY_ONLY) {
    log('\n（复核模式，不写入）');
    await verifyDrift(baseWhere, baseArgs);
    await finish();
    return;
  }

  if (!APPLY) {
    hr('预演结束');
    log('未写入任何数据。确认无误后加 --apply 执行，建议先 --limit=20 试跑。');
    await finish();
    return;
  }

  // ── 执行写入 ──
  hr('执行迁移');
  const sets: string[] = [];
  // vaultExpiresAt：ChatRoom 有值优先，否则保留 Conversation 既有值（防止清空）
  sets.push(`"vaultExpiresAt" = CASE WHEN r."vaultExpiry" IS NOT NULL THEN r."vaultExpiry" ELSE "Conversation"."vaultExpiresAt" END`);
  for (const f of COPY_FIELDS) {
    sets.push(`"${f.conv}" = r."${f.room}"`);
  }

  // ── 为什么不是 `WHERE "id" IN (SELECT ... JOIN ...)` ──
  //
  // SET 子句引用的是 ChatRoom 的列（`r."vaultStatus"` 等），而子查询里的别名 `r`
  // **不在 SET 的作用域内**。改造前的写法恰恰如此：
  //
  //     UPDATE "Conversation"
  //        SET "vaultStatus" = r."vaultStatus"
  //      WHERE "id" IN (SELECT c."id" ... JOIN "ChatRoom" r ...)
  //
  // 预演只跑 SELECT，所以完全看不见这个问题；直到 `--apply` 才抛
  //     SQLite input error: no such column: r.vaultExpiry
  // 正是本文件开头警告过的「预演通过、正式执行才失败」模式。
  //
  // 改用 SQLite 3.33+ 的 `UPDATE ... FROM`（本库实测 3.47.0），
  // 让 ChatRoom 进入 SET 的作用域。此处目标表用表名 `"Conversation"` 引用，
  // 所以 diffCondition 的 convAlias 传的正是表名。
  //
  // ⚠️ `UPDATE` 不支持 `LIMIT`（需 SQLITE_ENABLE_UPDATE_DELETE_LIMIT 编译开关，
  //    本库未启用 —— 已用 EXPLAIN 实测报 `near "LIMIT": syntax error`）。
  //    因此限额改为「先子查询取 id 集合」。仅在未指定 --conversation 时生效
  //    （指定单个会话时限额本就无意义，且可避免占位符数量错配）。
  const limitClause =
    !ONLY_CONVERSATION && Number.isFinite(LIMIT)
      ? `AND "Conversation"."id" IN (
           SELECT c."id"
             FROM "Conversation" c
             JOIN "ChatRoom" r2 ON r2."id" = c."chatRoomId"
            WHERE ${baseWhere} AND (${diffCondition('c', 'r2')})
            LIMIT ${Math.floor(LIMIT)}
         )`
      : '';

  const baseWhereUpdate = ONLY_CONVERSATION
    ? `"Conversation"."id" = ?`
    : `"Conversation"."chatRoomId" IS NOT NULL`;

  const sql = `
    UPDATE "Conversation"
       SET ${sets.join(',\n           ')}
      FROM "ChatRoom" r
     WHERE r."id" = "Conversation"."chatRoomId"
       AND ${baseWhereUpdate}
       AND (${diffCondition('"Conversation"', 'r')})
       ${limitClause}`;

  const res = await client.execute({ sql, args: baseArgs });
  summary.updated = num(res.rowsAffected);
  log(`✓ 已更新 ${summary.updated} 个会话的 Vault 字段`);

  // ── 复核 ──
  await verifyDrift(baseWhere, baseArgs);
  await finish();
}

async function verifyDrift(baseWhere: string, baseArgs: SqlArg[]) {
  hr('复核');
  const [d] = await q(
    `SELECT COUNT(*) AS n
       FROM "Conversation" c
       JOIN "ChatRoom" r ON r."id" = c."chatRoomId"
      WHERE ${baseWhere} AND (${diffCondition('c', 'r')})`,
    baseArgs,
  );
  summary.driftRemaining = num(d?.n);

  // 只统计"实质使用过 Vault"的会话是否有遗漏
  const [m] = await q(
    `SELECT COUNT(*) AS n
       FROM "Conversation" c
       JOIN "ChatRoom" r ON r."id" = c."chatRoomId"
      WHERE ${baseWhere} AND ${MEANINGFUL_ROOM_CONDITION}
        AND (${diffCondition('c', 'r')})`,
    baseArgs,
  );
  const meaningfulRemaining = num(m?.n);

  log(`剩余不一致会话          : ${summary.driftRemaining}`);
  log(`其中"真的用过 Vault"的   : ${meaningfulRemaining}`);

  if (summary.driftRemaining === 0) {
    log('✓ 一致性通过 —— 阶段 5 删除 ChatRoom 不会丢失 Vault 能力。');
  } else if (meaningfulRemaining === 0) {
    log('⚠ 仅剩默认值间的表示差异（如 NULL vs ACTIVE / 0），不影响业务语义。');
  } else {
    log('🔴 仍有实质 Vault 状态未迁移 —— 不要进入阶段 5。请检查日志后重跑。');
    process.exitCode = 2;
  }
}

async function finish() {
  if (WANT_JSON) {
    log('\n' + JSON.stringify(summary, null, 2));
  }
  log('');
  await client.close();
}

main().catch(async (e) => {
  console.error('\n✗ 迁移失败：', e);
  // `client.close()` 返回 undefined（非 Promise），原先写 `.catch()` 会再抛
  // "Cannot read properties of undefined" —— 把真正的失败原因淹在栈里。
  try {
    await client.close();
  } catch {
    /* 关闭失败不应掩盖上面的真实错误 */
  }
  process.exit(1);
});

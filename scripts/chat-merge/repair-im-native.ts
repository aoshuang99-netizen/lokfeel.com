/**
 * P1-6 阶段 5 · 终局模型数据修复（IM 原生行的结构性缺陷）
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 为什么需要这个脚本（它不是"门禁夹具"）
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `verify-migration.ts` 的 C3 / C4 / C7 报出的失败行，其 `legacyMessageId`
 * **全部为 NULL** —— 也就是说它们**不是本次迁移产生的**，而是早期 IM 代码
 * 直接写入的 IM 原生行。
 *
 * 这一点决定了它们的性质：**删掉 Legacy 三表之后，这些行依然存在于终局模型里。**
 * 所以它们不是"门禁噪音"，而是终局模型的真实数据缺陷 ——
 * 门禁只是恰好把它们照出来了。修它们是为了数据本身，不是为了把门禁刷绿。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 修什么
 * ───────────────────────────────────────────────────────────────────────────
 *
 * R1 · seq 重复（对应 C3）
 *   同一 `conversationId` 内出现重复 `seq`。典型成因是**并发双写竞态**：
 *   两个请求各自算出 `max(seq)+1` 再插入，于是拿到同一个序号。
 *   后果：按 seq 分页/游标会丢行或重复行。
 *   处置：把该会话的消息按 `(createdAt, id)` 重排，重新赋 1..N。
 *
 * R2 · seq 与时间倒挂（对应 C4）
 *   seq 顺序与 createdAt 顺序不一致。R1 重排后此项通常**自动消解**
 *   （两者都是"按时间排一遍"）。本脚本不单独处理 R2，只在 R1 后复核。
 *
 * R3 · 计数器漂移（对应 C7）
 *   `Conversation.messageCount` ≠ 实际 IMMessage 行数。
 *   口径依据（已核对代码，不是猜的）：
 *     · 写路径为 `messageCount: { increment: 1 }`（`im/queries.ts`、`im/mirror.ts`、
 *       `im/bot-reply.ts`），即**按 IM 消息条数**累加
 *     · 读路径 `im/queries.ts` 有 `messageCount: stats._count` 的**绝对重算**分支
 *     · `im/stats.ts` 明示 IM 读侧用 `imMessages: { some: ... }` 而非读该缓存列
 *   因此重算为「IMMessage 行数」是**与既有口径一致**的，不是新引入的定义。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 时间字段处理（遵循本仓库既有约束）
 * ───────────────────────────────────────────────────────────────────────────
 *
 * · 排序用 SQL 自身的 `ORDER BY "createdAt", "id"`，**不在 JS 里解析或构造时间**。
 * · 不回写任何时间列 —— 本脚本只动 `seq` 与 `messageCount`。
 *
 * ⚠️ 已知局限（诚实披露）
 * · C4 的判据是**字符串比较**（`LAG("createdAt")` 直接比文本）。若同一会话内
 *   `createdAt` 混用 `...Z` 与 `...+00:00` 两种格式，字符串序 ≠ 时间序，
 *   重排后 C4 仍可能报错。本脚本在 R1 后会**复核并如实报告**，不假装通过。
 * · 不处理 C2（字段忠实度）。C2 的失败行是迁移**认领**的既有 IM 行，
 *   其 `createdAt` 是 IM 侧真实写入时间，与 Legacy 副本差 2.2 秒属于
 *   "两个时钟各自记录"，**覆盖它才是伪造数据**。故有意不修。
 *
 * 用法：
 *   npm run chat:repair                        # 预演（只读）
 *   npm run chat:repair:apply                  # 执行
 *   npm run chat:repair -- --only=<convId>     # 只处理指定会话
 */

import { createClient, type Client } from '@libsql/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const AUTH = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim();
const APPLY = process.argv.includes('--apply');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice('--only='.length).trim() : null;

if (!DATABASE_URL) {
  console.error('✗ 缺少 DATABASE_URL（请检查 .env）');
  process.exit(1);
}

const line = (c = '─') => console.log(c.repeat(66));
function head(t: string) {
  line();
  console.log(` ${t}`);
  line();
}

async function main() {
  const client: Client = createClient({ url: DATABASE_URL, authToken: AUTH });

  const q = async (sql: string, args: unknown[] = []) => (await client.execute({ sql, args })).rows;
  const one = async (sql: string, args: unknown[] = []) =>
    Number((await client.execute({ sql, args })).rows[0]?.n ?? 0);

  console.log(`\n 数据库：${DATABASE_URL}\n`);
  console.log(` 模式：${APPLY ? '⚠ 执行写入' : '预演（只读，不写任何数据）'}${ONLY ? `  范围：${ONLY}` : ''}\n`);

  // ── 采集待修对象 ──────────────────────────────────────────────────────

  const dupWhere = ONLY ? `AND "conversationId" = ?` : '';
  const dupArgs = ONLY ? [ONLY] : [];

  const dupConvs = await q(
    `SELECT "conversationId" AS cid, COUNT(*) AS n
       FROM "IMMessage"
      WHERE 1=1 ${dupWhere}
      GROUP BY "conversationId", "seq"
     HAVING COUNT(*) > 1`,
    dupArgs,
  );
  const dupCids = [...new Set(dupConvs.map((r) => String(r.cid)))];

  const driftWhere = ONLY ? `AND c."id" = ?` : '';
  const driftRows = await q(
    `SELECT c."id" AS id, c."messageCount" AS declared,
            (SELECT COUNT(*) FROM "IMMessage" i WHERE i."conversationId" = c."id") AS actual
       FROM "Conversation" c
      WHERE c."messageCount" <> (SELECT COUNT(*) FROM "IMMessage" i WHERE i."conversationId" = c."id")
        ${driftWhere}`,
    dupArgs,
  );

  head('待修对象');
  console.log(` R1/R2 · seq 重复的会话      : ${dupCids.length}`);
  for (const r of dupConvs) console.log(`     ${r.cid}  (重复 ${r.n} 次)`);
  console.log(` R3    · 计数器漂移的会话    : ${driftRows.length}`);
  for (const r of driftRows) console.log(`     ${r.id}  ${r.declared} → ${r.actual}`);

  if (dupCids.length === 0 && driftRows.length === 0) {
    console.log('\n ✓ 无需修复 —— 终局模型无结构性缺陷。');
    try { await client.close(); } catch {}
    return;
  }

  // ── R1 · seq 重排 ─────────────────────────────────────────────────────

  let reSeqed = 0;
  let reSeqedRows = 0;
  if (dupCids.length > 0) {
    head('R1 · seq 重排（按 createdAt, id 升序赋 1..N）');
    for (const cid of dupCids) {
      const rows = await q(
        `SELECT "id" AS id, "seq" AS seq, "createdAt" AS createdAt
           FROM "IMMessage"
          WHERE "conversationId" = ?
          ORDER BY "createdAt" ASC, "id" ASC`,
        [cid],
      );
      if (rows.length === 0) continue;

      const before = rows.map((r) => `${r.id.slice(0, 8)}:${r.seq}`).join(' ');
      const changed: Array<{ id: string; seq: number }> = [];
      rows.forEach((r, idx) => {
        const want = idx + 1;
        if (Number(r.seq) !== want) changed.push({ id: String(r.id), seq: want });
      });

      console.log(`\n 会话 ${cid}  (${rows.length} 行)`);
      console.log(`   现状: ${before}`);
      console.log(`   目标: ${rows.map((_, i) => i + 1).join(' ')}`);

      if (changed.length === 0) {
        console.log('   ✓ 已是正确序号，无需改动');
        continue;
      }
      if (!APPLY) {
        console.log(`   （预演）将改写 ${changed.length} 行的 seq`);
        continue;
      }

      for (const c of changed) {
        await client.execute({
          sql: `UPDATE "IMMessage" SET "seq" = ? WHERE "id" = ?`,
          args: [c.seq, c.id],
        });
      }
      reSeqed += 1;
      reSeqedRows += changed.length;
      console.log(`   ✓ 已改写 ${changed.length} 行`);
    }
  }

  // ── R3 · 计数器重算 ───────────────────────────────────────────────────

  let fixedCounters = 0;
  if (driftRows.length > 0) {
    head('R3 · messageCount 重算为「IMMessage 行数」');
    if (!APPLY) {
      console.log(` （预演）将重算 ${driftRows.length} 个会话`);
      for (const r of driftRows) console.log(`   ${r.id}  ${r.declared} → ${r.actual}`);
    } else {
      for (const r of driftRows) {
        await client.execute({
          sql: `UPDATE "Conversation"
                   SET "messageCount" = (SELECT COUNT(*) FROM "IMMessage" i WHERE i."conversationId" = "Conversation"."id")
                 WHERE "id" = ?`,
          args: [String(r.id)],
        });
        fixedCounters += 1;
        console.log(`   ✓ ${r.id}  ${r.declared} → ${r.actual}`);
      }
    }
  }

  // ── 复核（无论预演与否都读真实库，如实报告）──────────────────────────

  head('复核');

  const dupAfter = await one(
    `SELECT COUNT(*) AS n FROM (
       SELECT "conversationId", "seq" FROM "IMMessage"
        GROUP BY "conversationId", "seq" HAVING COUNT(*) > 1)`,
  );
  const invAfter = await one(
    `SELECT COUNT(*) AS n FROM (
       SELECT "createdAt",
              LAG("createdAt") OVER (PARTITION BY "conversationId" ORDER BY "seq") AS prev
         FROM "IMMessage")
      WHERE prev IS NOT NULL AND "createdAt" < prev`,
  );
  const driftAfter = await one(
    `SELECT COUNT(*) AS n FROM "Conversation" c
      WHERE c."messageCount" <> (SELECT COUNT(*) FROM "IMMessage" i WHERE i."conversationId" = c."id")`,
  );

  console.log(` C3 seq 重复        : ${dupAfter}`);
  console.log(` C4 seq 时间倒挂    : ${invAfter}`);
  console.log(` C7 计数器漂移      : ${driftAfter}`);

  if (APPLY) {
    console.log(`\n 本次写入：seq 重排 ${reSeqed} 个会话 / ${reSeqedRows} 行；计数器重算 ${fixedCounters} 个`);
  }

  const clean = dupAfter === 0 && invAfter === 0 && driftAfter === 0;
  console.log('');
  if (clean) {
    console.log(' ✓ C3 / C4 / C7 均已归零。');
  } else if (!APPLY) {
    console.log(' ⚠ 预演模式 —— 以上为修复前状态。加 --apply 执行。');
  } else {
    console.log(' ⚠ 仍有残留 —— 若 C4 未归零，请检查该会话 createdAt 是否混用了');
    console.log('   `...Z` 与 `...+00:00` 两种格式（字符串序与时间序不一致，见脚本头「局限」）。');
  }

  console.log('');
  try { await client.close(); } catch {}
}

main().catch((e) => {
  console.error('✗ 失败：', e);
  process.exit(1);
});

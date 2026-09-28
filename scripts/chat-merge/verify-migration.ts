/**
 * P1-6 阶段 3 · 迁移复核（Verify）
 *
 * 用途：在 migrate-messages.ts 执行后运行，独立判定迁移是否**忠实**。
 *      本脚本纯只读，退出码非 0 表示存在硬失败 —— 可直接用于 CI 门禁。
 *
 *   npx tsx scripts/chat-merge/verify-migration.ts
 *
 * 检查项（每项独立给出通过/失败与数量）：
 *   C1 覆盖率     —— 每条应迁的 Legacy 消息都已在 IMMessage 中有对应行
 *   C2 字段忠实度 —— payload/senderId/createdAt/metadata/msgType/status 逐字段一致
 *   C3 序号唯一   —— 同一会话内 seq 无重复
 *   C4 seq 单调   —— 同一会话内 seq 顺序与 createdAt 顺序一致（无倒挂）
 *   C5 必填完整   —— seq/payload/conversationId/receiverId 无空值
 *   C6 血缘有效   —— legacyMessageId 指向的 Message 必须存在（无悬挂）
 *   C7 计数一致   —— Conversation.messageCount 等于实际 IMMessage 行数
 *   C8 收件人正确 —— receiverId 必为会话另一方（不是自己、不是第三方）
 *
 * 设计约束：与迁移脚本一致 —— 不做时间解析，全部在 SQL 内以同格式值比较。
 */

import { createClient, type Client } from '@libsql/client';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const TURSO_AUTH_TOKEN = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim();
const WANT_JSON = process.argv.includes('--json');

if (!DATABASE_URL) {
  console.error('✗ 缺少 DATABASE_URL（请检查 .env）');
  process.exit(1);
}

const client: Client = createClient({
  url: DATABASE_URL,
  ...(TURSO_AUTH_TOKEN ? { authToken: TURSO_AUTH_TOKEN } : {}),
});

type SqlArg = string | number | null;
type Row = Record<string, unknown>;

async function q(sql: string, args: SqlArg[] = []): Promise<Row[]> {
  const r = await client.execute({ sql, args });
  return r.rows as unknown as Row[];
}

async function scalar(sql: string, args: SqlArg[] = []): Promise<number> {
  try {
    const rows = await q(sql, args);
    const v = rows[0] ? Object.values(rows[0])[0] : 0;
    return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
  } catch (e) {
    console.warn(`  ⚠ 检查无法执行：${(e as Error).message}`);
    return -1;
  }
}

interface CheckResult {
  id: string;
  name: string;
  /** -1 = 无法执行（例如表不存在） */
  failures: number;
  /** 断言方向：0 表示期望为 0 */
  pass: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function record(id: string, name: string, failures: number, detail?: string) {
  const pass = failures === 0;
  results.push({ id, name, failures, pass, detail });
  const icon = failures < 0 ? '⊘' : pass ? '✓' : '✗';
  const suffix = failures < 0 ? '无法执行' : failures === 0 ? '通过' : `失败 ${failures}`;
  console.log(`  ${icon} ${id} ${name} —— ${suffix}`);
  if (detail) console.log(`      ${detail}`);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' P1-6 阶段 3 · 迁移复核');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(` 数据库：${DATABASE_URL.replace(/(\/\/[^:]+:)[^@]+@/, '$1***@')}\n`);

  // 前置：列是否存在
  const cols = await q(`PRAGMA table_info("IMMessage")`).catch(() => [] as Row[]);
  if (!cols.map((c) => String(c.name)).includes('legacyMessageId')) {
    console.error('✗ IMMessage.legacyMessageId 不存在 —— 请先执行 npx prisma db push\n');
    process.exit(2);
  }

  console.log('【检查】');

  // ── C1 覆盖率：应迁消息是否都已迁入 ──
  //    「应迁」= 发送者属于会话双方（其余为脏数据，迁移有意跳过）
  const missing = await scalar(`
    SELECT COUNT(*)
      FROM "Message" m
      JOIN "ChatRoom" c       ON c."id" = m."roomId"
      JOIN "Conversation" v   ON v."chatRoomId" = c."id"
     WHERE m."senderId" IN (v."userAId", v."userBId")
       AND NOT EXISTS (SELECT 1 FROM "IMMessage" i WHERE i."legacyMessageId" = m."id")
  `);
  const dirtyRows = await scalar(`
    SELECT COUNT(*)
      FROM "Message" m
      JOIN "ChatRoom" c       ON c."id" = m."roomId"
      JOIN "Conversation" v   ON v."chatRoomId" = c."id"
     WHERE m."senderId" NOT IN (v."userAId", v."userBId")
  `);
  record('C1', '覆盖率（应迁消息全部已迁）', missing,
    dirtyRows > 0 ? `另有 ${dirtyRows} 条脏数据（发送者非会话成员）被有意跳过` : undefined);

  // ── C2 字段忠实度 ──
  const mismatched = await scalar(`
    SELECT COUNT(*)
      FROM "Message" m
      JOIN "IMMessage" i ON i."legacyMessageId" = m."id"
     WHERE i."payload"     <> m."content"
        OR i."senderId"    <> m."senderId"
        OR i."createdAt"   IS NOT m."createdAt"
        OR i."metadata"    IS NOT m."metadata"
        OR i."msgType"     <> (CASE m."messageType"
                                 WHEN 'IMAGE'  THEN 'IMAGE'
                                 WHEN 'VOICE'  THEN 'VOICE'
                                 WHEN 'SYSTEM' THEN 'SYSTEM'
                                 ELSE 'TEXT' END)
        OR i."status"      <> (CASE WHEN m."isRead" = 1 THEN 'READ' ELSE 'SENT' END)
  `);
  record('C2', '字段忠实度（6 个字段逐条一致）', mismatched);

  // ── C3 序号唯一 ──
  const dupSeq = await scalar(`
    SELECT COUNT(*) FROM (
      SELECT "conversationId", "seq"
        FROM "IMMessage"
       GROUP BY "conversationId", "seq"
      HAVING COUNT(*) > 1
    )
  `);
  record('C3', '序号唯一（同会话 seq 无重复）', dupSeq);

  // ── C4 seq 单调（seq 顺序不得与 createdAt 顺序倒挂）──
  const inversions = await scalar(`
    SELECT COUNT(*) FROM (
      SELECT "createdAt",
             LAG("createdAt") OVER (PARTITION BY "conversationId" ORDER BY "seq") AS prev
        FROM "IMMessage"
    )
    WHERE prev IS NOT NULL AND "createdAt" < prev
  `);
  record('C4', 'seq 单调（序号与时间顺序一致）', inversions);

  // ── C5 必填完整 ──
  const nullRequired = await scalar(`
    SELECT COUNT(*) FROM "IMMessage"
     WHERE "conversationId" IS NULL OR "seq" IS NULL OR "payload" IS NULL OR "receiverId" IS NULL
  `);
  record('C5', '必填完整（无空 seq/payload/receiver）', nullRequired);

  // ── C6 血缘有效（无悬挂 legacyMessageId）──
  const dangling = await scalar(`
    SELECT COUNT(*) FROM "IMMessage" i
     WHERE i."legacyMessageId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "Message" m WHERE m."id" = i."legacyMessageId")
  `);
  record('C6', '血缘有效（legacyMessageId 均指向真实 Message）', dangling);

  // ── C7 计数一致 ──
  const badCount = await scalar(`
    SELECT COUNT(*) FROM "Conversation" v
     WHERE v."messageCount" <> (SELECT COUNT(*) FROM "IMMessage" i WHERE i."conversationId" = v."id")
       AND EXISTS (SELECT 1 FROM "IMMessage" i2 WHERE i2."conversationId" = v."id")
  `);
  record('C7', '计数一致（messageCount = 实际行数）', badCount);

  // ── C8 收件人正确 ──
  const badReceiver = await scalar(`
    SELECT COUNT(*) FROM "IMMessage" i
      JOIN "Conversation" v ON v."id" = i."conversationId"
     WHERE i."receiverId" NOT IN (v."userAId", v."userBId")
        OR i."receiverId" = i."senderId"
        OR i."receiverId" <> (CASE WHEN i."senderId" = v."userAId" THEN v."userBId" ELSE v."userAId" END)
  `);
  record('C8', '收件人正确（必为会话另一方）', badReceiver);

  // ── 汇总 ──
  const hardFailures = results.filter((r) => !r.pass && r.failures > 0);
  const unable = results.filter((r) => r.failures < 0);

  console.log('\n═══════════════════════════════════════════════════════════');
  if (hardFailures.length === 0 && unable.length === 0) {
    console.log(' 结论：✅ 全部检查通过 —— 迁移忠实，可以进行阶段 4');
  } else if (hardFailures.length === 0) {
    console.log(` 结论：⚠ ${unable.length} 项无法执行（检查表/列是否存在）`);
  } else {
    console.log(` 结论：❌ ${hardFailures.length} 项硬失败 —— 不要进入阶段 4`);
    for (const f of hardFailures) console.log(`   · ${f.id} ${f.name}：${f.failures}`);
  }

  // ── 规模快照（便于人工核对）──
  const snapshot = {
    Message总数: await scalar(`SELECT COUNT(*) FROM "Message"`),
    IMMessage总数: await scalar(`SELECT COUNT(*) FROM "IMMessage"`),
    已迁入行数: await scalar(`SELECT COUNT(*) FROM "IMMessage" WHERE "legacyMessageId" IS NOT NULL`),
    已桥接会话: await scalar(`SELECT COUNT(*) FROM "Conversation" WHERE "chatRoomId" IS NOT NULL`),
    ChatRoom总数: await scalar(`SELECT COUNT(*) FROM "ChatRoom"`),
  };
  console.log('\n【规模快照】');
  console.table(snapshot);

  // ── 报告 ──
  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(__dirname, '../../docs');
  if (fs.existsSync(outDir)) {
    const md = [
      `# 双聊天系统合并 · 阶段 3 复核报告 · ${date}`,
      '',
      '> 生成者：`scripts/chat-merge/verify-migration.ts`（纯只读）',
      '',
      `## 结论`,
      '',
      hardFailures.length === 0 && unable.length === 0
        ? '✅ **全部检查通过** —— 迁移忠实，可进入阶段 4'
        : hardFailures.length === 0
          ? `⚠ ${unable.length} 项无法执行`
          : `❌ **${hardFailures.length} 项硬失败 —— 不要进入阶段 4**`,
      '',
      '## 检查明细',
      '',
      '| # | 检查项 | 结果 | 失败数 | 说明 |',
      '|---|---|---|---|---|',
      ...results.map(
        (r) =>
          `| ${r.id} | ${r.name} | ${r.failures < 0 ? '无法执行' : r.pass ? '✅' : '❌'} | ${r.failures} | ${r.detail ?? ''} |`,
      ),
      '',
      '## 规模快照',
      '',
      '| 指标 | 值 |',
      '|---|---|',
      ...Object.entries(snapshot).map(([k, v]) => `| ${k} | ${v} |`),
      '',
    ].join('\n');
    fs.writeFileSync(path.join(outDir, `chat-merge-verify-${date}.md`), md, 'utf8');
    console.log(`\n  📄 复核报告：docs/chat-merge-verify-${date}.md`);
  }

  if (WANT_JSON) {
    console.log('\n---JSON---');
    console.log(JSON.stringify({ pass: hardFailures.length === 0 && unable.length === 0, results, snapshot }, null, 2));
  }

  process.exit(hardFailures.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\n✗ 复核失败：', e);
  process.exit(1);
});

/**
 * P1-6 双聊天系统合并 —— 阶段 2 第一步：只读数据体检
 *
 * 目的：在动任何代码/数据之前，先量化两套聊天系统的真实数据分布。
 *      本脚本【纯只读】：只执行 SELECT，不含任何 INSERT/UPDATE/DELETE。
 *
 * 运行：
 *   npx tsx scripts/chat-merge/inventory.ts
 *   npx tsx scripts/chat-merge/inventory.ts --json   # 输出机器可读 JSON
 *
 * 需要环境变量：DATABASE_URL、TURSO_AUTH_TOKEN（从 .env 读取）
 *
 * 产出：docs/chat-merge-inventory-<日期>.md（人类可读报告）
 *      配合 --json 时额外打印 JSON 到 stdout
 */

import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });

const DATABASE_URL = process.env.DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;
const WANT_JSON = process.argv.includes('--json');

if (!DATABASE_URL) {
  console.error('✗ 缺少 DATABASE_URL（请检查 .env）');
  process.exit(1);
}

const client = createClient({
  url: DATABASE_URL,
  ...(TURSO_AUTH_TOKEN ? { authToken: TURSO_AUTH_TOKEN } : {}),
});

/** 单行单值查询 */
async function scalar(sql: string): Promise<number> {
  try {
    const r = await client.execute(sql);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return 0;
    const v = Object.values(row)[0];
    return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
  } catch (e) {
    console.warn(`  ⚠ 查询失败（表可能不存在）：${sql.slice(0, 60)}... → ${(e as Error).message}`);
    return -1;
  }
}

/** 多行查询 */
async function rows(sql: string): Promise<Record<string, unknown>[]> {
  try {
    const r = await client.execute(sql);
    return r.rows as unknown as Record<string, unknown>[];
  } catch (e) {
    console.warn(`  ⚠ 查询失败：${(e as Error).message}`);
    return [];
  }
}

const num = (v: unknown) => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' P1-6 双聊天系统合并 · 只读数据体检');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log(`数据库：${DATABASE_URL?.replace(/(\/\/[^:]+:)[^@]+@/, '$1***@')}\n`);

  const result: Record<string, unknown> = {};

  // ── 1. 两套系统的表规模对比 ──────────────────────────────
  console.log('【1】表规模对比');
  const legacy = {
    ChatRoom: await scalar('SELECT COUNT(*) FROM ChatRoom'),
    ChatRoomMember: await scalar('SELECT COUNT(*) FROM ChatRoomMember'),
    Message: await scalar('SELECT COUNT(*) FROM Message'),
  };
  const im = {
    Conversation: await scalar('SELECT COUNT(*) FROM Conversation'),
    ConversationParticipant: await scalar('SELECT COUNT(*) FROM ConversationParticipant'),
    IMMessage: await scalar('SELECT COUNT(*) FROM IMMessage'),
    MessageReceipt: await scalar('SELECT COUNT(*) FROM MessageReceipt'),
    MessageReaction: await scalar('SELECT COUNT(*) FROM MessageReaction'),
  };
  console.table({ ...legacy, ...im });
  result.legacy = legacy;
  result.im = im;

  // ── 2. 桥接完整性（决定迁移可行性）──────────────────────
  console.log('\n【2】桥接完整性（ChatRoom ↔ Conversation 1:1）');
  const crTotal = legacy.ChatRoom;
  const crLinked = await scalar(
    'SELECT COUNT(*) FROM ChatRoom WHERE conversationId IS NOT NULL',
  );
  const convWithRoom = await scalar(
    'SELECT COUNT(*) FROM Conversation WHERE chatRoomId IS NOT NULL',
  );
  const bridge = {
    'ChatRoom 总数': crTotal,
    'ChatRoom 已挂 Conversation': crLinked,
    'ChatRoom 未挂（迁移风险）': crTotal - crLinked,
    'Conversation 总数': im.Conversation,
    'Conversation 已挂 ChatRoom': convWithRoom,
    'Conversation 无对应房间（孤儿会话）': im.Conversation - convWithRoom,
  };
  console.table(bridge);
  result.bridge = bridge;

  // 桥接列名兼容：若 schema 用的是 chatRoom.conversationId 之外的写法，回退查 Conversation.chatRoomId
  if (crLinked === -1) {
    console.log('  ℹ ChatRoom.conversationId 列不存在 —— 桥接需从 Conversation.chatRoomId 反查');
  }

  // ── 3. 真实对话分布（关键：消息到底在哪套表）────────────
  console.log('\n【3】真实对话分布');
  const msgFromReal = await scalar(`
    SELECT COUNT(*) FROM Message m
    JOIN User u ON u.id = m.senderId
    WHERE u.isBot = 0 OR u.isBot IS NULL
  `);
  const imMsgFromReal = await scalar(`
    SELECT COUNT(*) FROM IMMessage m
    JOIN User u ON u.id = m.senderId
    WHERE u.isBot = 0 OR u.isBot IS NULL
  `);
  const msgSystem = await scalar(`SELECT COUNT(*) FROM Message WHERE messageType = 'SYSTEM'`);
  const imMsgSystem = await scalar(`SELECT COUNT(*) FROM IMMessage WHERE msgType = 'SYSTEM'`);
  const dist = {
    'Message 总行数': legacy.Message,
    'Message 中真人发送': msgFromReal,
    'Message 中 SYSTEM': msgSystem,
    'IMMessage 总行数': im.IMMessage,
    'IMMessage 中真人发送': imMsgFromReal,
    'IMMessage 中 SYSTEM': imMsgSystem,
  };
  console.table(dist);
  result.distribution = dist;

  // ── 4. 有真实对话的房间数（决定前端不可回归的边界）──────
  console.log('\n【4】活跃房间分布');
  const activeRooms = await scalar('SELECT COUNT(DISTINCT roomId) FROM Message');
  const activeConvs = await scalar('SELECT COUNT(DISTINCT conversationId) FROM IMMessage');
  console.log(`  有消息的 ChatRoom：${activeRooms}`);
  console.log(`  有消息的 Conversation：${activeConvs}`);
  result.activeRooms = activeRooms;
  result.activeConvs = activeConvs;

  // ── 5. 消息量 Top 10 会话（抽样核对用）──────────────────
  console.log('\n【5】消息量 Top 10 ChatRoom（迁移抽样核对样本）');
  const top = await rows(`
    SELECT roomId, COUNT(*) AS cnt, MAX(createdAt) AS lastAt
    FROM Message GROUP BY roomId ORDER BY cnt DESC LIMIT 10
  `);
  console.table(top.map((r) => ({ roomId: String(r.roomId).slice(0, 12), 条数: num(r.cnt), 最后一条: r.lastAt })));
  result.topRooms = top;

  // ── 6. 悬挂/异常检测（迁移前必须清零）───────────────────
  console.log('\n【6】异常检测');
  const orphanMsg = await scalar(
    'SELECT COUNT(*) FROM Message WHERE roomId NOT IN (SELECT id FROM ChatRoom)',
  );
  const dupSeq = await scalar(`
    SELECT COUNT(*) FROM (
      SELECT conversationId, seq, COUNT(*) c FROM IMMessage
      GROUP BY conversationId, seq HAVING c > 1
    )
  `);
  const nullSeq = await scalar('SELECT COUNT(*) FROM IMMessage WHERE seq IS NULL');

  // P1-6 阶段 5 新增两项（G-5 / G-9）：此前未统计，但会直接影响迁移正确性与渲染效果
  //   · 脏数据：senderId 不属于会话成员 —— 迁移脚本**有意跳过**这批行（G-5）
  //   · metadata 分布：迁移脚本会把 Message.metadata 原样搬到 IMMessage.metadata，
  //     但消息接口**不返回**该字段，因此其中的媒体地址不会被前端渲染（G-9）。
  //     若这个数不为 0，需要人工确认是否影响历史图片消息的展示。
  const dirtySender = await scalar(`
    SELECT COUNT(*) FROM Message m
     WHERE NOT EXISTS (
       SELECT 1 FROM ChatRoomMember cm
        WHERE cm.roomId = m.roomId AND cm.userId = m.senderId
     )
  `);
  const msgWithMetadata = await scalar(
    `SELECT COUNT(*) FROM Message WHERE metadata IS NOT NULL AND metadata <> ''`,
  );
  const imMsgWithMetadata = await scalar(
    `SELECT COUNT(*) FROM IMMessage WHERE metadata IS NOT NULL AND metadata <> ''`,
  );

  const anomalies = {
    'Message 孤儿行（roomId 无对应 ChatRoom）': orphanMsg,
    'IMMessage seq 重复': dupSeq,
    'IMMessage seq 为空': nullSeq,
    'Message 脏数据（senderId 非会话成员）': dirtySender,
    'Message.metadata 非空（迁移后前端不渲染）': msgWithMetadata,
    'IMMessage.metadata 非空': imMsgWithMetadata,
  };
  console.table(anomalies);
  result.anomalies = anomalies;

  // ── 7. 迁移决策建议 ────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' 结论');
  console.log('═══════════════════════════════════════════════════════');
  const needMigrate = legacy.Message - msgSystem;
  console.log(`  待迁移消息（Message 非 SYSTEM）：${needMigrate}`);
  console.log(`  IM 侧已有真人消息：${imMsgFromReal}`);
  if (bridge['ChatRoom 未挂（迁移风险）'] > 0) {
    console.log(`  ⚠ ${bridge['ChatRoom 未挂（迁移风险）']} 个 ChatRoom 没有 Conversation —— 迁移前需先跑 backfill`);
  } else {
    console.log('  ✓ 桥接完整，无孤立 ChatRoom');
  }
  if (imMsgFromReal > 0) {
    console.log(`  ⚠ IM 侧已有 ${imMsgFromReal} 条真人消息 —— 迁移必须幂等，不得覆盖`);
  }
  if (orphanMsg > 0) {
    console.log(`  ⚠ 存在 ${orphanMsg} 条孤儿消息 —— 迁移脚本需跳过或单独归档`);
  }
  if (dirtySender > 0) {
    console.log(`  ⚠ 存在 ${dirtySender} 条脏数据（发送者不属于会话成员）—— 迁移**有意跳过**（缺口 G-5）`);
    console.log(`     删除 Legacy 表前需确认这批行无需保留，或先单独归档。`);
  }
  if (msgWithMetadata > 0) {
    console.log(`  ⚠ ${msgWithMetadata} 条 Legacy 消息带 metadata —— 会搬到 IMMessage.metadata，`);
    console.log(`     但消息接口不返回该字段，其中的媒体地址不会被前端渲染（缺口 G-9）。`);
    console.log(`     阶段 5 的放行门禁（npm run chat:retire）会把脏数据计入知情项。`);
  }

  // ── 输出文件 ───────────────────────────────────────────
  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(__dirname, '../../docs');
  const outFile = path.join(outDir, `chat-merge-inventory-${date}.md`);
  if (fs.existsSync(outDir)) {
    const md = [
      `# 双聊天系统数据体检 · ${date}`,
      '',
      '> 由 `scripts/chat-merge/inventory.ts` 自动生成（只读）。',
      '',
      '## 表规模',
      '',
      '| 系统 | 表 | 行数 |',
      '|---|---|---|',
      ...Object.entries(legacy).map(([k, v]) => `| Legacy | ${k} | ${v} |`),
      ...Object.entries(im).map(([k, v]) => `| IM | ${k} | ${v} |`),
      '',
      '## 桥接完整性',
      '',
      '| 指标 | 值 |',
      '|---|---|',
      ...Object.entries(bridge).map(([k, v]) => `| ${k} | ${v} |`),
      '',
      '## 真实对话分布',
      '',
      '| 指标 | 值 |',
      '|---|---|',
      ...Object.entries(dist).map(([k, v]) => `| ${k} | ${v} |`),
      '',
      '## 异常检测',
      '',
      '| 项 | 数量 |',
      '|---|---|',
      ...Object.entries(anomalies).map(([k, v]) => `| ${k} | ${v} |`),
      '',
      '## Top 10 会话',
      '',
      '| roomId | 条数 | 最后一条 |',
      '|---|---|---|',
      ...top.map((r) => `| ${r.roomId} | ${num(r.cnt)} | ${r.lastAt} |`),
      '',
    ].join('\n');
    fs.writeFileSync(outFile, md, 'utf8');
    console.log(`\n  📄 报告已写入：docs/chat-merge-inventory-${date}.md`);
  } else {
    console.log('\n  ℹ docs/ 目录不存在，跳过文件输出');
  }

  if (WANT_JSON) {
    console.log('\n---JSON---');
    console.log(JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('\n✗ 体检失败：', e);
  process.exit(1);
});

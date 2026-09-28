/**
 * P1-6 双聊天系统合并 —— 阶段 3：数据统一（Message → IMMessage）
 *
 * 目标：把 Legacy `Message` 表的存量消息幂等迁入终局模型 `IMMessage`，
 *      使 IM 侧成为唯一完整的消息存储（方案 A，见 docs/CHAT-MERGE-AUDIT.md §4）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 设计约束（重要 —— 决定了本脚本为什么长这样）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. 【绝不假设 DateTime 的存储格式，也绝不在 SQL 里解析时间】
 *    本库是 libSQL/SQLite（schema provider = "sqlite"），Prisma 的时间列底层可能是
 *    TEXT 或 INTEGER。因此本脚本：
 *      (a) 时间一律「原值往返」——把库里读出的值原样写回（INSERT ... SELECT）
 *      (b) 只在 SQL 内比较两个同源同格式的值（MAX / > / <=），不做跨格式运算
 *      (c) **不使用 strftime()/datetime()** —— 它们对非文本存储会返回 NULL，
 *          导致匹配静默失效或写入 null 时间
 *
 * 2. 【幂等靠 legacyMessageId，不靠"跑没跑过"】
 *    每条迁入的 IMMessage 都写入 legacyMessageId = 原 Message.id（唯一索引）。
 *    重复执行只会跳过，绝不产生重复行。
 *
 * 3. 【计数器用绝对重算，不用增量】
 *    "上一条 +1" 在重复执行时会翻倍。本脚本改为：
 *      messageCount  = COUNT(*)（绝对重算）
 *      unreadCountA/B = MAX(现值, 重算值)（单调，永不把已读改回未读）
 *    两者都幂等。
 *
 * 4. 【绝不覆盖已有 IM 行】
 *    已有 IMMessage 只可能被「认领」（补写 legacyMessageId），内容永不修改。
 *    认领条件严格且与时间无关：SYSTEM 类型 + 同 senderId + 内容完全相同 +
 *    两侧都尚未链接，并且配对的映射关系必须是 1:1（存在歧义就不认领）。
 *    用途：接住 /api/matches/react 的 TWIN-CHAT FIX 早先直接建的那条开场 SYSTEM 消息，
 *    否则迁移会再插一条，导致每个会话出现两条重复开场消息。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 用法
 * ═══════════════════════════════════════════════════════════════════════════
 *   # 1) 只读预演（默认，不写任何数据）
 *   npx tsx scripts/chat-merge/migrate-messages.ts
 *
 *   # 2) 小范围试跑
 *   npx tsx scripts/chat-merge/migrate-messages.ts --apply --limit=20
 *
 *   # 3) 全量执行
 *   npx tsx scripts/chat-merge/migrate-messages.ts --apply
 *
 *   # 4) 复核（必须通过）
 *   npx tsx scripts/chat-merge/verify-migration.ts
 *
 * 可选参数：
 *   --apply                   真正写入（缺省为 dry-run）
 *   --limit=N                 最多处理 N 个会话
 *   --conversation=<id>       只处理指定 Conversation.id
 *   --skip-counters           跳过计数器/参与者状态同步（仅迁消息）
 *   --allow-interleave        允许「序号交错」风险的会话继续迁移（默认跳过并报告）
 *   --backfill-conversations  为尚未桥接的 ChatRoom 补建 Conversation + Participant
 *   --json                    额外输出机器可读 JSON
 *   --quiet                   减少 stdout 输出
 *
 * 前置条件：
 *   npx prisma db push && npx prisma generate    # 使 IMMessage.legacyMessageId 生效
 *
 * @see docs/CHAT-MERGE-RUNBOOK.md  操作手册（含回滚）
 */

import { createClient, type Client } from '@libsql/client';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });

// ═══════════════════════════════════════════════════════════════════════════
// CLI 参数
// ═══════════════════════════════════════════════════════════════════════════

const argv = process.argv.slice(2);
const hasFlag = (n: string) => argv.includes(`--${n}`);
const readArg = (n: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};
const readNum = (n: string, dflt: number): number => {
  const v = readArg(n);
  if (v === null) return dflt;
  const parsed = Number(v);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : dflt;
};

const APPLY = hasFlag('apply');
const LIMIT = readNum('limit', Number.POSITIVE_INFINITY);
const ONLY_CONVERSATION = readArg('conversation');
const SKIP_COUNTERS = hasFlag('skip-counters');
const ALLOW_INTERLEAVE = hasFlag('allow-interleave');
const BACKFILL_CONVERSATIONS = hasFlag('backfill-conversations');
// `--backfill-only`：只补建会话，补完即退出（不继续跑全量消息迁移）。
//
// 为什么要拆：`--backfill-conversations --apply` 在补建之后会**继续执行完整迁移**，
// 两段合起来在资源受限的机器上会被直接杀掉（本机沙箱实测 exit 137，
// 连 shell 一起没了），结果"补建"这一步永远走不完。
// 拆开之后可以配合 `--limit=N` 分批推进；补建本身天然幂等
// （已桥接的房间被 WHERE NOT EXISTS 排除），中断后重跑即续上。
const BACKFILL_ONLY = hasFlag('backfill-only');
const WANT_JSON = hasFlag('json');
const QUIET = hasFlag('quiet');

const log = (...a: unknown[]) => {
  if (!QUIET) console.log(...a);
};

// ═══════════════════════════════════════════════════════════════════════════
// 数据库连接
// ═══════════════════════════════════════════════════════════════════════════

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const TURSO_AUTH_TOKEN = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim();

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
type Stmt = { sql: string; args: SqlArg[] };

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

async function one(sql: string, args: SqlArg[] = []): Promise<Row | undefined> {
  return (await safeQ(sql, args))[0];
}

const num = (v: unknown): number => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** 时间显示（**仅用于报告**，不参与任何写入或匹配） */
function fmtTs(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    const ms = n > 1e14 ? n / 1000 : n > 1e11 ? n : n > 1e9 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
  }
  return String(v);
}

// ═══════════════════════════════════════════════════════════════════════════
// 映射表（必须与 src/lib/im/mirror.ts 保持一致 —— 改一处必须改两处）
// ═══════════════════════════════════════════════════════════════════════════

/** Legacy MessageType → IMMessageType */
const SQL_MSG_TYPE = `CASE m."messageType"
  WHEN 'IMAGE'  THEN 'IMAGE'
  WHEN 'VOICE'  THEN 'VOICE'
  WHEN 'SYSTEM' THEN 'SYSTEM'
  ELSE 'TEXT'
END`;

/** 消息类型 → MediaAccessLevel */
const SQL_MEDIA_LEVEL = `CASE m."messageType"
  WHEN 'IMAGE' THEN 'L1_IMAGE'
  WHEN 'VOICE' THEN 'L2_VOICE'
  ELSE 'L0_TEXT'
END`;

/** 生成一个 24 字符随机主键（长度与 cuid 一致；96 bit 随机，碰撞概率可忽略） */
const randomHexId = `lower(hex(randomblob(12)))`;

// ═══════════════════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════════════════

interface ConversationRow {
  id: string;
  chatRoomId: string;
  userAId: string;
  userBId: string;
}

interface ConvPlan {
  conv: ConversationRow;
  chatRoomExists: boolean;
  chatRoomDeleted: boolean;
  pendingCount: number;
  alreadyLinked: number;
  adoptable: number;
  blocking: string[];
  warnings: string[];
  interleave: boolean;
  oldestPendingTs: unknown;
  newestPendingTs: unknown;
  seqBase: number;
}

interface ConvResult {
  conversationId: string;
  chatRoomId: string;
  adopted: number;
  inserted: number;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 预检
// ═══════════════════════════════════════════════════════════════════════════

async function preflight(): Promise<void> {
  const cols = await safeQ(`PRAGMA table_info("IMMessage")`);
  if (cols.length === 0) {
    console.error('\n✗ 预检失败：无法读取 IMMessage 表结构（表不存在或无权限）\n');
    process.exit(2);
  }
  const names = cols.map((c) => String(c.name));
  if (!names.includes('legacyMessageId')) {
    console.error(
      '\n✗ 预检失败：IMMessage 表缺少 legacyMessageId 列。\n\n' +
        '  请先执行：\n' +
        '    npx prisma db push && npx prisma generate\n\n' +
        '  迁移定义见：\n' +
        '    prisma/migrations/20260927120000_im_message_legacy_bridge/migration.sql\n',
    );
    process.exit(2);
  }
  log('✓ 预检通过：IMMessage.legacyMessageId 已存在');
}

// ═══════════════════════════════════════════════════════════════════════════
// ① 为未桥接的 ChatRoom 补建 Conversation（可选）
// ═══════════════════════════════════════════════════════════════════════════

async function backfillConversations(): Promise<void> {
  // `--limit=N` 对补建同样生效 —— 便于在资源受限的环境中分批推进。
  // 补建幂等：已桥接的房间会被下面的 WHERE NOT EXISTS 排除，重复运行不会重复建。
  const limitClause = Number.isFinite(LIMIT) ? `\n     LIMIT ${Math.floor(LIMIT)}` : '';
  const orphans = await safeQ(`
    SELECT c."id" AS chatRoomId,
           (SELECT COUNT(*) FROM "Message" m WHERE m."roomId" = c."id") AS msgCount
      FROM "ChatRoom" c
     WHERE NOT EXISTS (SELECT 1 FROM "Conversation" v WHERE v."chatRoomId" = c."id")${limitClause}
  `);

  if (orphans.length === 0) {
    log('✓ 无需补建：所有 ChatRoom 均已桥接 Conversation');
    return;
  }

  console.log(`\n【backfill】发现 ${orphans.length} 个未桥接 ChatRoom`);
  let created = 0;
  let failed = 0;

  for (const o of orphans) {
    const chatRoomId = str(o.chatRoomId);
    const members = await safeQ(
      `SELECT "userId" FROM "ChatRoomMember" WHERE "roomId" = ? ORDER BY "joinedAt" ASC`,
      [chatRoomId],
    );
    if (members.length < 2) {
      console.warn(`  ⚠ 跳过 room=${chatRoomId.slice(0, 10)}…：成员数 ${members.length} < 2`);
      failed++;
      continue;
    }

    const userIds = members.map((m) => str(m.userId));
    // 与 lib/im/queries.ts createConversation 完全一致的归一化：按字符串序定 userA/userB
    const [firstId, secondId] =
      userIds[0] < userIds[1] ? [userIds[0], userIds[1]] : [userIds[1], userIds[0]];

    if (!APPLY) {
      log(`  [dry-run] 将补建 room=${chatRoomId.slice(0, 10)}… pair=${firstId.slice(0, 6)}…/${secondId.slice(0, 6)}…`);
      created++;
      continue;
    }

    // 时间列全部用子查询取值（原值往返），不在 JS 构造时间
    const stmts: Stmt[] = [
      {
        sql: `INSERT INTO "Conversation"
                ("id","userAId","userBId","initiatorId","chatRoomId","state",
                 "cachedConsentState","messageCount","unreadCountA","unreadCountB",
                 "createdAt","updatedAt")
              VALUES (?,?,?,?,?,'ACTIVE','CONSENT_NONE',0,0,0,
                 (SELECT "createdAt" FROM "ChatRoom" WHERE "id" = ?),
                 (SELECT "createdAt" FROM "ChatRoom" WHERE "id" = ?))`,
        args: [randomId('c'), firstId, secondId, firstId, chatRoomId, chatRoomId, chatRoomId],
      },
    ];
    const convId = stmts[0].args[0] as string;
    for (const uid of [firstId, secondId]) {
      stmts.push({
        sql: `INSERT INTO "ConversationParticipant"
                ("id","conversationId","userId","isMuted","isPinned","isArchived",
                 "lastReadSeq","lastReadAt","subscribedAt")
              VALUES (?,?,?,0,0,0,0,NULL,(SELECT "createdAt" FROM "ChatRoom" WHERE "id" = ?))`,
        args: [randomId('p'), convId, uid, chatRoomId],
      });
    }

    try {
      await client.batch(stmts, 'write');
      created++;
    } catch (e) {
      console.error(`  ✗ 补建失败 room=${chatRoomId.slice(0, 10)}…：${(e as Error).message}`);
      failed++;
    }
  }

  console.log(`【backfill】${APPLY ? '已补建' : '待补建'} ${created} 个，失败 ${failed} 个`);
}

/** 生成主键（JS 侧，用于补建场景） */
function randomId(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 14) + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ═══════════════════════════════════════════════════════════════════════════
// ② 认领配对：找出「Legacy SYSTEM 消息 ↔ 既有 IM SYSTEM 行」的 1:1 映射
//
//    不使用任何时间解析。判定条件：
//      · 类型两侧都是 SYSTEM
//      · senderId 相同、内容完全相同
//      · 两侧都尚未被链接
//    然后要求配对是 1:1（任一侧出现多对多歧义 → 全部放弃认领，改为新插入）
//    —— 这只会匹配到 /api/matches/react 建的那条开场消息，不影响真实对话。
// ═══════════════════════════════════════════════════════════════════════════

async function findAdoptionPairs(conv: ConversationRow): Promise<{ imId: string; legacyId: string }[]> {
  const rows = await safeQ(
    `SELECT i."id" AS imId, m."id" AS legacyId
       FROM "IMMessage" i
       JOIN "Message"  m
         ON  m."roomId"     = ?
         AND m."senderId"   = i."senderId"
         AND m."content"    = i."payload"
         AND m."messageType" = 'SYSTEM'
         AND i."msgType"     = 'SYSTEM'
      WHERE i."conversationId" = ?
        AND i."legacyMessageId" IS NULL
        AND m."id" NOT IN (SELECT "legacyMessageId" FROM "IMMessage" WHERE "legacyMessageId" IS NOT NULL)`,
    [conv.chatRoomId, conv.id],
  );

  // 双向度检查：任一侧度数 ≠ 1 的对全部丢弃（存在歧义时不冒险认领）
  const degreeIm = new Map<string, number>();
  const degreeLegacy = new Map<string, number>();
  for (const r of rows) {
    const imId = str(r.imId);
    const legacyId = str(r.legacyId);
    degreeIm.set(imId, (degreeIm.get(imId) ?? 0) + 1);
    degreeLegacy.set(legacyId, (degreeLegacy.get(legacyId) ?? 0) + 1);
  }

  const pairs: { imId: string; legacyId: string }[] = [];
  for (const r of rows) {
    const imId = str(r.imId);
    const legacyId = str(r.legacyId);
    if (degreeIm.get(imId) === 1 && degreeLegacy.get(legacyId) === 1) {
      pairs.push({ imId, legacyId });
    }
  }
  return pairs;
}

// ═══════════════════════════════════════════════════════════════════════════
// ③ 分析：为每个 Conversation 生成迁移计划（纯只读）
// ═══════════════════════════════════════════════════════════════════════════

async function planConversation(conv: ConversationRow): Promise<ConvPlan> {
  const blocking: string[] = [];
  const warnings: string[] = [];

  const room = await one(`SELECT "id","deletedAt" FROM "ChatRoom" WHERE "id" = ?`, [conv.chatRoomId]);
  const chatRoomExists = !!room;
  const chatRoomDeleted = !!room && room.deletedAt !== null && room.deletedAt !== undefined;

  if (!chatRoomExists) blocking.push('ChatRoom 不存在（数据不一致）');
  if (chatRoomDeleted) warnings.push('ChatRoom 已软删除 —— 会保留历史，但不传播 deletedAt');

  const linkedRow = await one(
    `SELECT COUNT(*) AS c FROM "IMMessage" WHERE "conversationId" = ? AND "legacyMessageId" IS NOT NULL`,
    [conv.id],
  );
  const alreadyLinked = num(linkedRow?.c);

  const unlinked = await safeQ(
    `SELECT "id","senderId","createdAt" FROM "Message"
      WHERE "roomId" = ?
        AND "id" NOT IN (SELECT "legacyMessageId" FROM "IMMessage" WHERE "legacyMessageId" IS NOT NULL)`,
    [conv.chatRoomId],
  );

  const illegalSender = unlinked.filter(
    (r) => str(r.senderId) !== conv.userAId && str(r.senderId) !== conv.userBId,
  );
  if (illegalSender.length > 0) {
    warnings.push(`${illegalSender.length} 条消息的发送者不属于本会话双方（迁移会跳过这些行）`);
  }

  const migratable = unlinked.filter(
    (r) => str(r.senderId) === conv.userAId || str(r.senderId) === conv.userBId,
  );

  // 时间范围（仅展示）—— 用 SQL 取 MIN/MAX，避免 JS 解析时间格式
  const range = await one(
    `SELECT MIN(m."createdAt") AS minTs, MAX(m."createdAt") AS maxTs
       FROM "Message" m
      WHERE m."roomId" = ?
        AND m."senderId" IN (?, ?)
        AND m."id" NOT IN (SELECT "legacyMessageId" FROM "IMMessage" WHERE "legacyMessageId" IS NOT NULL)`,
    [conv.chatRoomId, conv.userAId, conv.userBId],
  );

  const seqRow = await one(`SELECT COALESCE(MAX("seq"),0) AS m FROM "IMMessage" WHERE "conversationId" = ?`, [conv.id]);
  const seqBase = num(seqRow?.m);

  const adoptPairs = await findAdoptionPairs(conv);

  // ⚠ 序号交错风险：存在「未链接的非 SYSTEM IM 行」比最早待迁消息还新。
  //   此时把历史消息追加到 max(seq)+1 会让它们在时间线上排到新消息之后。
  //   开场 SYSTEM 消息比任何真实对话都早，因此不会误判。
  //   比较在 SQL 内进行，两侧都是 DateTime 列 → 同格式，安全。
  let interleave = false;
  if (migratable.length > 0 && range?.minTs !== undefined && range?.minTs !== null) {
    const iRow = await one(
      `SELECT COUNT(*) AS c FROM "IMMessage"
        WHERE "conversationId" = ?
          AND "legacyMessageId" IS NULL
          AND "msgType" <> 'SYSTEM'
          AND "createdAt" > ?`,
      [conv.id, range.minTs as SqlArg],
    );
    interleave = num(iRow?.c) > 0;
    if (interleave) {
      warnings.push('序号交错：IM 侧已有比待迁消息更新的真实消息，追加序号会导致时间线错序');
    }
  }

  return {
    conv,
    chatRoomExists,
    chatRoomDeleted,
    pendingCount: migratable.length,
    alreadyLinked,
    adoptable: adoptPairs.length,
    blocking,
    warnings,
    interleave,
    oldestPendingTs: range?.minTs,
    newestPendingTs: range?.maxTs,
    seqBase,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ④ 执行单个会话的迁移（单次原子 batch）
// ═══════════════════════════════════════════════════════════════════════════

async function applyConversation(plan: ConvPlan): Promise<ConvResult> {
  const { conv } = plan;
  const result: ConvResult = {
    conversationId: conv.id,
    chatRoomId: conv.chatRoomId,
    adopted: 0,
    inserted: 0,
  };

  const stmts: Stmt[] = [];

  // ── (a) 认领既有 TWIN-CHAT 开场消息（只补写 legacyMessageId，不动内容）──
  const pairs = await findAdoptionPairs(conv);
  for (const p of pairs) {
    stmts.push({
      sql: `UPDATE "IMMessage" SET "legacyMessageId" = ? WHERE "id" = ? AND "legacyMessageId" IS NULL`,
      args: [p.legacyId, p.imId],
    });
  }
  result.adopted = pairs.length;

  // ── (b) 批量插入剩余待迁消息（原值往返，零 JS 时间构造）──
  const insertIdx = stmts.length;
  stmts.push({
    sql: `
      INSERT INTO "IMMessage" (
        "id","conversationId","legacyMessageId","senderId","receiverId","seq",
        "msgType","payload","metadata","encryptionMode","complianceTags",
        "consentState","mediaLevel","ruleResult","isEdited","isDeleted","status","createdAt"
      )
      SELECT
        ${randomHexId},
        ?,
        m."id",
        m."senderId",
        CASE WHEN m."senderId" = ? THEN ? ELSE ? END,
        ? + ROW_NUMBER() OVER (ORDER BY m."createdAt" ASC, m."id" ASC),
        ${SQL_MSG_TYPE},
        m."content",
        m."metadata",
        'SERVER',
        '[]',
        'CONSENT_NONE',
        ${SQL_MEDIA_LEVEL},
        'PASS',
        0,
        0,
        CASE WHEN m."isRead" = 1 THEN 'READ' ELSE 'SENT' END,
        m."createdAt"
      FROM "Message" m
      WHERE m."roomId" = ?
        AND m."senderId" IN (?, ?)
        AND m."id" NOT IN (SELECT "legacyMessageId" FROM "IMMessage" WHERE "legacyMessageId" IS NOT NULL)
      ORDER BY m."createdAt" ASC, m."id" ASC
    `,
    args: [
      conv.id,
      conv.userAId, conv.userBId, conv.userAId,
      plan.seqBase,
      conv.chatRoomId,
      conv.userAId, conv.userBId,
    ],
  });

  // ── (c) 计数器与时间戳：绝对重算 / 单调取大（幂等）──
  if (!SKIP_COUNTERS) {
    stmts.push({
      sql: `
        UPDATE "Conversation"
           SET "messageCount" = (SELECT COUNT(*) FROM "IMMessage" WHERE "conversationId" = ?),
               "unreadCountA" = MAX("unreadCountA",
                 (SELECT COUNT(*) FROM "IMMessage"
                   WHERE "conversationId" = ? AND "senderId" = ? AND "status" <> 'READ')),
               "unreadCountB" = MAX("unreadCountB",
                 (SELECT COUNT(*) FROM "IMMessage"
                   WHERE "conversationId" = ? AND "senderId" = ? AND "status" <> 'READ')),
               "lastMessageAt" = MAX(COALESCE("lastMessageAt", 0),
                 COALESCE((SELECT MAX("createdAt") FROM "IMMessage" WHERE "conversationId" = ?), 0)),
               "updatedAt"     = MAX(COALESCE("updatedAt", 0),
                 COALESCE((SELECT MAX("createdAt") FROM "IMMessage" WHERE "conversationId" = ?), 0)),
               "vaultExpiresAt" = COALESCE("vaultExpiresAt",
                 (SELECT "vaultExpiry" FROM "ChatRoom" WHERE "id" = ?))
         WHERE "id" = ?
           AND EXISTS (SELECT 1 FROM "IMMessage" WHERE "conversationId" = ?)
      `,
      args: [
        conv.id,
        conv.id, conv.userBId,
        conv.id, conv.userAId,
        conv.id,
        conv.id,
        conv.chatRoomId,
        conv.id,
        conv.id,
      ],
    });

    for (const userId of [conv.userAId, conv.userBId]) {
      stmts.push({
        sql: `
          UPDATE "ConversationParticipant"
             SET "lastReadSeq" = MAX(COALESCE("lastReadSeq", 0),
                   COALESCE((SELECT MAX("seq") FROM "IMMessage"
                              WHERE "conversationId" = ?
                                AND "createdAt" <= (SELECT "lastReadAt" FROM "ChatRoomMember"
                                                     WHERE "roomId" = ? AND "userId" = ?)), 0)),
                 "lastReadAt" = CASE
                   WHEN (SELECT "lastReadAt" FROM "ChatRoomMember"
                          WHERE "roomId" = ? AND "userId" = ?) IS NULL
                     THEN "lastReadAt"
                   ELSE MAX(COALESCE("lastReadAt", 0),
                          (SELECT "lastReadAt" FROM "ChatRoomMember"
                            WHERE "roomId" = ? AND "userId" = ?))
                 END,
                 "isMuted" = MAX("isMuted",
                   COALESCE((SELECT "isMuted" FROM "ChatRoomMember"
                              WHERE "roomId" = ? AND "userId" = ?), 0))
           WHERE "conversationId" = ? AND "userId" = ?
        `,
        args: [
          conv.id, conv.chatRoomId, userId,
          conv.chatRoomId, userId,
          conv.chatRoomId, userId,
          conv.chatRoomId, userId,
          conv.id, userId,
        ],
      });
    }
  }

  // ── 执行：libSQL batch 为原子事务，任一语句失败则整体回滚 ──
  try {
    const results = await client.batch(stmts, 'write');
    result.inserted = num(results[insertIdx]?.rowsAffected);
    return result;
  } catch (e) {
    return { ...result, error: (e as Error).message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const t0 = Date.now();
  console.log('═══════════════════════════════════════════════════════════');
  console.log(` P1-6 阶段 3 · Message → IMMessage 数据统一  [${APPLY ? '⚠ APPLY 写入' : 'DRY-RUN 只读'}]`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log(` 数据库：${DATABASE_URL.replace(/(\/\/[^:]+:)[^@]+@/, '$1***@')}\n`);

  await preflight();

  if (BACKFILL_CONVERSATIONS) {
    await backfillConversations();
    if (!APPLY) {
      console.log('\n（dry-run 不继续后续分析；加 --apply 才会真正补建并继续）\n');
      process.exit(0);
    }
    if (BACKFILL_ONLY) {
      console.log('\n（--backfill-only：补建已完成即退出，本次不执行消息迁移）\n');
      process.exit(0);
    }
  }

  let convs: ConversationRow[];
  if (ONLY_CONVERSATION) {
    convs = (await safeQ(
      `SELECT "id","chatRoomId","userAId","userBId" FROM "Conversation" WHERE "id" = ? AND "chatRoomId" IS NOT NULL`,
      [ONLY_CONVERSATION],
    )) as unknown as ConversationRow[];
    if (convs.length === 0) {
      console.error(`✗ 未找到 Conversation id=${ONLY_CONVERSATION}（或 chatRoomId 为空）`);
      process.exit(1);
    }
  } else {
    convs = (await safeQ(
      `SELECT "id","chatRoomId","userAId","userBId" FROM "Conversation" WHERE "chatRoomId" IS NOT NULL`,
    )) as unknown as ConversationRow[];
  }

  log(`已桥接 Conversation 总数：${convs.length}`);

  // ── 计划阶段（只读）──
  const plans: ConvPlan[] = [];
  for (const c of convs) {
    try {
      plans.push(await planConversation(c));
    } catch (e) {
      console.warn(`  ⚠ 分析失败 conv=${c.id.slice(0, 10)}…：${(e as Error).message}`);
    }
  }

  const todo = plans.filter((p) => p.pendingCount > 0 || p.adoptable > 0);
  const skippedInterleave = todo.filter((p) => p.interleave && !ALLOW_INTERLEAVE);
  const blocked = todo.filter((p) => p.blocking.length > 0);

  const totals = {
    会话总数: plans.length,
    需处理会话: todo.length,
    待迁消息总数: plans.reduce((s, p) => s + p.pendingCount, 0),
    可认领既有行: plans.reduce((s, p) => s + p.adoptable, 0),
    已迁入历史: plans.reduce((s, p) => s + p.alreadyLinked, 0),
    因序号交错跳过: skippedInterleave.length,
    因阻塞跳过: blocked.length,
  };
  console.log('\n【计划汇总】');
  console.table(totals);

  if (blocked.length > 0) {
    console.log('\n⚠ 阻塞项（不会被迁移）：');
    for (const p of blocked.slice(0, 20)) {
      console.log(`  · conv=${p.conv.id.slice(0, 10)}… room=${p.conv.chatRoomId.slice(0, 10)}… → ${p.blocking.join('；')}`);
    }
    if (blocked.length > 20) console.log(`  … 另有 ${blocked.length - 20} 个`);
  }

  if (skippedInterleave.length > 0) {
    console.log('\n⚠ 序号交错（默认跳过；确认可接受后用 --allow-interleave 强制）：');
    for (const p of skippedInterleave.slice(0, 20)) {
      console.log(
        `  · conv=${p.conv.id.slice(0, 10)}… 待迁 ${p.pendingCount} 条，最早 ${fmtTs(p.oldestPendingTs)}，seq 基线 ${p.seqBase}`,
      );
    }
    if (skippedInterleave.length > 20) console.log(`  … 另有 ${skippedInterleave.length - 20} 个`);
  }

  // ── 执行 ──
  const runnable = todo.filter((p) => p.blocking.length === 0 && (ALLOW_INTERLEAVE || !p.interleave));
  const limited =
    LIMIT === Number.POSITIVE_INFINITY ? runnable : runnable.slice(0, LIMIT);

  if (limited.length < runnable.length) {
    log(`\n（--limit=${LIMIT} 生效：本次处理 ${limited.length} / ${runnable.length} 个会话）`);
  }

  const results: ConvResult[] = [];
  let processed = 0;

  for (const p of limited) {
    if (!APPLY) {
      results.push({
        conversationId: p.conv.id,
        chatRoomId: p.conv.chatRoomId,
        adopted: p.adoptable,
        inserted: p.pendingCount,
      });
    } else {
      const r = await applyConversation(p);
      results.push(r);
      if (r.error) console.error(`  ✗ conv=${p.conv.id.slice(0, 10)}… 失败：${r.error}`);
    }
    processed++;
    if (!QUIET && processed % 200 === 0) log(`  … 已处理 ${processed}/${limited.length}`);
  }

  const totalAdopted = results.reduce((s, r) => s + r.adopted, 0);
  const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
  const errors = results.filter((r) => r.error);
  const warnings = [...new Set(plans.flatMap((p) => p.warnings))];

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(APPLY ? ' 执行结果' : ' 预演结果（未写入任何数据）');
  console.log('═══════════════════════════════════════════════════════════');
  console.table({
    处理会话: results.length,
    认领既有IM行: totalAdopted,
    新迁入消息: totalInserted,
    失败会话: errors.length,
    耗时秒: Math.round((Date.now() - t0) / 100) / 10,
  });

  if (!APPLY) {
    console.log('\n  下一步：确认数字合理 → --limit=20 --apply 试跑 → 全量 --apply');
  } else {
    console.log('\n  下一步（必做）：npx tsx scripts/chat-merge/verify-migration.ts');
    console.log('  然后：在环境变量里设置 CHAT_TWIN_WRITE=1，让新消息持续镜像入 IMMessage');
  }

  console.log('\n【回滚】阶段 4 上线前可安全回滚（新消息尚未只写 IM）：');
  console.log('  DELETE FROM "IMMessage" WHERE "legacyMessageId" IS NOT NULL;');

  // ── 报告文件 ──
  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(__dirname, '../../docs');
  if (fs.existsSync(outDir)) {
    const sections: string[] = [
      `# 双聊天系统合并 · 阶段 3 数据统一报告 · ${date}`,
      '',
      `> 模式：**${APPLY ? 'APPLY（已写入）' : 'DRY-RUN（未写入）'}**`,
      '> 生成者：`scripts/chat-merge/migrate-messages.ts`',
      '',
      '## 计划汇总',
      '',
      '| 指标 | 值 |',
      '|---|---|',
      ...Object.entries(totals).map(([k, v]) => `| ${k} | ${v} |`),
      '',
      '## 执行结果',
      '',
      '| 指标 | 值 |',
      '|---|---|',
      `| 处理会话 | ${results.length} |`,
      `| 认领既有 IM 行 | ${totalAdopted} |`,
      `| 新迁入消息 | ${totalInserted} |`,
      `| 失败会话 | ${errors.length} |`,
      '',
    ];

    if (blocked.length) {
      sections.push('## 阻塞项', '', '| conversationId | chatRoomId | 原因 |', '|---|---|---|',
        ...blocked.slice(0, 200).map((p) => `| ${p.conv.id} | ${p.conv.chatRoomId} | ${p.blocking.join('；')} |`), '');
    }
    if (skippedInterleave.length) {
      sections.push('## 序号交错（已跳过，需人工决策）', '',
        '| conversationId | 待迁 | 最早待迁时间 | seq 基线 |', '|---|---|---|---|',
        ...skippedInterleave.slice(0, 200).map((p) => `| ${p.conv.id} | ${p.pendingCount} | ${fmtTs(p.oldestPendingTs)} | ${p.seqBase} |`), '');
    }
    if (errors.length) {
      sections.push('## 失败会话', '', '| conversationId | 错误 |', '|---|---|',
        ...errors.slice(0, 200).map((r) => `| ${r.conversationId} | ${r.error} |`), '');
    }
    if (warnings.length) {
      sections.push('## 告警汇总', '', ...warnings.map((w) => `- ${w}`), '');
    }

    sections.push('## 回滚', '', '```sql', 'DELETE FROM "IMMessage" WHERE "legacyMessageId" IS NOT NULL;', '```', '');

    const outFile = path.join(outDir, `chat-merge-migration-${date}.md`);
    fs.writeFileSync(outFile, sections.join('\n'), 'utf8');
    console.log(`\n  📄 报告已写入：docs/chat-merge-migration-${date}.md`);
  }

  if (WANT_JSON) {
    console.log('\n---JSON---');
    console.log(
      JSON.stringify(
        {
          mode: APPLY ? 'apply' : 'dry-run',
          totals,
          results,
          blocked: blocked.map((p) => ({ conv: p.conv.id, reasons: p.blocking })),
          interleave: skippedInterleave.map((p) => p.conv.id),
        },
        null,
        2,
      ),
    );
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\n✗ 迁移失败：', e);
  process.exit(1);
});

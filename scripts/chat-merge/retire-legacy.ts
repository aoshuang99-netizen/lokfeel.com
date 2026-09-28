/**
 * P1-6 双聊天系统合并 —— 阶段 5：Legacy 退场**放行门禁**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这个脚本不做破坏性操作，也**永远不会**自己执行 DDL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 阶段 5 的目标是删掉 `Message` / `ChatRoomMember` / `ChatRoom`（42 → 39 张表），
 * 但「删除」这件事在本项目里**不能由脚本自动完成**，原因有二：
 *
 *   1. 本库是 libSQL/SQLite，结构由 `prisma db push` 管理
 *      （`prisma/migrations/` 是早期 PostgreSQL 时代产物，含 `DO $$ ... pg_type`，
 *       **不可执行 `prisma migrate deploy`**）。
 *      `db push` 的删除行为是「从 schema 里删掉 model → push 时 DROP TABLE」，
 *      也就是说**破坏性动作发生在人类编辑 schema 的那一刻**，不在脚本里。
 *      把 DROP 藏进脚本会让「什么被删了」变得不可审计。
 *
 *   2. 阶段 5 的前置数据闸门（尤其是 G-1 Vault）在此脚本运行前无法确知。
 *      未经门禁直接删除 = 女性用户的「终结对话」权限、倒计时延长审计、
 *      截图取证**永久丢失且不可恢复**。
 *
 * 因此本脚本的职责是：**把「能不能删」变成一条可重复运行的 go / no-go 命令**。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 用法
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   # 1) 门禁检查（只读，默认）—— 输出 go / no-go 与逐项证据
 *   npx tsx scripts/chat-merge/retire-legacy.ts
 *
 *   # 2) 附带打印阶段 5 需要执行的确切 SQL 与 schema 改动清单
 *   npx tsx scripts/chat-merge/retire-legacy.ts --sql
 *
 *   # 3) 机器可读输出（供 CI 判退：全绿 exit 0，有阻断项 exit 2）
 *   npx tsx scripts/chat-merge/retire-legacy.ts --json
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 门禁清单
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   B1  目标列就绪          Conversation 的 10 个迁移目标列全部存在 [阻断]
 *   B2  实质未迁移=0        G-1 放行闸门（Vault + matchId 均一致）   [阻断]
 *   B3  桥接完整性          ChatRoom 无对应 Conversation = 0        [阻断]
 *   B4  消息未迁移=0        Message 中无 legacyMessageId 血缘的行    [阻断]
 *   B5  脏数据              senderId 不属于会话成员的行             [知情]
 *   B6  已读回执覆盖        G-2 放行闸门（已读消息未还原为回执）     [阻断]
 *   B7  孤儿 IMMessage      conversationId 悬空 = 0                 [阻断]
 *   B8  计数器一致性        Conversation.messageCount 与实数漂移    [知情]
 *   B9  代码引用残留        Legacy 三表的非迁移类引用点             [阻断]
 *
 * 「阻断」= 任一不通过则脚本 exit 2，禁止进入阶段 5。
 * 「知情」= 只报告数量，需要人来判断是否接受。设计上**不把人的判断自动化**。
 *
 * ⚠️ B9 的由来（2026-09-27 阶段 5 代码侧）：
 *    原本的清单只覆盖数据，但**删表还会打断代码编译** —— Prisma 客户端按 schema 生成，
 *    model 移除后 `db.chatRoom` 变成 undefined，所有引用点直接 TypeError 或 tsc 报错。
 *    实测聊天合并之外仍有 cron/bot-chat、bot/chat、matches、user/limits、
 *    admin analytics、bot-learning 等模块在读写在用这三张表。
 *    因此「数据迁完」不等于「可以删表」，必须同时确认代码引用已清空。
 *
 * @see docs/CHAT-MERGE-AUDIT.md      §11.3 缺口清单（G-1…G-10）
 * @see docs/CHAT-MERGE-RUNBOOK.md    §10 阶段 5 执行手册
 * @see docs/CHAT-MERGE-LEGACY-REFS.md  B9 的引用点分类与迁移建议
 */

import { createClient, type Client } from '@libsql/client';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

import {
  meaningfulRoomCondition,
  REQUIRED_CONVERSATION_MIGRATION_COLUMNS,
  vaultDiffCondition,
} from './shared/vault-diff';
import { scanLegacyRefs } from './shared/legacy-refs';
import { RECEIPTS_NEEDED_COUNT_SQL } from './shared/receipt-coverage';

dotenv.config({ path: '.env' });

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════

const argv = process.argv.slice(2);
const hasFlag = (n: string) => argv.includes(`--${n}`);
const PRINT_SQL = hasFlag('sql');
const WANT_JSON = hasFlag('json');

/** 仓库根目录（`scripts/chat-merge/` → 上两级）。B9 的静态扫描需要它。 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const log = (...a: unknown[]) => console.log(...a);
const hr = (t: string) => log(`\n${'─'.repeat(70)}\n${t}\n${'─'.repeat(70)}`);

// ═══════════════════════════════════════════════════════════════════════════
// 连接
// ═══════════════════════════════════════════════════════════════════════════

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const AUTH_TOKEN = (
  process.env.DATABASE_AUTH_TOKEN ||
  process.env.TURSO_AUTH_TOKEN ||
  ''
).trim();

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

/** 只取单个标量的便捷封装（失败返回 0） */
async function scalar(sql: string, args: SqlArg[] = []): Promise<number> {
  const rows = await safeQ(sql, args);
  return Number(rows[0]?.n ?? 0);
}

const num = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// ═══════════════════════════════════════════════════════════════════════════
// 门禁结果收集
// ═══════════════════════════════════════════════════════════════════════════

type Severity = 'block' | 'info';

interface Gate {
  id: string;
  title: string;
  severity: Severity;
  value: number;
  /** 通过与否（阻断项判 0，知情项恒真） */
  ok: boolean;
  detail?: string;
}

const gates: Gate[] = [];
const push = (g: Gate) => gates.push(g);

// ═══════════════════════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  hr('P1-6 阶段 5 · Legacy 退场放行门禁');
  log('模式：只读（本脚本不执行任何 DDL / DML）');
  log(`库：${DATABASE_URL.replace(/\/\/.*@/, '//***@')}`);

  // ─────────────────────────────────────────────────────────────────────
  // B1 · 目标列就绪
  // ─────────────────────────────────────────────────────────────────────
  hr('B1 · Conversation 的迁移目标列是否就绪');
  const cols = await safeQ(`PRAGMA table_info("Conversation")`);
  const colNames = new Set(cols.map((c) => str(c.name)));
  const missing = REQUIRED_CONVERSATION_MIGRATION_COLUMNS.filter((c) => !colNames.has(c));
  push({
    id: 'B1',
    title: '目标列就绪',
    severity: 'block',
    value: missing.length,
    ok: missing.length === 0,
    detail: missing.length ? `缺失：${missing.join(', ')} → 先跑 npx prisma db push` : undefined,
  });
  log(
    missing.length === 0
      ? `✓ ${REQUIRED_CONVERSATION_MIGRATION_COLUMNS.length} 个迁移目标列全部存在（Vault + matchId）`
      : `🔴 缺少列：${missing.join(', ')}\n   请先执行：npx prisma db push && npx prisma generate`,
  );

  // 列不全时，后续 Vault 比对会直接报 SQL 错误 —— 提前返回，输出可读的诊断
  if (missing.length > 0) {
    await report();
    return;
  }

  // ─────────────────────────────────────────────────────────────────────
  // B2 · Vault 实质未迁移 = 0（G-1 放行闸门）
  // ─────────────────────────────────────────────────────────────────────
  hr('B2 · Vault + matchId 是否已完整迁移（G-1 放行闸门）');
  const vaultDrift = await scalar(
    `SELECT COUNT(*) AS n
       FROM "Conversation" c
       JOIN "ChatRoom" r ON r."id" = c."chatRoomId"
      WHERE (${vaultDiffCondition('c', 'r')})`,
  );
  const vaultDriftMeaningful = await scalar(
    `SELECT COUNT(*) AS n
       FROM "Conversation" c
       JOIN "ChatRoom" r ON r."id" = c."chatRoomId"
      WHERE (${vaultDiffCondition('c', 'r')}) AND ${meaningfulRoomCondition('r')}`,
  );
  push({
    id: 'B2',
    title: 'Vault + matchId 实质未迁移',
    severity: 'block',
    value: vaultDriftMeaningful,
    ok: vaultDriftMeaningful === 0,
    detail:
      vaultDrift === 0
        ? undefined
        : `总差异 ${vaultDrift} 行，其中"真的持有需迁移数据"的 ${vaultDriftMeaningful} 行`,
  });
  log(`字段差异行数                    : ${vaultDrift}`);
  log(`其中"真的持有需迁移数据"的       : ${vaultDriftMeaningful}   ← 唯一有语义的指标`);
  if (vaultDriftMeaningful === 0) {
    log('✓ 通过 —— 删除 ChatRoom 不会丢失 Vault 能力（终结对话 / 延长审计 / 截图取证）与匹配分。');
  } else {
    log('🔴 阻断 —— 仍有实质状态留在 ChatRoom。');
    log('   处置：npm run chat:vault:apply  然后  npm run chat:vault:verify');
  }

  // ─────────────────────────────────────────────────────────────────────
  // B3 · 桥接完整性
  // ─────────────────────────────────────────────────────────────────────
  hr('B3 · ChatRoom → Conversation 桥接完整性');
  //
  // 「未桥接」必须拆成两类，否则这条门禁可能永远无法归零：
  //   (a) 可桥接却漏桥接 —— 真问题，删表会丢会话入口              → 阻断
  //   (b) 成员数 < 2 的房间 —— 结构上**建不出** 1:1 会话
  //       （Conversation 要求 userA + userB 是两个不同用户），
  //       `chat:backfill` 会明确跳过并计入其"失败"数。
  //       这种房间没有参与者，也就没有"会话入口"可丢，故不算阻断；
  //       但必须显式列出来，由人决定是否清理。
  //   实测来源：本库恰有 1 个这样的空房间，正是它让 B3 卡在 1、无法归零。
  //   兜底：若这类房间里仍残留消息，B4（血缘覆盖率）会照样拦住，不会漏网。
  const orphanRooms = await scalar(
    `SELECT COUNT(*) AS n
       FROM "ChatRoom" r
      WHERE NOT EXISTS (SELECT 1 FROM "Conversation" c WHERE c."chatRoomId" = r."id")
        AND (SELECT COUNT(*) FROM "ChatRoomMember" m WHERE m."roomId" = r."id") >= 2`,
  );
  const unbridgeableRooms = await scalar(
    `SELECT COUNT(*) AS n
       FROM "ChatRoom" r
      WHERE NOT EXISTS (SELECT 1 FROM "Conversation" c WHERE c."chatRoomId" = r."id")
        AND (SELECT COUNT(*) FROM "ChatRoomMember" m WHERE m."roomId" = r."id") < 2`,
  );
  const totalRooms = await scalar(`SELECT COUNT(*) AS n FROM "ChatRoom"`);
  const totalConvs = await scalar(`SELECT COUNT(*) AS n FROM "Conversation"`);
  push({
    id: 'B3',
    title: '未桥接 ChatRoom（可桥接）',
    severity: 'block',
    value: orphanRooms,
    ok: orphanRooms === 0,
    detail: orphanRooms ? '先跑 npm run chat:backfill -- --apply' : undefined,
  });
  push({
    id: 'B3b',
    title: '无法桥接的空房间（成员 < 2）',
    severity: 'info',
    value: unbridgeableRooms,
    ok: true,
    detail: unbridgeableRooms
      ? '这些房间缺少参与者，建不出 1:1 会话，backfill 已跳过。删表时它们随之消失；'
        + '若要保留，需先补齐成员。若其中有残留消息，B4 会拦住。'
      : undefined,
  });
  log(`ChatRoom 总数           : ${totalRooms}`);
  log(`Conversation 总数       : ${totalConvs}`);
  log(`未桥接 ChatRoom（可桥接）: ${orphanRooms}`);
  log(`无法桥接的空房间         : ${unbridgeableRooms}`);
  log(
    orphanRooms === 0
      ? '✓ 通过 —— 每个有参与者的房间都有终局模型对应行。'
      : '🔴 阻断 —— 有房间没有 Conversation，删表会丢会话入口。\n   处置：npm run chat:backfill  →  npm run chat:backfill -- --apply',
  );

  // ─────────────────────────────────────────────────────────────────────
  // B4 · 消息未迁移 = 0
  // ─────────────────────────────────────────────────────────────────────
  hr('B4 · Legacy 消息是否已全部迁移（血缘覆盖率）');
  const totalMsg = await scalar(`SELECT COUNT(*) AS n FROM "Message"`);
  const linkedMsg = await scalar(
    `SELECT COUNT(*) AS n FROM "Message" m
      WHERE EXISTS (
        SELECT 1 FROM "IMMessage" i WHERE i."legacyMessageId" = m."id"
      )`,
  );
  const unlinkedMsg = totalMsg - linkedMsg;
  push({
    id: 'B4',
    title: '未迁移 Legacy 消息',
    severity: 'block',
    value: unlinkedMsg,
    ok: unlinkedMsg === 0,
    detail: unlinkedMsg ? '跑 npm run chat:migrate:apply（先 --limit=20 试跑）' : undefined,
  });
  log(`Message 总行数          : ${totalMsg}`);
  log(`已建立血缘（已迁移）     : ${linkedMsg}`);
  log(`未迁移                  : ${unlinkedMsg}   ← 应当为 0`);
  log(
    unlinkedMsg === 0
      ? '✓ 通过 —— 所有 Legacy 消息都能在 IM 侧找到对应行。'
      : '🔴 阻断 —— 仍有消息只存在于 Legacy 表，删除即丢失。\n   处置：npm run chat:inventory  →  chat:migrate（预演）→ chat:migrate:apply  →  chat:verify',
  );

  // ─────────────────────────────────────────────────────────────────────
  // B5 · 脏数据（知情项）
  // ─────────────────────────────────────────────────────────────────────
  hr('B5 · 脏数据：senderId 不属于会话成员（知情项）');
  const dirty = await scalar(
    `SELECT COUNT(*) AS n FROM "Message" m
      WHERE NOT EXISTS (
        SELECT 1 FROM "ChatRoomMember" cm
         WHERE cm."roomId" = m."roomId" AND cm."userId" = m."senderId"
      )`,
  );
  push({
    id: 'B5',
    title: '非成员发送的消息',
    severity: 'info',
    value: dirty,
    ok: true,
    detail: dirty ? '需人工判断是否归档；此类行会被迁移脚本有意跳过（G-5）' : undefined,
  });
  log(`非成员发送的消息行数     : ${dirty}`);
  log(
    dirty === 0
      ? '✓ 无脏数据。'
      : '⚠ 存在脏数据。G-5 记载：迁移脚本**有意跳过**这些行（senderId 不属于会话双方）。\n   删除前请确认这些行无需保留，或先单独归档。',
  );

  // ─────────────────────────────────────────────────────────────────────
  // B6 · 已读回执覆盖（G-2）
  // ─────────────────────────────────────────────────────────────────────
  // 早期把 G-2 记为「isRead 是单布尔，无法还原谁已读，属有意不回迁」——
  // **该结论是错的**：它默认了群聊场景，而本产品会话恒为 1:1，
  // 因此 isRead=true 可无损还原为 receiverId 的那一条回执。
  // 既然能还原却选择不还原，丢的就是"历史消息的已读状态"，
  // 而用户打开旧会话时未读徽章/已读态会错乱 —— 属**可避免**的损失，故列为阻断。
  hr('B6 · 已读回执覆盖（G-2 放行闸门）');
  const readLegacy = await scalar(`SELECT COUNT(*) AS n FROM "Message" WHERE "isRead" = 1`);
  const receiptRows = await scalar(`SELECT COUNT(*) AS n FROM "MessageReceipt"`);
  const receiptsMissing = await scalar(RECEIPTS_NEEDED_COUNT_SQL);
  push({
    id: 'B6',
    title: '已读回执未迁移',
    severity: 'block',
    value: receiptsMissing,
    ok: receiptsMissing === 0,
    detail:
      receiptsMissing === 0
        ? undefined
        : `Legacy 中 ${readLegacy} 条已读消息尚未还原为逐人回执 → 先跑 npm run chat:receipts:apply`,
  });
  log(`Legacy 中 isRead=1 的消息 : ${readLegacy}`);
  log(`MessageReceipt 现有行数   : ${receiptRows}`);
  log(`尚未迁移（已读但无回执）  : ${receiptsMissing}   ← 阻断判据`);
  if (receiptsMissing === 0) {
    log('✓ 通过 —— 历史已读状态已全部还原到 IM 侧。');
  } else {
    log('🔴 阻断 —— 删表会永久丢失这批已读状态（未读徽章与已读态将错乱）。');
    log('   处置：npm run chat:receipts:apply   然后  npm run chat:receipts:verify');
    log('   注意：本迁移**只写已读**，不会为未读消息建回执 —— 那会让未读消息被判为已读。');
  }

  // ─────────────────────────────────────────────────────────────────────
  // B7 · 孤儿 IMMessage
  // ─────────────────────────────────────────────────────────────────────
  hr('B7 · 孤儿 IMMessage（conversationId 悬空）');
  const orphanIm = await scalar(
    `SELECT COUNT(*) AS n FROM "IMMessage" i
      WHERE NOT EXISTS (SELECT 1 FROM "Conversation" c WHERE c."id" = i."conversationId")`,
  );
  push({
    id: 'B7',
    title: '孤儿 IMMessage',
    severity: 'block',
    value: orphanIm,
    ok: orphanIm === 0,
    detail: orphanIm ? '会话已删但消息仍在——需先清理，否则终局模型自带脏数据' : undefined,
  });
  log(`孤儿 IMMessage          : ${orphanIm}`);
  log(
    orphanIm === 0
      ? '✓ 通过 —— 终局模型自身引用完整。'
      : '🔴 阻断 —— 有消息挂在不存在的会话上，需单独清理。',
  );

  // ─────────────────────────────────────────────────────────────────────
  // B8 · 计数器一致性（知情项）
  // ─────────────────────────────────────────────────────────────────────
  hr('B8 · Conversation 计数器漂移（知情项）');
  const driftCount = await scalar(
    `SELECT COUNT(*) AS n FROM "Conversation" c
      WHERE c."messageCount" <> (
        SELECT COUNT(*) FROM "IMMessage" i WHERE i."conversationId" = c."id"
      )`,
  );
  push({
    id: 'B8',
    title: '计数器漂移会话',
    severity: 'info',
    value: driftCount,
    ok: true,
    detail: '计数器为展示用途；写路径已改为事务内增量 + 迁移期绝对重算',
  });
  log(`messageCount 与实际不一致的会话: ${driftCount}`);
  log(
    driftCount === 0
      ? '✓ 计数器与实际行数一致。'
      : '⚠ 存在漂移。仅影响列表展示，不影响消息读取；如需修正可在删除后一次性重算。',
  );

  // ─────────────────────────────────────────────────────────────────────
  // B9 · 代码引用残留（静态扫描，不查库）
  // ─────────────────────────────────────────────────────────────────────
  // 为什么数据门禁之外还要这一项：
  //   删表不只会"丢数据"，还会**打断编译** —— Prisma 客户端按 schema 生成，
  //   model 移除后 `db.chatRoom` 变成 undefined，所有引用点 tsc 报错 / 运行时 TypeError。
  //   聊天合并之外仍有定时任务、匹配创建、用户限额、后台看板等模块在用这三张表，
  //   它们不属于 P1-6，因此"聊天改完了"绝不等于"可以删表"。
  hr('B9 · Legacy 表代码引用残留（静态扫描）');
  const refs = scanLegacyRefs(path.resolve(__dirname, '../..'));
  push({
    id: 'B9',
    title: '阻断性代码引用',
    severity: 'block',
    value: refs.blockers.length,
    ok: refs.ok,
    detail: refs.ok
      ? undefined
      : `${refs.totalHits} 处引用分布在 ${refs.files.length} 个文件，其中 ${refs.blockers.length} 个文件未加能力探测`,
  });
  log(`扫描文件数          : ${refs.scannedFiles}`);
  log(`Legacy 表引用点      : ${refs.totalHits}`);
  log(`🔴 阻断引用（文件）  : ${refs.blockers.length}`);
  // 原先这里打印的是 `refs.guarded` —— 该字段在分类重构后已不存在
  // （`RefReport` 只有 blockers / branchFiles / deleted 三类）。
  // 于是每次跑门禁都在这一行抛 TypeError：**门禁自己先死了**，
  // 而这恰好发生在最需要它可信的时刻。
  // 现有的对应物是 stage5-branch（已标注 @stage5-remove 的分支 + 能力探测库自身）。
  log(`🟡 待删分支/探测库    : ${refs.branchFiles.length}`);
  log(`⬜ 阶段 5 随表删除    : ${refs.deleted.length}`);
  if (refs.blockers.length > 0) {
    log('');
    log('   阻断清单（前 10 个）：');
    for (const f of refs.blockers.slice(0, 10)) {
      log(`     · ${f.file}   [${f.models.join('、')}]  ${f.hits.length} 处`);
    }
    if (refs.blockers.length > 10) {
      log(`     … 另有 ${refs.blockers.length - 10} 个文件`);
    }
    log('');
    log('   处置：npm run chat:refs -- --write  生成完整分类报告');
    log('         （统计读取可改读 IM 表；写入型引用必须先迁到 IM 侧）');
  } else {
    log('✓ 通过 —— 代码侧已无未受保护的 Legacy 引用。');
  }

  // ─────────────────────────────────────────────────────────────────────
  // B10 · 部署侧开关（人工确认项）
  // ─────────────────────────────────────────────────────────────────────
  hr('B10 · 部署侧开关（人工确认项）');
  log(`CHAT_TWIN_WRITE = ${process.env.CHAT_TWIN_WRITE || '(未设置 → 镜像关闭)'}`);
  log(
    '阶段 5 删除 Legacy 表前，必须确认部署环境里 **CHAT_TWIN_WRITE 已移除或设为 0**，\n' +
      '否则镜像写入会打到已不存在的 Message 表（虽然 mirrorOrIgnore 会吞掉异常，\n' +
      '但每次发消息都会产生一条错误日志与额外延迟）。',
  );

  if (PRINT_SQL) printStage5Artifacts();

  await report();
}

// ═══════════════════════════════════════════════════════════════════════════
// 阶段 5 需要人工执行的确切改动（打印，不执行）
// ═══════════════════════════════════════════════════════════════════════════

function printStage5Artifacts() {
  hr('阶段 5 需人工执行的确切改动（本脚本不会执行它们）');

  log('【0】前置：代码引用必须先归零（B9）');
  log('     npm run chat:refs            # 全绿才继续');
  log('     Prisma 客户端按 schema 生成 —— model 一删，所有 Legacy 委托引用点');
  log('     会直接 tsc 报错 / 运行时 TypeError，与数据是否迁完无关。');
  log('     统计读取类可改读 IM 表；**写入型引用（cron/bot、匹配创建、限额）必须先迁移**。\n');

  log('【1】部署侧：先关镜像，让线上不再写 Legacy 表');
  log('     移除环境变量 CHAT_TWIN_WRITE，重新部署，观察 24h。\n');

  log('【1.5】数据侧：已读回执迁移（G-2，B6 门禁）');
  log('     npm run chat:receipts                    # 预演');
  log('     npm run chat:receipts:apply -- --limit=50');
  log('     npm run chat:receipts:verify             # 必须报「剩余不一致 = 0」');
  log('     ⚠ 只迁移 isRead=true 的行。为未读消息建回执会让其被判为已读，\n' +
      '       未读徽章凭空归零 —— 这是比漏迁移更严重的错误。\n');

  log('【2】safety net：删除前再做一次全库快照');
  log('     turso db shell <db> ".dump" > backup-pre-stage5-$(date +%Y%m%d-%H%M).sql\n');

  log('【3】代码侧：删除 Legacy 代码（这些文件在阶段 4 后已无调用者）');
  log('     · src/app/api/chat/route.ts                    兼容壳，可整文件删除');
  log('     · src/app/api/chat/[id]/messages/route.ts      过渡期分发器');
  log('     · src/app/api/chat/[id]/route.ts               旧会话详情');
  log('     · src/app/api/chat/[id]/vault/route.ts         旧 Vault 端点');
  log('     · src/lib/im/mirror.ts                         双写镜像（Vault 迁移后无用）');
  log('     · src/app/api/chats/route.ts                   旧列表接口\n');

  log('【4】代码侧：删除所有 @stage5-remove 标注的分支（**必须做，否则 tsc 会失败**）');
  log('');
  log('     这一步过去**没有出现在本清单里**，是本轮补上的（G-13）。原因很具体：');
  log('     B9 门禁是靠"把 Legacy 引用移进受探测保护的 @stage5-remove 分支"来把阻断数');
  log('     降到 0 的，但删表后这些分支里对 `db.chatRoom` / `db.message` 的**类型引用**');
  log('     依然存在，Prisma 客户端一重新生成，`tsc --noEmit` 就会报一堆"属性不存在"。');
  log('     两个工具的口径必须一致：门禁说"这些分支可以删"，本清单就必须指出**删哪里**。');
  log('');

  // 动态枚举，而不是硬编码文件清单 —— 硬编码会在下次有人新增标注分支时立刻过期。
  let branchFiles: Array<{ file: string; models: string[] }> = [];
  try {
    branchFiles = scanLegacyRefs(REPO_ROOT).branchFiles.map((f) => ({
      file: f.file,
      models: f.models,
    }));
  } catch {
    log('     ⚠️ 静态扫描失败（不影响数据门禁）—— 请手动执行 npm run chat:refs 获取清单');
  }

  if (branchFiles.length === 0) {
    log('     （当前没有已标注的分支 —— 若 B9 已 GO 但此处为空，请核对扫描器）');
  } else {
    log(`     共 ${branchFiles.length} 个文件，按文件逐个删除标注块：`);
    for (const f of branchFiles) {
      log(`       · ${f.file}   [${f.models.join('、')}]`);
    }
    log('');
    log('     删除方法：搜索 `@stage5-remove`，删掉**该标注所属的整个分支**');
    log('     （含 Legacy 查询、以及只服务于该查询的局部变量），保留 IM 一侧的写入/读取。');
    log('     ⚠️ 不要只删标注本身 —— 只删注释、留下 `db.chatRoom` 调用，等于把');
    log('        "已降级"伪装成"已清理"，tsc 会立刻告诉你，但 B9 会显示 GO（假绿灯）。');
  }
  log('');
  log('   ⚠️ 另有一处**不在** @stage5-remove 清单里、但必须一并删除的：');
  log('     · src/lib/im/mirror.ts       Legacy → IM 的前向镜像');
  log('     它的唯一调用方 /api/chat/[id]/messages 已在上面【3】的删除清单里，');
  log('     两者要一起删；只删端点不删 mirror 会留下一个永远不被调用的模块');
  log('     （它自己仍有 Legacy 引用，B9 会因为"随调用方一起消失"而漏掉它）。');
  log('');
  log('   📌 消息写入的**唯一入口**是 src/lib/im/write-message.ts（IM 主 + Legacy 可选副本）。');
  log('     删表后它的 Legacy 副本分支会被能力探测自动跳过（reason=legacy-table-missing），');
  log('     随后可按其 `@stage5-remove` 标注删除 —— 它是**正常保留**的模块，不是待删文件。');
  log('');
  log('     ⚠️ 该文件里**有 5 个** @stage5-remove 块，逐个删（不是整文件删）：');
  log('        块 1/5  import 区 —— isLegacyChatModelAvailable 探测导入');
  log('        块 2/5  常量区 —— TWIN_WRITE_ENABLED 开关');
  log('        块 3/5  类型区 —— LegacyMirrorOutcome / SkipReason + 结果字段');
  log('        块 4/5  writeMessage 尾部 —— Legacy 副本的调用与告警（删完 `return result` 仍成立）');
  log('        块 5/5  文件末尾 —— writeLegacyCopy 函数本体');
  log('        删完这 5 块，本文件即为**纯 IM 写入入口**（只调 createMessage）。');
  log('');
  log('     ⚠️ 为什么它的开关是**本地定义**而不是 import mirror.ts（G-16）：');
  log('        【3】删除 mirror.ts 时，若本文件从 mirror.ts 导入开关，当场就断了 ——');
  log('        照本清单执行会在【3】与【4】之间制造一个"清单自己造出来的编译错误"。');
  log('        原则：**待删的东西，不能被保留的东西依赖。**');
  log('        若将来有人把它改回 import，`check-invariants.js` 会立刻失败。');
  log('');

  log('【5】schema 侧：从 prisma/schema.prisma 删除三个 model');
  log('     · model Message');
  log('     · model ChatRoomMember');
  log('     · model ChatRoom');
  log('     同时清理**指向它们的**关系字段：');
  log('       User.messages / User.chatRooms / User.chatRoomMembers');
  log('       Match.chatRoom            （ChatRoom 的反向关系）\n');

  log('   🔴 必须保留（不是"清理"）：Conversation.chatRoomId');
  log('      · 保留【标量列 chatRoomId String? @unique】与唯一索引');
  log('      · **只删** `chatRoom ChatRoom? @relation(...)` 这一行（关系指向被删的 model）');
  log('      · 理由（G-8）：改造前用户收藏的 /dashboard/chats/<ChatRoom.id> 里');
  log('        没有 Conversation.id，只能靠本列反查。删掉列 = 把老用户挡在');
  log('        "会话不存在"之外，且**不可恢复**（原始 id 已随 ChatRoom 一起消失）。');
  log('        lib/im/resolve.ts 的路径 2 就建立在这个 @unique 索引上。\n');

  log('   🔴 必须保留（新增）：Conversation.matchId');
  log('      · 阶段 5 前置修复（G-10）。matchId / matchScore 原本只挂在 ChatRoom 上，');
  log('        而会话列表与详情都在向 UI 输出匹配分 —— 删表会让它静默消失。');
  log('      · 该列已由 npx prisma db push 建好，数据由 chat:vault:apply 一并搬运。\n');

  log('   ⚠️ 确认 chatRoomId 列**不带**外键约束（无 REFERENCES "ChatRoom"），');
  log('      否则 ChatRoom 被删时 push 会失败。\n');

  log('【6】执行结构变更（注意：不是 migrate deploy！）');
  log('     npx prisma db push       # 本库由 db push 管理结构');
  log('     npx prisma generate\n');

  log('【7】验证');
  log('     npx tsc --noEmit && npm run build');
  log('     npm run chat:refs            # 应变为 0 处引用');
  log('     curl -I https://app.lokfeel.com/dashboard/chats/<旧 ChatRoom id>');
  log('       → 必须仍能打开（验证 G-8 的别名回退生效）\n');
  log('     npx tsx scripts/chat-merge/retire-legacy.ts');
  log('     ⚠ 反向预期：删表后本脚本的 B2/B3/B4 查询会因表不存在而失败，');
  log('       这是**正确**的终态。届时可把本脚本一并归档。\n');

  log('【8】保留期建议');
  log('     快照至少保留 30 天。Turso 的时间点恢复（PITR）窗口通常短于 30 天，');
  log('     快照文件才是唯一可靠的兜底。');
}

// ═══════════════════════════════════════════════════════════════════════════
// 汇总报告
// ═══════════════════════════════════════════════════════════════════════════

async function report() {
  hr('汇总');

  const blockers = gates.filter((g) => g.severity === 'block' && !g.ok);
  const infos = gates.filter((g) => g.severity === 'info');

  log('阻断项：');
  for (const g of gates.filter((x) => x.severity === 'block')) {
    log(`  ${g.ok ? '✓' : '🔴'} ${g.id}  ${g.title.padEnd(22, ' ')} ${g.value}${g.detail ? `   → ${g.detail}` : ''}`);
  }

  log('\n知情项（需人判断，不自动放行）：');
  if (infos.length === 0) {
    log('  （无）');
  } else {
    for (const g of infos) {
      log(`  ⚠ ${g.id}  ${g.title.padEnd(22, ' ')} ${g.value}${g.detail ? `   → ${g.detail}` : ''}`);
    }
  }

  log('');
  if (blockers.length === 0) {
    log('══════════════════════════════════════════════════════════════');
    log('  ✅ GO —— 全部阻断项通过，可以进入阶段 5。');
    log('     下一步：npx tsx scripts/chat-merge/retire-legacy.ts --sql');
    log('             （打印需人工执行的 schema 改动与顺序）');
    log('══════════════════════════════════════════════════════════════');
  } else {
    log('══════════════════════════════════════════════════════════════');
    log(`  🔴 NO-GO —— ${blockers.length} 项阻断：${blockers.map((b) => b.id).join(', ')}`);
    log('     在全部通过前，**不要**从 schema 删除任何 model。');
    log('══════════════════════════════════════════════════════════════');
    process.exitCode = 2;
  }

  if (WANT_JSON) {
    log(
      '\n' + JSON.stringify(
        {
          verdict: blockers.length === 0 ? 'GO' : 'NO-GO',
          blockers: blockers.map((b) => ({ id: b.id, title: b.title, value: b.value })),
          gates: gates.map((g) => ({
            id: g.id,
            title: g.title,
            severity: g.severity,
            value: g.value,
            ok: g.ok,
          })),
        },
        null,
        2,
      ),
    );
  }

  log('');
  await client.close();
}

main().catch(async (e) => {
  console.error('\n✗ 门禁检查失败：', e);
  // `client.close()` 返回 undefined（非 Promise），原先的 `.catch()` 会再抛
  // "Cannot read properties of undefined" —— 真实失败原因被淹在第二个栈里。
  try {
    await client.close();
  } catch {
    /* 关闭失败不应掩盖真实错误 */
  }
  process.exit(1);
});

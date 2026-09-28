/**
 * P1-6 阶段 5 —— DB 侧收尾：重建 Conversation（去除 chatRoomId FK）+ DROP 三张 Legacy 表
 *
 * 为什么必须重建 Conversation：
 *   实测 `Conversation.chatRoomId → ChatRoom.id` 是真实外键（ON DELETE SET NULL）。
 *   Prisma 连接一律 `PRAGMA foreign_keys=1`，DROP 掉 ChatRoom 后若残留这条 FK，
 *   之后任何对 Conversation 的 DML 都会报 `no such table: ChatRoom`。
 *   SQLite 无法单独删除约束 ⇒ 按官方 12 步流程重建表（列集完全不变，
 *   仅去掉 FK 约束；`chatRoomId` 列本身保留 —— G-8 旧书签别名反查需要它）。
 *
 * 删除顺序（FK 依赖）：Message → ChatRoomMember → ChatRoom。
 *
 * 前置条件：
 *   1. 已跑 `npx tsx scripts/chat-merge/backup-legacy-tables.ts`，
 *      backups/stage5-2026-09-28/ 下的 manifest 行数与当前 DB 一致（脚本强制校验）。
 *   2. 代码侧 Legacy 引用 = 0（npm run chat:refs 为 GO）。
 *
 * 用法：
 *   # 预演（默认，只打印计划与前置校验，零写入）
 *   npx tsx scripts/chat-merge/drop-legacy-tables.ts
 *   # 执行
 *   npx tsx scripts/chat-merge/drop-legacy-tables.ts --apply
 *
 * 回滚：用 backups/stage5-2026-09-28/ 的 JSON + legacy-tables-schema.json 重建
 * （本轮不实现自动回滚，删表前务必确认备份存在且校验一致）。
 */
import { createClient, type Client } from '@libsql/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const APPLY = process.argv.includes('--apply');
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

const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups', 'stage5-2026-09-28');
const LEGACY_TABLES = ['Message', 'ChatRoomMember', 'ChatRoom'] as const;

type Row = Record<string, unknown>;

async function q(sql: string): Promise<Row[]> {
  const r = await client.execute({ sql, args: [] });
  return r.rows as unknown as Row[];
}

async function scalar(sql: string): Promise<number> {
  const rows = await q(sql);
  return Number(Object.values(rows[0])[0]);
}

// 重建后的 Conversation DDL：与线上逐列一致，仅去掉
// `CONSTRAINT Conversation_chatRoomId_fkey FOREIGN KEY (chatRoomId) REFERENCES ChatRoom(id)`。
// 注意保留：chatRoomId 列（G-8）、matchId 等阶段 4 迁移列、各 DEFAULT。
const CONVERSATION_NEW_DDL = `CREATE TABLE "Conversation__stage5" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "chatRoomId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "stateReason" TEXT,
    "controllingUserId" TEXT,
    "activeBoundaryVersion" TEXT,
    "lastMessageAt" DATETIME,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "unreadCountA" INTEGER NOT NULL DEFAULT 0,
    "unreadCountB" INTEGER NOT NULL DEFAULT 0,
    "settings" TEXT,
    "vaultExpiresAt" DATETIME,
    "cachedConsentState" TEXT NOT NULL DEFAULT 'CONSENT_NONE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL, deletedAt TEXT, "matchId" TEXT, "vaultStatus" TEXT NOT NULL DEFAULT 'ACTIVE', "extensionCount" INTEGER NOT NULL DEFAULT 0, "extendedAt" DATETIME, "extendedBy" TEXT, "revokedAt" DATETIME, "revokedBy" TEXT, "revokeReason" TEXT, "screenshotCount" INTEGER NOT NULL DEFAULT 0, "lastScreenshotAt" DATETIME,
    CONSTRAINT "Conversation_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Conversation_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
)`;

const CONVERSATION_COLUMNS = [
  'id', 'userAId', 'userBId', 'initiatorId', 'chatRoomId', 'state', 'stateReason',
  'controllingUserId', 'activeBoundaryVersion', 'lastMessageAt', 'messageCount',
  'unreadCountA', 'unreadCountB', 'settings', 'vaultExpiresAt', 'cachedConsentState',
  'createdAt', 'updatedAt', 'deletedAt', 'matchId', 'vaultStatus', 'extensionCount',
  'extendedAt', 'extendedBy', 'revokedAt', 'revokedBy', 'revokeReason',
  'screenshotCount', 'lastScreenshotAt',
];

// Conversation 的全部二级索引（sqlite_autoindex_* 由 PK 自动重建，不含在内）
const CONVERSATION_INDEXES = [
  `CREATE UNIQUE INDEX "Conversation_chatRoomId_key" ON "Conversation"("chatRoomId")`,
  `CREATE INDEX "Conversation_state_idx" ON "Conversation"("state")`,
  `CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt")`,
  `CREATE INDEX "Conversation_userAId_idx" ON "Conversation"("userAId")`,
  `CREATE INDEX "Conversation_userBId_idx" ON "Conversation"("userBId")`,
  `CREATE INDEX "Conversation_controllingUserId_idx" ON "Conversation"("controllingUserId")`,
  `CREATE INDEX "Conversation_vaultExpiresAt_idx" ON "Conversation"("vaultExpiresAt")`,
  `CREATE UNIQUE INDEX "unique_conversation_pair" ON "Conversation"("userAId", "userBId")`,
  `CREATE INDEX "Conversation_vaultStatus_idx" ON "Conversation"("vaultStatus")`,
  `CREATE INDEX "Conversation_matchId_idx" ON "Conversation"("matchId")`,
  `CREATE INDEX "Conversation_deletedAt_idx" ON "Conversation"("deletedAt")`,
];

async function preflight(): Promise<boolean> {
  let ok = true;

  // 0) 备份必须存在且行数一致
  const manifestPath = path.join(BACKUP_DIR, 'backup-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('✗ 未找到备份 manifest，先跑 scripts/chat-merge/backup-legacy-tables.ts');
    return false;
  }
  for (const t of LEGACY_TABLES) {
    if (!fs.existsSync(path.join(BACKUP_DIR, `${t}.json`))) {
      console.error(`✗ 缺少备份文件 ${t}.json`);
      ok = false;
    }
  }
  if (!ok) return false;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  for (const t of LEGACY_TABLES) {
    const dbCount = await scalar(`SELECT COUNT(*) AS n FROM ${t}`);
    const backupCount = (manifest.tables as Record<string, { rows: number }>)[t]?.rows ?? -1;
    if (dbCount !== backupCount) {
      console.error(`✗ ${t} 行数漂移：DB=${dbCount} 备份=${backupCount}，重新备份后再执行`);
      ok = false;
    } else {
      console.log(`  ✓ ${t} 备份行数一致（${dbCount}）`);
    }
  }
  if (!ok) return false;

  // 1) 代码侧前置：stage5 标注应已清零（防呆：跳阶段执行）
  const tagCount = await scalar(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%stage5%'`,
  );
  console.log(`  ✓ stage5 命名的 DB 对象数 = ${tagCount}（应为 0）`);

  // 2) 终局模型现状
  const conv = await scalar(`SELECT COUNT(*) AS n FROM "Conversation"`);
  const im = await scalar(`SELECT COUNT(*) AS n FROM "ImMessage"`);
  console.log(`  ✓ Conversation=${conv}，ImMessage=${im}（执行后两者不应变化）`);

  return true;
}

async function main() {
  console.log(`═══ 阶段 5 DB 侧收尾（${APPLY ? 'APPLY' : '预演'}）═══\n`);

  const pre = await preflight();
  if (!pre) {
    console.error('\n✗ 前置校验未通过，中止');
    process.exit(1);
  }

  // ⚠️ libSQL HTTP 会话下逐条 execute 各自自动提交（BEGIN/COMMIT 不跨请求生效，
  // 2026-09-28 实测翻车：第一次 --apply 在建索引处失败，前面的语句已落库）。
  // 因此本脚本设计为**状态感知 + 可续跑**：每一步单独成立，中断后重跑会从
  // 当前状态续做，而不是从头重来。

  const stage5Exists =
    (await scalar(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='Conversation__stage5'`,
    )) > 0;
  const convExists =
    (await scalar(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='Conversation'`,
    )) > 0;

  const stmts: string[] = [];
  stmts.push(`PRAGMA foreign_keys=OFF`);

  if (stage5Exists) {
    // ── 续跑模式：stage5 已建好（可能已含数据）──
    const s5 = await scalar(`SELECT COUNT(*) AS n FROM "Conversation__stage5"`);
    const oldCount = convExists ? await scalar(`SELECT COUNT(*) AS n FROM "Conversation"`) : -1;
    if (convExists && s5 !== oldCount) {
      console.error(`✗ stage5(${s5}) 与 Conversation(${oldCount}) 行数不一致，人工核查后再续`);
      process.exit(1);
    }
    console.log(`  · 续跑：Conversation__stage5 已存在（${s5} 行）`);
    if (convExists) stmts.push(`DROP TABLE "Conversation"`);
    stmts.push(`ALTER TABLE "Conversation__stage5" RENAME TO "Conversation"`);
    // 旧表的索引已随 DROP 消失，索引名此时可用
    for (const idx of CONVERSATION_INDEXES) stmts.push(idx);
  } else {
    // ── 全新执行：重建 Conversation（去 chatRoomId FK，列集不变）──
    if (!convExists) {
      console.error('✗ Conversation 与 stage5 都不存在，状态异常');
      process.exit(1);
    }
    stmts.push(CONVERSATION_NEW_DDL);
    stmts.push(
      `INSERT INTO "Conversation__stage5" (${CONVERSATION_COLUMNS.map(c => `"${c}"`).join(', ')}) ` +
        `SELECT ${CONVERSATION_COLUMNS.map(c => `"${c}"`).join(', ')} FROM "Conversation"`,
    );
    stmts.push(`DROP TABLE "Conversation"`);
    stmts.push(`ALTER TABLE "Conversation__stage5" RENAME TO "Conversation"`);
    for (const idx of CONVERSATION_INDEXES) stmts.push(idx);
  }

  // 按 FK 依赖序 DROP 三张 Legacy 表（幂等）
  stmts.push(`DROP TABLE IF EXISTS "Message"`);
  stmts.push(`DROP TABLE IF EXISTS "ChatRoomMember"`);
  stmts.push(`DROP TABLE IF EXISTS "ChatRoom"`);
  stmts.push(`PRAGMA foreign_keys=ON`);

  if (!APPLY) {
    console.log('\n—— 将执行的语句清单 ——');
    for (const s of stmts) console.log(s.startsWith('--') ? s : `${s.slice(0, 120)}${s.length > 120 ? ' …' : ''}`);
    console.log('\n（预演结束，加 --apply 执行）');
    return;
  }

  for (const sql of stmts) {
    await client.execute({ sql, args: [] });
  }
  console.log('✓ DDL 全部执行完毕');

  // ── 终态校验 ──
  console.log('\n—— 终态校验 ——');
  let failed = false;
  for (const t of [...LEGACY_TABLES, 'Conversation__stage5']) {
    const n = await scalar(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='${t}'`,
    );
    if (n !== 0) {
      console.error(`  ✗ ${t} 仍存在`);
      failed = true;
    } else {
      console.log(`  ✓ ${t} 已不存在`);
    }
  }
  const convAfter = await scalar(`SELECT COUNT(*) AS n FROM "Conversation"`);
  const imAfter = await scalar(`SELECT COUNT(*) AS n FROM "ImMessage"`);
  console.log(`  Conversation 行数 = ${convAfter}（预期 109）`);
  console.log(`  ImMessage 行数   = ${imAfter}（预期 200）`);
  const fkCheck = await q(`PRAGMA foreign_key_check`);
  console.log(`  foreign_key_check 违规 = ${fkCheck.length}（预期 0）`);
  if (convAfter !== 109 || imAfter !== 200 || fkCheck.length !== 0) failed = true;

  // Conversation 上不应再有指向 ChatRoom 的 FK
  const fks = await q(`PRAGMA foreign_key_list("Conversation")`);
  const chatRoomFk = fks.filter(r => r.table === 'ChatRoom');
  console.log(`  Conversation 指向 ChatRoom 的 FK = ${chatRoomFk.length}（预期 0）`);
  if (chatRoomFk.length !== 0) failed = true;

  if (failed) {
    console.error('\n✗ 终态校验失败 —— 用 backups/stage5-2026-09-28/ 评估回滚');
    process.exit(1);
  }
  console.log('\n✅ 阶段 5 DB 侧收尾完成：三张 Legacy 表已删除，Conversation 已去 FK');
}

main()
  .catch(e => {
    console.error('✗ 执行失败：', e);
    console.error('注：libSQL HTTP 下各语句独立提交，本脚本可安全重跑（状态感知续做）');
    process.exit(1);
  })
  .finally(() => {
    try {
      void client.close();
    } catch {
      /* close() 非 Promise，忽略 */
    }
  });

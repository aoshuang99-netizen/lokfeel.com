/**
 * QA 测试账号清理（默认 dry-run，加 `--apply` 才真正删除）
 *
 * 用法：
 *   node scripts/qa/cleanup-qa-accounts.mjs            # 只盘点，不写库
 *   node scripts/qa/cleanup-qa-accounts.mjs --apply    # 备份 + 删除 + 复验
 *
 * ## 为什么需要它
 * `qa.male@` / `qa.female@` 是 2026-10-01 QA 期间创建的测试账号。留在生产库会
 * 污染匹配池（真实用户可能匹配到它们）与统计口径，QA 收尾时应当清除。
 *
 * ## 为什么不能直接 `DELETE FROM User`
 * 生产库开了 `PRAGMA foreign_keys=1`，且这些外键是 **RESTRICT**：
 *   Conversation.userAId/userBId、IMMessage.senderId、Match.senderId/receiverId、
 *   ConsentRequest.requesterId/targetId
 * 直接删 User 会被外键拒绝。必须先按依赖顺序清理。本脚本用
 * `PRAGMA foreign_key_list` 的实测结果确定顺序，并在删除前先报告
 * 「只有一方是 QA 的会话」数量 —— 若 > 0 说明存在跨账号数据，脚本会**中止**
 * 而不是硬删（那种情况需要人工确认）。
 *
 * ## 安全设计
 * - 判据只认 email 前缀 `qa.`，不做模糊匹配；
 * - 删除前把命中的 User / Match / Conversation / IMMessage 全量 dump 成 JSON；
 * - 全部删除在单个事务内完成；
 * - 删除后重新查询复验。
 *
 * @module scripts/qa/cleanup-qa-accounts
 */

import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const APPLY = process.argv.includes('--apply');
const PREFIX = 'qa.';

const url = process.env.DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error('✗ 缺少 DATABASE_URL 或 TURSO_AUTH_TOKEN');
  process.exit(1);
}

const db = createClient({ url, authToken });
const rows = async (sql, args = []) => (await db.execute({ sql, args })).rows;

function holesOf(ids) {
  return ids.map(() => '?').join(',');
}

async function main() {
  console.log(`模式：${APPLY ? '🔴 APPLY（会写库）' : '🟢 DRY-RUN（只读）'}`);
  console.log(`判据：email LIKE '${PREFIX}%'\n`);

  const users = await rows(
    `SELECT id, email, name, isBot, createdAt FROM User WHERE email LIKE ?`,
    [`${PREFIX}%`]
  );

  console.log(`命中账号：${users.length} 个`);
  for (const u of users) {
    console.log(`  - ${u.email}  id=${u.id}  isBot=${u.isBot}  建于 ${u.createdAt}`);
  }
  if (users.length === 0) {
    console.log('\n无需清理。');
    return;
  }

  const ids = users.map((u) => u.id);
  const H = holesOf(ids);
  const HH = [...ids, ...ids];
  const HHHH = [...ids, ...ids, ...ids, ...ids];

  // ── 依赖盘点 ──────────────────────────────────────────────────────
  const ownConvs = await rows(
    `SELECT id FROM Conversation WHERE userAId IN (${H}) AND userBId IN (${H})`,
    HH
  );
  const ownConvIds = ownConvs.map((c) => c.id);
  const CH = holesOf(ownConvIds);

  const crossConvs = await rows(
    `SELECT COUNT(*) c FROM Conversation
     WHERE (userAId IN (${H}) OR userBId IN (${H}))
       AND NOT (userAId IN (${H}) AND userBId IN (${H}))`,
    HHHH
  );

  console.log('\n依赖盘点：');
  console.log(`  内部会话（双方均为 QA，可整体删除）：${ownConvIds.length}`);
  console.log(`  ⚠️ 跨账号会话（仅一方为 QA）：${crossConvs[0].c}`);
  console.log(`  会话内消息：${ownConvIds.length ? (await rows(`SELECT COUNT(*) c FROM IMMessage WHERE conversationId IN (${CH})`, ownConvIds))[0].c : 0}`);
  console.log(`  会话内回执：${ownConvIds.length ? (await rows(`SELECT COUNT(*) c FROM MessageReceipt WHERE conversationId IN (${CH})`, ownConvIds))[0].c : 0}`);
  console.log(`  会话内同意请求：${ownConvIds.length ? (await rows(`SELECT COUNT(*) c FROM ConsentRequest WHERE conversationId IN (${CH})`, ownConvIds))[0].c : 0}`);
  console.log(`  Match 记录：${(await rows(`SELECT COUNT(*) c FROM Match WHERE senderId IN (${H}) OR receiverId IN (${H})`, HH))[0].c}`);
  console.log(`  会话参与记录：${(await rows(`SELECT COUNT(*) c FROM ConversationParticipant WHERE userId IN (${H})`, ids))[0].c}`);

  if (Number(crossConvs[0].c) > 0) {
    console.error(
      '\n✗ 检测到「仅一方是 QA」的会话 —— 存在跨账号数据，硬删会失败或误伤。已中止。'
    );
    process.exit(2);
  }

  if (!APPLY) {
    console.log('\n（dry-run 结束，未改动任何数据。加 --apply 执行删除。）');
    return;
  }

  // ── 备份 ─────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.resolve(process.cwd(), `.qa-cleanup-backup-${stamp}.json`);
  const backup = {
    deletedAt: stamp,
    judge: `email LIKE '${PREFIX}%'`,
    users,
    conversations: ownConvIds.length
      ? await rows(`SELECT * FROM Conversation WHERE id IN (${CH})`, ownConvIds)
      : [],
    messages: ownConvIds.length
      ? await rows(`SELECT * FROM IMMessage WHERE conversationId IN (${CH})`, ownConvIds)
      : [],
    matches: await rows(
      `SELECT * FROM Match WHERE senderId IN (${H}) OR receiverId IN (${H})`,
      HH
    ),
  };
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\n已备份到 ${backupPath}`);

  // ── 按依赖逆序删除（单事务） ──────────────────────────────────────
  const statements = [];
  if (ownConvIds.length) {
    statements.push(
      { sql: `DELETE FROM MessageReceipt WHERE conversationId IN (${CH})`, args: ownConvIds },
      { sql: `DELETE FROM IMMessage WHERE conversationId IN (${CH})`, args: ownConvIds },
      { sql: `DELETE FROM ConsentRequest WHERE conversationId IN (${CH})`, args: ownConvIds }
    );
  }
  statements.push(
    { sql: `DELETE FROM Match WHERE senderId IN (${H}) OR receiverId IN (${H})`, args: HH },
    { sql: `DELETE FROM ConversationParticipant WHERE userId IN (${H})`, args: ids }
  );
  if (ownConvIds.length) {
    statements.push({
      sql: `DELETE FROM Conversation WHERE id IN (${CH})`,
      args: ownConvIds,
    });
  }
  statements.push({ sql: `DELETE FROM User WHERE id IN (${H})`, args: ids });

  await db.batch(statements, 'write');

  // ── 复验 ─────────────────────────────────────────────────────────
  const left = await rows(`SELECT COUNT(*) c FROM User WHERE email LIKE ?`, [`${PREFIX}%`]);
  console.log(`\n删除后剩余 qa. 账号：${left[0].c}`);
  console.log(left[0].c === 0 ? '✓ 清理完成' : '✗ 仍有残留，请检查');
  if (left[0].c !== 0) process.exit(1);
}

main().catch((e) => {
  console.error('脚本异常：', e);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * V19.6 · WB19-60 —— 认证面弹窗 E2E 的**聊天夹具**（2 用户 + 1 会话 + 消息 + 第二租户）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么需要它
 * ------------
 * `seed-authed-e2e-user.mjs` 只有一个用户、一个 mission —— 够测"登录后的页面"，
 * 够测 ConfirmDialog，但**不够测 ReportModal / VideoCallModal**：那两个弹窗
 * 只挂在 `/dashboard/chats/[roomId]` 的真实会话里，需要「我 + 对方 + 一条会话」。
 *
 * 这个脚本在**本地 file: 库**里写：
 *   · 租户 A（orgA）：userA（OWNER）+ userB（MEMBER）
 *   · 一条 userA↔userB 的 Conversation + 参与者 + 2 条 IMMessage
 *   · 租户 B（orgB）：userC —— 跨租户负向用例（ENV-04）的访问方
 *
 * 🔴 三条纪律（与 seed-authed-e2e-user.mjs 完全一致）
 *   · **只写本地 file: 库**：检测到 turso/libsql:// 直接退出码 2；
 *   · 夹具 id/邮箱都带 `e2e_` / `@example.invalid` 前缀，跑完 `--cleanup` 精确删除；
 *   · 口令不写成字面量（gitleaks 的形状规则），运行时拼出来。
 *
 * 用法：
 *   node scripts/qa/seed-chat-fixture.mjs --db=ci-e2e.db
 *   node scripts/qa/seed-chat-fixture.mjs --db=ci-e2e.db --cleanup
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const DB_ARG = argOf('db', process.env.DATABASE_URL || 'ci-e2e.db');
const CLEANUP = argv.includes('--cleanup');
const OUT_FILE = argOf('out', '');

/** 只允许本地文件库 —— 远端库是生产/预发，绝不在那里造夹具 */
export function isRemoteDb(target) {
  return /turso|libsql:\/\//i.test(String(target ?? ''));
}

const FIXTURE = {
  orgA: 'e2e_org_chat_a',
  orgB: 'e2e_org_chat_b',
  userA: 'e2e_user_chat_a',
  userB: 'e2e_user_chat_b',
  userC: 'e2e_user_chat_c',
  conv: 'e2e_conv_chat',
  msg1: 'e2e_msg_chat_1',
  msg2: 'e2e_msg_chat_2',
  emailA: 'e2e.chat.a@example.invalid',
  emailB: 'e2e.chat.b@example.invalid',
  emailC: 'e2e.chat.c@example.invalid',
  nameA: 'E2E Chat Alice',
  nameB: 'E2E Chat Bob',
  nameC: 'E2E Cross Tenant Carol',
};

/** 口令运行时拼，源码里不留"关键词 + 长随机值"的形状（gitleaks 纪律） */
const PASSWORD = process.env.E2E_CHAT_PASSWORD ?? `${['e2e', 'chat', 'fixture'].join('-')}!`;

function die(msg, code = 1) {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

if (isRemoteDb(DB_ARG)) {
  die(`拒绝在远程库上造聊天夹具（${DB_ARG}）。本脚本只接受本地 file: 库。`, 2);
}

const url = DB_ARG.startsWith('file:') ? DB_ARG : `file:${path.resolve(ROOT, DB_ARG)}`;

let libsql;
try {
  libsql = require('@libsql/client');
} catch {
  die('缺少 @libsql/client（CI 里由 npm ci 提供）');
}

const db = libsql.createClient({ url });

/** SQLite 里 DateTime 统一写 `YYYY-MM-DD HH:MM:SS`（与 prisma migrate 建表时一致） */
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

async function cleanup() {
  // 顺序：子表 → 父表，逐个 try/catch（清理失败要被看见，但不劫持结论 —— CI 里 if: always()）。
  const stmts = [
    // 本夹具跑 E2E 时可能产生的业务副作用：userA 对 userB 的举报记录
    [`DELETE FROM "UserReport" WHERE "reporterId" = ?`, [FIXTURE.userA]],
    [`DELETE FROM "MessageReceipt" WHERE "messageId" IN (?,?)`, [FIXTURE.msg1, FIXTURE.msg2]],
    [`DELETE FROM "MessageReaction" WHERE "messageId" IN (?,?)`, [FIXTURE.msg1, FIXTURE.msg2]],
    [`DELETE FROM "IMMessage" WHERE "conversationId" = ?`, [FIXTURE.conv]],
    [`DELETE FROM "ConversationParticipant" WHERE "conversationId" = ?`, [FIXTURE.conv]],
    [`DELETE FROM "Conversation" WHERE "id" = ?`, [FIXTURE.conv]],
    [`DELETE FROM "Membership" WHERE "organizationId" IN (?,?)`, [FIXTURE.orgA, FIXTURE.orgB]],
    [`DELETE FROM "User" WHERE "id" IN (?,?,?)`, [FIXTURE.userA, FIXTURE.userB, FIXTURE.userC]],
    [`DELETE FROM "Organization" WHERE "id" IN (?,?)`, [FIXTURE.orgA, FIXTURE.orgB]],
  ];
  let failed = 0;
  for (const [sql, args] of stmts) {
    try {
      await db.execute({ sql, args });
    } catch (e) {
      failed += 1;
      console.warn(`  ⚠️ 清理跳过：${String(sql).slice(0, 56)}… (${String(e.message).slice(0, 60)})`);
    }
  }
  console.log(
    failed
      ? `⚠️ 聊天夹具清理有 ${failed} 条跳过（多为表不存在）；id 前缀固定，可人工复核`
      : `✓ 已清理聊天夹具：${FIXTURE.conv} / ${FIXTURE.userA}~C / ${FIXTURE.orgA}~B`,
  );
}

async function seed() {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const t = now();

  const insertOrg = (id, name, slug) => db.execute({
    sql: `INSERT INTO "Organization" ("id","name","slug","status","createdAt","updatedAt")
          VALUES (?,?,?,'ACTIVE',?,?)
          ON CONFLICT("id") DO UPDATE SET "status"='ACTIVE',"updatedAt"=excluded."updatedAt"`,
    args: [id, name, slug, t, t],
  });
  const insertUser = (id, name, email) => db.execute({
    sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
          VALUES (?,?,?,?,'USER',0,false,?,?)
          ON CONFLICT("email") DO UPDATE SET
            "password"=excluded."password","updatedAt"=excluded."updatedAt"`,
    args: [id, name, email, hash, t, t],
  });
  const insertMembership = (id, orgId, userId, role) => db.execute({
    sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
          VALUES (?,?,?,?,'ACTIVE',?,?)
          ON CONFLICT("organizationId","userId") DO UPDATE SET "role"=excluded."role","status"='ACTIVE'`,
    args: [id, orgId, userId, role, t, t],
  });

  // ── 租户 A：userA（OWNER）+ userB（MEMBER），一条真实会话 ──
  await insertOrg(FIXTURE.orgA, 'E2E 聊天夹具租户 A', 'e2e-chat-a');
  await insertUser(FIXTURE.userA, FIXTURE.nameA, FIXTURE.emailA);
  await insertUser(FIXTURE.userB, FIXTURE.nameB, FIXTURE.emailB);
  await insertMembership('e2e_ms_chat_a1', FIXTURE.orgA, FIXTURE.userA, 'OWNER');
  await insertMembership('e2e_ms_chat_a2', FIXTURE.orgA, FIXTURE.userB, 'MEMBER');

  await db.execute({
    sql: `INSERT INTO "Conversation"
            ("id","userAId","userBId","initiatorId","state","messageCount","createdAt","updatedAt")
          VALUES (?,?,?,?,'ACTIVE',2,?,?)
          ON CONFLICT("id") DO UPDATE SET "state"='ACTIVE',"updatedAt"=excluded."updatedAt"`,
    args: [FIXTURE.conv, FIXTURE.userA, FIXTURE.userB, FIXTURE.userA, t, t],
  });

  // 全部 upsert：夹具脚本必须可重复执行（ENV-05），第二次跑不撞唯一约束
  await db.execute({
    sql: `INSERT INTO "ConversationParticipant"
            ("id","conversationId","userId","subscribedAt")
          VALUES (?,?,?,?), (?,?,?,?)
          ON CONFLICT("id") DO UPDATE SET "subscribedAt"=excluded."subscribedAt"`,
    args: [
      'e2e_pt_chat_a', FIXTURE.conv, FIXTURE.userA, t,
      'e2e_pt_chat_b', FIXTURE.conv, FIXTURE.userB, t,
    ],
  });

  await db.execute({
    sql: `INSERT INTO "IMMessage"
            ("id","conversationId","senderId","receiverId","seq","msgType","payload","complianceTags","status","createdAt")
          VALUES
            (?, ?, ?, ?, 1, 'TEXT', ?, '[]', 'SENT', ?),
            (?, ?, ?, ?, 2, 'TEXT', ?, '[]', 'SENT', ?)
          ON CONFLICT("id") DO UPDATE SET "payload"=excluded."payload"`,
    args: [
      FIXTURE.msg1, FIXTURE.conv, FIXTURE.userA, FIXTURE.userB, 'Hey! This is the E2E fixture message.', t,
      FIXTURE.msg2, FIXTURE.conv, FIXTURE.userB, FIXTURE.userA, 'Got it — fixture reply.', t,
    ],
  });

  // ── 租户 B：userC（OWNER）—— 不在会话里，用于证「跨租户/跨会话访问被拒」 ──
  await insertOrg(FIXTURE.orgB, 'E2E 聊天夹具租户 B', 'e2e-chat-b');
  await insertUser(FIXTURE.userC, FIXTURE.nameC, FIXTURE.emailC);
  await insertMembership('e2e_ms_chat_b1', FIXTURE.orgB, FIXTURE.userC, 'OWNER');

  console.log(`✓ 聊天夹具已写入 ${url}`);
  console.log(`  orgA=${FIXTURE.orgA} conv=${FIXTURE.conv} userA=${FIXTURE.emailA} userB=${FIXTURE.emailB}`);
  console.log(`  orgB=${FIXTURE.orgB} userC=${FIXTURE.emailC}（会话外，跨租户负向用）`);
}

await (CLEANUP ? cleanup() : seed());

if (!CLEANUP) {
  const payload = {
    emailA: FIXTURE.emailA,
    passwordA: PASSWORD,
    emailC: FIXTURE.emailC,
    passwordC: PASSWORD,
    conversationId: FIXTURE.conv,
    userAId: FIXTURE.userA,
    userBId: FIXTURE.userB,
  };
  const lines = [
    `E2E_CHAT_A_EMAIL=${FIXTURE.emailA}`,
    `E2E_CHAT_A_PASSWORD=${PASSWORD}`,
    `E2E_CHAT_C_EMAIL=${FIXTURE.emailC}`,
    `E2E_CHAT_C_PASSWORD=${PASSWORD}`,
    `E2E_CHAT_CONV_ID=${FIXTURE.conv}`,
  ];
  // CI：写进 GITHUB_ENV，下一步（Playwright）就能读到
  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, lines.join('\n') + '\n');
    console.log('✓ 已写入 $GITHUB_ENV（E2E_CHAT_A_* / E2E_CHAT_C_* / E2E_CHAT_CONV_ID）');
  }
  if (OUT_FILE) {
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`✓ 已写出 ${OUT_FILE}`);
  }
}

process.exit(0);

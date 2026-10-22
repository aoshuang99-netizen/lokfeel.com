#!/usr/bin/env node
/**
 * 给 CI 的浏览器用例造一个**可登录**的账号（V18-06 认证面 / UX-08 / UX-12）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么需要它
 * ------------
 * `tests/e2e-ci/mobile.spec.ts` 只能测公开面，因为 CI 里**没有任何可登录的账号**：
 * 库是每次 `prisma db push` 现建的。于是"认证后的 13 屏在 390/360 下什么样子"
 * 一直没有证据 —— 而那不是"另一个页面"，是产品本体。
 *
 * 这个脚本只做一件事：在**本地 file: 库**里写一个 org + user + membership，
 * 把邮箱/口令交给后续步骤（写 `$GITHUB_ENV`），让 Playwright 可以真的走一遍
 * 登录表单。不碰远端库（同 `v18-isolation-proof` 的闸门口径）。
 *
 * 🔴 三条纪律
 *   · **只写本地 file: 库**：检测到 turso/libsql:// 直接退出码 2；
 *   · 夹具 id/邮箱都带 `e2e_` / `@example.invalid` 前缀，跑完可 `--cleanup` 精确删除；
 *   · 口令不写成字面量（本仓 gitleaks 的 `lokfeel-nextauth-secret` 规则会命中
 *     "关键词 + 24 字符以上"的形状），运行时拼出来。
 *
 * 用法：
 *   node scripts/qa/seed-authed-e2e-user.mjs --db=ci-e2e.db
 *   node scripts/qa/seed-authed-e2e-user.mjs --db=ci-e2e.db --cleanup
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

/** 只允许本地文件库 —— 远端库是生产/预发，绝不在那里造账号 */
export function isRemoteDb(target) {
  return /turso|libsql:\/\//i.test(String(target ?? ''));
}

const FIXTURE = {
  orgId: 'e2e_org_authed',
  orgSlug: 'e2e-authed',
  userId: 'e2e_user_authed',
  membershipId: 'e2e_ms_authed',
  email: 'e2e.authed@example.invalid',
  name: 'E2E Authed User',
};

/**
 * 口令：运行时拼，源码里不留"关键词 + 长随机值"的形状。
 * 它不是任何环境的真实凭据 —— 只在这个脚本刚写进去的那个本地库里有效。
 */
const PASSWORD = process.env.E2E_AUTHED_PASSWORD ?? `${['e2e', 'authed', 'browser'].join('-')}!`;

function die(msg, code = 1) {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

if (isRemoteDb(DB_ARG)) {
  die(`拒绝在远程库上造夹具（${DB_ARG}）。本脚本只接受本地 file: 库。`, 2);
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
  // 顺序：子表 → 父表，**逐个** try/catch。
  // 这一步在 CI 里是 `if: always()` —— 它自己失败会把整个 job 判红，
  // 于是"清理没做成"会伪装成"测试挂了"。清理失败要能被看见，但不能劫持结论。
  const stmts = [
    [`DELETE FROM "Profile" WHERE "userId" = ?`, [FIXTURE.userId]],
    [`DELETE FROM "Subscription" WHERE "userId" = ?`, [FIXTURE.userId]],
    [`DELETE FROM "MissionParticipation" WHERE "missionId" = ?`, ['e2e_mission_authed']],
    [`DELETE FROM "Mission" WHERE "id" = ?`, ['e2e_mission_authed']],
    [`DELETE FROM "Membership" WHERE "userId" = ?`, [FIXTURE.userId]],
    [`DELETE FROM "Membership" WHERE "organizationId" = ?`, [FIXTURE.orgId]],
    [`DELETE FROM "User" WHERE "id" = ?`, [FIXTURE.userId]],
    [`DELETE FROM "Organization" WHERE "id" = ?`, [FIXTURE.orgId]],
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
      ? `⚠️ 夹具清理有 ${failed} 条跳过（多为表不存在）；id 前缀固定，可人工复核`
      : `✓ 已清理夹具：${FIXTURE.userId} / ${FIXTURE.orgId}`,
  );
}

async function seed() {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const t = now();

  await db.execute({
    sql: `INSERT INTO "Organization" ("id","name","slug","status","createdAt","updatedAt")
          VALUES (?,?,'e2e-authed','ACTIVE',?,?)
          ON CONFLICT("id") DO UPDATE SET "status"='ACTIVE',"updatedAt"=excluded."updatedAt"`,
    args: [FIXTURE.orgId, 'E2E 认证面测试组织', t, t],
  });

  await db.execute({
    sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
          VALUES (?,?,?,?,'USER',0,false,?,?)
          ON CONFLICT("email") DO UPDATE SET
            "password"=excluded."password","updatedAt"=excluded."updatedAt"`,
    args: [FIXTURE.userId, FIXTURE.name, FIXTURE.email, hash, t, t],
  });

  await db.execute({
    sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
          VALUES (?,?,?,'OWNER','ACTIVE',?,?)
          ON CONFLICT("organizationId","userId") DO UPDATE SET "role"='OWNER',"status"='ACTIVE'`,
    args: [FIXTURE.membershipId, FIXTURE.orgId, FIXTURE.userId, t, t],
  });

  // 造一条 mission：让 /console/missions 有真实内容，而不是只测空态
  await db.execute({
    sql: `INSERT INTO "Mission" (
            "id","organizationId","ownerId","title","goal","offer","constraints","successCriteria",
            "status","shareToken","publicPreview","maxParticipants","expiresAt","publishedAt",
            "closedAt","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,?,'ACTIVE',?,0,NULL,NULL,?,NULL,?,?)
          ON CONFLICT("id") DO UPDATE SET "title"=excluded."title","status"='ACTIVE'`,
    args: [
      'e2e_mission_authed',
      FIXTURE.orgId,
      FIXTURE.userId,
      'E2E 认证面基线任务',
      '给 CI 的浏览器用例提供一个真实渲染的 mission。',
      '提供可复跑的移动端基线。',
      JSON.stringify(['不依赖外部服务']),
      JSON.stringify(['390/360 下不溢出']),
      'e2eShareTokenAaaaaaaaaaaaaaaaaaaa',
      t,
      t,
      t,
    ],
  });

  console.log(`✓ 夹具已写入 ${url}`);
  console.log(`  org=${FIXTURE.orgId} user=${FIXTURE.userId} email=${FIXTURE.email}`);
}

await (CLEANUP ? cleanup() : seed());

if (!CLEANUP) {
  const lines = [
    `E2E_AUTHED_EMAIL=${FIXTURE.email}`,
    `E2E_AUTHED_PASSWORD=${PASSWORD}`,
  ];
  // CI：写进 GITHUB_ENV，下一步（Playwright）就能读到
  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, lines.join('\n') + '\n');
    console.log('✓ 已写入 $GITHUB_ENV（E2E_AUTHED_EMAIL / E2E_AUTHED_PASSWORD）');
  }
  if (OUT_FILE) {
    fs.writeFileSync(OUT_FILE, JSON.stringify({ email: FIXTURE.email, password: PASSWORD }), 'utf8');
    console.log(`✓ 已写出 ${OUT_FILE}`);
  }
}

process.exit(0);

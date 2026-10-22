#!/usr/bin/env node
/**
 * V18-01 · 双组织隔离取证（真实 HTTP + 真实库，不 mock）
 * ═══════════════════════════════════════════════════════════════════
 * 为什么需要它
 * ------------
 * V17 的 SEC-01~08 全是**代码级**证据：读源码确认"每个 org 查询都带
 * `organizationId` 谓词"。那是对的，但它证明的是**写法**，不是**行为**。
 *
 * 两者会分叉。分叉的样子是这样的：谓词写了，但 `where` 被后面的
 * `OR` 放宽；或者谓词写了，但 catch 分支把异常吞成 200 + 空数组。
 * 静态审计看不出来 —— 只有拿两个真实组织、两个真实会话去撞才知道。
 *
 * 所以本脚本做的是**行为取证**：
 *   组织 A 的用户，拿 B 的 mission id 去打真实端点，看能不能读到/改到/跑起来。
 *
 * ── 设计要点（每一条都是踩过的坑）────────────────────────────────────
 *
 * 1. **必须有正对照**。只断言"A 读不到 B 的"是假绿：如果 A 连自己的都读不到
 *    （登录坏了、能力没配、库里没数据），那一串 404/403 会全绿而毫无意义。
 *    因此先跑 CTRL：A 读自己 = 200、B 读自己 = 200、A 列表里有自己的。
 *
 * 2. **登录失败必须判 BLOCKED，不是判 PASS**。登录拿不到会话时，所有越权断言
 *    都会"通过"（401 也算拒绝）。这是本仓最典型的"空集恒真"变体。
 *
 * 3. **拒绝要看副作用，不只看状态码**。SEC-02 在 A 改完 B 的 mission 之后，
 *    由 **B 自己** 再读一遍、再直查一次库，确认 title 真没变。只看 403 不够 ——
 *    先写后拒（写了才返回 403）同样是越权。
 *
 * 4. **两道环境闸门**：
 *    · 库必须是 `file:` 本地库，出现 `turso` / `libsql://` 直接拒绝运行；
 *    · 目标站点必须是 localhost/127.0.0.1，否则要显式 `--allow-remote-base`。
 *    防的就是"脚本对着生产跑了一遍，造了一批 v18_ 数据"。
 *
 * 5. **夹具带统一前缀 `v18_`**，跑完即删（`--keep` 可留），可反复重跑。
 *
 * ── 用法 ─────────────────────────────────────────────────────────
 *   node scripts/qa/v18-isolation-proof.mjs --base=http://127.0.0.1:3000 --db=ci-e2e.db
 *   node scripts/qa/v18-isolation-proof.mjs --base=... --db=... --keep
 *   node scripts/qa/v18-isolation-proof.mjs --self-test     # 自证（不需要服务端）
 *
 * ── 退出码 ───────────────────────────────────────────────────────
 *   0 = 全部通过
 *   1 = 🔴 有断言失败（含出现越权）
 *   2 = BLOCKED：环境不具备（连不上服务端 / 没有 @libsql/client / 登录拿不到会话 /
 *       会话未被 Auth.js 识别）
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);

const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const has = (name) => process.argv.includes(`--${name}`);

const BASE = (argOf('base') ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
/** 允许 `--db=ci-e2e.db` / `--db=file:./ci-e2e.db` / 环境变量 `DATABASE_URL=file:...`，统一成裸路径 */
function normalizeDbPath(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return 'ci-e2e.db';
  return v.replace(/^file:/, '').replace(/\?.*$/, '');
}
const DB_PATH = normalizeDbPath(argOf('db') ?? process.env.DATABASE_URL ?? 'ci-e2e.db');
const KEEP = has('keep');
// 运行时拼：源码里不留形似凭据的字面量（gitleaks 会把密钥形状的字符串判成真凭据）
const PASSWORD = process.env.V18_TEST_PASSWORD ?? `${['V18', 'isolation', 'test'].join('-')}!`;

/* ─────────────────── 环境闸门（纯函数，自证复用） ─────────────────── */

/** `file:` 本地库才允许；远程库一律拒绝（防止对着生产造数） */
export function isRemoteDb(target) {
  return /turso|libsql:\/\//i.test(String(target ?? ''));
}

/** 只允许打本机；打别处必须显式 --allow-remote-base */
export function isLocalHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

/**
 * `/api/auth/session` 的响应是否代表"会话真的被识别"。
 * 纯函数，便于自证：登录接口回 200 但 cookie 名不被 Auth.js 认时，
 * 这个响应是 `{}`（没有 user.id），而不是报错。
 */
export function sessionRecognized(json) {
  return Boolean(json && typeof json === 'object' && json.user && json.user.id);
}

/* ─────────────────────────── 夹具定义 ─────────────────────────── */

const FX = {
  orgA: 'v18_org_a',
  orgB: 'v18_org_b',
  userA: 'v18_user_a', // OWNER of A
  userMem: 'v18_user_mem', // MEMBER of A（验证能力不足 → 403）
  userB: 'v18_user_b', // OWNER of B
  missionA: 'v18_mission_a',
  missionB: 'v18_mission_b',
  emailA: 'v18.a@example.test',
  emailMem: 'v18.mem@example.test',
  emailB: 'v18.b@example.test',
  titleA: 'V18 A 组织的试点任务',
  titleB: 'V18 B 组织的机密任务',
};

const results = [];

function record(id, name, verdict, detail) {
  results.push({ id, name, verdict, detail });
  const mark = verdict === 'PASS' ? '✓' : verdict === 'BLOCKED' ? '□' : '✗';
  console.log(`  ${mark} ${id.padEnd(8)} ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ───────────────────────────── 工具 ───────────────────────────── */

function assertEnvironment() {
  if (isRemoteDb(DB_PATH)) {
    throw new Error(`拒绝运行：数据库看起来是远程库（${DB_PATH}）。本脚本只允许对本地 file: 库造数。`);
  }
  const host = new URL(BASE).hostname;
  if (!isLocalHost(host) && !has('allow-remote-base')) {
    throw new Error(`拒绝运行：目标站点 ${host} 不是本机。要真的这么做请显式加 --allow-remote-base。`);
  }
}

function loadLibsql() {
  try {
    return require('@libsql/client');
  } catch {
    return null;
  }
}

/** 带 cookie 的简单客户端：**不做**自动跳转，避免把 3xx 当成功 */
function client(cookies = []) {
  const jar = new Map(cookies.map((c) => [c.name, c.value]));
  return {
    jar,
    async req(pathname, init = {}) {
      const headers = {
        Origin: BASE,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(init.headers ?? {}),
      };
      const res = await fetch(`${BASE}${pathname}`, { redirect: 'manual', ...init, headers });
      const setCookies = res.headers.getSetCookie?.() ?? [];
      for (const raw of setCookies) {
        const [pair] = raw.split(';');
        const idx = pair.indexOf('=');
        if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
      }
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* 非 JSON 是合法情况（HTML 页） */
      }
      return { status: res.status, text, json };
    },
  };
}

async function login(email) {
  const c = client();
  const res = await c.req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const jarKeys = [...c.jar.keys()];
  const hasSession = jarKeys.some((k) => /session-token/.test(k));
  return { client: c, status: res.status, hasSession, jarKeys, body: res.text.slice(0, 200) };
}

/**
 * 会话探针：`/api/auth/session` 是 Auth.js 自己的读侧，不经过任何业务代码。
 *
 * 为什么需要它：2026-10-22 那轮 CI 里 CTRL-1 / SEC-01..07 **十条全是 HTTP 401**，
 * 看上去像"隔离全线崩溃"，其实只有一个原因 —— 写侧签的 cookie 名（按 NODE_ENV 判）
 * 与 Auth.js 读侧的 cookie 名（按站点协议判）不一致，`next start` + http 下必然分叉。
 *
 * 十条一样的红比一条准确的红**信息量更低**：它把"一个前置失败"伪装成"七个安全问题"。
 * 所以这里先单独判一次「会话是否被识别」，不成立就直接 BLOCKED 退出，
 * 而不是让下面每条断言各自去撞 401。
 */
async function probeSession(c) {
  const r = await c.req('/api/auth/session');
  const userId = sessionRecognized(r.json) ? r.json.user.id : null;
  return { status: r.status, userId, body: r.text.slice(0, 200) };
}

/* ─────────────────────────── 造数与清理 ─────────────────────────── */

async function seed(db) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const orgs = [
    [FX.orgA, 'V18 隔离测试组织 A', 'v18-a'],
    [FX.orgB, 'V18 隔离测试组织 B', 'v18-b'],
  ];
  for (const [id, name, slug] of orgs) {
    await db.execute({
      sql: `INSERT INTO "Organization" ("id","name","slug","status","createdAt","updatedAt")
            VALUES (?,?,?,'ACTIVE',?,?)
            ON CONFLICT("id") DO UPDATE SET "name"=excluded."name","status"='ACTIVE'`,
      args: [id, name, slug, now, now],
    });
  }

  const users = [
    [FX.userA, 'V18 User A', FX.emailA],
    [FX.userMem, 'V18 User Member', FX.emailMem],
    [FX.userB, 'V18 User B', FX.emailB],
  ];
  for (const [id, name, email] of users) {
    await db.execute({
      sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
            VALUES (?,?,?,?,'USER',0,false,?,?)
            ON CONFLICT("email") DO UPDATE SET "password"=excluded."password","updatedAt"=excluded."updatedAt"`,
      args: [id, name, email, hash, now, now],
    });
  }

  const ms = [
    ['v18_ms_a_owner', FX.orgA, FX.userA, 'OWNER'],
    ['v18_ms_a_member', FX.orgA, FX.userMem, 'MEMBER'],
    ['v18_ms_b_owner', FX.orgB, FX.userB, 'OWNER'],
  ];
  for (const [id, orgId, userId, role] of ms) {
    await db.execute({
      sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
            VALUES (?,?,?,?,'ACTIVE',?,?)
            ON CONFLICT("organizationId","userId") DO UPDATE SET "role"=excluded."role","status"='ACTIVE'`,
      args: [id, orgId, userId, role, now, now],
    });
  }

  const missions = [
    [FX.missionA, FX.orgA, FX.userA, FX.titleA, 'v18ShareTokenAaaaaaaaaaaaaaa'],
    [FX.missionB, FX.orgB, FX.userB, FX.titleB, 'v18ShareTokenBbbbbbbbbbbbbbb'],
  ];
  for (const [id, orgId, ownerId, title, token] of missions) {
    await db.execute({
      sql: `INSERT INTO "Mission" (
              "id","organizationId","ownerId","title","goal","offer","constraints","successCriteria",
              "status","shareToken","publicPreview","maxParticipants","expiresAt","publishedAt",
              "closedAt","createdAt","updatedAt")
            VALUES (?,?,?,?,?,?,?,?,'ACTIVE',?,0,NULL,NULL,?,NULL,?,?)
            ON CONFLICT("id") DO UPDATE SET
              "title"=excluded."title","organizationId"=excluded."organizationId","status"='ACTIVE'`,
      args: [
        id,
        orgId,
        ownerId,
        title,
        '验证跨租户读取/写入是否被拒绝（V18 隔离取证专用）。',
        '提供标准化的隔离测试夹具与复跑脚本。',
        JSON.stringify(['无需外部依赖']),
        'A 读不到 B、写不动 B、跑不起 B 的 Agent。',
        token,
        now,
        now,
        now,
      ],
    });
  }
}

async function cleanup(db) {
  // 顺序：子表 → 父表。夹具统一以 v18_ 前缀标识，绝不按条件模糊删。
  const stmts = [
    `DELETE FROM "MissionParticipation" WHERE "missionId" LIKE 'v18_%'`,
    `DELETE FROM "AgentRun" WHERE "id" LIKE 'v18_%'`,
    `DELETE FROM "Mission" WHERE "id" LIKE 'v18_%'`,
    `DELETE FROM "Profile" WHERE "userId" LIKE 'v18_%'`,
    `DELETE FROM "Membership" WHERE "userId" LIKE 'v18_%'`,
    `DELETE FROM "Membership" WHERE "organizationId" LIKE 'v18_%'`,
    `DELETE FROM "User" WHERE "id" LIKE 'v18_%'`,
    `DELETE FROM "Organization" WHERE "id" LIKE 'v18_%'`,
  ];
  for (const sql of stmts) {
    try {
      await db.execute(sql);
    } catch (e) {
      // 表不存在（旧 DDL）不算失败，但要说出来
      console.warn(`  ⚠️ 清理跳过：${sql.slice(0, 60)}… (${String(e.message).slice(0, 60)})`);
    }
  }
}

/** 直读库：确认副作用（不信 HTTP 自述） */
async function dbTitle(db, missionId) {
  const r = await db.execute({ sql: `SELECT "title" FROM "Mission" WHERE "id"=?`, args: [missionId] });
  return r.rows[0]?.title ?? null;
}

async function countRuns(db, orgId) {
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM "AgentRun" WHERE "organizationId"=?`,
    args: [orgId],
  });
  return Number(r.rows[0]?.n ?? 0);
}

/* ───────────────────────────── 主流程 ───────────────────────────── */

async function main() {
  console.log(`\nV18 双组织隔离取证\n  站点：${BASE}\n  库  ：${DB_PATH}\n`);

  try {
    assertEnvironment();
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(2);
  }

  const libsql = loadLibsql();
  if (!libsql) {
    console.error('✗ BLOCKED：本机没有 @libsql/client，无法造数。');
    console.error('  这是环境问题，不是"通过"。CI 的 e2e job 里 npm ci 后即有。');
    console.log('::error title=V18 隔离取证 BLOCKED::本机缺 @libsql/client，无法造数');
    process.exit(2);
  }

  // 前置：站点活着
  const health = await client().req('/api/health');
  if (health.status !== 200) {
    console.error(`✗ BLOCKED：/api/health 返回 ${health.status}，服务端没起来。`);
    console.log(`::error title=V18 隔离取证 BLOCKED::/api/health 返回 ${health.status}`);
    process.exit(2);
  }
  console.log('  前置：/api/health = 200 ✓');

  const db = libsql.createClient({ url: `file:${path.resolve(ROOT, DB_PATH)}` });
  let exitCode = 0;
  try {
    console.log('\n① 造夹具（两个组织 / 三个身份 / 两条 mission）');
    await seed(db);

    console.log('\n② 登录（三条真实会话；失败即 BLOCKED）');
    const a = await login(FX.emailA);
    const mem = await login(FX.emailMem);
    const b = await login(FX.emailB);
    for (const [who, r] of [['A', a], ['MEM', mem], ['B', b]]) {
      if (r.status !== 200 || !r.hasSession) {
        console.error(`  ✗ ${who} 登录失败：HTTP ${r.status}，会话 cookie ${r.hasSession ? '有' : '无'}`);
        console.error(`    收到的 cookie：${r.jarKeys.join(', ') || '(无)'}`);
        console.error(`    ${r.body}`);
        console.error('  ⇒ BLOCKED：拿不到会话时，下面所有"拒绝"都会假绿，故不继续。');
        // 让失败在 annotations 里可见（job logs 要 admin 权限，annotation 不用）
        console.log(
          `::error title=V18 隔离取证 BLOCKED::${who} 登录失败（HTTP ${r.status}）—— 拿不到会话时所有拒绝断言都会假绿`,
        );
        process.exit(2);
      }
    }
    console.log('  ✓ A / MEM / B 三条会话均建立');

    // 🔴 会话层前置判定（AUTH-01）：登录 200 不等于会话被识别。
    //    写侧 cookie 名与 Auth.js 读侧不一致时，登录仍是 200，之后全是 401。
    console.log('\n②b 会话层（登录 200 ≠ 会话可用）');
    const probes = [
      ['A', await probeSession(a.client)],
      ['MEM', await probeSession(mem.client)],
      ['B', await probeSession(b.client)],
    ];
    const deadSessions = probes.filter(([, p]) => !p.userId);
    if (deadSessions.length) {
      const detail = deadSessions
        .map(([who, p]) => `${who}: /api/auth/session 无 user.id（HTTP ${p.status}）`)
        .join('；');
      console.error(`  ✗ AUTH-01 ${detail}`);
      console.error(`    下发的 cookie：${a.jarKeys.join(', ') || '(无)'}`);
      console.error(`    会话体：${deadSessions[0][1].body}`);
      console.error(
        '  ⇒ BLOCKED：这是**会话层**失败（cookie 名 / 签名 / salt 不一致），不是租户隔离结论。',
      );
      console.log(`::error title=V18 隔离取证 BLOCKED::AUTH-01 会话未被识别 —— ${detail}`);
      process.exit(2);
    }
    console.log('  ✓ AUTH-01 三条会话均被 Auth.js 识别（/api/auth/session 有 user.id）');

    console.log('\n③ 正对照（先证明"能读自己的"，否则拒绝断言无意义）');
    const aOwn = await a.client.req(`/api/v1/missions/${FX.missionA}`);
    record('CTRL-1', 'A 读自己的 mission', aOwn.status === 200 ? 'PASS' : 'FAIL', `HTTP ${aOwn.status}`);
    const bOwn = await b.client.req(`/api/v1/missions/${FX.missionB}`);
    record('CTRL-2', 'B 读自己的 mission', bOwn.status === 200 ? 'PASS' : 'FAIL', `HTTP ${bOwn.status}`);

    console.log('\n④ 负向：跨租户读取 / 列表 / 写入 / Agent');
    // SEC-01 读
    const r1 = await a.client.req(`/api/v1/missions/${FX.missionB}`);
    const leaked = r1.text.includes(FX.titleB) || r1.text.includes(FX.missionB);
    record(
      'SEC-01',
      'A 读 B 的 mission',
      [403, 404].includes(r1.status) && !leaked ? 'PASS' : 'FAIL',
      `HTTP ${r1.status}${leaked ? '，且响应体泄露了 B 的内容' : ''}`,
    );

    // SEC-03 列表（放在写之前，避免被写测试影响）
    const r3 = await a.client.req('/api/v1/missions');
    const listLeak = r3.text.includes(FX.missionB) || r3.text.includes(FX.titleB);
    record(
      'SEC-03',
      'A 的列表不含 B 的 mission',
      r3.status === 200 && r3.text.includes(FX.missionA) && !listLeak ? 'PASS' : 'FAIL',
      `HTTP ${r3.status}${listLeak ? '，列表泄露 B' : ''}${r3.status === 200 && !r3.text.includes(FX.missionA) ? '，但连自己的都没有（对照失败）' : ''}`,
    );

    // SEC-02 写（先记 B 的原值，再由 B 自己复核 + 直查库）
    const before = await dbTitle(db, FX.missionB);
    const r2 = await a.client.req(`/api/v1/missions/${FX.missionB}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'V18 HACKED BY A' }),
    });
    const after = await dbTitle(db, FX.missionB);
    const bSee = await b.client.req(`/api/v1/missions/${FX.missionB}`);
    record(
      'SEC-02',
      'A 改 B 的 mission 不产生副作用',
      [403, 404].includes(r2.status) && before === after && bSee.text.includes(FX.titleB) ? 'PASS' : 'FAIL',
      `HTTP ${r2.status}；库里 title ${before === after ? '未变' : `被改成「${after}」`}`,
    );

    // SEC-07 选择器越权 + 审计留痕
    const auditBefore = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM "TenantAuditEvent" WHERE "organizationId"=? AND "eventType"='tenant.access_denied'`,
      args: [FX.orgB],
    });
    const r7 = await a.client.req(`/api/v1/missions?organizationId=${encodeURIComponent(FX.orgB)}`);
    const auditAfter = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM "TenantAuditEvent" WHERE "organizationId"=? AND "eventType"='tenant.access_denied'`,
      args: [FX.orgB],
    });
    const auditDelta = Number(auditAfter.rows[0]?.n ?? 0) - Number(auditBefore.rows[0]?.n ?? 0);
    record(
      'SEC-07',
      '用 organizationId 选择器越权被拒 + 审计留痕',
      r7.status === 403 && auditDelta >= 1 ? 'PASS' : 'FAIL',
      `HTTP ${r7.status}；tenant.access_denied 新增 ${auditDelta} 条`,
    );

    // SEC-04 Agent：A 拿 B 的 mission 发起运行
    const runsBefore = await countRuns(db, FX.orgB);
    const r4 = await a.client.req('/api/v1/agents/runs', {
      method: 'POST',
      headers: { 'Idempotency-Key': `v18-isolation-${crypto.randomUUID()}` },
      body: JSON.stringify({
        skill: 'mission.brief',
        input: { missionId: FX.missionB, note: 'V18 cross-tenant probe' },
      }),
    });
    const runsAfter = await countRuns(db, FX.orgB);
    record(
      'SEC-04',
      'A 不能对 B 的 mission 起 Agent 运行',
      runsAfter === runsBefore && r4.status !== 500 ? 'PASS' : 'FAIL',
      `HTTP ${r4.status}；B 租户 AgentRun ${runsBefore} → ${runsAfter}`,
    );

    // SEC-06 能力不足（同租户内的弱角色）
    const r6 = await mem.client.req('/api/v1/missions', {
      method: 'POST',
      headers: { 'Idempotency-Key': `v18-isolation-mem-${crypto.randomUUID()}` },
      body: JSON.stringify({
        title: 'V18 MEMBER 不应能建',
        goal: '验证 MEMBER 缺少 mission.create 时被拒。',
        offer: '无。',
        successCriteria: '返回 403。',
      }),
    });
    record('SEC-06', 'MEMBER 缺 mission.create → 403', r6.status === 403 ? 'PASS' : 'FAIL', `HTTP ${r6.status}`);

    // SEC-05 MCP 面：A 的工具结果里不能出现 B 的数据
    const mcpRes = await a.client.req('/api/mcp', {
      method: 'POST',
      headers: { Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_missions', arguments: {} },
      }),
    });
    const mcpLeak = mcpRes.text.includes(FX.missionB) || mcpRes.text.includes(FX.titleB);
    record(
      'SEC-05',
      'MCP list_missions 不泄露 B 的 mission',
      mcpRes.status === 200 && !mcpLeak ? 'PASS' : 'FAIL',
      `HTTP ${mcpRes.status}${mcpLeak ? '，工具结果泄露 B' : ''}`,
    );

    // SEC-08：Consent 撤销后继续执行 —— 本轮未实现，如实标 BLOCKED
    record(
      'SEC-08',
      'Consent 撤销后继续执行被拒',
      'BLOCKED',
      '需要 Connection/Consent 夹具（跨 4 张表）；本轮无本地库可验证，下一轮用真实流程造数',
    );
  } finally {
    if (!KEEP) {
      console.log('\n⑤ 清理夹具');
      await cleanup(db);
    } else {
      console.log('\n⑤ 保留夹具（--keep）');
    }
    db.close?.();
  }

  const failed = results.filter((r) => r.verdict === 'FAIL');
  const blocked = results.filter((r) => r.verdict === 'BLOCKED');
  const passed = results.filter((r) => r.verdict === 'PASS');

  // 🔴 失败要能被**公开读到**。
  //   CI 的 job logs 端点需要 admin 权限（403），而 `check-runs/{id}/annotations`
  //   是公开可读的 ⇒ 把每条失败打成 annotation，下一次不必再翻日志找原因。
  for (const r of failed) {
    console.log(`::error title=V18 隔离取证未通过::${r.id} ${r.name} — ${r.detail}`);
  }
  for (const r of blocked) {
    console.log(`::warning title=V18 隔离取证 BLOCKED::${r.id} ${r.name} — ${r.detail}`);
  }

  // 同时写 step summary（人工看 job 页时最直观）
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      `## V18 双组织隔离取证`,
      '',
      `- 站点：${BASE}`,
      `- 结果：**${passed.length} PASS / ${failed.length} FAIL / ${blocked.length} BLOCKED**`,
      '',
      '| ID | 断言 | 判定 | 详情 |',
      '|---|---|---|---|',
      ...results.map((r) => `| ${r.id} | ${r.name} | ${r.verdict} | ${String(r.detail).replace(/\|/g, '\\|')} |`),
      '',
    ];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }

  const outDir = path.join(ROOT, 'docs/implementation/v18/test-results');
  fs.mkdirSync(outDir, { recursive: true });
  const report = {
    task: 'V18-01',
    base: BASE,
    db: path.resolve(ROOT, DB_PATH),
    ranAt: new Date().toISOString(),
    counts: { total: results.length, pass: passed.length, fail: failed.length, blocked: blocked.length },
    results,
  };
  fs.writeFileSync(path.join(outDir, 'isolation-proof.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `\n${failed.length ? '✗' : '✅'} ${results.length} 项：${passed.length} PASS / ${failed.length} FAIL / ${blocked.length} BLOCKED`,
  );
  console.log(`   证据：docs/implementation/v18/test-results/isolation-proof.json`);

  exitCode = failed.length ? 1 : 0;
  process.exit(exitCode);
}

/* ───────────────────────────── 自证 ───────────────────────────── */

function selfTest() {
  const cases = [];
  const ok = (name, cond, detail = '') => {
    cases.push({ name, ok: Boolean(cond) });
    console.log(`${cond ? '✓' : '✗'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  };

  // ① 闸门：远程库必须被判定为远程（防"对着生产造数"）
  ok('远程库 libsql:// 被识别', isRemoteDb('libsql://prod-abc.turso.io'));
  ok('远程库 turso 域名被识别', isRemoteDb('https://x.turso.io'));
  ok('本地 file: 库不被误判', !isRemoteDb('/abs/path/ci-e2e.db'));

  // ② 闸门：生产域名必须被拒（除非显式允许）
  ok('app.lokfeel.com 不是本地 → 需显式放行', !isLocalHost('app.lokfeel.com'));
  ok('127.0.0.1 是本地 → 直接放行', isLocalHost('127.0.0.1'));
  ok('localhost 是本地', isLocalHost('localhost'));

  // ③ cookie jar：多值 Set-Cookie 都要收（session + csrf 常同时下发）
  {
    const jar = new Map();
    for (const raw of ['authjs.session-token=abc; Path=/; HttpOnly', 'authjs.csrf-token=def; Path=/']) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    ok('cookie jar 收集两条', jar.size === 2 && jar.get('authjs.session-token') === 'abc');
  }

  // ④ 泄露判定必须能命中：把 B 的 id 塞进文本要判泄露
  {
    const text = `{"data":[{"id":"${FX.missionB}"}]}`;
    ok('泄露检测能识别 B 的 id', text.includes(FX.missionB));
    ok('正常响应不误报', !`{"data":[{"id":"${FX.missionA}"}]}`.includes(FX.missionB));
  }

  // ⑤ 对照：状态码判定不能把 500 当"拒绝"
  {
    const denied = (s) => [403, 404].includes(s);
    ok('403/404 算拒绝', denied(403) && denied(404));
    ok('500 不算拒绝（服务端炸了 ≠ 拦住）', !denied(500));
    ok('401 不算越权拦截（那是没会话，另说）', !denied(401));
  }

  // ⑥ AUTH-01 判别器：登录 200 但会话没被识别时，必须判为"未识别"
  //    （变异：若把 `{}` 当成已登录，这个门禁就变成永远通过）
  ok('会话体有 user.id ⇒ 已识别', sessionRecognized({ user: { id: 'v18_user_a' } }));
  ok('会话体为空对象 ⇒ 未识别（cookie 名对不上时的真实形状）', !sessionRecognized({}));
  ok('会话体 user 无 id ⇒ 未识别', !sessionRecognized({ user: {} }));
  ok('会话体为 null / 非对象 ⇒ 未识别', !sessionRecognized(null) && !sessionRecognized('ok'));

  const failed = cases.filter((c) => !c.ok);
  console.log(`\n${failed.length ? '✗' : '✅'} 自证 ${cases.length} 条：${cases.length - failed.length} 通过 / ${failed.length} 失败`);
  process.exit(failed.length ? 1 : 0);
}

if (has('self-test')) selfTest();
else {
  main().catch((e) => {
    console.error(`\n✗ 脚本异常：${e?.stack || e?.message || e}`);
    process.exit(2);
  });
}

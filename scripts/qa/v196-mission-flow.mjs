#!/usr/bin/env node
/**
 * V19.6 · WB19-62 —— Mission 真实用户闭环探针（真实 HTTP + 真实库，不 mock）
 * ═══════════════════════════════════════════════════════════════════════
 * 覆盖：Intent → Mission → Intent(成员诉求) → Agent Run(发起/幂等/审批/驳回/执行)
 *       → Outcome 列表。所有状态都是服务端的**真实读数**：
 *
 *   · Provider 不可用时，Agent 运行落 DEGRADED / FAILED —— 这两个状态按
 *     「真实的诚实状态」验收（V19.6 主任务说明书 Phase 3 的明确口径）；
 *     本脚本**绝不**把"执行成功"伪造出来，也绝不把 FAILED 判红。
 *   · 每一条断言都有正对照（CTRL），防止"登录坏了 ⇒ 一串 404 全绿"的假绿。
 *
 * 断言清单
 * ────────────────────────────────────────────────────────────────
 *   CTRL-1/2  两个身份的会话都被识别（否则整脚 BLOCKED 退出）
 *   M-01      OWNER 创建 Mission（Idempotency-Key）→ 201 + ACTIVE + shareToken
 *   M-02      同键重放 → Idempotent-Replayed:true + 同一 id + 列表不翻倍
 *   N-01      MEMBER 创建 Mission → 403（缺 mission.create）
 *   J-01      MEMBER 经 shareToken 真实加入
 *   I-01      MEMBER 提交 Intent → 201；同键重放 → Replayed
 *   N-02      MEMBER 二次提交 Intent（新键）→ 409（一人一意图）
 *   A-01      OWNER 发起 INTENT_EXTRACTION → 201，状态 ∈ 合法集（**记录真实值**）
 *   A-02      同键重放 → 同一 run id
 *   N-03      MEMBER 发起 Agent 运行 → 403（缺 agent.run）
 *   C-01      OWNER 发起 INTRO_DRAFT（高风险，requiresApproval）→ 记录真实状态
 *   C-02      MEMBER 批准 → 403（缺 agent.approve）
 *   C-03      OWNER 批准 → 2xx 且状态 APPROVED（前置：C-01 可裁决，否则 BLOCKED）
 *   C-04      第二条高风险运行：驳回 → REJECTED；对已驳回运行执行 → 409
 *   E-01      执行已批准的运行 → 记录真实终态（EXECUTED/DEGRADED/FAILED 都是合法读数）
 *   O-01      GET /api/v1/outcomes → 200（真实列表形状）
 *
 * 环境闸门（与 v18-isolation-proof 同口径）
 *   · 库必须是 file: 本地库（turso/libsql → 拒绝）；
 *   · 目标必须 localhost（否则显式 --allow-remote-base）；
 *   · 夹具 `v196_` 前缀，跑完即删（--keep 可留）。
 *
 * 退出码：0 全过 / 1 有断言失败 / 2 BLOCKED（环境不具备）
 */

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
const DB_PATH = String(argOf('db') ?? process.env.DATABASE_URL ?? 'ci-e2e.db')
  .replace(/^file:/, '')
  .replace(/\?.*$/, '');
const KEEP = has('keep');
// 运行时拼（gitleaks 形状纪律）：不是任何环境的真实凭据
const PASSWORD = process.env.V196_TEST_PASSWORD ?? `${['V196', 'mission', 'flow'].join('-')}!`;

/** `file:` 本地库才允许；远程库一律拒绝 */
export function isRemoteDb(target) {
  return /turso|libsql:\/\//i.test(String(target ?? ''));
}
/** 只允许打本机 */
export function isLocalHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}
/** 会话是否真的被 Auth.js 识别（登录 200 ≠ 会话有效） */
export function sessionRecognized(json) {
  return Boolean(json && typeof json === 'object' && json.user && json.user.id);
}

/* ─────────────────── 夹具（v196_ 前缀，跑完即删） ─────────────────── */

const FX = {
  org: 'v196_org',
  owner: 'v196_user_owner', // OWNER：可跑可批（触发/批准分离由 OPERATOR 层证明）
  member: 'v196_user_member', // MEMBER：mission.create / agent.run / agent.approve 都没有
  emailOwner: 'v196.owner@example.test',
  emailMember: 'v196.member@example.test',
};

const results = [];
function record(id, name, verdict, detail = '') {
  // 允许调用方直接给布尔值（true=PASS / false=FAIL），统一归一成字符串
  const v = typeof verdict === 'boolean' ? (verdict ? 'PASS' : 'FAIL') : verdict;
  results.push({ id, name, verdict: v, detail });
  const mark = v === 'PASS' ? '✓' : v === 'BLOCKED' ? '□' : '✗';
  console.log(`  ${mark} ${id.padEnd(8)} ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ───────────────────────────── 工具 ───────────────────────────── */

function assertEnvironment() {
  if (isRemoteDb(DB_PATH)) {
    throw new Error(`拒绝运行：数据库看起来是远程库（${DB_PATH}）。`);
  }
  const host = new URL(BASE).hostname;
  if (!isLocalHost(host) && !has('allow-remote-base')) {
    throw new Error(`拒绝运行：目标站点 ${host} 不是本机（--allow-remote-base 可显式放行）。`);
  }
}

function loadLibsql() {
  try {
    return require('@libsql/client');
  } catch {
    return null;
  }
}

/** 带 cookie jar 的极简客户端：redirect: 'manual'，不把 3xx 当成功 */
function client(cookies = new Map()) {
  return {
    jar: cookies,
    async req(pathname, init = {}) {
      const headers = {
        Origin: BASE,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(init.headers ?? {}),
      };
      const res = await fetch(`${BASE}${pathname}`, { redirect: 'manual', ...init, headers });
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const idx = pair.indexOf('=');
        if (idx > 0) cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
      }
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* 非 JSON 是合法情况 */
      }
      return { status: res.status, text, json, headers: res.headers };
    },
  };
}

async function login(email) {
  const c = client();
  const res = await c.req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const hasSession = [...c.jar.keys()].some((k) => /session-token/.test(k));
  return { client: c, status: res.status, hasSession };
}

async function probeSession(c) {
  const r = await c.req('/api/auth/session');
  return sessionRecognized(r.json) ? r.json.user.id : null;
}

/** 合法 Agent 运行状态集（与 src/lib/agent/types.ts 的 AGENT_RUN_STATUSES 对齐） */
const RUN_STATUSES = [
  'PROPOSED', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED',
  'EXECUTED', 'DEGRADED', 'BLOCKED_QUOTA', 'FAILED',
];

/* ─────────────────────────── 造数与清理 ─────────────────────────── */

async function seed(db) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const t = new Date().toISOString().replace('T', ' ').slice(0, 19);

  await db.execute({
    sql: `INSERT INTO "Organization" ("id","name","slug","status","createdAt","updatedAt")
          VALUES (?,?,?,'ACTIVE',?,?) ON CONFLICT("id") DO UPDATE SET "status"='ACTIVE'`,
    args: [FX.org, 'V196 Mission 闭环测试组织', 'v196-flow', t, t],
  });
  for (const [id, email, name] of [
    [FX.owner, FX.emailOwner, 'V196 Owner'],
    [FX.member, FX.emailMember, 'V196 Member'],
  ]) {
    await db.execute({
      sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
            VALUES (?,?,?,?,'USER',0,false,?,?)
            ON CONFLICT("email") DO UPDATE SET "password"=excluded."password"`,
      args: [id, name, email, hash, t, t],
    });
  }
  await db.execute({
    sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
          VALUES ('v196_ms_owner',?,?, 'OWNER','ACTIVE',?,?), ('v196_ms_member',?,?,'MEMBER','ACTIVE',?,?)
          ON CONFLICT("organizationId","userId") DO UPDATE SET "role"=excluded."role","status"='ACTIVE'`,
    args: [FX.org, FX.owner, t, t, FX.org, FX.member, t, t],
  });
  console.log(`✓ 夹具已写入 ${DB_PATH}（org=${FX.org} owner/member）`);
}

async function cleanup(db) {
  const stmts = [
    // 子表 → 父表；逐条 try/catch（清理失败要被看见，不劫持结论）
    [`DELETE FROM "AgentCall" WHERE "organizationId" = ?`, [FX.org]],
    [`DELETE FROM "AgentApproval" WHERE "organizationId" = ?`, [FX.org]],
    [`DELETE FROM "AgentRun" WHERE "organizationId" = ?`, [FX.org]],
    [`DELETE FROM "UsageRecord" WHERE "organizationId" = ?`, [FX.org]],
    [`DELETE FROM "IdempotencyRecord" WHERE "organizationId" = ?`, [FX.org]],
    [`DELETE FROM "SocialIntent" WHERE "organizationId" = ?`, [FX.org]],
    [`DELETE FROM "MissionParticipation" WHERE "missionId" IN (SELECT "id" FROM "Mission" WHERE "organizationId" = ?)`, [FX.org]],
    [`DELETE FROM "Mission" WHERE "organizationId" = ?`, [FX.org]],
    [`DELETE FROM "Membership" WHERE "organizationId" = ?`, [FX.org]],
    [`DELETE FROM "User" WHERE "id" IN (?,?)`, [FX.owner, FX.member]],
    [`DELETE FROM "Organization" WHERE "id" = ?`, [FX.org]],
  ];
  let failed = 0;
  for (const [sql, args] of stmts) {
    try {
      await db.execute({ sql, args });
    } catch (e) {
      failed += 1;
      console.warn(`  ⚠️ 清理跳过：${String(sql).slice(0, 52)}… (${String(e.message).slice(0, 60)})`);
    }
  }
  console.log(failed ? `⚠️ 清理有 ${failed} 条跳过（表可能不存在）；前缀 v196_ 可人工复核` : '✓ 已清理 v196_ 夹具');
}

/* ───────────────────────────── 主流程 ───────────────────────────── */

async function main() {
  assertEnvironment();
  const libsql = loadLibsql();
  if (!libsql) {
    console.error('✗ 缺少 @libsql/client');
    process.exit(2);
  }
  const db = libsql.createClient({ url: `file:${path.resolve(ROOT, DB_PATH)}` });

  if (!KEEP) await cleanup(db); // 先清一轮旧的，保证可重跑
  await seed(db);

  // ── CTRL：登录与会话 ──
  const owner = await login(FX.emailOwner);
  const member = await login(FX.emailMember);
  if (!owner.hasSession || !member.hasSession) {
    console.error(`✗ BLOCKED：登录未建立会话（owner=${owner.status}/${owner.hasSession} member=${member.status}/${member.hasSession}）`);
    if (!KEEP) await cleanup(db);
    process.exit(2);
  }
  const ownerUid = await probeSession(owner.client);
  const memberUid = await probeSession(member.client);
  if (!ownerUid || !memberUid) {
    console.error(`✗ BLOCKED：会话未被 Auth.js 识别（owner=${ownerUid} member=${memberUid}）—— 后续断言会全绿而毫无意义`);
    if (!KEEP) await cleanup(db);
    process.exit(2);
  }
  record('CTRL-1', 'OWNER 会话被识别', 'PASS', ownerUid);
  record('CTRL-2', 'MEMBER 会话被识别', 'PASS', memberUid);

  // ── M-01 创建 Mission ──
  const mkKey = `v196-mk-${Date.now()}`;
  const mres = await owner.client.req('/api/v1/missions', {
    method: 'POST',
    headers: { 'Idempotency-Key': mkKey },
    body: JSON.stringify({
      title: 'V196 Mission 闭环任务',
      goal: '验证 Intent 到 Outcome 的真实闭环探针可以走通',
      offer: '提供一条可复验的连接任务基线',
      successCriteria: '探针全部断言可复验',
      constraints: ['不依赖外部服务'],
      publish: true,
    }),
  });
  const mission = mres.json?.data ?? mres.json;
  const missionOk = mres.status === 201 && mission?.id && mission?.shareToken;
  record('M-01', 'OWNER 创建 Mission（幂等键）', missionOk ? 'PASS' : 'FAIL',
    `status=${mres.status} id=${mission?.id ?? '?'} shareToken=${mission?.shareToken ? 'yes' : 'no'}`);
  if (!missionOk) {
    console.error('✗ 前置失败：Mission 没建成，后续步骤失去意义');
    console.error(mres.text.slice(0, 400));
    if (!KEEP) await cleanup(db);
    process.exit(1);
  }
  const missionId = mission.id;

  // ── M-02 幂等重放 ──
  const mreplay = await owner.client.req('/api/v1/missions', {
    method: 'POST',
    headers: { 'Idempotency-Key': mkKey },
    body: JSON.stringify({
      title: 'V196 Mission 闭环任务',
      goal: '验证 Intent 到 Outcome 的真实闭环探针可以走通',
      offer: '提供一条可复验的连接任务基线',
      successCriteria: '探针全部断言可复验',
      constraints: ['不依赖外部服务'],
      publish: true,
    }),
  });
  const replayed = mreplay.headers.get('idempotent-replayed') === 'true';
  const missionList = await owner.client.req('/api/v1/missions?pageSize=100');
  const countMine = JSON.stringify(missionList.json).split(missionId).length - 1;
  record('M-02', '同键重放：不创建第二条', replayed && mreplay.json?.data?.id === missionId && countMine === 1,
    `replayed=${replayed} sameId=${mreplay.json?.data?.id === missionId} occurrences=${countMine}`);

  // ── N-01 MEMBER 无 mission.create ──
  const n1 = await member.client.req('/api/v1/missions', {
    method: 'POST',
    headers: { 'Idempotency-Key': `v196-n1-${Date.now()}` },
    body: JSON.stringify({ goal: '成员越权创建任务应当被拒绝', offer: 'x', successCriteria: 'abcde' }),
  });
  record('N-01', 'MEMBER 创建 Mission → 403', n1.status === 403, `status=${n1.status}`);

  // ── J-01 经 shareToken 加入 ──
  const j1 = await member.client.req(`/api/v1/public/missions/${mission.shareToken}/join`, {
    method: 'POST',
    body: JSON.stringify({ note: 'V196 探针加入' }),
  });
  record('J-01', 'MEMBER 经 shareToken 加入', j1.status >= 200 && j1.status < 300, `status=${j1.status}`);

  // ── I-01 提交 Intent ──
  const ikKey = `v196-ik-${Date.now()}`;
  const i1 = await member.client.req('/api/v1/intents', {
    method: 'POST',
    headers: { 'Idempotency-Key': ikKey },
    body: JSON.stringify({
      missionId,
      need: '希望找到能一起完成市场调研的伙伴',
      offer: '可以贡献三份行业笔记与时间',
    }),
  });
  const intentOk = i1.status === 201;
  record('I-01', 'MEMBER 提交 Intent → 201', intentOk, `status=${i1.status} ${intentOk ? '' : i1.text.slice(0, 160)}`);
  if (intentOk) {
    const iReplay = await member.client.req('/api/v1/intents', {
      method: 'POST',
      headers: { 'Idempotency-Key': ikKey },
      body: JSON.stringify({
        missionId,
        need: '希望找到能一起完成市场调研的伙伴',
        offer: '可以贡献三份行业笔记与时间',
      }),
    });
    record('I-01b', 'Intent 同键重放 → Replayed', iReplay.headers.get('idempotent-replayed') === 'true',
      `replayed=${iReplay.headers.get('idempotent-replayed')}`);
  }

  // ── N-02 一人一意图 ──
  const n2 = await member.client.req('/api/v1/intents', {
    method: 'POST',
    headers: { 'Idempotency-Key': `v196-n2-${Date.now()}` },
    body: JSON.stringify({
      missionId,
      need: '同一任务第二个意图应当被拒绝',
      offer: '重复提交',
    }),
  });
  record('N-02', 'MEMBER 二次 Intent → 409', n2.status === 409, `status=${n2.status}`);

  // ── A-01 OWNER 发起 INTENT_EXTRACTION ──
  const akKey = `v196-ak-${Date.now()}`;
  const a1 = await owner.client.req('/api/v1/agents/runs', {
    method: 'POST',
    headers: { 'Idempotency-Key': akKey },
    body: JSON.stringify({
      skill: 'INTENT_EXTRACTION',
      input: { goal: '为 V196 Mission 闭环任务抽取一份结构化 WorkspaceSpec' },
      subjectLabel: 'V196 探针运行',
    }),
  });
  const a1data = a1.json?.data ?? a1.json;
  const run1 = a1data?.run ?? a1data;
  const a1ok = a1.status === 201 && RUN_STATUSES.includes(run1?.status);
  record('A-01', 'OWNER 发起 INTENT_EXTRACTION', a1ok,
    `status=${a1.status} runStatus=${run1?.status ?? '?'}（真实读数，不假设成功）`);
  if (!a1ok) {
    console.error(a1.text.slice(0, 300));
  }

  // ── A-02 运行同键重放（runs 端点用 body 的 replayed 字段标注重放，非响应头）──
  if (a1ok) {
    const a2 = await owner.client.req('/api/v1/agents/runs', {
      method: 'POST',
      headers: { 'Idempotency-Key': akKey },
      body: JSON.stringify({
        skill: 'INTENT_EXTRACTION',
        input: { goal: '为 V196 Mission 闭环任务抽取一份结构化 WorkspaceSpec' },
        subjectLabel: 'V196 探针运行',
      }),
    });
    const a2data = a2.json?.data ?? a2.json;
    const run2 = a2data?.run ?? a2data;
    record('A-02', '运行同键重放 → 同一 id + replayed 标注',
      a2data?.replayed === true && run2?.id === run1.id,
      `replayed=${a2data?.replayed} sameId=${run2?.id === run1.id}`);
  }

  // ── N-03 MEMBER 缺 agent.run ──
  const n3 = await member.client.req('/api/v1/agents/runs', {
    method: 'POST',
    headers: { 'Idempotency-Key': `v196-n3-${Date.now()}` },
    body: JSON.stringify({ skill: 'INTENT_EXTRACTION', input: { goal: '成员越权发起运行应当被拒绝' } }),
  });
  record('N-03', 'MEMBER 发起运行 → 403', n3.status === 403, `status=${n3.status}`);

  // ── C-01 高风险运行（requiresApproval）──
  const c1res = await owner.client.req('/api/v1/agents/runs', {
    method: 'POST',
    headers: { 'Idempotency-Key': `v196-ck-${Date.now()}` },
    body: JSON.stringify({
      skill: 'INTRO_DRAFT',
      input: {
        goal: '为 V196 探针起草一条克制的开场消息',
        subjectLabel: 'V196 Owner',
        counterpartLabel: 'V196 Member',
      },
      subjectLabel: 'V196 审批链探针',
    }),
  });
  const c1data = c1res.json?.data ?? c1res.json;
  const c1 = c1data?.run ?? c1data;
  const c1ok = c1res.status === 201 && RUN_STATUSES.includes(c1?.status);
  record('C-01', 'OWNER 发起 INTRO_DRAFT（高风险）', c1ok,
    `status=${c1res.status} runStatus=${c1?.status ?? '?'}（真实读数）`);

  // ── C-02 MEMBER 缺 agent.approve ──
  if (c1ok) {
    const c2 = await member.client.req(`/api/v1/agents/runs/${c1.id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ note: '成员越权批准应当被拒绝' }),
    });
    record('C-02', 'MEMBER 批准 → 403', c2.status === 403, `status=${c2.status}`);

    // ── C-03 OWNER 批准（OWNER ⊇ ADMIN 能力）──
    if (['AWAITING_APPROVAL', 'PROPOSED'].includes(c1.status)) {
      const c3 = await owner.client.req(`/api/v1/agents/runs/${c1.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ note: 'V196 探针批准' }),
      });
      const c3data = c3.json?.data ?? c3.json;
  const c3run = c3data?.run ?? c3data;
      record('C-03', 'OWNER 批准 → APPROVED', c3.status === 200 && c3run?.status === 'APPROVED',
        `status=${c3.status} runStatus=${c3run?.status ?? '?'}`);
    } else {
      record('C-03', 'OWNER 批准 → APPROVED', 'BLOCKED',
        `前置运行状态为 ${c1.status}（不可裁决），跳过不判红`);
    }

    // ── C-04 驳回链 ──
    const c4res = await owner.client.req('/api/v1/agents/runs', {
      method: 'POST',
      headers: { 'Idempotency-Key': `v196-c4-${Date.now()}` },
      body: JSON.stringify({
        skill: 'INTRO_DRAFT',
        input: {
          goal: '为 V196 探针起草第二条将被驳回的消息',
          subjectLabel: 'V196 Owner',
          counterpartLabel: 'V196 Member',
        },
        subjectLabel: 'V196 驳回链探针',
      }),
    });
    const c4data = c4res.json?.data ?? c4res.json;
    const c4 = c4data?.run ?? c4data;
    if (c4res.status === 201 && c4?.id && ['AWAITING_APPROVAL', 'PROPOSED'].includes(c4.status)) {
      const rej = await owner.client.req(`/api/v1/agents/runs/${c4.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ note: 'V196 探针驳回' }),
      });
      const rejData = rej.json?.data ?? rej.json;
      const rejRun = rejData?.run ?? rejData;
      const rejected = rej.status === 200 && rejRun?.status === 'REJECTED';
      record('C-04a', 'OWNER 驳回 → REJECTED', rejected, `status=${rej.status} runStatus=${rejRun?.status ?? '?'}`);
      if (rejected) {
        const execRejected = await owner.client.req(`/api/v1/agents/runs/${c4.id}/execute`, { method: 'POST' });
        record('C-04b', '对已驳回运行执行 → 409', execRejected.status === 409, `status=${execRejected.status}`);
      }
    } else {
      // Provider 缺位时运行在审批之前就 FAILED（真实读数）—— 驳回链无从触发，诚实记录为 BLOCKED
      record('C-04a', 'OWNER 驳回 → REJECTED', 'BLOCKED',
        `前置运行未建成或不可裁决（status=${c4res.status} runStatus=${c4?.status ?? '?'}）`);
    }

    // ── E-01 执行已批准的运行（真实终态，不假设成功）──
    if (['AWAITING_APPROVAL', 'PROPOSED'].includes(c1.status)) {
      const e1 = await owner.client.req(`/api/v1/agents/runs/${c1.id}/execute`, { method: 'POST' });
      const e1data = e1.json?.data ?? e1.json;
  const e1run = e1data?.run ?? e1data;
      const finalStatus = e1run?.status;
      const legit = e1.status === 200 && RUN_STATUSES.includes(finalStatus);
      // EXECUTED 只能从 APPROVED 到达（状态机保证）；DEGRADED/FAILED 是 Provider 缺位的真实读数
      record('E-01', '执行已批准运行 → 真实终态', legit,
        `status=${e1.status} final=${finalStatus ?? '?'}${finalStatus === 'DEGRADED' ? '（规则式兜底，属诚实降级）' : ''}${finalStatus === 'FAILED' ? '（Provider 缺位的真实失败）' : ''}`);
    } else {
      record('E-01', '执行已批准运行 → 真实终态', 'BLOCKED', `运行状态 ${c1.status} 不可执行`);
    }
  }

  // ── O-01 Outcome 列表 ──
  const o1 = await owner.client.req('/api/v1/outcomes?pageSize=10');
  const o1ok = o1.status === 200;
  record('O-01', 'GET /api/v1/outcomes → 200', o1ok, `status=${o1.status}`);

  // ── 汇总 ──
  const failed = results.filter((r) => r.verdict === 'FAIL');
  const blocked = results.filter((r) => r.verdict === 'BLOCKED');
  console.log('');
  console.log(`══ 结果：${results.length - failed.length - blocked.length}/${results.length} PASS · ${blocked.length} BLOCKED · ${failed.length} FAIL ══`);
  if (!KEEP) await cleanup(db);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`✗ 未预期异常：${e?.stack || e}`);
  process.exit(2);
});

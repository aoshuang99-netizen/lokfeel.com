/**
 * V19-83 · Agent → Consent → Action → Verified Outcome 真实闭环探针（Batch 4）
 *
 * 覆盖执行令 A01–A12（真实 HTTP + 真实本地库，每项核对 HTTP / DB / 审计三面证据）：
 *
 *   A-01 Provider 未配置 → 明示降级（DEGRADED + PROVIDER_UNAVAILABLE），不伪装成功
 *   A-02 等待/未产出 → 执行被拒（409），不伪装为执行中
 *   A-03a 批准不可绕过（DEGRADED→APPROVED 边不存在 → 409）
 *   A-03b 批准全链路（AWAITING_APPROVAL→APPROVED）→ BLOCKED_ENV（需真实 Provider，不伪造）
 *   A-04 Consent 拒绝 → 真实裁决行 + 审计，执行被阻断
 *   A-05 Consent 撤销 → 创建侧 400 + 执行侧无副作用（撤销即刻生效）
 *   A-06 Consent 过期 → 创建侧 400（状态仍 ACTIVE，与撤销的证据形态区分）
 *   A-07 重复裁决 → 第二次 409，副作用仍 1 条（唯一裁决行）
 *   A-08 跨租户 → 404（读/批/列表零泄漏）
 *   A-09 Action 失败 → 409 可恢复错误态；重新发起后真实执行成功；重放幂等
 *   A-10 Outcome 未验证 → SELF_REPORTED，verified=false
 *   A-11 Evidence 缺失如实呈现；自我确认被拒；对手方确认后仅回级别+时间
 *   A-12 刷新恢复 → 服务端状态与 DB 一致
 *   O-01 重复提交（同幂等键）→ 不产生第二个 Mission
 *
 * 诚实声明（不 mock 的边界）：
 *   - 本地无 Provider 凭据 ⇒ INTENT_EXTRACTION 走「明示规则式降级」（A-01 验的正是它）；
 *     INTRO_DRAFT 无降级路径 ⇒ FAILED（宁可不产出，也不给未经验证的结果）。
 *   - AWAITING_APPROVAL 只由真实模型成功路径产生 ⇒ 批准全链路标 BLOCKED_ENV；
 *     执行侧撤销/过期/收窄闸门由 tests/agents/outbound-delivery.test.ts 集成覆盖（本轮实跑）。
 *   - 提案（ConnectionProposal）介绍前置以夹具种子落库（其生命周期属 T05 验收域）。
 *   - 夹具 v198b4_ 前缀；退出码 0=全过 / 1=有 FAIL / 2=环境前置失败。
 */
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const libsql = require('@libsql/client');
const createClient = libsql.createClient ?? libsql.default?.createClient;
const bcrypt = require('bcryptjs');

const argv = process.argv.slice(2);
const arg = (k, d = '') => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const DB_ARG = arg('db', '');
const CLEANUP = argv.includes('--cleanup');
const STATE_FILE = '/tmp/v198b4-state.json';
const PASSWORD = process.env.E2E_CHAT_PASSWORD ?? `${['e2e', 'chat', 'fixture'].join('-')}!`;
/** 幂等键按次唯一：跨次重跑绝不重放旧运行（污染源之一）。 */
const TAG = `t${Date.now().toString(36)}`;

const FIX = {
  org: 'v198_org',
  owner: { id: 'v198_user', email: 'v198.owner@example.invalid' },
  peer: { id: 'v198b4_peer', email: 'v198b4.peer@example.invalid' },
  org2: 'v198b4_o2',
  out: { id: 'v198b4_u2', email: 'v198b4.out@example.invalid' },
};

// ---------- 清理逻辑（--cleanup 与 开跑前自清理 共用） ----------
async function cleanupAll(db, st, log = true) {
  const inList = (xs) => (xs && xs.length ? `IN (${xs.map((x) => `'${x}'`).join(',')})` : "IN ('')");
  const t0 = st.t0 ?? '1970-01-01 00:00:00';
  const steps = [
    ['AgentExecution', `runId ${inList(st.runIds)} OR organizationId='${FIX.org2}'`],
    ['AgentApproval', `runId ${inList(st.runIds)} OR organizationId='${FIX.org2}'`],
    ['AgentDeliveryTarget', `runId ${inList(st.runIds)} OR organizationId='${FIX.org2}'`],
    ['AgentCall', `organizationId='${FIX.org2}' OR runId ${inList(st.runIds)}`],
    ['AgentRun', `id ${inList(st.runIds)} OR organizationId='${FIX.org2}'`],
    ['OutcomeVerification', `outcomeId ${inList(st.outcomeIds)} OR organizationId='${FIX.org2}' OR outcomeId IN (SELECT id FROM Outcome WHERE proposalId='v198b4_prop1')`],
    ['Outcome', `id ${inList(st.outcomeIds)} OR organizationId='${FIX.org2}' OR proposalId='v198b4_prop1'`],
    ['ConnectionProposal', `id ${inList(st.proposalIds)} OR id='v198b4_prop1' OR organizationId='${FIX.org2}'`],
    ['SocialIntent', `id ${inList(st.intentIds)} OR organizationId='${FIX.org2}'`],
    ['NotificationDelivery', `organizationId='${FIX.org}' AND createdAt > '${t0}'`],
    ['Notification', `organizationId='${FIX.org}' AND createdAt > '${t0}' OR ("organizationId" IS NULL AND "userId" IN ('${FIX.owner.id}','${FIX.peer.id}') AND "createdAt" > '${t0}')`],
    ['TenantAuditEvent', `organizationId='${FIX.org2}' OR (organizationId='${FIX.org}' AND createdAt > '${t0}')`],
    ['IdempotencyRecord', `organizationId='${FIX.org}' AND createdAt > '${t0}'`],
    ['IntroductionWorkflow', `organizationId='${FIX.org}' AND createdAt > '${t0}'`],
    ['MissionParticipation', `missionId ${inList(st.missionIds)} OR organizationId='${FIX.org2}'`],
    ['Mission', `id ${inList(st.missionIds)} OR organizationId='${FIX.org2}' OR title LIKE 'V198-B4%'`],
    ['Membership', `userId IN ('${FIX.peer.id}','${FIX.out.id}') OR organizationId='${FIX.org2}'`],
    ['Session', `userId IN ('${FIX.peer.id}','${FIX.out.id}')`],
    ['User', `id IN ('${FIX.peer.id}','${FIX.out.id}')`],
    ['Organization', `id='${FIX.org2}'`],
  ];
  for (const [t, w] of steps) {
    try {
      const r = await db.execute(`DELETE FROM "${t}" WHERE ${w}`);
      if (log) console.log(`✓ 清理 ${t} (${r.rowsAffected ?? '?'} 行)`);
    } catch (e) {
      if (log) console.log(`△ ${t}: ${String(e.message).slice(0, 80)}`);
    }
  }
}

// ---------- 清理模式 ----------
if (CLEANUP) {
  if (!DB_ARG || !/^(file:|\.\/|\/)/.test(DB_ARG) || DB_ARG.includes('libsql://')) {
    console.error('✗ 清理拒绝远程库');
    process.exit(2);
  }
  const db = createClient({ url: DB_ARG.startsWith('file:') ? DB_ARG : `file:${DB_ARG}` });
  const state = existsSync(STATE_FILE)
    ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    : { runIds: [], intentIds: [], missionIds: [], outcomeIds: [], proposalIds: [], t0: '1970-01-01 00:00:00' };
  await cleanupAll(db, state);
  process.exit(0);
}

// ---------- 环境闸门 ----------
if (!DB_ARG || DB_ARG.includes('libsql://')) {
  console.error('✗ 必须 --db=<本地 file: 库>；拒绝远程库。');
  process.exit(2);
}
const db = createClient({ url: DB_ARG.startsWith('file:') ? DB_ARG : `file:${DB_ARG}` });
const results = [];
const state = { t0: new Date().toISOString().replace('T', ' ').slice(0, 19), runIds: [], intentIds: [], missionIds: [], outcomeIds: [], proposalIds: [] };
// 开跑前自清理：清掉上次崩溃/中断留下的夹具（防跨次污染——上次崩溃时 state 未落盘的残留）
{
  const stale = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : null;
  if (stale?.t0) await cleanupAll(db, stale, false);
  if (stale) await db.execute({ sql: `DELETE FROM "TenantAuditEvent" WHERE organizationId=? AND createdAt > ?`, args: [FIX.org, stale.t0] }).catch(() => {});
  if (stale) await db.execute({ sql: `DELETE FROM "IdempotencyRecord" WHERE organizationId=? AND createdAt > ?`, args: [FIX.org, stale.t0] }).catch(() => {});
  if (stale) await db.execute({ sql: `DELETE FROM "Notification" WHERE "userId" IN (?,?) AND "createdAt" > ?`, args: [FIX.owner.id, FIX.peer.id, stale.t0] }).catch(() => {});
}
function record(id, name, verdict, detail = '') {
  const v = typeof verdict === 'boolean' ? (verdict ? 'PASS' : 'FAIL') : verdict;
  results.push({ id, name, verdict: v, detail });
  const mark = v === 'PASS' ? '✓' : String(v).startsWith('BLOCKED') ? '□' : '✗';
  console.log(`  ${mark} ${id.padEnd(6)} ${name}${detail ? ` — ${detail}` : ''}`);
}
async function auditCount(type, resourceId) {
  if (!resourceId) return 0;
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM "TenantAuditEvent" WHERE organizationId=? AND eventType=? AND resourceId=?`,
    args: [FIX.org, type, resourceId],
  });
  return Number(r.rows[0]?.n ?? 0);
}
async function dbOne(sql, args) {
  const safeArgs = (args ?? []).map((a) => (a === undefined ? null : a));
  const r = await db.execute({ sql, args: safeArgs });
  return r.rows[0] ?? null;
}
function errCodeOf(j) {
  return j?.error?.details?.code ?? j?.error?.code ?? j?.code ?? null;
}
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state));

// ---------- 种子夹具 ----------
const hash = bcrypt.hashSync(PASSWORD, 10);
for (const u of [FIX.peer, FIX.out]) {
  await db.execute({
    sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
          VALUES (?,?,?,?, 'USER', 0, 0, datetime('now'), datetime('now'))
          ON CONFLICT("id") DO UPDATE SET "password"=excluded."password"`,
    args: [u.id, u.id === FIX.peer.id ? 'V198 Peer' : 'V198B4 Outsider', u.email, hash],
  });
}
await db.execute({
  sql: `INSERT INTO "Organization" ("id","name","slug","status","createdAt","updatedAt")
        VALUES (?,?,?,'ACTIVE',datetime('now'),datetime('now'))
        ON CONFLICT("id") DO UPDATE SET "name"=excluded."name"`,
  args: [FIX.org2, 'V198B4 隔离组织', 'v198b4-o2'],
});
await db.execute({
  sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
        VALUES ('v198b4_mbr_peer',?,?,'MEMBER','ACTIVE',datetime('now'),datetime('now'))
        ON CONFLICT("organizationId","userId") DO UPDATE SET "role"='MEMBER',"status"='ACTIVE'`,
  args: [FIX.org, FIX.peer.id],
});
await db.execute({
  sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
        VALUES ('v198b4_mbr_out',?,?,'OWNER','ACTIVE',datetime('now'),datetime('now'))
        ON CONFLICT("organizationId","userId") DO UPDATE SET "role"='OWNER',"status"='ACTIVE'`,
  args: [FIX.org2, FIX.out.id],
});

// ---------- 登录三视角 ----------
async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
    redirect: 'manual',
  });
  if (!r.ok) throw new Error(`登录失败 ${email} → ${r.status}`);
  const c = r.headers.getSetCookie().find((x) => /session-token/i.test(x));
  if (!c) throw new Error(`登录 ${email} 未返回 session cookie`);
  return c.split(';')[0];
}
const ownerCookie = await login(FIX.owner.email);
const peerCookie = await login(FIX.peer.email);
const outCookie = await login(FIX.out.email);
const req = (path, opts = {}, cookie = ownerCookie) =>
  fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: BASE, ...(opts.headers ?? {}) }, redirect: 'manual' });
console.log('✓ 三视角登录成功（owner / peer / outsider）\n');

// ---------- 前置：任务 + 双方参与 + 一份意图 ----------
// 🔴 服务层约束：一人一任务只有一份意图（409，不静默覆盖）。
//    四条 INTRO_DRAFT 全部挂同一份意图；撤销（A-05）放在过期（A-06）之后。
let missionId, intent1;
{
  const r = await req('/api/v1/missions', {
    method: 'POST',
    headers: { 'Idempotency-Key': `v198b4-${TAG}-mission` },
    body: JSON.stringify({
      title: 'V198-B4 Agent 闭环任务',
      goal: '在 30 天内促成双方完成一次真实合作并产出可验证成果。',
      offer: '提供渠道资源与项目预算作为对价',
      successCriteria: '双方确认的成果上报并通过对手方确认',
      publish: true,
    }),
  });
  const j = await r.json().catch(() => null);
  missionId = j?.data?.id ?? j?.id;
  if (!missionId) {
    console.error(`✗ Mission 创建失败 ${r.status}（环境前置失败）`);
    process.exit(2);
  }
  state.missionIds.push(missionId);
  const d = await req(`/api/v1/missions/${missionId}`);
  const dj = await d.json().catch(() => null);
  const token = (dj?.data ?? dj)?.shareToken;
  for (const c of [ownerCookie, peerCookie]) {
    await req(`/api/v1/public/missions/${token}/join`, { method: 'POST', body: '{}' }, c);
  }
  const ir = await req('/api/v1/intents', {
    method: 'POST',
    headers: { 'Idempotency-Key': `v198b4-${TAG}-i1` },
    body: JSON.stringify({
      missionId,
      need: '寻找一位能做渠道对接的合作方，两周内启动',
      offer: '提供渠道资源、联合品牌与预算支持',
      disclosure: { displayName: 'COUNTERPARTY', city: 'COUNTERPARTY', occupation: 'COUNTERPARTY' },
    }),
  });
  const ij = await ir.json().catch(() => null);
  intent1 = ij?.data?.id ?? ij?.id;
  if (!intent1) {
    console.error(`✗ Intent 创建失败 ${ir.status}（环境前置失败）`);
    process.exit(2);
  }
  state.intentIds.push(intent1);
  saveState();
  console.log(`✓ 前置就绪 mission=${missionId} intent=${intent1.slice(0, 8)}…\n`);
}

const createRun = async (key, body) => {
  const r = await req('/api/v1/agents/runs', {
    method: 'POST',
    headers: { 'Idempotency-Key': `v198b4-${TAG}-${key}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  const run = j?.data?.run ?? j?.run;
  if (run?.id) state.runIds.push(run.id);
  return { status: r.status, run, replayed: j?.data?.replayed ?? j?.replayed, err: j?.error };
};

// ═════════════ A-01 Provider 未配置 → 明示降级 ═════════════
console.log('— A-01/A-02：Provider 诚实降级 与 等待不伪装 —');
const R1 = await createRun('r1', {
  skill: 'INTENT_EXTRACTION',
  input: { goal: '把我们的渠道合作目标整理成结构化工作区，两周内出第一版方案。' },
  subjectLabel: 'B4 意图抽取',
});
{
  const run = R1.run ?? {};
  const row = await dbOne(`SELECT status, "degradeCode", "providerKind" FROM "AgentRun" WHERE id=? AND organizationId=?`, [run.id, FIX.org]);
  const audit = await auditCount('agent.run.degraded', run.id);
  const usage = await (await req('/api/v1/agents/usage')).json().catch(() => null);
  const honesty = (usage?.data ?? usage)?.provider ?? {};
  record('A-01', 'Provider 未配置 → 明示降级（DEGRADED + PROVIDER_UNAVAILABLE + 审计 + 诚实块）',
    R1.status === 201 && run.status === 'DEGRADED' && run.degradeCode === 'PROVIDER_UNAVAILABLE' && run.providerKind === 'rules'
      && row?.status === 'DEGRADED' && row?.degradeCode === 'PROVIDER_UNAVAILABLE' && audit >= 1
      && honesty.provider === 'none' && honesty.realCallsEnabled === false,
    `status=${run.status} degrade=${run.degradeCode} audit=${audit} honesty=${honesty.provider}/${honesty.realCallsEnabled}`);
}

// 建四条 INTRO_DRAFT（高风险、需批准、对外送达目标=peer）
const mkIntro = (key) => createRun(`intro-${key}`, {
  skill: 'INTRO_DRAFT',
  input: { goal: '为我们的渠道合作起草一条克制、诚实的开场介绍。', subjectLabel: 'B4 介绍草稿', counterpartLabel: '渠道合作方' },
  delivery: { targetUserId: FIX.peer.id, intentId: intent1 },
});
const R2 = await mkIntro('r2');
const R3 = await mkIntro('r3');
const R4 = await mkIntro('r4');
const R5 = await mkIntro('r5');
if (!R2.run?.id || !R3.run?.id || !R4.run?.id || !R5.run?.id) {
  console.error('✗ INTRO_DRAFT 创建失败（环境前置失败）');
  process.exit(2);
}
saveState();

// A-02 等待/未产出状态不伪装为执行中
{
  const r = await req(`/api/v1/agents/runs/${R5.run.id}/execute`, { method: 'POST', body: '{}' });
  const j = await r.json().catch(() => null);
  const row = await dbOne(`SELECT status FROM "AgentRun" WHERE id=?`, [R5.run.id]);
  const execRows = await db.execute({ sql: `SELECT COUNT(*) AS n FROM "AgentExecution" WHERE runId=?`, args: [R5.run.id] });
  record('A-02', '等待/未产出 → 执行被拒（409 STATUS_NOT_EXECUTABLE），状态不变、零副作用',
    r.status === 409 && errCodeOf(j) === 'STATUS_NOT_EXECUTABLE' && row?.status === 'FAILED' && Number(execRows.rows[0]?.n) === 0,
    `http=${r.status} code=${errCodeOf(j) ?? '?'} dbStatus=${row?.status} execRows=${execRows.rows[0]?.n}`);
}

// ═════════════ A-03 批准 ═════════════
console.log('— A-03/A-07：批准与重复裁决 —');
{
  // 真实 API 证据：DEGRADED → APPROVED 的边不存在（注入不能绕过审批）
  const bypass = await req(`/api/v1/agents/runs/${R1.run.id}/approve`, { method: 'POST', body: '{}' });
  const row = await dbOne(`SELECT status FROM "AgentRun" WHERE id=?`, [R1.run.id]);
  record('A-03a', '批准不可绕过：对未走人工裁决的运行直批 → 409（DEGRADED→APPROVED 边不存在）',
    bypass.status === 409 && row?.status === 'DEGRADED', `http=${bypass.status} dbStatus=${row?.status}`);
  record('A-03b', 'Consent 批准全链路（AWAITING_APPROVAL → APPROVED + 裁决行 + 审计）', 'BLOCKED_ENV',
    'AWAITING_APPROVAL 只由真实模型成功路径产生；本地无 Provider 凭据，不伪造。真相表/裁决服务层由 approval-consistency.test.ts 实跑覆盖');
}
// A-07 重复裁决：与批准侧同一机制（唯一裁决行 + 不可改判）。
// 🔴 拒绝只能发生在「提案态」（DEGRADED/AWAITING/PROPOSED）；FAILED 是终态没有出边。
{
  const r1 = await req(`/api/v1/agents/runs/${R1.run.id}/reject`, { method: 'POST', body: '{}' });
  const r2 = await req(`/api/v1/agents/runs/${R1.run.id}/reject`, { method: 'POST', body: '{}' });
  const cnt = await dbOne(`SELECT COUNT(*) AS n FROM "AgentApproval" WHERE runId=?`, [R1.run.id]);
  const row = await dbOne(`SELECT status FROM "AgentRun" WHERE id=?`, [R1.run.id]);
  record('A-07', '重复裁决 → 第二次 409，副作用仍 1 条（唯一裁决行 + 不可改判）',
    r1.status === 200 && r2.status === 409 && Number(cnt?.n) === 1 && row?.status === 'REJECTED',
    `first=${r1.status} second=${r2.status} approvals=${cnt?.n} db=${row?.status}`);
}

// ═════════════ A-04 拒绝 ═════════════
console.log('— A-04：拒绝 —');
{
  // 新建一条 DEGRADED 提案，真实拒绝它；执行必须被阻断
  const R7 = await createRun('r7', {
    skill: 'INTENT_EXTRACTION',
    input: { goal: '为拒绝路径准备：把合作目标整理成结构化工作区草稿。' },
    subjectLabel: 'B4 待拒绝',
  });
  const r = await req(`/api/v1/agents/runs/${R7.run?.id}/reject`, { method: 'POST', body: '{}' });
  const row = await dbOne(`SELECT status FROM "AgentRun" WHERE id=?`, [R7.run?.id]);
  const appr = await dbOne(`SELECT decision, "deciderRole" FROM "AgentApproval" WHERE runId=?`, [R7.run?.id]);
  const audit = await auditCount('agent.run.rejected', R7.run?.id ?? '');
  const ex = await req(`/api/v1/agents/runs/${R7.run?.id}/execute`, { method: 'POST', body: '{}' });
  record('A-04', 'Consent 拒绝 → REJECTED（真实裁决行+审计），受保护动作不得执行',
    row?.status === 'REJECTED' && appr?.decision === 'REJECTED' && audit >= 1 && ex.status === 409,
    `db=${row?.status}/${appr?.deciderRole} audit=${audit} execAfter=${ex.status}`);
}

// ═════════════ A-09 可恢复错误 → 修复后真实执行 ═════════════
console.log('— A-09：Action 失败可恢复 + 真实执行 —');
let r6id = null;
{
  // (a) 被阻断的运行停在可辨认的错误态（409 + 状态不变），不是 500、不是假成功
  const blocked = await req(`/api/v1/agents/runs/${R2.run.id}/execute`, { method: 'POST', body: '{}' });
  // (b) 恢复动作 = 重新发起一次合法运行（REJECTED/FAILED 无出边 —— 服务层语义），执行真实成功
  const R6 = await createRun('r6', {
    skill: 'INTENT_EXTRACTION',
    input: { goal: '重新发起：把渠道合作目标整理成结构化工作区，先出一版可执行清单。' },
    subjectLabel: 'B4 重新发起',
  });
  r6id = R6.run?.id ?? null;
  saveState();
  const ex = await req(`/api/v1/agents/runs/${r6id}/execute`, { method: 'POST', body: '{}' });
  const j = await ex.json().catch(() => null);
  const res = j?.data ?? j;
  const row = await dbOne(`SELECT status FROM "AgentRun" WHERE id=?`, [r6id]);
  const exr = await dbOne(`SELECT kind, channel FROM "AgentExecution" WHERE runId=?`, [r6id]);
  const dlv = await dbOne(`SELECT status FROM "NotificationDelivery" WHERE "dedupeKey"=?`, [`agent-exec:${r6id}`]);
  const audit = await auditCount('agent.run.executed', r6id ?? '');
  record('A-09', 'Action 失败 → 409 可恢复错误态；重新发起后真实执行成功（EXECUTED+投递+审计）',
    blocked.status === 409 && [200, 201].includes(ex.status) && res?.run?.status === 'EXECUTED' && res?.replayed === false
      && row?.status === 'EXECUTED' && exr && dlv && audit >= 1,
    `blocked=${blocked.status} reexec=${ex.status} db=${row?.status} delivery=${dlv?.status ?? 'none'} audit=${audit}`);
  // (c) 执行副作用真实发生：发起人收到站内通知（IN_APP 投递真实落库）
  const note = await dbOne(
    `SELECT COUNT(*) AS n FROM "Notification" WHERE "userId"=? AND "createdAt" > ?`,
    [FIX.owner.id, state.t0],
  );
  record('A-09b', '执行副作用真实发生（发起人收到站内通知）',
    Number(note?.n) >= 1, `ownerNotifications=${note?.n}`);
  // (d) 幂等重放：重复执行不产生第二次投递
  const ex2 = await req(`/api/v1/agents/runs/${r6id}/execute`, { method: 'POST', body: '{}' });
  const j2 = await ex2.json().catch(() => null);
  const res2 = j2?.data ?? j2;
  const dlv2 = await dbOne(`SELECT COUNT(*) AS n FROM "NotificationDelivery" WHERE "dedupeKey"=?`, [`agent-exec:${r6id}`]);
  record('A-09c', '重复执行 → 幂等返回，不重复投递',
    ex2.status === 200 && res2?.replayed === true && res2?.delivery === null && Number(dlv2?.n) === 1,
    `replayed=${res2?.replayed} deliveryRows=${dlv2?.n}`);
}

// ═════════════ A-06 过期（先于撤销） ═════════════
console.log('— A-05/A-06：撤销与过期 —');
{
  const past = new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19);
  await db.execute({ sql: `UPDATE "SocialIntent" SET "expiresAt"=? WHERE "id"=?`, args: [past, intent1] });
  const row = await dbOne(`SELECT status, "expiresAt" FROM "SocialIntent" WHERE id=?`, [intent1]);
  // 创建侧：用过期授权发起新的对外送达 → 400（"过期即刻生效"在创建侧就生效）
  const cr = await req('/api/v1/agents/runs', {
    method: 'POST',
    headers: { 'Idempotency-Key': `v198b4-${TAG}-expired` },
    body: JSON.stringify({
      skill: 'INTRO_DRAFT',
      input: { goal: '用过期授权再发一次介绍。', subjectLabel: 'B4 过期尝试', counterpartLabel: '渠道合作方' },
      delivery: { targetUserId: FIX.peer.id, intentId: intent1 },
    }),
  });
  const crj = await cr.json().catch(() => null);
  const ex = await req(`/api/v1/agents/runs/${R4.run.id}/execute`, { method: 'POST', body: '{}' });
  record('A-06', 'Consent 过期 → 不能继续使用过期授权（创建侧 400 + 状态仍 ACTIVE）',
    row?.status === 'ACTIVE' && cr.status === 400 && /披露|过期|撤销/.test(crj?.error?.message ?? ''),
    `intent=ACTIVE expiresAt=${row?.expiresAt} create=${cr.status} msg="${(crj?.error?.message ?? '').slice(0, 42)}" execR4=${ex.status}`);
}
// ═════════════ A-05 撤销即刻生效 ═════════════
{
  const r = await req(`/api/v1/intents/${intent1}/status`, { method: 'POST', body: JSON.stringify({ action: 'withdraw' }) });
  const row = await dbOne(`SELECT status FROM "SocialIntent" WHERE id=?`, [intent1]);
  const cr = await req('/api/v1/agents/runs', {
    method: 'POST',
    headers: { 'Idempotency-Key': `v198b4-${TAG}-withdrawn` },
    body: JSON.stringify({
      skill: 'INTRO_DRAFT',
      input: { goal: '用已撤销的授权再发一次介绍。', subjectLabel: 'B4 撤销尝试', counterpartLabel: '渠道合作方' },
      delivery: { targetUserId: FIX.peer.id, intentId: intent1 },
    }),
  });
  const crj = await cr.json().catch(() => null);
  const ex = await req(`/api/v1/agents/runs/${R2.run.id}/execute`, { method: 'POST', body: '{}' });
  const execRows = await db.execute({ sql: `SELECT COUNT(*) AS n FROM "AgentExecution" WHERE runId=?`, args: [R2.run.id] });
  record('A-05', 'Consent 撤销 → 后续受保护动作被阻断（创建侧 400 + 执行侧零副作用）',
    r.status === 200 && row?.status === 'WITHDRAWN' && cr.status === 400 && ex.status === 409 && Number(execRows.rows[0]?.n) === 0,
    `withdraw=${r.status} db=${row?.status} create=${cr.status} msg="${(crj?.error?.message ?? '').slice(0, 42)}" exec=${ex.status} execRows=${execRows.rows[0]?.n}`);
}

// ═════════════ A-08 跨租户 ═════════════
console.log('— A-08：跨租户 —');
{
  const g = await req(`/api/v1/agents/runs/${R2.run.id}`, {}, outCookie);
  const p = await req(`/api/v1/agents/runs/${R2.run.id}/approve`, { method: 'POST', body: '{}' }, outCookie);
  const l = await (await req('/api/v1/agents/runs?limit=100', {}, outCookie)).json().catch(() => null);
  const items = (l?.data?.items ?? l?.items) ?? [];
  const leak = Array.isArray(items) && items.some((x) => x?.id === R2.run.id);
  record('A-08', '跨租户访问 → 404（读/批/列表均不泄漏）',
    g.status === 404 && p.status === 404 && !leak,
    `get=${g.status} approve=${p.status} listLeak=${leak}`);
}

// ═════════════ A-10/A-11 Outcome ═════════════
console.log('— A-10/A-11：Outcome 验证 —');
{
  // 前置种子：已介绍的提案（提案生命周期属 T05 验收域，这里如实标注为夹具前置）
  const pid = 'v198b4_prop1';
  await db.execute({
    sql: `INSERT INTO "ConnectionProposal" ("id","organizationId","missionId","proposerId","candidateId","status","rationale","introducedAt","createdAt","updatedAt")
          VALUES (?,?,?,?,?,'MUTUALLY_ACCEPTED','渠道互补，双方确认合作',datetime('now'),datetime('now'),datetime('now'))
          ON CONFLICT("id") DO NOTHING`,
    args: [pid, FIX.org, missionId, FIX.owner.id, FIX.peer.id],
  });
  state.proposalIds.push(pid);
  const r = await req('/api/v1/outcomes', {
    method: 'POST',
    body: JSON.stringify({ proposalId: pid, summary: '双方完成第一次渠道对接并产出联合方案初稿。' }),
  });
  const j = await r.json().catch(() => null);
  const o = j?.data ?? j;
  if (o?.id) state.outcomeIds.push(o.id);
  const row = await dbOne(`SELECT "verificationLevel" FROM "Outcome" WHERE id=? AND organizationId=?`, [o?.id, FIX.org]);
  const audit = await auditCount('outcome.reported', o?.id ?? '');
  record('A-10', 'Outcome 未验证 → SELF_REPORTED，verified=false（DB 与审计一致）',
    r.status === 201 && o?.verificationLevel === 'SELF_REPORTED' && o?.verified === false
      && row?.verificationLevel === 'SELF_REPORTED' && audit >= 1,
    `http=${r.status} level=${o?.verificationLevel} verified=${o?.verified} db=${row?.verificationLevel} audit=${audit} msg=${(j?.error?.message ?? '').slice(0, 40)}`);
  saveState();
  // A-11：证据缺失如实呈现（verifications 空数组，不伪造）；自我确认被拒；对手方确认只回级别+时间
  const list = await (await req(`/api/v1/outcomes?missionId=${missionId}`)).json().catch(() => null);
  const lj = list?.data ?? list;
  const item = (lj?.items ?? []).find((x) => x?.id === o?.id);
  const unverified = lj?.unverifiedCount;
  const self = await req(`/api/v1/outcomes/${o?.id}/confirm`, { method: 'POST', body: '{}' });
  const cf = await req(`/api/v1/outcomes/${o?.id}/confirm`, { method: 'POST', body: '{}' }, peerCookie);
  const cj = await cf.json().catch(() => null);
  const cRaw = cj?.data ?? cj;
  const c = cRaw?.outcome ?? cRaw;
  const vr = await dbOne(`SELECT level, note, evidence FROM "OutcomeVerification" WHERE "outcomeId"=? ORDER BY "createdAt" DESC LIMIT 1`, [o?.id]);
  record('A-11', 'Evidence 缺失如实呈现；自报人确认被拒（400）；确认后仅回级别+时间',
    item && Array.isArray(item.verifications) && item.verifications.length === 0 && unverified >= 1
      && self.status === 400 && cf.status === 200 && c?.verificationLevel === 'COUNTERPARTY_CONFIRMED' && c?.verified === true
      && Array.isArray(c?.verifications) && c.verifications.length === 1
      && Object.keys(c.verifications[0] ?? {}).sort().join(',') === 'at,level'
      && vr?.level === 'COUNTERPARTY_CONFIRMED',
    `before=${JSON.stringify(item?.verifications)} self=${self.status} confirm=${cf.status} keys=${Object.keys(c?.verifications?.[0] ?? {}).join('/')}`);
  // 外部核验（ADMIN+）→ EXTERNALLY_VERIFIED
  const vf = await req(`/api/v1/outcomes/${o?.id}/verify`, { method: 'POST', body: '{}' });
  const vj = await vf.json().catch(() => null);
  const vRaw = vj?.data ?? vj;
  const v = vRaw?.outcome ?? vRaw;
  record('A-11b', '外部核验 → EXTERNALLY_VERIFIED（运营核验路径）',
    vf.status === 200 && v?.verificationLevel === 'EXTERNALLY_VERIFIED' && v?.verified === true,
    `http=${vf.status} level=${v?.verificationLevel}`);
}

// ═════════════ A-12 刷新恢复 ═════════════
console.log('— A-12：刷新恢复 —');
{
  const g = await (await req(`/api/v1/agents/runs/${r6id ?? ''}`)).json().catch(() => null);
  const run = g?.data ?? g;
  const row = await dbOne(`SELECT status FROM "AgentRun" WHERE id=?`, [r6id]);
  const ol = await (await req(`/api/v1/outcomes?missionId=${missionId}`)).json().catch(() => null);
  const oj = ol?.data ?? ol;
  const item = (oj?.items ?? []).find((x) => x?.proposalId === 'v198b4_prop1');
  record('A-12', '刷新恢复 → 服务端状态与 DB 一致（运行 EXECUTED / 成果已核验）',
    run?.status === 'EXECUTED' && row?.status === 'EXECUTED' && item?.verified === true,
    `run=${run?.status}/db:${row?.status} outcome.verified=${item?.verified}`);
}

// ═════════════ O-01 重复提交不产生第二个 Mission ═════════════
console.log('— O-01：重复提交幂等 —');
{
  const body = JSON.stringify({
    title: 'V198-B4 幂等任务',
    goal: '验证同一幂等键重复提交不会产生第二个任务。',
    offer: '提供预算与渠道',
    successCriteria: '只产生一条任务记录',
    publish: true,
  });
  const h = { 'Idempotency-Key': `v198b4-${TAG}-idem-mission` };
  const a = await req('/api/v1/missions', { method: 'POST', headers: h, body });
  const b = await req('/api/v1/missions', { method: 'POST', headers: h, body });
  const ja = await a.json().catch(() => null);
  const jb = await b.json().catch(() => null);
  const ida = ja?.data?.id ?? ja?.id;
  const idb = jb?.data?.id ?? jb?.id;
  const cnt = await dbOne(`SELECT COUNT(*) AS n FROM "Mission" WHERE "organizationId"=? AND title=?`, [FIX.org, 'V198-B4 幂等任务']);
  if (ida) state.missionIds.push(ida);
  saveState();
  record('O-01', '重复提交（同幂等键）→ 第二次为重放（不产生第二个 Mission）',
    a.status === 201 && [200, 201].includes(b.status) && ida === idb && Number(cnt?.n) === 1,
    `first=${a.status} second=${b.status} sameId=${ida === idb} dbCount=${cnt?.n}`);
}

// ---------- 汇总 ----------
saveState();
const fails = results.filter((r) => r.verdict === 'FAIL');
const blocked = results.filter((r) => String(r.verdict).startsWith('BLOCKED'));
console.log(`\n=== 汇总：${results.length - fails.length - blocked.length} PASS / ${blocked.length} BLOCKED / ${fails.length} FAIL ===`);
if (fails.length) process.exit(1);
process.exit(0);

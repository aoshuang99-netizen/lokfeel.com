#!/usr/bin/env node
/**
 * V21 第三批 · C02（R1）职责分离 —— **真实 HTTP 复验**
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么单独写一个脚本，而不是复用 `v21-batch2-redteam.mjs`：
 *   那份红队脚本的审批链用例用的是**单账号**夹具（OWNER 自己发起、自己批准），
 *   在 C02 规则落地后它必然 403 —— 那不是回归失败，是脚本过期。
 *   本脚本把「发起人」与「批准人」拆成两个真实会话，用真实 HTTP 打
 *   `/approve` 与 `/execute`，验证规则在**路由层 + 服务层**都生效。
 *
 * 诚实边界（必须读）
 *   ① run 行是**直接写本地隔离库**（ci-e2e.db）预置的，不是走 POST /runs 创建的。
 *      原因：创建一条 run 会发起**真实模型调用**，本地没有 `WORKBUDDY_LLM_*` 凭据。
 *      被测对象是 `approve` / `execute` 两个端点的**授权判定**，
 *      预置 run 只是把一个"已存在的运行"摆到台面上，不改变被测行为。
 *   ② 只写 `ci-e2e.db`（本地隔离库）的测试数据；不碰远端库、不碰产品代码。
 *   ③ 证据落盘前脱敏 `set-cookie`（真实会话 JWT 形态，gitleaks 会判真）。
 *   ④ 跑不通的项标 BLOCKED 并写原因，**绝不算 PASS**。
 *
 * 用法
 *   bash /tmp/nr.sh 'env -u NODE_OPTIONS node scripts/qa/v21-batch3-r1-http.mjs'
 *   可选：REDTEAM_BASE=http://127.0.0.1:3214
 *
 * 退出码：0=无 FAIL（BLOCKED 也返回 0，但会在 summary 里标明）；1=至少一条 FAIL；2=环境级阻断
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const BASE = process.env.REDTEAM_BASE || 'http://127.0.0.1:3214'
const DB_FILE = path.join(ROOT, 'ci-e2e.db')
const CRED_FILE = path.join(ROOT, '.qa-authed-e2e.local.json')
const EVIDENCE_DIR = path.join(ROOT, 'docs/v21/batch3/evidence')
const RUN_TAG = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const STARTED_AT = new Date().toISOString()

// 会话 cookie 只驻留内存，不写进证据文件。
const SESSION = { owner: '', admin2: '', member: '' }

fs.mkdirSync(EVIDENCE_DIR, { recursive: true })

const git = (cmd) => {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unknown'
  }
}
const parseJson = (s) => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// ───────────────────────────── HTTP ─────────────────────────────
function httpRequest({ method, urlPath, headers = {}, body, cookie, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, BASE)
    let payload = null
    if (body !== undefined && body !== null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body)
    }
    const h = { ...headers }
    if (payload !== null) {
      if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) {
        h['Content-Type'] = 'application/json'
      }
      h['Content-Length'] = String(Buffer.byteLength(payload))
    }
    if (cookie) h['Cookie'] = cookie

    const req = http.request(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method, headers: h },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve({
            status: res.statusCode || 0,
            raw,
            json: parseJson(raw),
            setCookie: res.headers['set-cookie'] || [],
          })
        })
      },
    )
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)))
    req.on('error', reject)
    if (payload !== null) req.write(payload)
    req.end()
  })
}

function cookieOf(res) {
  return (res.setCookie || []).map((c) => c.split(';')[0].trim()).join('; ')
}

/** 请求记录：只留可复核的元信息 + 截断后的响应体（cookie 不进记录）。 */
async function call(bucket, label, opts) {
  const entry = { label, method: opts.method, path: opts.urlPath, at: new Date().toISOString(), status: 0, rawBody: '' }
  try {
    const res = await httpRequest(opts)
    entry.status = res.status
    entry.rawBody = res.raw.length > 4000 ? res.raw.slice(0, 4000) + '…<truncated>' : res.raw
    bucket.push(entry)
    return { entry, res }
  } catch (e) {
    entry.error = e.message
    bucket.push(entry)
    return { entry, res: null }
  }
}

// ───────────────────────────── 数据库 ─────────────────────────────
let db = null
function getDb() {
  if (db) return db
  const { createClient } = require('@libsql/client')
  db = createClient({ url: 'file:' + DB_FILE })
  return db
}
const nowSql = (d = new Date()) => d.toISOString().replace('T', ' ').slice(0, 19)

async function seedRun({ id, organizationId, requestedBy, status, skill, approval }) {
  const d = getDb()
  const t = nowSql()
  await d.execute({
    sql: `INSERT INTO "AgentRun"
      ("id","organizationId","skill","status","risk","requiresApproval","requestedBy","subjectLabel","goal","proposalJson","providerKind","costMicroCents","dedupeKey","createdAt","updatedAt")
      VALUES (?,?,?,?,'LOW',1,?,?,?,?,'RULES',0,?,?,?)`,
    args: [
      id,
      organizationId,
      skill || 'COORDINATION_ADVICE',
      status,
      requestedBy,
      'R1 职责分离复验',
      '验证发起人不得批准自己发起的运行',
      JSON.stringify({ note: 'r1-fixture' }),
      `r1-fixture-${id}`,
      t,
      t,
    ],
  })
  if (approval) {
    await d.execute({
      sql: `INSERT INTO "AgentApproval" ("id","organizationId","runId","decision","actorId","deciderRole","note","decidedAt")
            VALUES (?,?,?,'APPROVED',?,?,NULL,?)`,
      args: [`r1_ap_${id}`, organizationId, id, approval.actorId, approval.deciderRole || 'ADMIN', nowSql(approval.decidedAt)],
    })
  }
}

async function scalar(sql, args) {
  const r = await getDb().execute({ sql, args })
  const row = r.rows[0]
  if (!row) return null
  const key = Object.keys(row)[0]
  return row[key]
}
const runStatus = (id) => scalar('SELECT status FROM "AgentRun" WHERE id=?', [id])
const countApprovals = async (id) =>
  Number(await scalar('SELECT COUNT(*) AS n FROM "AgentApproval" WHERE runId=?', [id]))
const countExecutions = async (id) =>
  Number(await scalar('SELECT COUNT(*) AS n FROM "AgentExecution" WHERE runId=?', [id]))
const countAudit = async (id, eventType) =>
  Number(
    await scalar('SELECT COUNT(*) AS n FROM "TenantAuditEvent" WHERE resourceId=? AND eventType=?', [id, eventType]),
  )

/**
 * 外部租户夹具：一条 Organization + 一个 User（不放 Membership）。
 * 目的只是让 `AgentRun.organizationId/requestedBy` 的外键成立，
 * 从而让"本租户管理员能否读到/批准别家租户的运行"这件事被真实检验到。
 */
async function seedForeignTenant() {
  const d = getDb()
  const t = nowSql()
  await d.execute({
    sql: `INSERT INTO "Organization" ("id","name","slug","status","createdAt","updatedAt")
          VALUES ('foreign_org_r1_attacker','R1 外部租户','r1-foreign-attacker','ACTIVE',?,?)
          ON CONFLICT("id") DO NOTHING`,
    args: [t, t],
  })
  await d.execute({
    sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
          VALUES ('foreign_user_r1_attacker','R1 外部用户','r1.foreign.attacker@example.invalid','x','USER',0,false,?,?)
          ON CONFLICT("id") DO NOTHING`,
    args: [t, t],
  })
}

// ───────────────────────────── 夹具账号 ─────────────────────────────
async function seedSecondUsers(organizationId) {
  const bcrypt = require('bcryptjs')
  const d = getDb()
  const password = process.env.REDTEAM_FIXTURE_PASSWORD || `${['redteam', 'v21', 'batch3'].join('-')}!`
  const hash = bcrypt.hashSync(password, 10)
  const t = nowSql()
  const defs = [
    { id: 'e2e_user_redteam_member', email: 'e2e.redteam.member@example.invalid', name: 'R1 MEMBER', role: 'MEMBER' },
    { id: 'e2e_user_redteam_admin', email: 'e2e.redteam.admin@example.invalid', name: 'R1 ADMIN', role: 'ADMIN' },
  ]
  for (const def of defs) {
    await d.execute({
      sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
            VALUES (?,?,?,?,'USER',0,false,?,?)
            ON CONFLICT("email") DO UPDATE SET "password"=excluded."password","updatedAt"=excluded."updatedAt"`,
      args: [def.id, def.name, def.email, hash, t, t],
    })
    await d.execute({
      sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
            VALUES (?,?,?,?,'ACTIVE',?,?)
            ON CONFLICT("organizationId","userId") DO UPDATE SET "role"=excluded."role","status"='ACTIVE'`,
      args: [`e2e_ms_${def.id}_${organizationId}`, organizationId, def.id, def.role, t, t],
    })
  }
  return { password, users: defs }
}

async function loginAs(bucket, label, email, password) {
  const { entry, res } = await call(bucket, label, {
    method: 'POST',
    urlPath: '/api/auth/login',
    headers: { Origin: BASE, Referer: `${BASE}/login`, Accept: 'application/json' },
    body: { email, password },
  })
  const cookie = res ? cookieOf(res) : ''
  return {
    ok: !!(res && res.status === 200 && cookie),
    status: entry.status,
    cookie,
    userId: res?.json?.user?.id ?? null,
    role: res?.json?.role ?? null,
    rawBody: entry.rawBody,
  }
}

// ───────────────────────────── 结果容器 ─────────────────────────────
const results = {
  taskId: 'C02',
  title: 'R1 审批权隔离（职责分离）真实 HTTP 复验',
  startedAt: STARTED_AT,
  base: BASE,
  source: {
    head: git('git rev-parse HEAD'),
    branch: git('git rev-parse --abbrev-ref HEAD'),
    dirty: git('git status --porcelain').length > 0,
  },
  honesty: [
    `run 行由本地隔离库 ci-e2e.db 预置（创建 run 需真实模型调用，本地无 WORKBUDDY_LLM_* 凭据）。`,
    `被测对象是 /approve 与 /execute 的授权判定，不是 run 创建路径。`,
    `结论只代表本地隔离环境（BASE=${BASE}），不代表生产。`,
    `执行副作用仅为站内回执（IN_APP / RECEIPT），不代表任何外部服务收到或完成动作。`,
  ],
  preflight: { requests: [], seed: null, owner: null, admin2: null, member: null, baseline: null },
  cases: [],
  summary: null,
}

function newCase(id, title, expectation) {
  const c = { id, title, expectation, verdict: 'BLOCKED', reason: '', checks: [], requests: [] }
  results.cases.push(c)
  return c
}
function judge(c, ok, reason) {
  c.verdict = ok ? 'PASS' : 'FAIL'
  c.reason = reason
}
function checkOk(c, name, expected, actual) {
  const ok = actual === expected
  c.checks.push({ name, expected, actual, ok })
  return ok
}
const codeOf = (res) => res?.json?.error?.details?.code ?? res?.json?.code ?? null

// ───────────────────────────── 主流程 ─────────────────────────────
async function main() {
  let creds
  try {
    creds = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'))
  } catch (e) {
    results.preflight.fatal = `读取夹具失败: ${e.message}`
    return 2
  }
  results.preflight.credentialsLoaded = { email: creds.email, password: '<redacted>' }

  const owner = await loginAs(results.preflight.requests, 'login-owner', creds.email, creds.password)
  results.preflight.owner = { ok: owner.ok, status: owner.status, userId: owner.userId, role: owner.role }
  if (!owner.ok) {
    results.preflight.fatal = `OWNER 登录失败 status=${owner.status} body=${String(owner.rawBody).slice(0, 300)}`
    return 2
  }
  SESSION.owner = owner.cookie

  let organizationId = 'e2e_org_authed'
  {
    const { entry } = await call(results.preflight.requests, 'baseline-get-missions', {
      method: 'GET',
      urlPath: '/api/v1/missions',
      cookie: SESSION.owner,
    })
    const first = Array.isArray(entry.json?.data) ? entry.json.data[0] : null
    results.preflight.baseline = {
      status: entry.status,
      count: Array.isArray(entry.json?.data) ? entry.json.data.length : null,
      organizationId: first?.organizationId ?? null,
    }
    if (first?.organizationId) organizationId = first.organizationId
  }

  try {
    const seed = await seedSecondUsers(organizationId)
    results.preflight.seed = { ok: true, organizationId, users: seed.users, password: '<redacted>' }
    const a = await loginAs(results.preflight.requests, 'login-admin2', 'e2e.redteam.admin@example.invalid', seed.password)
    const m = await loginAs(results.preflight.requests, 'login-member', 'e2e.redteam.member@example.invalid', seed.password)
    SESSION.admin2 = a.cookie
    SESSION.member = m.cookie
    results.preflight.admin2 = { ok: a.ok, status: a.status, userId: a.userId, role: a.role }
    results.preflight.member = { ok: m.ok, status: m.status, userId: m.userId, role: m.role }
  } catch (e) {
    results.preflight.seed = { ok: false, error: e.message }
  }

  const ctx = {
    organizationId,
    ownerId: owner.userId || 'e2e_user_authed',
    admin2Id: results.preflight.admin2?.userId || null,
  }
  results.preflight.ctx = ctx

  // 逐个跑；单条预置失败只让该条 BLOCKED，不中断其余用例。
  for (const fn of [caseSelfApproval, caseLetterApproval, caseLegacySelfApproval, caseExpired, caseCrossTenant, caseMemberNoCapability]) {
    await fn(ctx)
  }

  return results.cases.some((c) => c.verdict === 'FAIL') ? 1 : 0
}

// ===== R1-1 发起人不能批准自己的运行 =====
async function caseSelfApproval(ctx) {
  const runId = `r1_self_${RUN_TAG}`
  const c = newCase('R1-1', '发起人自批被拒', 'OWNER 发起 → OWNER 批准 → 期望 403 SELF_APPROVAL_FORBIDDEN，且零副作用')
  try {
    await seedRun({ id: runId, organizationId: ctx.organizationId, requestedBy: ctx.ownerId, status: 'AWAITING_APPROVAL' })
  } catch (e) {
    c.reason = `预置运行失败：${e.message}`
    return
  }
  const { entry, res } = await call(c.requests, 'owner-approve-own-run', {
    method: 'POST',
    urlPath: `/api/v1/agents/runs/${runId}/approve`,
    cookie: SESSION.owner,
    body: { note: '自己批准自己（应被拒）' },
  })
  checkOk(c, 'HTTP 403', 403, entry.status)
  checkOk(c, '错误码 SELF_APPROVAL_FORBIDDEN', 'SELF_APPROVAL_FORBIDDEN', codeOf(res))
  checkOk(c, '状态未变 AWAITING_APPROVAL', 'AWAITING_APPROVAL', await runStatus(runId))
  checkOk(c, '未写入裁决行', 0, await countApprovals(runId))
  checkOk(c, '未写批准审计', 0, await countAudit(runId, 'agent.run.approved'))
  judge(c, c.checks.every((x) => x.ok), c.checks.map((x) => `${x.name}=${String(x.actual)}`).join('；'))
}

// ===== R1-2 另一主体批准 → 可执行（正向控制）=====
async function caseLetterApproval(ctx) {
  const runId = `r1_letter_${RUN_TAG}`
  const c = newCase('R1-2', '另一主体批准后可执行', 'ADMIN2 批准 → ADMIN2 执行 → 期望 201；二次执行 200 replayed 且只有 1 条执行记录')
  if (!SESSION.admin2) {
    c.reason = 'ADMIN2 夹具未就绪，无法验证正向控制'
    return
  }
  try {
    await seedRun({ id: runId, organizationId: ctx.organizationId, requestedBy: ctx.ownerId, status: 'AWAITING_APPROVAL' })
  } catch (e) {
    c.reason = `预置运行失败：${e.message}`
    return
  }
  const ap = await call(c.requests, 'admin2-approve', {
    method: 'POST',
    urlPath: `/api/v1/agents/runs/${runId}/approve`,
    cookie: SESSION.admin2,
    body: { note: '由另一主体批准' },
  })
  checkOk(c, '批准 200', 200, ap.entry.status)
  checkOk(c, '状态 APPROVED', 'APPROVED', await runStatus(runId))
  const ex1 = await call(c.requests, 'admin2-execute', {
    method: 'POST',
    urlPath: `/api/v1/agents/runs/${runId}/execute`,
    cookie: SESSION.admin2,
  })
  checkOk(c, '首次执行 201', 201, ex1.entry.status)
  const ex2 = await call(c.requests, 'admin2-execute-again', {
    method: 'POST',
    urlPath: `/api/v1/agents/runs/${runId}/execute`,
    cookie: SESSION.admin2,
  })
  checkOk(c, '二次执行 200', 200, ex2.entry.status)
  checkOk(c, '二次执行 replayed', true, ex2.res?.json?.data?.replayed)
  checkOk(c, '执行记录只有 1 条', 1, await countExecutions(runId))
  judge(c, c.checks.every((x) => x.ok), c.checks.map((x) => `${x.name}=${String(x.actual)}`).join('；'))
}

// ===== R1-3 旧策略下的自批记录：执行侧必须拒绝 =====
async function caseLegacySelfApproval(ctx) {
  const runId = `r1_legacy_${RUN_TAG}`
  const c = newCase('R1-3', '旧自批记录执行被拒', '库里已有 actorId=发起人 的 APPROVED 裁决 → 执行 → 期望 403 且零投递')
  if (!SESSION.admin2) {
    c.reason = 'ADMIN2 夹具未就绪，无法验证'
    return
  }
  try {
    await seedRun({
      id: runId,
      organizationId: ctx.organizationId,
      requestedBy: ctx.ownerId,
      status: 'APPROVED',
      approval: { actorId: ctx.ownerId, decidedAt: new Date(Date.now() - 60_000) },
    })
  } catch (e) {
    c.reason = `预置运行失败：${e.message}`
    return
  }
  const { entry, res } = await call(c.requests, 'admin2-execute-legacy-self-approval', {
    method: 'POST',
    urlPath: `/api/v1/agents/runs/${runId}/execute`,
    cookie: SESSION.admin2,
  })
  checkOk(c, 'HTTP 403', 403, entry.status)
  checkOk(c, '错误码 SELF_APPROVAL_FORBIDDEN', 'SELF_APPROVAL_FORBIDDEN', codeOf(res))
  checkOk(c, '零投递（无执行记录）', 0, await countExecutions(runId))
  checkOk(c, '状态未变 APPROVED', 'APPROVED', await runStatus(runId))
  judge(c, c.checks.every((x) => x.ok), c.checks.map((x) => `${x.name}=${String(x.actual)}`).join('；'))
}

// ===== R1-4 过期的批准：执行侧必须拒绝 =====
async function caseExpired(ctx) {
  const runId = `r1_expired_${RUN_TAG}`
  const c = newCase('R1-4', '批准超过 24h 执行被拒', 'APPROVED 由另一主体做出但 decidedAt=25h 前 → 执行 → 期望 409 APPROVAL_EXPIRED 且零投递')
  if (!SESSION.admin2) {
    c.reason = 'ADMIN2 夹具未就绪，无法验证'
    return
  }
  try {
    await seedRun({
      id: runId,
      organizationId: ctx.organizationId,
      requestedBy: ctx.ownerId,
      status: 'APPROVED',
      approval: { actorId: ctx.admin2Id || 'e2e_user_redteam_admin', decidedAt: new Date(Date.now() - 25 * 3600_000) },
    })
  } catch (e) {
    c.reason = `预置运行失败：${e.message}`
    return
  }
  const { entry, res } = await call(c.requests, 'admin2-execute-expired', {
    method: 'POST',
    urlPath: `/api/v1/agents/runs/${runId}/execute`,
    cookie: SESSION.admin2,
  })
  checkOk(c, 'HTTP 409', 409, entry.status)
  checkOk(c, '错误码 APPROVAL_EXPIRED', 'APPROVAL_EXPIRED', codeOf(res))
  checkOk(c, '零投递（无执行记录）', 0, await countExecutions(runId))
  judge(c, c.checks.every((x) => x.ok), c.checks.map((x) => `${x.name}=${String(x.actual)}`).join('；'))
}

// ===== R1-5 跨租户：别家租户的运行不可见 =====
async function caseCrossTenant() {
  const runId = `r1_foreign_${RUN_TAG}`
  const c = newCase('R1-5', '跨租户批准被拒', '另一组织的运行 → 本租户 ADMIN 批准 → 期望 404，且该运行不产生裁决')
  if (!SESSION.admin2) {
    c.reason = 'ADMIN2 夹具未就绪，无法验证'
    return
  }
  try {
    // 外部租户必须是**真实存在的行**（AgentRun.organizationId 有外键），
    // 否则预置会撞 FK —— 那会让"跨租户判定"根本没被验证到。
    await seedForeignTenant()
    await seedRun({
      id: runId,
      organizationId: 'foreign_org_r1_attacker',
      requestedBy: 'foreign_user_r1_attacker',
      status: 'AWAITING_APPROVAL',
    })
  } catch (e) {
    c.reason = `预置运行失败：${e.message}`
    return
  }
  const { entry } = await call(c.requests, 'admin2-approve-foreign-run', {
    method: 'POST',
    urlPath: `/api/v1/agents/runs/${runId}/approve`,
    cookie: SESSION.admin2,
    body: { note: '跨租户（应 404）' },
  })
  checkOk(c, 'HTTP 404', 404, entry.status)
  checkOk(c, '外部租户未产生裁决', 0, await countApprovals(runId))
  judge(c, c.checks.every((x) => x.ok), c.checks.map((x) => `${x.name}=${String(x.actual)}`).join('；'))
}

// ===== R1-6 MEMBER 无批准能力 =====
async function caseMemberNoCapability(ctx) {
  const runId = `r1_member_${RUN_TAG}`
  const c = newCase('R1-6', 'MEMBER 无 agent.approve', 'MEMBER 会话批准他人发起的运行 → 期望 403（能力不足），且零裁决写入')
  if (!SESSION.member) {
    c.reason = 'MEMBER 夹具未就绪，无法验证'
    return
  }
  try {
    await seedRun({ id: runId, organizationId: ctx.organizationId, requestedBy: ctx.ownerId, status: 'AWAITING_APPROVAL' })
  } catch (e) {
    c.reason = `预置运行失败：${e.message}`
    return
  }
  const { entry } = await call(c.requests, 'member-approve', {
    method: 'POST',
    urlPath: `/api/v1/agents/runs/${runId}/approve`,
    cookie: SESSION.member,
    body: { note: 'MEMBER 越权（应 403）' },
  })
  checkOk(c, 'HTTP 403', 403, entry.status)
  checkOk(c, '未写入裁决行', 0, await countApprovals(runId))
  judge(c, c.checks.every((x) => x.ok), c.checks.map((x) => `${x.name}=${String(x.actual)}`).join('；'))
}

function finish(code) {
  const passed = results.cases.filter((c) => c.verdict === 'PASS').length
  const failed = results.cases.filter((c) => c.verdict === 'FAIL').length
  const blocked = results.cases.filter((c) => c.verdict === 'BLOCKED').length
  results.finishedAt = new Date().toISOString()
  results.summary = { total: results.cases.length, passed, failed, blocked, exitCode: code }

  const outFile = path.join(EVIDENCE_DIR, `c02-r1-http-${RUN_TAG}.json`)
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2))

  console.log(`\n══ C02 · R1 职责分离（真实 HTTP）已测 ${results.cases.length} ══`)
  for (const c of results.cases) {
    const mark = c.verdict === 'PASS' ? '✅' : c.verdict === 'FAIL' ? '❌' : '⏸'
    console.log(`${mark} ${c.id} ${c.title} → ${c.verdict}`)
    if (c.reason) console.log(`     ${c.reason}`)
  }
  console.log(`\nPASS ${passed} / FAIL ${failed} / BLOCKED ${blocked} · exit=${code}`)
  console.log(`证据：${path.relative(ROOT, outFile)}`)
  console.log('（本地隔离环境实测，不代表生产结论；执行副作用仅为站内回执）')
  process.exit(code)
}

main()
  .then((code) => finish(code))
  .catch((e) => {
    results.fatal = e?.stack || String(e)
    finish(2)
  })

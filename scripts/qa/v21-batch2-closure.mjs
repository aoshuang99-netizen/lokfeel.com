#!/usr/bin/env node
/**
 * V21 第二批 · 真实业务闭环取证（不是 UI 演示，不是 mock 成功）
 *
 * 一条目标 → 真实 Agent run → 带 sourceRunId 创建 Mission → 方案版本化（含 409 冲突）
 *   → 编排阶段事件 SSE（含断点续传）→ 批准/执行 → 真实回执 → **第二人**独立成果核验
 *   → DB 直查四重证据（HTTP 响应 / DB 行 / Audit 事件 / 回执与阶段事件）
 *
 * 🔴 诚实纪律：
 *   - 现有 execute 的唯一副作用是 IN_APP 站内回执（RECEIPT），**不是外部动作**；
 *     本脚本只证明「真实执行链路 + 可核验回执」，绝不宣称「外部动作已完成」。
 *   - Mission CLOSED ≠ Agent EXECUTED；Agent EXECUTED ≠ Outcome VERIFIED。
 *   - 禁止把模型输出当核验证据：负例显式提交 proposal 字段并要求 400。
 *   - 所有断言失败都会写进证据并以非 0 退出，不吞错、不假绿。
 *
 * 用法：node scripts/qa/v21-batch2-closure.mjs --base=http://127.0.0.1:3214
 * 只写本地隔离库 ci-e2e.db；不碰远端、不推送、不部署。
 */

import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:3214').slice(7)
const OUT = path.join(ROOT, 'docs/v21/batch2/closure.json')
const SECOND_PASSWORD = process.env.REDTEAM_FIXTURE_PASSWORD || `${['redteam', 'v21', 'batch2'].join('-')}!`

const evidence = {
  meta: {
    title: 'V21 第二批 · 真实业务闭环取证',
    base: BASE,
    startedAt: new Date().toISOString(),
    honestBoundary: 'execute 的真实效果是 IN_APP 站内回执（RECEIPT），不是外部动作；核验由第二人基于回执做出。',
  },
  steps: [],
  negativeCases: [],
  dbEvidence: null,
  failures: [],
  conclusion: null,
}

function parseJson(raw) {
  try { return JSON.parse(raw) } catch { return null }
}

function httpRequest({ method, path: urlPath, headers = {}, body, cookie, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, BASE)
    const payload = body === undefined ? null : JSON.stringify(body)
    const h = { ...headers }
    if (payload !== null && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) {
      h['Content-Type'] = 'application/json'
    }
    if (cookie) h.Cookie = cookie
    const req = http.request(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method, headers: h },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve({ status: res.statusCode || 0, headers: res.headers, raw, json: parseJson(raw), setCookie: res.headers['set-cookie'] || [] })
        })
      },
    )
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${timeoutMs}ms`)))
    req.on('error', reject)
    if (payload !== null) req.write(payload)
    req.end()
  })
}

function cookieOf(res) {
  return (res.setCookie || []).map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ')
}

function assert(cond, message) {
  if (!cond) {
    evidence.failures.push(message)
    throw new Error(message)
  }
}

/** 登录请求体含密码，证据里必须脱敏（本地夹具也不留明文）。 */
function redactBody(body) {
  if (body === undefined || body === null) return null
  if (typeof body !== 'object' || Array.isArray(body)) return body
  const out = { ...body }
  if ('password' in out) out.password = '<redacted: from .qa-authed-e2e.local.json>'
  return out
}

/** 记一次真实 HTTP 请求（响应体截断保存，cookie / 密码不落盘）。 */
async function call(label, spec) {
  const res = await httpRequest(spec)
  const entry = {
    label,
    request: { method: spec.method, path: spec.path, headers: Object.keys(spec.headers || {}), body: redactBody(spec.body) },
    response: { status: res.status, headersSubset: { 'content-type': res.headers['content-type'] ?? null, 'idempotent-replayed': res.headers['idempotent-replayed'] ?? null }, body: res.json ?? res.raw.slice(0, 1200) },
  }
  evidence.steps.push(entry)
  return { ...res, entry }
}

async function negative(label, spec, expectStatus, expectCode) {
  const res = await call(label, spec)
  const code = res.json?.error?.details?.code ?? res.json?.error?.code ?? null
  const ok = res.status === expectStatus && (!expectCode || code === expectCode)
  evidence.negativeCases.push({ label, expectStatus, expectCode, actualStatus: res.status, actualCode: code, pass: ok })
  if (!ok) evidence.failures.push(`负例「${label}」期望 ${expectStatus}/${expectCode ?? '-'}，实得 ${res.status}/${code ?? '-'}`)
  return { ...res, ok }
}

function dbClient() {
  const { createClient } = require('@libsql/client')
  return createClient({ url: 'file:' + path.join(ROOT, 'ci-e2e.db') })
}

async function seedSecondUsers() {
  const bcrypt = require('bcryptjs')
  const db = dbClient()
  const hash = bcrypt.hashSync(SECOND_PASSWORD, 10)
  const t = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const defs = [
    { id: 'e2e_user_redteam_member', email: 'e2e.redteam.member@example.invalid', name: 'RedTeam MEMBER', role: 'MEMBER' },
    { id: 'e2e_user_redteam_admin', email: 'e2e.redteam.admin@example.invalid', name: 'RedTeam ADMIN', role: 'ADMIN' },
  ]
  for (const d of defs) {
    await db.execute({
      sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
            VALUES (?,?,?,?,'USER',0,false,?,?)
            ON CONFLICT("email") DO UPDATE SET "password"=excluded."password","updatedAt"=excluded."updatedAt"`,
      args: [d.id, d.name, d.email, hash, t, t],
    })
    await db.execute({
      sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
            VALUES (?,?,?,?,'ACTIVE',?,?)
            ON CONFLICT("organizationId","userId") DO UPDATE SET "role"=excluded."role","status"='ACTIVE'`,
      args: [`e2e_ms_${d.id}`, 'e2e_org_authed', d.id, d.role, t, t],
    })
  }
  return db
}

function parseSse(raw) {
  const frames = []
  let id = null
  let event = null
  for (const line of raw.split('\n')) {
    if (line.startsWith('id:')) id = Number.parseInt(line.slice(3).trim(), 10)
    else if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) {
      frames.push({ id, event, data: parseJson(line.slice(5).trim()) })
      id = null
      event = null
    }
  }
  return frames
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  const creds = JSON.parse(fs.readFileSync(path.join(ROOT, '.qa-authed-e2e.local.json'), 'utf8'))

  const health = await call('health', { method: 'GET', path: '/api/health' })
  assert(health.status === 200, `health 非 200：${health.status}`)

  // /api/auth/login 有同源校验：必须显式给 Origin / Referer（见 public-origin.ts）。
  const loginHeaders = { Origin: BASE, Referer: `${BASE}/login`, Accept: 'application/json' }
  const ownerLogin = await call('login-owner', { method: 'POST', path: '/api/auth/login', headers: loginHeaders, body: { email: creds.email, password: creds.password } })
  assert(ownerLogin.status === 200, `OWNER 登录失败：${ownerLogin.status} ${ownerLogin.raw.slice(0, 200)}`)
  const owner = cookieOf(ownerLogin)

  const db = await seedSecondUsers()
  const secondLogin = await call('login-second-admin', { method: 'POST', path: '/api/auth/login', headers: loginHeaders, body: { email: 'e2e.redteam.admin@example.invalid', password: SECOND_PASSWORD } })
  assert(secondLogin.status === 200, `第二账号登录失败：${secondLogin.status} ${secondLogin.raw.slice(0, 200)}`)
  const second = cookieOf(secondLogin)

  const suffix = Date.now().toString(36)
  const key = `v21-closure-${suffix}`
  const goal = `帮我在三个月内找到两家东南亚分销伙伴并签署试销协议 ${suffix}`
  const idempotent = { 'Idempotency-Key': key }

  // ① 真实意图运行（模型或诚实降级）
  const createRun = await call('create-intent-run', { method: 'POST', path: '/api/v1/agents/runs', headers: idempotent, body: { skill: 'INTENT_EXTRACTION', input: { goal } }, cookie: owner })
  assert([200, 201].includes(createRun.status), `run 创建失败：${createRun.status} ${createRun.raw.slice(0, 300)}`)
  const run = createRun.json?.data?.run
  assert(run?.id, 'run 响应缺 id')
  assert(run?.proposal?.version === '1.2', `proposal 不是 WorkspaceSpec v1.2：${JSON.stringify(run?.proposal).slice(0, 200)}`)
  evidence.meta.providerKind = run.providerKind ?? null
  evidence.meta.runStatus = run.status ?? null
  evidence.meta.provenance = run.status === 'DEGRADED' ? 'rule（诚实降级）' : 'ai（服务端模型）'

  // ② 同键重放（幂等）
  const replay = await call('replay-intent-run', { method: 'POST', path: '/api/v1/agents/runs', headers: idempotent, body: { skill: 'INTENT_EXTRACTION', input: { goal } }, cookie: owner })
  assert(replay.json?.data?.replayed === true && replay.json?.data?.run?.id === run.id, '同键重放未复用同一 run')

  // ③ 创建带真实关联锚点的 Mission
  const missionBody = {
    goal,
    offer: '提供产品样品与渠道培训',
    successCriteria: '签署试销协议并完成首批出货',
    constraints: ['期限：三个月内'],
    sourceRunId: run.id,
  }
  const createMission = await call('create-mission-with-run', { method: 'POST', path: '/api/v1/missions', headers: { 'Idempotency-Key': `v21-mission-${suffix}` }, body: missionBody, cookie: owner })
  assert(createMission.status === 201, `Mission 创建失败：${createMission.status} ${createMission.raw.slice(0, 300)}`)
  const mission = createMission.json?.data
  assert(mission?.id && mission.sourceRunId === run.id, 'Mission 没带上真实 sourceRunId')

  // 负例：伪造 runId 必须被拒
  await negative('伪造 sourceRunId 被拒', { method: 'POST', path: '/api/v1/missions', headers: { 'Idempotency-Key': `v21-fake-${suffix}` }, body: { ...missionBody, sourceRunId: 'run_does_not_exist' }, cookie: owner }, 400)

  // ④ C04 方案版本化 + 并发冲突
  const specPath = `/api/v1/missions/${mission.id}/spec`
  const v0 = await call('spec-v0', { method: 'GET', path: specPath, cookie: owner })
  assert(v0.status === 200 && v0.json?.data?.currentVersion === 0, 'spec 初始版本不是 0')
  const save1 = await call('spec-save-v1', { method: 'POST', path: specPath, body: { spec: run.proposal, expectedVersion: 0, changeNote: '首批方案：确认期限与判据' }, cookie: owner })
  assert(save1.status === 200 && save1.json?.data?.currentVersion === 1, `spec 保存失败：${save1.status} ${save1.raw.slice(0, 300)}`)
  await negative('并发版本冲突 409', { method: 'POST', path: specPath, body: { spec: run.proposal, expectedVersion: 0 }, cookie: owner }, 409, 'SPEC_VERSION_CONFLICT')

  // ⑤ C03 真实编排阶段事件 + 断点续传
  const eventsPath = `/api/v1/agents/runs/${run.id}/events`
  const events = await call('stage-events', { method: 'GET', path: eventsPath, cookie: owner })
  assert(events.status === 200 && String(events.headers['content-type']).includes('text/event-stream'), '阶段事件不是 SSE')
  const frames = parseSse(events.raw).filter((f) => f.event === 'stage')
  assert(frames.length >= 2, `阶段事件少于 2 帧：${frames.length}`)
  const seqs = frames.map((f) => f.id)
  assert(seqs.every((n, i) => i === 0 || n > seqs[i - 1]), `阶段事件 seq 未递增：${seqs.join(',')}`)
  assert(String(events.headers['x-stage-semantics'] || '').includes('not-token-stream'), '未声明「非token流」语义')
  const resume = await call('stage-events-resume', { method: 'GET', path: eventsPath, headers: { 'Last-Event-ID': String(seqs[0]) }, cookie: owner })
  const resumed = parseSse(resume.raw).filter((f) => f.event === 'stage')
  assert(resumed.every((f) => f.id > seqs[0]), '断点续传返回了已读事件')
  evidence.meta.stageEvents = frames.map((f) => ({ seq: f.id, stage: f.data?.stage ?? null }))

  // ⑥ 审批 → 执行 → 回执（真实状态机）
  if (run.status === 'AWAITING_APPROVAL') {
    const approve = await call('approve-by-second-actor', { method: 'POST', path: `/api/v1/agents/runs/${run.id}/approve`, body: { note: '第二人批准（演示避免自我审批）' }, cookie: second })
    assert(approve.status === 200, `第二人批准失败：${approve.status} ${approve.raw.slice(0, 300)}`)
  }
  const execute = await call('execute-run', { method: 'POST', path: `/api/v1/agents/runs/${run.id}/execute`, cookie: owner })
  assert([200, 201].includes(execute.status), `execute 失败：${execute.status} ${execute.raw.slice(0, 400)}`)
  const executed = await call('run-after-execute', { method: 'GET', path: `/api/v1/agents/runs/${run.id}`, cookie: owner })
  assert(executed.json?.data?.status === 'EXECUTED', '执行后状态不是 EXECUTED')
  const receipt = executed.json?.data?.executionRecord ?? null
  assert(receipt, '执行后没有真实回执记录')
  evidence.meta.receipt = { kind: receipt.kind ?? null, channel: receipt.channel ?? null, deliveryId: receipt.deliveryId ?? null, deliveryStatus: receipt.deliveryStatus ?? null }

  // 锁定负例：执行已发生，历史方案不可覆盖
  await negative('EXECUTED 后方案锁定 409', { method: 'POST', path: specPath, body: { spec: run.proposal, expectedVersion: 1 }, cookie: owner }, 409, 'MISSION_LOCKED')

  // ⑦ 独立成果核验（第二人）+ 全部负例
  const verifyPath = `/api/v1/missions/${mission.id}/verification`
  const beforeVerify = await call('verification-before', { method: 'GET', path: verifyPath, cookie: owner })
  assert(beforeVerify.json?.data === null, '核验前不是 null（可能空数组假绿）')
  const criteria = [
    { label: '签署试销协议', confirmed: true },
    { label: '完成首批出货', confirmed: true },
  ]
  await negative('发起人自己核验被拒', { method: 'POST', path: verifyPath, body: { criteria }, cookie: owner }, 409, 'SELF_VERIFICATION_FORBIDDEN')
  await negative('模型输出当证据被拒', { method: 'POST', path: verifyPath, body: { criteria, proposal: run.proposal }, cookie: second }, 400, 'MODEL_OUTPUT_NOT_EVIDENCE')
  await negative('未确认的判据被拒', { method: 'POST', path: verifyPath, body: { criteria: [{ label: '签署试销协议', confirmed: false }] }, cookie: second }, 409)
  const noRunMission = await call('create-mission-without-run', { method: 'POST', path: '/api/v1/missions', headers: { 'Idempotency-Key': `v21-norun-${suffix}` }, body: { goal: `独立核验负例用的无关联任务 ${suffix}`, offer: '样品', successCriteria: '签署试销协议' }, cookie: owner })
  if (noRunMission.status === 201) {
    await negative('无关联运行/无回执不可核验', { method: 'POST', path: `/api/v1/missions/${noRunMission.json.data.id}/verification`, body: { criteria }, cookie: second }, 409)
  }
  const verified = await call('verification-by-second-actor', { method: 'POST', path: verifyPath, body: { criteria, evidenceNote: '对照回执逐条核对，第二人确认' }, cookie: second })
  assert(verified.status === 200, `第二人核验失败：${verified.status} ${verified.raw.slice(0, 400)}`)
  const record = verified.json?.data
  assert(record?.verificationLevel === 'COUNTERPARTY_CONFIRMED', '核验等级不是 COUNTERPARTY_CONFIRMED')
  assert(record?.evidence?.receipt && record?.evidence?.dbRows && record?.evidence?.auditEventType, '四重证据不完整')
  await negative('重复核验被拒', { method: 'POST', path: verifyPath, body: { criteria }, cookie: second }, 409)

  // ⑧ DB 直查：四重证据（HTTP 响应之外，逐表核对真实行）
  const q = async (sql, args = []) => (await db.execute({ sql, args })).rows
  const dbEvidence = {
    agentRun: await q('SELECT "id","status","requestedBy" FROM "AgentRun" WHERE "id"=?', [run.id]),
    agentExecution: await q('SELECT "id","runId","kind","channel","deliveryId","deliveryStatus" FROM "AgentExecution" WHERE "runId"=?', [run.id]),
    executionVerification: await q('SELECT "id","missionId","runId","verdict","verifierId","receiptRef" FROM "ExecutionVerification" WHERE "missionId"=?', [mission.id]),
    missionSpecRevision: await q('SELECT "id","missionId","version" FROM "MissionSpecRevision" WHERE "missionId"=?', [mission.id]),
    agentRunStageEvent: await q('SELECT "id","runId","seq","stage" FROM "AgentRunStageEvent" WHERE "runId"=? ORDER BY "seq"', [run.id]),
    tenantAuditEvent: await q('SELECT "id","eventType","resourceType","resourceId" FROM "TenantAuditEvent" WHERE "resourceId" IN (?,?) ORDER BY "createdAt" DESC LIMIT 20', [run.id, mission.id]),
    mission: await q('SELECT "id","sourceRunId","status" FROM "Mission" WHERE "id"=?', [mission.id]),
  }
  evidence.dbEvidence = dbEvidence
  assert(dbEvidence.agentRun.length === 1 && dbEvidence.agentRun[0].status === 'EXECUTED', 'DB: AgentRun 未落 EXECUTED')
  assert(dbEvidence.agentExecution.length === 1, 'DB: AgentExecution 回执行缺失')
  assert(dbEvidence.executionVerification.length === 1, 'DB: ExecutionVerification 核验行缺失')
  assert(dbEvidence.missionSpecRevision.length === 1, 'DB: MissionSpecRevision 版本行缺失')
  assert(dbEvidence.agentRunStageEvent.length >= 2, 'DB: AgentRunStageEvent 阶段事件缺失')
  assert(dbEvidence.mission[0]?.sourceRunId === run.id, 'DB: Mission.sourceRunId 未落库')
  assert(dbEvidence.tenantAuditEvent.length > 0, 'DB: TenantAuditEvent 审计事件缺失')

  evidence.conclusion = {
    verdict: evidence.failures.length === 0 ? 'PASS_LOCAL' : 'FAIL',
    note: 'PASS_LOCAL 仅表示本地隔离库的真实 HTTP+DB+Audit+阶段事件链路闭合；不等于生产发布，也不等于外部执行动作完成。',
    chain: ['意图运行', '幂等重放', '带 sourceRunId 创建任务', '方案版本化+冲突', '阶段事件SSE+续传', '批准/执行', '真实回执', '第二人独立核验', 'DB 四重证据'],
    negatives: evidence.negativeCases,
  }
}

main()
  .catch((err) => {
    evidence.failures.push(err instanceof Error ? err.message : String(err))
    evidence.conclusion = { verdict: 'FAIL', note: '链路未闭合，见 failures' }
  })
  .finally(() => {
    evidence.meta.finishedAt = new Date().toISOString()
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n')
    const passed = evidence.negativeCases.filter((n) => n.pass).length
    console.log(`[v21-closure] verdict=${evidence.conclusion?.verdict} steps=${evidence.steps.length} negatives=${passed}/${evidence.negativeCases.length} failures=${evidence.failures.length}`)
    for (const f of evidence.failures) console.error(`  ✗ ${f}`)
    console.log(`[v21-closure] evidence=${OUT}`)
    process.exit(evidence.failures.length === 0 ? 0 : 1)
  })

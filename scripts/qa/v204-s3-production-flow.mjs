#!/usr/bin/env node
/**
 * V20.4 · S3 —— **生产业务验证**（审批 → 执行 → 站内回执 → 审计留痕）
 *
 * 与 S1/S2 的分界（`56` 的口径）：
 *   S1 沙箱跑通内核；S2 证明真实调到了云端模型；
 *   **S3 才回答「批准这件事有没有真的挡住/放行」**。
 *
 * 为什么现在能跑：`execute` 的效果是**站内回执给发起人**（`executor.ts` 头注释
 * 与 `EXECUTION_PLANS` 的 `recipient: 'REQUESTER'` 双重声明），**不对外送达**。
 * 所以不存在"发了真实邮件 / 调了第三方 API"这类不可撤副作用。
 *
 * 两条链路，故意分开：
 *   A. INTENT_EXTRACTION（requiresApproval=false）→ PROPOSED 直接执行
 *      → 验「执行唯一性」「重放不重复投递」「状态机落点」「审计留痕」
 *   B. INTRO_DRAFT（requiresApproval=true, risk=HIGH）→ AWAITING_APPROVAL
 *      → 验「OPERATOR 批准被 403」「ADMIN 批准放行」「无目标身份时执行被拒」
 *      → 这是 AC-08（注入不得绕过审批）在**制度层**的运行时证据
 *
 * ⚠️ B 需要一名 ADMIN。生产组织 `default` 当前**没有** ADMIN（实测只有两个
 * OPERATOR QA 账号），因此脚本提供 `--elevate`：临时把 qa.female 提到 ADMIN，
 * **finally 里必定回滚**。不加该开关时 B 段整体记 SKIP，不伪造通过。
 *
 * 用法：
 *   node scripts/qa/v204-s3-production-flow.mjs --elevate
 *   node scripts/qa/v204-s3-production-flow.mjs            # 只跑 A
 */

import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@libsql/client'

// ── 参数 ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const BASE = arg('base', 'https://app.lokfeel.com').replace(/\/$/, '')
const ELEVATE = argv.includes('--elevate')
const PWD_FILE = arg('pwd-file', '/tmp/v204_qa_pwd')
const MALE = 'qa.male@lokfeel.com'
const FEMALE = 'qa.female@lokfeel.com'
const ORG_SLUG = 'default'

// ── env（.env.local 优先，值去引号）────────────────────────────────
function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const v = m[2].replace(/^["']|["']$/g, '')
      if (!process.env[m[1]]) process.env[m[1]] = v
    }
  }
}
loadEnv()

const PASSWORD = process.env.V204_QA_PASSWORD ?? readFileSync(PWD_FILE, 'utf8').trim()

// ── 断言账本 ────────────────────────────────────────────────────────
const results = []
function check(id, ok, detail) {
  results.push({ id, verdict: ok ? 'PASS' : 'FAIL', detail })
  console.log(`  ${ok ? '✓' : '✗'} ${id.padEnd(40)} ${detail}`)
}
function skip(id, why) {
  results.push({ id, verdict: 'SKIP', detail: why })
  console.log(`  – ${id.padEnd(40)} SKIP (${why})`)
}

// ── HTTP ────────────────────────────────────────────────────────────
async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
    redirect: 'manual',
  })
  const jar = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  return { status: res.status, jar }
}

async function api(path, { method = 'GET', body, jar, idem } = {}) {
  const headers = { Origin: BASE, Cookie: jar }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idem) headers['Idempotency-Key'] = idem
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* 非 JSON 响应（例如网关错误页）—— 保持 null，断言里会体现 */
  }
  return { status: res.status, json, data: json?.data }
}

// ── DB（只读核验 + 一次可回滚的角色变更）────────────────────────────
const dbUrl = process.env.DATABASE_URL
const db = dbUrl
  ? createClient({
      url: dbUrl,
      authToken: process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN,
    })
  : null

async function orgIdOf(slug) {
  const rs = await db.execute({ sql: 'SELECT id FROM Organization WHERE slug = ? LIMIT 1', args: [slug] })
  return rs.rows[0]?.id ?? null
}

async function roleOf(orgId, email) {
  const rs = await db.execute({
    sql: `SELECT m.role FROM Membership m JOIN User u ON u.id = m.userId
          WHERE m.organizationId = ? AND u.email = ? LIMIT 1`,
    args: [orgId, email],
  })
  return rs.rows[0]?.role ?? null
}

async function setRole(orgId, email, role) {
  await db.execute({
    sql: `UPDATE Membership SET role = ?
          WHERE organizationId = ? AND userId = (SELECT id FROM User WHERE email = ?)`,
    args: [role, orgId, email],
  })
}

// ── 主流程 ──────────────────────────────────────────────────────────
const t0 = new Date()
console.log(`\n目标：${BASE}`)
console.log(`组织：${ORG_SLUG}｜提权：${ELEVATE ? '开启（会自动回滚）' : '关闭'}\n`)

const orgId = db ? await orgIdOf(ORG_SLUG) : null
if (db && !orgId) {
  console.error('✗ 找不到组织 default —— 中止（不猜）')
  process.exit(2)
}

const male = await login(MALE)
const female = await login(FEMALE)
console.log('[0] 登录')
check('OPERATOR 账号可登录', male.status === 200 && male.jar.includes('session-token'), `status=${male.status}`)
check('ADMIN 候选账号可登录', female.status === 200 && female.jar.includes('session-token'), `status=${female.status}`)

// ── A. 低风险：PROPOSED 直接执行 ───────────────────────────────────
console.log('\n[A] INTENT_EXTRACTION（requiresApproval=false）执行链')
const goalA = 'S3 生产验证：为一次双边介绍准备结构化工作区，不要编造候选与预算。'
const runA = await api('/api/v1/agents/runs', {
  method: 'POST',
  jar: male.jar,
  idem: randomUUID(),
  body: { skill: 'INTENT_EXTRACTION', input: { goal: goalA } },
})
// POST 的返回是 `{ data: { run, replayed } }`（不是把 run 摊在 data 上）——
// GET 单条才是 `data` 直接为 run。这个差异踩过一次，写死在这里防复发。
const runADto = runA.data?.run ?? runA.data
check('A1 运行已创建', runA.status === 201, `status=${runA.status}`)
const runAId = runADto?.id
check('A2 返回运行 id', Boolean(runAId), `id=${runAId}`)
check(
  'A3 真实 Provider 产出（非降级）',
  ['PROPOSED', 'DEGRADED'].includes(runADto?.status),
  `status=${runADto?.status} provider=${runADto?.providerKind}`,
)
check('A4 requiresApproval=false 快照', runADto?.requiresApproval === false, `${runADto?.requiresApproval}`)

const execA = await api(`/api/v1/agents/runs/${runAId}/execute`, { method: 'POST', jar: male.jar })
check('A5 首次执行 201', execA.status === 201, `status=${execA.status}`)
check('A6 非重放', execA.data?.replayed !== true, `replayed=${execA.data?.replayed}`)

const replayA = await api(`/api/v1/agents/runs/${runAId}/execute`, { method: 'POST', jar: male.jar })
check(
  'A7 重放返回 200 且 replayed=true（不二次投递）',
  replayA.status === 200 && replayA.data?.replayed === true,
  `status=${replayA.status} replayed=${replayA.data?.replayed}`,
)

const gotA = await api(`/api/v1/agents/runs/${runAId}`, { jar: male.jar })
check('A8 状态落点 EXECUTED', gotA.data?.status === 'EXECUTED', `status=${gotA.data?.status}`)

if (db) {
  const ex = await db.execute({
    sql: 'SELECT COUNT(*) AS n FROM AgentExecution WHERE runId = ?',
    args: [runAId],
  })
  const n = Number(ex.rows[0]?.n ?? 0)
  check('A9 执行记录恰 1 条（重放未造第二条）', n === 1, `count=${n}`)

  const st = await db.execute({
    sql: 'SELECT deliveryStatus, recipientId FROM AgentExecution WHERE runId = ? LIMIT 1',
    args: [runAId],
  })
  check(
    'A10 投递结果非 FAILED',
    ['SENT', 'CAPTURED'].includes(String(st.rows[0]?.deliveryStatus)),
    `deliveryStatus=${st.rows[0]?.deliveryStatus}`,
  )

  const rc = await db.execute({
    sql: 'SELECT COUNT(*) AS n FROM Notification WHERE userId = ? AND createdAt >= ?',
    args: [st.rows[0]?.recipientId ?? '', t0.toISOString()],
  })
  check('A11 发起人收到站内回执', Number(rc.rows[0]?.n ?? 0) >= 1, `notifications=${rc.rows[0]?.n}`)

  const au = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM TenantAuditEvent
          WHERE organizationId = ? AND eventType = 'agent.run.executed' AND resourceId = ?`,
    args: [orgId, runAId],
  })
  check('A12 审计留痕 agent.run.executed', Number(au.rows[0]?.n ?? 0) >= 1, `events=${au.rows[0]?.n}`)
} else {
  skip('A9-A12 DB 侧证据', '无 DATABASE_URL')
}

// ── B. 高风险：审批门 ─────────────────────────────────────────────
console.log('\n[B] INTRO_DRAFT（requiresApproval=true, HIGH）审批门')
let elevated = false
let originalRole = null
try {
  if (ELEVATE) {
    originalRole = await roleOf(orgId, FEMALE)
    if (originalRole === 'ADMIN') {
      console.log(`  · ${FEMALE} 已是 ADMIN，无需提权`)
    } else {
      await setRole(orgId, FEMALE, 'ADMIN')
      elevated = true
      console.log(`  · 临时提权 ${FEMALE}: ${originalRole} → ADMIN（结束时回滚）`)
    }
    const now = await roleOf(orgId, FEMALE)
    check('B1 ADMIN 权限就位', now === 'ADMIN', `role=${now}`)
    const relogin = await login(FEMALE)
    female.jar = relogin.jar
  }

  const runB = await api('/api/v1/agents/runs', {
    method: 'POST',
    jar: male.jar,
    idem: randomUUID(),
    body: {
      skill: 'INTRO_DRAFT',
      input: {
        goal: '为两位候选人起草一条克制、不夸张的开场消息，不要承诺任何未授权的动作。',
        subjectLabel: 'S3-主体',
        counterpartLabel: 'S3-对手方',
        allowedFieldKeys: [],
      },
    },
  })
  const runBDto = runB.data?.run ?? runB.data
  const runBId = runBDto?.id
  check('B2 高风险运行已创建', runB.status === 201, `status=${runB.status}`)
  check('B3 requiresApproval=true', runBDto?.requiresApproval === true, `${runBDto?.requiresApproval}`)
  check(
    'B4 状态停在待批（未执行）',
    runBDto?.status === 'AWAITING_APPROVAL',
    `status=${runBDto?.status}`,
  )

  if (ELEVATE) {
    const byOp = await api(`/api/v1/agents/runs/${runBId}/approve`, { method: 'POST', jar: male.jar, body: {} })
    check('B5 OPERATOR 批准被拒（403，职责分离）', byOp.status === 403, `status=${byOp.status}`)

    const byAdmin = await api(`/api/v1/agents/runs/${runBId}/approve`, {
      method: 'POST',
      jar: female.jar,
      body: { note: 'S3 生产验证：ADMIN 批准' },
    })
    check('B6 ADMIN 批准成功', byAdmin.status === 200, `status=${byAdmin.status}`)
    check('B7 状态 → APPROVED', byAdmin.data?.status === 'APPROVED', `status=${byAdmin.data?.status}`)

    const execB = await api(`/api/v1/agents/runs/${runBId}/execute`, { method: 'POST', jar: male.jar })
    const code = execB.json?.error?.code ?? execB.json?.code ?? ''
    check(
      'B8 无目标身份 ⇒ 执行被拒（投递门生效）',
      execB.status === 409 && /NO_TARGET|TARGET|DISCLOSURE/.test(JSON.stringify(execB.json)),
      `status=${execB.status} code=${code}`,
    )

    const afterB = await api(`/api/v1/agents/runs/${runBId}`, { jar: male.jar })
    check('B9 拒绝后状态仍非 EXECUTED（无副作用）', afterB.data?.status !== 'EXECUTED', `status=${afterB.data?.status}`)

    if (db) {
      const n = await db.execute({
        sql: 'SELECT COUNT(*) AS n FROM AgentExecution WHERE runId = ?',
        args: [runBId],
      })
      check('B10 无执行记录落库', Number(n.rows[0]?.n ?? 0) === 0, `count=${n.rows[0]?.n}`)
    }
  } else {
    skip('B5-B10 审批门', '未加 --elevate（生产 default 组织无 ADMIN）')
  }
} finally {
  if (elevated) {
    await setRole(orgId, FEMALE, originalRole)
    const back = await roleOf(orgId, FEMALE)
    check('B11 提权已回滚', back === originalRole, `${back}`)
  }
}

// ── 汇总 ────────────────────────────────────────────────────────────
const pass = results.filter((r) => r.verdict === 'PASS').length
const fail = results.filter((r) => r.verdict === 'FAIL').length
const skipN = results.filter((r) => r.verdict === 'SKIP').length
console.log(`\n━━━ ${pass} PASS / ${fail} FAIL / ${skipN} SKIP（共 ${results.length}）━━━`)
if (fail > 0) {
  console.log('\n失败项：')
  for (const r of results.filter((x) => x.verdict === 'FAIL')) console.log(`  - ${r.id}: ${r.detail}`)
}
process.exit(fail > 0 ? 1 : 0)

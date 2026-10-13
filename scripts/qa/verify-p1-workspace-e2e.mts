#!/usr/bin/env node
/**
 * P1 收口 · 端到端取证（**隔离库 + 真实 HTTP + 真实装配器**）
 *
 * 目标是回答两个"只能端到端回答"的问题：
 *
 *   ① `POST /api/v1/missions` 真的能从界面这一侧被用起来吗？
 *      —— 幂等键必需 / 同键重放不产生第二条 / 缺键 400 / MEMBER 403。
 *   ② `consent` / `action` / `outcome` 三类节点的**真实数据装配**真的能吃到
 *      服务端载荷吗？—— 用**真实响应**喂 `assembleTenantNodes()`，再要求合并后的
 *      spec 通过 `WorkspaceSpecSchema`（这就是"渲染层永远拿得到合法数据"的判据）。
 *
 * 🔴 为什么必须用隔离库（`file:/tmp/t02-e2e.db`）：本用例会**真的创建** Mission /
 *    提案 / 成果。跑在生产库上会污染真实数据；跑在 mock 上则回答不了"契约与真实
 *    端点是否对得上"这个问题（mock 里的枚举永远是对的，这正是 P1 首版把三处枚举
 *    猜错却毫无察觉的原因）。
 *
 * 前置（脚本不负责起服务，避免把"服务起不来"误报成"功能坏了"）：
 *   E2E_DB_FILE=/tmp/t02-e2e.db node scripts/qa/seed-t02-e2e.mjs --reset --regenerate
 *   DATABASE_URL=file:/tmp/t02-e2e.db npx next dev -p 3099
 *   QA_BASE=http://localhost:3099 npx tsx scripts/qa/verify-p1-workspace-e2e.mts
 *
 * 退出码 0 = 全部通过。
 */

import {
  assembleTenantNodes,
  mergeTenantNodes,
  WorkspaceSpecSchema,
  WORKSPACE_SPEC_VERSION,
  ACTION_JOB_STATUSES,
  CONSENT_STATES,
  OUTCOME_LEVELS,
  type Source,
  type WorkspaceSpec,
  type WorkspaceNode,
} from '@/lib/workspace-spec'

const BASE = (process.env.QA_BASE || 'http://localhost:3000').replace(/\/$/, '')
const PASSWORD = process.env.E2E_PASSWORD || 'E2E-Test-Passw0rd!'
const OWNER_EMAIL = 'e2e.owner@example.test'
const MEMBER_EMAIL = 'e2e.member@example.test'

let pass = 0
let fail = 0
const ck = (label: string, ok: boolean, extra = '') => {
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? `  ${extra}` : ''}`)
}

/**
 * 服务端响应的**信封**（`src/lib/api-response.ts`）。
 * 载荷一律当 `unknown` 处理 —— 这个脚本的职责就是"看服务端到底下发了什么"，
 * 给它一个具体类型等于先把结论写死，而那正是 P1 首版把三处枚举猜错的成因。
 */
interface ApiEnvelope {
  success?: boolean
  data?: unknown
  error?: { code?: string; message?: string; details?: unknown }
  meta?: { page?: number; pageSize?: number; total?: number }
}

interface Res {
  status: number
  json: ApiEnvelope | null
  headers: Headers
}

/** 把 `unknown` 收敛成"可索引对象"（读不到的字段即 `undefined`）。 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const payload = (r: Res) => asRecord(r.json?.data)
const totalOf = (r: Res) => (typeof r.json?.meta?.total === 'number' ? (r.json?.meta?.total as number) : -1)
const errorDetails = (r: Res) => asRecord(asRecord(r.json?.error).details)

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: BASE, Referer: `${BASE}/login` },
    body: JSON.stringify({ email, password: PASSWORD }),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  if (res.status !== 200) throw new Error(`登录失败 ${email}: status=${res.status} ${text.slice(0, 200)}`)
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ')
  if (!/session-token/i.test(cookie)) throw new Error(`登录成功但没拿到会话 cookie: ${cookie.slice(0, 120)}`)
  return cookie
}

async function api(
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      cookie,
      Origin: BASE,
      Referer: `${BASE}/workspace`,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  const json = (await res.json().catch(() => null)) as ApiEnvelope | null
  return { status: res.status, json, headers: res.headers }
}

/** 幂等键（写路径的通用要求，T03 起一致）。 */
let seq = 0
const idem = (tag: string): Record<string, string> => ({
  'Idempotency-Key': `p1-e2e-${tag}-${Date.now()}-${++seq}`,
})

/** 断言一批"真实载荷"的装配结果：必须过契约，且取值全部来自服务端枚举。 */
function assertAssembly(label: string, spec: WorkspaceSpec, nodes: readonly WorkspaceNode[]) {
  const parsed = WorkspaceSpecSchema.safeParse(spec)
  ck(
    `${label}：合并后的 spec 通过 WorkspaceSpecSchema`,
    parsed.success,
    parsed.success ? '' : JSON.stringify(parsed.error?.issues?.[0] ?? {}),
  )
  ck(`${label}：contract version === ${WORKSPACE_SPEC_VERSION}`, spec.version === WORKSPACE_SPEC_VERSION)
  for (const n of nodes) {
    if (n.type === 'consent') {
      ck(`${label}：consent.status 是服务端枚举`, (CONSENT_STATES as readonly string[]).includes(n.data.status), n.data.status)
    }
    if (n.type === 'action') {
      const bad = n.data.jobs.filter((j) => !(ACTION_JOB_STATUSES as readonly string[]).includes(j.status))
      ck(`${label}：action 全部状态是服务端枚举`, bad.length === 0, bad.map((b) => b.status).join(','))
    }
    if (n.type === 'outcome') {
      const bad = n.data.outcomes.filter((o) => !(OUTCOME_LEVELS as readonly string[]).includes(o.level))
      ck(`${label}：outcome 全部档位是服务端枚举`, bad.length === 0, bad.map((b) => b.level).join(','))
    }
  }
}

async function main() {
  console.log(`\nP1 收口端到端取证  目标 ${BASE}\n`)

  // ── 探活：服务没起来就早退（不要把"服务不可达"记成功能失败）──
  try {
    const h = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(20_000) })
    ck('服务可达（/api/health）', h.status < 500, `status=${h.status}`)
  } catch (e) {
    console.error(
      `❌ 无法连接 ${BASE}：${(e as Error).message}\n   请先起隔离库服务：DATABASE_URL=file:/tmp/t02-e2e.db npx next dev -p 3099`,
    )
    process.exit(1)
  }

  const owner = await login(OWNER_EMAIL)
  const member = await login(MEMBER_EMAIL)
  console.log('── 会话就绪（owner / member）')

  // ── ① 能力探测：OWNER 应有 mission.create（同时否证"信封读错层"那个坑）──
  console.log('\n── ① 组织与能力')
  const org = await api(owner, 'GET', '/api/v1/org')
  ck('GET /api/v1/org → 200', org.status === 200, `status=${org.status}`)
  const caps = asArray(payload(org).capabilities).map(str)
  ck('capabilities 非空（信封解析正确）', caps.length > 0, `${caps.length} 项`)
  ck('OWNER 具备 mission.create', caps.includes('mission.create'))
  ck('OWNER 具备 workflow.read', caps.includes('workflow.read'))

  const orgM = await api(member, 'GET', '/api/v1/org')
  const capsM = asArray(payload(orgM).capabilities).map(str)
  ck('MEMBER 的 capabilities 不含 mission.create', !capsM.includes('mission.create'), `MEMBER ${capsM.length} 项`)

  // ── ② POST /missions：幂等键必需 + 同键重放 ──
  console.log('\n── ② POST /api/v1/missions（幂等）')
  const before = await api(owner, 'GET', '/api/v1/missions')
  const totalBefore = totalOf(before)
  ck('读取创建前的任务总数', totalBefore >= 0, `total=${totalBefore}`)

  const missionBody = {
    goal: '在 30 天内对接 5 家东南亚渠道伙伴，完成初步合作洽谈',
    offer: '社群内的引荐、联合投放预算与渠道培训',
    successCriteria: '至少 3 家进入试销，并完成首批出货',
    constraints: ['东南亚市场经验'],
    publish: true,
  }
  const key = `p1-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const created = await api(owner, 'POST', '/api/v1/missions', missionBody, { 'Idempotency-Key': key })
  ck('首次创建 → 201', created.status === 201, `status=${created.status}`)
  const missionId = str(payload(created).id)
  const shareToken = str(payload(created).shareToken)
  ck('返回任务 id', missionId.length > 0, missionId)
  ck('返回分享令牌（后续加入需要）', shareToken.length > 0)
  ck('publish=true → 状态 ACTIVE', str(payload(created).status) === 'ACTIVE', str(payload(created).status))
  ck('首次创建**不带**重放头', created.headers.get('Idempotent-Replayed') === null)

  const afterCreate = await api(owner, 'GET', '/api/v1/missions')
  ck('任务总数 +1', totalOf(afterCreate) === totalBefore + 1, `total=${totalOf(afterCreate)}`)

  const replay = await api(owner, 'POST', '/api/v1/missions', missionBody, { 'Idempotency-Key': key })
  ck('同键重放 → 201', replay.status === 201, `status=${replay.status}`)
  ck('重放带 Idempotent-Replayed: true', replay.headers.get('Idempotent-Replayed') === 'true')
  ck('重放返回同一 id', str(payload(replay).id) === missionId)
  const afterReplay = await api(owner, 'GET', '/api/v1/missions')
  ck('🔴 重放**没有**产生第二条', totalOf(afterReplay) === totalBefore + 1, `total=${totalOf(afterReplay)}`)

  // ── ③ 负向：缺键 / 越权 ──
  console.log('\n── ③ 负向断言')
  const noKey = await api(owner, 'POST', '/api/v1/missions', missionBody)
  ck('缺 Idempotency-Key → 400', noKey.status === 400, `status=${noKey.status}`)
  ck('400 指向 Idempotency-Key 字段', errorDetails(noKey).field === 'Idempotency-Key', JSON.stringify(errorDetails(noKey)))
  const byMember = await api(member, 'POST', '/api/v1/missions', missionBody, { 'Idempotency-Key': `${key}-m` })
  ck('MEMBER 创建 → 403（能力不足）', byMember.status === 403, `status=${byMember.status}`)
  const afterNeg = await api(owner, 'GET', '/api/v1/missions')
  ck('负向两次尝试都未产生任务', totalOf(afterNeg) === totalBefore + 1, `total=${totalOf(afterNeg)}`)

  // ── ④ 把三类节点的数据真的造出来（全部走真实端点）──
  console.log('\n── ④ 造真实数据（加入 → 意图 → 提案 → 双方同意 → 介绍 → 成果 → 对手方确认）')
  const members = await api(owner, 'GET', '/api/v1/members?pageSize=50')
  const memberRow = asArray(payload(members))
    .map(asRecord)
    .find((m) => str(m.email) === MEMBER_EMAIL)
  const candidateId = str(memberRow?.userId)
  ck('从 /api/v1/members 解析出对方 userId', candidateId.length > 0, candidateId)

  for (const [who, cookie] of [
    ['owner', owner],
    ['member', member],
  ] as const) {
    const j = await api(cookie, 'POST', `/api/v1/public/missions/${shareToken}/join`, {})
    ck(`${who} 加入任务 → 2xx`, j.status >= 200 && j.status < 300, `status=${j.status}`)
  }

  for (const [who, cookie] of [
    ['owner', owner],
    ['member', member],
  ] as const) {
    // 🔴 写路径一律要求 Idempotency-Key（T03 起的一致口径）—— 这也是"界面接线"
    //    最容易漏掉的一步：只发 body 会拿到 400，而 400 的原因并不在 body 里。
    const it = await api(
      cookie,
      'POST',
      '/api/v1/intents',
      { missionId, need: '找东南亚渠道合作', offer: '提供样品与渠道培训' },
      idem(`intent-${who}`),
    )
    ck(
      `${who} 提交意图 → 2xx`,
      it.status >= 200 && it.status < 300,
      `status=${it.status} ${it.status >= 400 ? JSON.stringify(it.json?.error ?? {}) : ''}`,
    )
  }

  const prop = await api(
    owner,
    'POST',
    '/api/v1/connections/proposals',
    { missionId, candidateId, rationale: '双方在印尼市场都有落地经验（来自任务意图）' },
    idem('proposal'),
  )
  ck('发起提案 → 201', prop.status === 201, `status=${prop.status}`)
  const proposalId = str(payload(prop).id)
  ck('提案初始状态 CONSENT_PENDING', str(payload(prop).state) === 'CONSENT_PENDING', str(payload(prop).state))

  const d1 = await api(owner, 'POST', `/api/v1/connections/${proposalId}/consent`, { decision: 'accept' })
  ck('发起方接受 → 200', d1.status === 200, `status=${d1.status}`)
  ck('单方接受仍是 CONSENT_PENDING（AC-04）', str(payload(d1).state) === 'CONSENT_PENDING', str(payload(d1).state))

  const d2 = await api(member, 'POST', `/api/v1/connections/${proposalId}/consent`, { decision: 'accept' })
  ck('被介绍方接受 → 200', d2.status === 200, `status=${d2.status}`)
  ck('双方同意 → MUTUALLY_ACCEPTED', str(payload(d2).state) === 'MUTUALLY_ACCEPTED', str(payload(d2).state))

  const intro = await api(owner, 'POST', `/api/v1/connections/${proposalId}/introduce`)
  ck('介绍执行 → 200', intro.status === 200, `status=${intro.status}`)

  const oc = await api(owner, 'POST', '/api/v1/outcomes', {
    proposalId,
    summary: '完成首轮试销并与对方签署合作备忘',
  })
  ck('上报成果 → 201', oc.status === 201, `status=${oc.status}`)
  const outcomeId = str(payload(oc).id)
  ck(
    '成果初始档位 SELF_REPORTED（自报不算验证成功）',
    str(payload(oc).verificationLevel) === 'SELF_REPORTED',
    str(payload(oc).verificationLevel),
  )

  const cf = await api(member, 'POST', `/api/v1/outcomes/${outcomeId}/confirm`, {})
  ck('对手方确认 → 2xx', cf.status >= 200 && cf.status < 300, `status=${cf.status}`)

  // ── ⑤ 用**真实响应**装配三类节点，并要求过契约 ──
  console.log('\n── ⑤ 真实载荷 → 装配 → 契约')
  const proposalsRes = await api(owner, 'GET', '/api/v1/connections/proposals')
  const jobsRes = await api(owner, 'GET', '/api/v1/workflow/jobs')
  const outcomesRes = await api(owner, 'GET', '/api/v1/outcomes')

  ck('GET /connections/proposals → 200', proposalsRes.status === 200, `status=${proposalsRes.status}`)
  ck('GET /workflow/jobs → 200', jobsRes.status === 200, `status=${jobsRes.status}`)
  ck('GET /outcomes → 200', outcomesRes.status === 200, `status=${outcomesRes.status}`)

  const proposals = asArray(payload(proposalsRes).proposals)
  const jobs = asArray(payload(jobsRes).jobs)
  const outcomes = asArray(payload(outcomesRes).items)
  ck('提案端点确实下发了本用例刚建的提案', proposals.some((p) => str(asRecord(p).id) === proposalId), `${proposals.length} 条`)
  ck('任务端点确实下发了工作流任务（T06 钩子生效）', jobs.length > 0, `${jobs.length} 个`)
  ck('成果端点确实下发了本用例刚建的成果', outcomes.some((o) => str(asRecord(o).id) === outcomeId), `${outcomes.length} 条`)

  const confirmation = outcomes.map(asRecord).find((o) => str(o.id) === outcomeId)
  ck(
    '对手方确认后档位升到 COUNTERPARTY_CONFIRMED（真实枚举，不是 EVIDENCE_BACKED）',
    str(confirmation?.verificationLevel) === 'COUNTERPARTY_CONFIRMED',
    str(confirmation?.verificationLevel),
  )

  const sources: Source[] = [
    { ok: true, items: proposals },
    { ok: true, items: jobs },
    { ok: true, items: outcomes },
  ]
  const assembly = assembleTenantNodes({ proposals: sources[0], jobs: sources[1], outcomes: sources[2] })
  ck('装配器产出了节点（不是空手而归）', assembly.nodes.length > 0, `${assembly.nodes.length} 个节点`)
  ck('装配过程没有需要解释的异常', assembly.notes.length === 0, assembly.notes.join(' | '))

  const draft: WorkspaceSpec = {
    version: WORKSPACE_SPEC_VERSION,
    title: '渠道 / 资源对接',
    summary: '端到端取证用草稿',
    nodes: [
      {
        id: 'intent-1',
        type: 'intent',
        title: '目标与成功判据',
        data: {
          goal: missionBody.goal,
          constraints: missionBody.constraints,
          successCriteria: ['至少 3 家进入试销'],
        },
      },
      { id: 'candidate-1', type: 'candidate', title: '候选择优', data: { candidates: [] } },
    ],
    availableActions: [],
    notes: [],
  }
  const merged = mergeTenantNodes(draft, assembly)
  ck('合并社群节点 → 通过契约', merged.ok, merged.ok ? '' : merged.reason)
  if (merged.ok) assertAssembly('真实载荷', merged.spec, assembly.nodes)

  // ── ⑥ 不可用来源必须**不产节点**（而不是产空节点冒充"没有数据"）──
  console.log('\n── ⑥ 来源不可用的诚实处理')
  const denied = assembleTenantNodes({ jobs: { ok: false, reason: '读取失败（Error 403）' } })
  ck('来源失败 → 不产节点', denied.nodes.length === 0)
  ck('来源失败 → 写明原因', denied.notes.length === 1 && denied.notes[0].includes('403'), denied.notes.join(' | '))

  console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n❌ 端到端取证异常终止：', err?.message || err)
  process.exit(1)
})

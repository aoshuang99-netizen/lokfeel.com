#!/usr/bin/env node
/**
 * T11 Slice 5 · **AC-22** 端到端取证：第三方 Agent 在授权范围内完成发现/协作，越权失败
 * ═══════════════════════════════════════════════════════════════════════
 * AC-22 的原文（交付包 `docs/ACCEPTANCE_MATRIX.md`）：
 *   「第三方 Agent 在授权范围内完成**发现/协作**，**越权失败**」——证据形式：**合约测试**。
 * T11 的三条铁律（`tasks/T11_OPEN_SDK.md`）：
 *   「外部示例可运行；**越权必须失败**；开源仓**无凭据**。」
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么必须真 dev server + 真隔离库 + 真会话
 * ═══════════════════════════════════════════════════════════════════════
 *   · `tests/mcp/mcp-route.test.ts`（25 例）与 `tests/a2a/*.test.ts`（22 例）
 *     证的是**函数契约**，且把 `@/lib/tenancy` 整个 mock 掉了 ——
 *     也就是说，"无会话 ⇒ 401"这条在单测里是**我们告诉它** 401 的，不是它自己做到的。
 *   · `scripts/check-openapi-contract.mjs` 证的是**文本级**同源（契约的能力名 ==
 *     代码里 `withTenant(...)` 的能力名），它看不见"运行时到底返回了什么"。
 *   · 本脚本补的正是这一层：**真实 HTTP + 真实 cookie 会话 + 真实 SQLite 库**。
 *     单测里被 mock 掉的那一环（`resolveTenant` → `Membership` 回查 → `can(role, cap)`），
 *     只有在这里才真正被执行。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 判据设计的核心：**同端点、只换角色**
 * ═══════════════════════════════════════════════════════════════════════
 *   "MEMBER 被拒"单独拿出来是**弱证据** —— 它可以用"数据不存在""路径写错了"
 *   "功能压根没实现"等无数种方式变真。所以每一组越权都配一条**对照**：
 *     同一个端点、同一个租户、同一份夹具，只把会话换成 OPERATOR ⇒ 必须成功。
 *   两条一起看，"被拒"才唯一地归因到**能力判定**。
 *   为此夹具造了三档角色（MEMBER / OPERATOR / OWNER）而不是两个。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 三组取证（每组都必须过）
 * ═══════════════════════════════════════════════════════════════════════
 *   ① **发现面（匿名）**：MCP `initialize` / `tools/list` + A2A agent card
 *      都必须**无需会话**可达 —— 外部 Agent 得先"看见"能力才能谈授权。
 *      同时 `GET /api/mcp` 必须 405 + `Allow: POST`（不做 SSE，且要说清楚）。
 *   ② **契约一致性（运行时）**：MCP `tools/list` 与 agent card `skills`
 *      **双向集合相等**，且每个技能声明的 `x-required-capability` 与工具
 *      `annotations.requiredCapability` 逐字一致。两套协议各写一份清单的漂移
 *      是**静默**的，这条断言是它唯一的结构性防线。
 *   ③ **授权 vs 越权**：
 *        授权（正）MEMBER  → `bridge.read` 命中 ⇒ 成功（断言是**真实数据**，不是空列表）
 *        授权（正）OPERATOR → `mission.read` 命中 ⇒ 成功
 *        越权（负）无会话   → 三面全 401
 *        越权（负）MEMBER   → `list_missions` 必拒；`POST /api/v1/bridges` 403
 *        越权（负）跨租户   → `organizationId` 指向**自己不属于**的群 ⇒ 三面全拒
 *                            （把入参当授权依据是最经典的越权形状）
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 用法
 * ═══════════════════════════════════════════════════════════════════════
 *   npm run verify:ac22:open-sdk
 *   覆盖：AC22_PORT=3122 AC22_DB_FILE=/tmp/x.db
 *   退出码 0 = AC-22 通过。服务日志在 /tmp/lf-ac22-logs/。
 *
 * ⚠️ 长任务（起 next dev + 真实登录）—— 与其它扫描/自证脚本**不可并行**（8G 机）。
 * ⚠️ 本脚本**不需要**浏览器：AC-22 的判据是 HTTP 合约，不是渲染（渲染归 AC-18 的七屏取证）。
 *    少一个 Chrome 意味着本脚本可以更频繁地跑。
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  AC22_MISSION,
  AC22_ORGS,
  AC22_PASSWORD,
  AC22_PROBE_TOOLS,
  AC22_USERS,
} from './ac22-fixture.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const PORT = Number(process.env.AC22_PORT || '3122')
const BASE = `http://localhost:${PORT}`
const DB_FILE = process.env.AC22_DB_FILE || '/tmp/ac22-open-sdk.db'
const DDL_FILE = process.env.AC22_DDL_FILE || '/tmp/ac22-open-sdk-ddl.sql'
const LOG_DIR = process.env.AC22_LOG_DIR || '/tmp/lf-ac22-logs'

/** 非成员租户（`organizationId` 越权靶标）。 */
const FOREIGN_ORG = AC22_ORGS.b.id
const OWN_ORG = AC22_ORGS.a.id
const MISSION_ID = AC22_MISSION.id

// ── 计数与输出 ─────────────────────────────────────────────
let pass = 0
let fail = 0
const ck = (label, ok, extra = '') => {
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? `  ${extra}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const section = (t) => console.log(`\n${t}`)

// ── 子进程（与 AC-19 同一套：detached + 组杀，避免留下占端口的孤儿）──
const children = []

function spawnBg(name, cmd, args, env, logName) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
  const logPath = path.join(LOG_DIR, `${logName}.log`)
  const out = fs.openSync(logPath, 'a')
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', out, out],
  })
  child.on('error', (e) => console.log(`  ⚠️ ${name} 启动失败：${e.message}`))
  children.push({ name, child, logPath })
  return child
}

function killAll() {
  for (const { child } of children) {
    if (!child || child.exitCode !== null) continue
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {
        /* 已经没了 */
      }
    }
  }
}

function runToCompletion(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env } })
    let tail = ''
    const keep = (chunk) => {
      tail = `${tail}${chunk.toString()}`.slice(-2000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', () => resolve({ code: -1, tail }))
    child.on('exit', (code) => resolve({ code, tail }))
  })
}

async function waitForHttp(url, { timeoutMs, label, expectStatus }) {
  const t0 = Date.now()
  let last = ''
  let lastStatus = 0
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
      lastStatus = r.status
      // 🔴 判据必须**精确**：只要求"fetch 没抛"会把 404 当成就绪。
      //    本次就踩到了：dev server 的路由清单为空 ⇒ 全站 404 ⇒ 旧判据判定"就绪"，
      //    于是失败被推迟到登录那一步，报出来的症状是"登录 404"，指向完全错误的方向。
      if (expectStatus === undefined || r.status === expectStatus) return { ok: true, status: r.status }
      last = `status=${r.status}（期望 ${expectStatus}）`
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
    await sleep(1000)
  }
  console.log(`  ⚠️ ${label} 未在 ${timeoutMs}ms 内就绪（最后：${last}）`)
  return { ok: false, status: lastStatus }
}

const DEV_ENV = () => ({
  DATABASE_URL: `file:${DB_FILE}`,
  AUTH_URL: BASE,
  NEXTAUTH_URL: BASE,
  NEXT_PUBLIC_APP_URL: BASE,
})

/**
 * 起 dev server 并**确认它能路由**（`/api/health` 必须 200）。
 *
 * 为什么允许重试一次、且失败时清 `.next`：
 *   上一轮被 SIGTERM 组杀的 dev server 可能留下**不完整的 Turbopack 路由清单**，
 *   症状是**全站 404**（连 `/api/auth/login` 这种老路由都 404）。
 *   它不是应用缺陷，但会让取证以"登录 404"这种误导性症状失败。
 *   清掉构建产物重来一次，把"环境残留"与"代码缺陷"分开 ——
 *   若第二次仍然 404，那就是真问题，必须让人看见。
 */
async function startDevServer() {
  for (let attempt = 1; attempt <= 2; attempt++) {
    spawnBg('next-dev', 'npx', ['next', 'dev', '--turbopack', '-p', String(PORT)], DEV_ENV(), 'next-dev')
    const ready = await waitForHttp(`${BASE}/api/health`, {
      timeoutMs: 240_000,
      label: `dev server（第 ${attempt} 次）`,
      expectStatus: 200,
    })
    if (ready.ok) {
      ck(`dev server 就绪（/api/health 200）${attempt > 1 ? `｜第 ${attempt} 次尝试` : ''}`, true, `status=${ready.status}`)
      return true
    }
    console.log(`  ↻ 第 ${attempt} 次未就绪（status=${ready.status}），清理 .next 后重试`)
    killAll()
    children.length = 0
    await sleep(1500)
    try {
      fs.rmSync(path.join(ROOT, '.next'), { recursive: true, force: true })
      console.log('  🧹 已清理 .next（Turbopack 构建产物）')
    } catch (err) {
      console.log(`  ⚠️ 清理 .next 失败（继续重试）：${err?.message}`)
    }
  }
  ck('dev server 就绪（/api/health 200）', false, '两次尝试均失败 —— 请查服务日志')
  return false
}

// ── HTTP 会话 ─────────────────────────────────────────────

/** 用**真实登录端点**换 cookie（不是 NextAuth 的 callback —— 见记忆里的 QA 盲区）。 */
async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: BASE, Referer: `${BASE}/login` },
    body: JSON.stringify({ email, password: AC22_PASSWORD }),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  if (res.status !== 200) {
    throw new Error(`登录失败 ${email}: status=${res.status} ${(await res.text()).slice(0, 200)}`)
  }
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  if (raw.length === 0) throw new Error(`登录成功但没拿到任何 Set-Cookie（${email}）`)
  return raw.map((c) => c.split(';')[0])
}

async function parse(res) {
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON —— 只看 status 的断言用不到 */
  }
  return { status: res.status, json, text, allow: res.headers.get('allow') }
}

/**
 * 带会话的租户域请求。
 *
 * `Origin`/`Referer` 必须带 —— `/api/*` 会过 `proxy.ts` 的 CORS 判定
 * （`isCorsAllowed(origin, host)`）。少了它们，症状是**全站 403**，
 * 看起来像"授权把好人也拒了"，而其实是测试客户端不像浏览器。
 */
async function tenantReq(cookie, method, p, { body, headers } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      ...(cookie ? { cookie: cookie.join('; ') } : {}),
      Origin: BASE,
      Referer: `${BASE}/workspace`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  return parse(res)
}

/** MCP：发一条 JSON-RPC 消息。`rawBody` 用于刻意的非法信封。 */
async function mcp(cookie, method, params, { rawBody, query } = {}) {
  const payload =
    rawBody !== undefined ? rawBody : JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  const res = await fetch(`${BASE}/api/mcp${query || ''}`, {
    method: 'POST',
    headers: {
      ...(cookie ? { cookie: cookie.join('; ') } : {}),
      Origin: BASE,
      Referer: `${BASE}/workspace`,
      'content-type': 'application/json',
    },
    body: payload,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  return parse(res)
}

/** MCP `tools/call` 的便捷包装。 */
const mcpCall = (cookie, name, args = {}, opts = {}) =>
  mcp(cookie, 'tools/call', { name, arguments: args }, opts)

/** MCP 工具结果里的文本（`content[0].text`）。 */
const mcpText = (r) => r.json?.result?.content?.[0]?.text ?? ''
const mcpIsError = (r) => r.json?.result?.isError
/** 解析工具结果里的 JSON（服务端用 `JSON.stringify(data, null, 2)` 承载）。 */
function mcpData(r) {
  const t = mcpText(r)
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

/** A2A：发一个任务。 */
async function a2a(cookie, skillId, input = {}) {
  const res = await fetch(`${BASE}/api/v1/a2a/tasks`, {
    method: 'POST',
    headers: {
      ...(cookie ? { cookie: cookie.join('; ') } : {}),
      Origin: BASE,
      Referer: `${BASE}/workspace`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ skillId, input }),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  return parse(res)
}

/** A2A 任务信封里的 data 部分。 */
const a2aState = (r) => r.json?.task?.status?.state
function a2aData(r) {
  const part = r.json?.task?.artifacts?.[0]?.parts?.[0]
  return part && part.type === 'data' ? part.data : null
}

/** 运行时可达的 agent card（静态文件，无会话）。 */
async function agentCard() {
  const res = await fetch(`${BASE}/.well-known/agent-card.json`, {
    signal: AbortSignal.timeout(15_000),
  })
  return parse(res)
}

// ── 泄漏形态扫描（与 `scripts/qa/open-source-audit.mjs` 同一族判据）──
const CREDENTIAL_SHAPES = [
  { name: 'JWT（eyJ 开头）', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'Bearer 令牌字面量', re: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { name: '长随机串（32+ hex/base64）', re: /\b[A-Za-z0-9_-]{32,}\b/ },
  { name: '凭据字段名带值', re: /"(?:api[_-]?key|secret|token|password)"\s*:\s*"(?!bearerAuth)[^"]{8,}"/i },
]
const INTERNAL_DETAIL_SHAPES = [
  { name: 'SQLite/Prisma 痕迹', re: /SQLITE|prisma\.|P2002|P1013/ },
  { name: '绝对文件路径', re: /\/Users\/|\/home\/|\/tmp\// },
  { name: 'env 变量回显', re: /process\.env|DATABASE_URL|TURSO_TOKEN/ },
  { name: '堆栈帧', re: /\n\s+at\s+\w+.*\(.*:\d+:\d+\)/ },
]
function scanShapes(text, shapes) {
  const hits = []
  for (const s of shapes) if (s.re.test(text)) hits.push(s.name)
  return hits
}

// ═══════════════════════════════════════════════════════════
const main = async () => {
  console.log('\nAC-22 · 第三方 Agent 的发现 / 协作 / 越权 —— 真实 HTTP 合约取证')
  console.log(`  目标 ${BASE}`)
  console.log(`  隔离库 ${DB_FILE}`)
  console.log(`  日志 ${LOG_DIR}`)

  fs.mkdirSync(LOG_DIR, { recursive: true })

  // ═══════════════════════════════════════════════════════════
  section('── ⓪ 引导：隔离库 → dev server → 三档角色的真实登录')
  // ═══════════════════════════════════════════════════════════
  const seed = await runToCompletion(
    'node',
    ['scripts/qa/seed-ac22-e2e.mjs', '--reset', '--regenerate'],
    { E2E_DB_FILE: DB_FILE, E2E_DDL_FILE: DDL_FILE, E2E_PASSWORD: AC22_PASSWORD },
  )
  ck(
    '夹具就绪：一个群 + 三档角色（MEMBER/OPERATOR/OWNER）+ 一条真实 Mission + 一个非成员租户',
    seed.code === 0,
    seed.code === 0 ? '' : seed.tail.slice(-400),
  )
  if (seed.code !== 0) return

  if (!(await startDevServer())) return

  const cookies = {}
  for (const key of ['aOwner', 'aOperator', 'aMember']) {
    const email = AC22_USERS[key].email
    try {
      cookies[key] = await login(email)
      ck(`真实登录端点换到会话 cookie（${key} · ${email}）`, cookies[key].length > 0)
    } catch (e) {
      ck(`真实登录端点（${key} · ${email}）`, false, e instanceof Error ? e.message : String(e))
      return
    }
  }

  // ═══════════════════════════════════════════════════════════
  section('── ① 发现面（**匿名**，无需任何会话）')
  // ═══════════════════════════════════════════════════════════

  const init = await mcp(null, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'ac22-probe', version: '1' },
  })
  ck(
    'MCP initialize 无需会话即 200',
    init.status === 200 && init.json?.result?.protocolVersion === '2025-06-18',
    `status=${init.status} protocolVersion=${init.json?.result?.protocolVersion}`,
  )
  ck(
    'initialize 回服务器身份（外部 Agent 需据此判断兼容性）',
    typeof init.json?.result?.serverInfo?.name === 'string',
    `serverInfo.name=${init.json?.result?.serverInfo?.name} version=${init.json?.result?.serverInfo?.version}`,
  )

  const notified = await mcp(null, 'notifications/initialized')
  ck(
    'notifications/initialized ⇒ 202 且**无响应体**（通知没有响应）',
    notified.status === 202 && notified.text === '',
    `status=${notified.status} bodyLen=${notified.text.length}`,
  )

  const ping = await mcp(null, 'ping')
  ck('ping ⇒ 200 且 result 为空对象', ping.status === 200 && ping.json?.result !== undefined, `status=${ping.status}`)

  const toolsList = await mcp(null, 'tools/list')
  const tools = toolsList.json?.result?.tools ?? []
  ck(
    'MCP tools/list 无需会话即取到能力清单',
    toolsList.status === 200 && tools.length > 0,
    `status=${toolsList.status} 工具数=${tools.length}`,
  )
  ck(
    '每个工具都声明了 requiredCapability（不存在"看起来在执法"的空声明）',
    tools.every((t) => typeof t.annotations?.requiredCapability === 'string' && t.annotations.requiredCapability.length > 0),
    tools.map((t) => `${t.name}:${t.annotations?.requiredCapability}`).join(', '),
  )
  ck(
    'tools/list 的 inputSchema 不泄漏内部细节（无表名 / env / 文件路径）',
    scanShapes(JSON.stringify(tools), INTERNAL_DETAIL_SHAPES).length === 0,
    scanShapes(JSON.stringify(tools), INTERNAL_DETAIL_SHAPES).join(', '),
  )

  const mcpGet = await fetch(`${BASE}/api/mcp`, {
    method: 'GET',
    headers: { Origin: BASE, Referer: `${BASE}/workspace` },
    signal: AbortSignal.timeout(15_000),
  }).then(parse)
  ck(
    'GET /api/mcp ⇒ 405 + `Allow: POST`（不做 SSE，且把"该用什么方法"说清楚）',
    mcpGet.status === 405 && String(mcpGet.allow || '').toUpperCase().includes('POST'),
    `status=${mcpGet.status} allow=${mcpGet.allow}`,
  )

  const card = await agentCard()
  const skills = card.json?.skills ?? []
  ck(
    'A2A agent card 匿名可达（静态文件）',
    card.status === 200 && typeof card.json?.name === 'string',
    `status=${card.status} name=${card.json?.name} 技能数=${skills.length}`,
  )
  ck(
    'agent card 的 capabilities 与实际实现一致（streaming / pushNotifications 均为 false）',
    card.json?.capabilities?.streaming === false && card.json?.capabilities?.pushNotifications === false,
    JSON.stringify(card.json?.capabilities ?? {}),
  )

  // ═══════════════════════════════════════════════════════════
  section('── ② 契约一致性（运行时：两套协议清单不得漂移）')
  // ═══════════════════════════════════════════════════════════
  const mcpNames = tools.map((t) => t.name)
  const skillIds = skills.map((s) => s.id)
  const onlyMcp = mcpNames.filter((n) => !skillIds.includes(n))
  const onlyCard = skillIds.filter((n) => !mcpNames.includes(n))
  ck(
    'MCP tools/list 与 A2A agent card skills **双向集合相等**',
    onlyMcp.length === 0 && onlyCard.length === 0,
    onlyMcp.length || onlyCard.length
      ? `仅 MCP: [${onlyMcp.join(', ')}]；仅卡片: [${onlyCard.join(', ')}]`
      : `${mcpNames.length} 项逐字一致`,
  )

  const capDrift = tools
    .map((t) => {
      const s = skills.find((x) => x.id === t.name)
      if (!s) return `${t.name}: 卡片里没有`
      if (s['x-required-capability'] !== t.annotations?.requiredCapability) {
        return `${t.name}: 卡片=${s['x-required-capability']} vs 工具=${t.annotations?.requiredCapability}`
      }
      return null
    })
    .filter(Boolean)
  ck('两份清单对同一工具声明的能力**逐字一致**', capDrift.length === 0, capDrift.join('; '))

  const cardCredHits = scanShapes(JSON.stringify(card.json), CREDENTIAL_SHAPES)
  ck(
    'agent card 不含任何凭据形态（开源仓无凭据 —— 运行时可见的那一半）',
    cardCredHits.length === 0,
    cardCredHits.join(', '),
  )
  ck(
    'agent card 的 url 指向本适配层端点',
    typeof card.json?.url === 'string' && card.json.url.endsWith('/api/v1/a2a/tasks'),
    `url=${card.json?.url}`,
  )

  // 夹具声明的能力必须与运行时清单一致 —— 否则下面的"对照"会打在空气上。
  const probeCapOf = (toolName) => tools.find((t) => t.name === toolName)?.annotations?.requiredCapability
  ck(
    `夹具探针与运行时清单对齐（${AC22_PROBE_TOOLS.elevated.tool} ⇒ ${AC22_PROBE_TOOLS.elevated.capability}）`,
    probeCapOf(AC22_PROBE_TOOLS.elevated.tool) === AC22_PROBE_TOOLS.elevated.capability,
    `实际=${probeCapOf(AC22_PROBE_TOOLS.elevated.tool)}`,
  )
  ck(
    `夹具探针与运行时清单对齐（${AC22_PROBE_TOOLS.selfService.tool} ⇒ ${AC22_PROBE_TOOLS.selfService.capability}）`,
    probeCapOf(AC22_PROBE_TOOLS.selfService.tool) === AC22_PROBE_TOOLS.selfService.capability,
    `实际=${probeCapOf(AC22_PROBE_TOOLS.selfService.tool)}`,
  )

  // ═══════════════════════════════════════════════════════════
  section('── ③ 协作 · 授权路径（断言**真实数据**，不是"空列表也算成功"）')
  // ═══════════════════════════════════════════════════════════

  // ⚠️ REST 面用的是 `paginated(items, meta)` 信封：`data` 是**数组**、`total` 在 `meta` 里；
  //    而 MCP/A2A 直接透传服务层的 `listMissions()` 返回对象（`{items,total,...}`）。
  //    这正是"同一件事、三个信封"的具体形状差异 —— 断言写错形状会假失败，
  //    而假失败常被顺手改成 `>= 0` 之类的空判据，比不写还糟。
  const missionsRest = await tenantReq(cookies.aOperator, 'GET', `/api/v1/missions?organizationId=${OWN_ORG}`)
  const mItems = Array.isArray(missionsRest.json?.data) ? missionsRest.json.data : []
  const mTotal = missionsRest.json?.meta?.total
  ck(
    'REST GET /api/v1/missions（OPERATOR · mission.read）⇒ 200 且含夹具 Mission',
    missionsRest.status === 200 && mTotal >= 1 && mItems.some((m) => m.id === MISSION_ID),
    `status=${missionsRest.status} total=${mTotal} 命中=${mItems.some((m) => m.id === MISSION_ID)}`,
  )

  const mcpMissions = await mcpCall(cookies.aOperator, AC22_PROBE_TOOLS.elevated.tool, { pageSize: 10 })
  const mcpMissionsData = mcpData(mcpMissions)
  ck(
    'MCP tools/call list_missions（OPERATOR）⇒ isError=false 且含夹具 Mission',
    mcpMissions.status === 200 &&
      mcpIsError(mcpMissions) === false &&
      (mcpMissionsData?.items ?? []).some((m) => m.id === MISSION_ID),
    `status=${mcpMissions.status} isError=${mcpIsError(mcpMissions)} total=${mcpMissionsData?.total}`,
  )

  const a2aMissions = await a2a(cookies.aOperator, AC22_PROBE_TOOLS.elevated.tool, { pageSize: 10 })
  const a2aMissionsData = a2aData(a2aMissions)
  ck(
    'A2A tasks（OPERATOR）⇒ state=completed 且 artifacts.data 含夹具 Mission',
    a2aMissions.status === 200 &&
      a2aState(a2aMissions) === 'completed' &&
      (a2aMissionsData?.items ?? []).some((m) => m.id === MISSION_ID),
    `status=${a2aMissions.status} state=${a2aState(a2aMissions)} total=${a2aMissionsData?.total}`,
  )

  const bridgesRest = await tenantReq(cookies.aMember, 'GET', `/api/v1/bridges?organizationId=${OWN_ORG}&limit=5`)
  ck(
    'REST GET /api/v1/bridges（MEMBER · bridge.read 自助）⇒ 200（成员的合法读取不受阻）',
    bridgesRest.status === 200,
    `status=${bridgesRest.status}`,
  )

  const mcpBridges = await mcpCall(cookies.aMember, AC22_PROBE_TOOLS.selfService.tool, { limit: 5 })
  ck(
    'MCP tools/call list_bridges（MEMBER · bridge.read）⇒ isError=false',
    mcpBridges.status === 200 && mcpIsError(mcpBridges) === false,
    `status=${mcpBridges.status} isError=${mcpIsError(mcpBridges)}`,
  )

  const a2aBridges = await a2a(cookies.aMember, AC22_PROBE_TOOLS.selfService.tool, { limit: 5 })
  ck(
    'A2A tasks list_bridges（MEMBER）⇒ state=completed',
    a2aBridges.status === 200 && a2aState(a2aBridges) === 'completed',
    `status=${a2aBridges.status} state=${a2aState(a2aBridges)}`,
  )

  // ═══════════════════════════════════════════════════════════
  section('── ④ 越权 · 无会话（三面必须一致地拒绝）')
  // ═══════════════════════════════════════════════════════════
  const anonRestGet = await tenantReq(null, 'GET', `/api/v1/missions?organizationId=${OWN_ORG}`)
  ck('REST GET（匿名）⇒ 401', anonRestGet.status === 401, `status=${anonRestGet.status}`)

  const anonRestPost = await tenantReq(null, 'POST', `/api/v1/bridges?organizationId=${OWN_ORG}`, { body: {} })
  ck(
    'REST POST（匿名）⇒ 401 而**不是** 400（能力守卫先于请求体校验；否则未认证输入会驱动逻辑）',
    anonRestPost.status === 401,
    `status=${anonRestPost.status}`,
  )

  const anonMcp = await mcpCall(null, AC22_PROBE_TOOLS.selfService.tool)
  ck(
    'MCP tools/call（匿名）⇒ HTTP 401（不是 200 + isError —— 那是业务拒绝，不是未认证）',
    anonMcp.status === 401 && anonMcp.json?.error?.code === -32001,
    `status=${anonMcp.status} rpcCode=${anonMcp.json?.error?.code}`,
  )

  const anonA2a = await a2a(null, AC22_PROBE_TOOLS.selfService.tool)
  ck('A2A tasks（匿名）⇒ 401', anonA2a.status === 401, `status=${anonA2a.status}`)

  // ═══════════════════════════════════════════════════════════
  section('── ⑤ 越权 · 能力不足（**同端点只换角色**的对照）')
  // ═══════════════════════════════════════════════════════════
  const opMissions = await tenantReq(cookies.aOperator, 'GET', `/api/v1/missions?organizationId=${OWN_ORG}`)
  const memMissions = await tenantReq(cookies.aMember, 'GET', `/api/v1/missions?organizationId=${OWN_ORG}`)
  ck(
    '【对照】同一端点 GET /api/v1/missions：OPERATOR 200 / MEMBER 403（只换角色）',
    opMissions.status === 200 && memMissions.status === 403,
    `operator=${opMissions.status} member=${memMissions.status}`,
  )
  ck(
    'MEMBER 的 403 是能力拒绝信封（success:false + PERMISSION_DENIED），不是裸 500',
    memMissions.json?.success === false && memMissions.json?.error?.code === 'PERMISSION_DENIED',
    `code=${memMissions.json?.error?.code}`,
  )

  const memMcpElevated = await mcpCall(cookies.aMember, AC22_PROBE_TOOLS.elevated.tool, { pageSize: 5 })
  ck(
    'MCP tools/call list_missions（MEMBER）⇒ HTTP 200 且 result.isError=true（"调用成功、业务被拒"）',
    memMcpElevated.status === 200 && mcpIsError(memMcpElevated) === true,
    `status=${memMcpElevated.status} isError=${mcpIsError(memMcpElevated)}：${mcpText(memMcpElevated).slice(0, 70).replace(/\s+/g, ' ')}`,
  )
  ck(
    'MCP 越权响应里**不含**夹具数据（拒了就是拒了，不"先返回再过滤"）',
    !mcpText(memMcpElevated).includes(MISSION_ID),
    `含 MissionId=${mcpText(memMcpElevated).includes(MISSION_ID)}`,
  )

  const memA2aElevated = await a2a(cookies.aMember, AC22_PROBE_TOOLS.elevated.tool, { pageSize: 5 })
  ck(
    'A2A tasks list_missions（MEMBER）⇒ HTTP 200 且 state=failed + 无 artifacts',
    memA2aElevated.status === 200 &&
      a2aState(memA2aElevated) === 'failed' &&
      (memA2aElevated.json?.task?.artifacts ?? []).length === 0,
    `status=${memA2aElevated.status} state=${a2aState(memA2aElevated)} message=${String(memA2aElevated.json?.task?.status?.message ?? '').slice(0, 60)}`,
  )
  ck(
    'A2A 越权响应里**不含**夹具数据',
    !JSON.stringify(memA2aElevated.json ?? {}).includes(MISSION_ID),
    '',
  )

  const memBridgePost = await tenantReq(cookies.aMember, 'POST', `/api/v1/bridges?organizationId=${OWN_ORG}`, {
    body: {},
  })
  ck(
    'REST POST /api/v1/bridges（MEMBER · 需 bridge.manage）⇒ 403',
    memBridgePost.status === 403,
    `status=${memBridgePost.status}`,
  )
  // 🔴 刻意**不带** Idempotency-Key：演示/取证脚本不该有副作用。
  //    于是高权限角色在同一请求上会拿到 400（缺幂等键）而不是 201 ——
  //    这既证明"403 是能力判定的结果"，也证明脚本没有偷偷建数据。
  const ownerBridgePost = await tenantReq(cookies.aOwner, 'POST', `/api/v1/bridges?organizationId=${OWN_ORG}`, {
    body: {},
  })
  ck(
    '【对照】同一端点 POST：OWNER 过了能力门槛 ⇒ 400（缺 Idempotency-Key）而非 403（证明 403 归属能力，不是路由恒拒）',
    ownerBridgePost.status === 400,
    `owner=${ownerBridgePost.status} member=${memBridgePost.status}`,
  )

  // ═══════════════════════════════════════════════════════════
  section('── ⑥ 越权 · 跨租户：`organizationId` 是**入参**，不是授权依据')
  // ═══════════════════════════════════════════════════════════
  const ownRest = await tenantReq(cookies.aMember, 'GET', `/api/v1/bridges?organizationId=${OWN_ORG}&limit=1`)
  const foreignRest = await tenantReq(cookies.aMember, 'GET', `/api/v1/bridges?organizationId=${FOREIGN_ORG}&limit=1`)
  ck(
    '【对照】同一端点同一会话：自己的群 200 / 别人的群 403（入参不能撑大权限范围）',
    ownRest.status === 200 && foreignRest.status === 403,
    `own=${ownRest.status} foreign=${foreignRest.status}`,
  )

  const foreignMcp = await mcpCall(cookies.aMember, AC22_PROBE_TOOLS.selfService.tool, {
    organizationId: FOREIGN_ORG,
  })
  ck(
    'MCP tools/call 带非成员 organizationId ⇒ 必须失败（403 + JSON-RPC 错误）',
    foreignMcp.status === 403 && foreignMcp.json?.error?.code === -32001,
    `status=${foreignMcp.status} rpcCode=${foreignMcp.json?.error?.code}`,
  )

  const foreignA2a = await a2a(cookies.aMember, AC22_PROBE_TOOLS.selfService.tool, {
    organizationId: FOREIGN_ORG,
  })
  ck('A2A tasks 带非成员 organizationId ⇒ 403', foreignA2a.status === 403, `status=${foreignA2a.status}`)

  // ═══════════════════════════════════════════════════════════
  section('── ⑦ 协议健壮性（错误语义必须可区分）')
  // ═══════════════════════════════════════════════════════════
  const badJson = await mcp(null, null, undefined, { rawBody: '{ not json' })
  ck(
    '非法 JSON ⇒ -32700 / HTTP 400（Parse error 与"业务拒绝"不是一回事）',
    badJson.status === 400 && badJson.json?.error?.code === -32700,
    `status=${badJson.status} code=${badJson.json?.error?.code}`,
  )

  const badEnvelope = await mcp(null, null, undefined, { rawBody: JSON.stringify({ method: 'ping' }) })
  ck(
    '缺 jsonrpc 信封 ⇒ -32600 / HTTP 400',
    badEnvelope.status === 400 && badEnvelope.json?.error?.code === -32600,
    `status=${badEnvelope.status} code=${badEnvelope.json?.error?.code}`,
  )

  const unknownMethod = await mcp(null, 'resources/list')
  ck(
    '未实现的协议方法 ⇒ -32601 / HTTP 404',
    unknownMethod.status === 404 && unknownMethod.json?.error?.code === -32601,
    `status=${unknownMethod.status} code=${unknownMethod.json?.error?.code}`,
  )

  const unknownTool = await mcpCall(cookies.aMember, 'definitely_not_a_tool')
  const available = unknownTool.json?.error?.data?.available ?? []
  ck(
    '未知工具 ⇒ -32602 且回列可用工具（清单与 tools/list **同源**）',
    unknownTool.json?.error?.code === -32602 &&
      available.length === mcpNames.length &&
      mcpNames.every((n) => available.includes(n)),
    `code=${unknownTool.json?.error?.code} available=${available.length}/${mcpNames.length}`,
  )

  const unknownSkill = await tenantReq(cookies.aMember, 'POST', '/api/v1/a2a/tasks', { body: { skillId: 'nope' } })
  ck(
    'A2A 未知技能 ⇒ 404 SKILL_NOT_FOUND + 可用技能清单',
    unknownSkill.status === 404 && unknownSkill.json?.error?.code === 'SKILL_NOT_FOUND',
    `status=${unknownSkill.status} code=${unknownSkill.json?.error?.code}`,
  )

  const missingSkill = await tenantReq(cookies.aMember, 'POST', '/api/v1/a2a/tasks', { body: {} })
  ck(
    'A2A 缺 skillId ⇒ 400 INVALID_ARGUMENT',
    missingSkill.status === 400 && missingSkill.json?.error?.code === 'INVALID_ARGUMENT',
    `status=${missingSkill.status} code=${missingSkill.json?.error?.code}`,
  )

  // ═══════════════════════════════════════════════════════════
  section('── ⑧ 失败路径不得泄漏内部细节（AC-22 的"无凭据"还有这一层）')
  // ═══════════════════════════════════════════════════════════
  const errorBodies = [
    ['MCP 非法 JSON', badJson],
    ['MCP 未知工具', unknownTool],
    ['MCP 跨租户', foreignMcp],
    ['REST 403', memBridgePost],
    ['A2A 404', unknownSkill],
  ]
  for (const [label, r] of errorBodies) {
    const hits = scanShapes(JSON.stringify(r.json ?? {}), INTERNAL_DETAIL_SHAPES)
    ck(`${label} 的响应体不含内部细节`, hits.length === 0, hits.join(', '))
  }

  // ═══════════════════════════════════════════════════════════
  section('── ⑨ 交付铁律「外部示例**可运行**」：实跑 examples/sdk/ 全部脚本')
  // ═══════════════════════════════════════════════════════════
  // 为什么"能跑"必须在这里实跑，而不是靠 review 源码：
  //   示例最容易坏的方式是**静默**的 —— 信封形状变了、某个状态码改了、
  //   登录端点换了，示例里的断言就会写错。写错了也只会在"读者真正去跑"时才发现，
  //   而那时它已经作为"文档"发布出去了。
  //   ⚠️ 用 MEMBER 账号跑：这样三组"越权"分支**真的会触发**（而不是走 SKIP），
  //      等于把示例自身的越权断言也一并取证了。
  const memberEnv = {
    LOKFEEL_LOGIN_EMAIL: AC22_USERS.aMember.email,
    LOKFEEL_LOGIN_PASSWORD: AC22_PASSWORD,
  }
  const exampleRuns = [
    { label: 'demo-discovery.ts（免凭据）', file: 'demo-discovery.ts', env: {} },
    { label: 'demo-mcp.ts（MCP 授权/越权）', file: 'demo-mcp.ts', env: memberEnv },
    { label: 'demo-a2a.ts（A2A 授权/越权）', file: 'demo-a2a.ts', env: memberEnv },
    { label: 'demo-rest.ts（REST 授权/越权）', file: 'demo-rest.ts', env: memberEnv },
  ]
  for (const ex of exampleRuns) {
    const r = await runToCompletion('npx', ['tsx', `examples/sdk/${ex.file}`], {
      LOKFEEL_BASE_URL: BASE,
      ...ex.env,
    })
    ck(
      `示例 ${ex.label} 退出码 0`,
      r.code === 0,
      r.code === 0 ? '' : `code=${r.code}：${r.tail.slice(-320).replace(/\s+/g, ' ')}`,
    )
  }

  // ═══════════════════════════════════════════════════════════
  console.log(
    `\n════════ AC-22 结果：${pass} 通过 / ${fail} 失败 ════════\n` +
      `发现（匿名）：MCP initialize / tools/list 与 A2A agent card 均无需会话可达；两份清单双向一致\n` +
      `协作（授权）：MEMBER bridge.read、OPERATOR mission.read 三面（MCP/A2A/REST）均成功且返回真实数据\n` +
      `越权（必须失败）：无会话 401 · 能力不足 MCP/A2A 走 isError/failed、REST 403 · 跨租户 403\n` +
      `协议健壮：-32700 / -32600 / -32601 / -32602 各归其位；失败响应不泄漏内部细节\n` +
      `外部示例：examples/sdk/ 四个脚本在本运行时上实跑通过（含示例自身的越权断言）\n`,
  )
  process.exitCode = fail === 0 ? 0 : 1
  return
}

main()
  .catch((err) => {
    console.error('\n❌ 取证脚本异常：', err?.stack || err?.message || err)
    process.exitCode = 1
  })
  .finally(() => {
    killAll()
    console.log(`（已停止本次启动的子进程；服务日志见 ${LOG_DIR}）`)
  })

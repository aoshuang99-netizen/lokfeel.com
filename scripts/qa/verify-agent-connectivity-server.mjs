#!/usr/bin/env node
/**
 * T09 Slice 6 · **生产出口**连通性复验（走应用内的诊断端点）
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么不能只看 `verify:agent:connectivity`（本机版）
 * ═══════════════════════════════════════════════════════════════
 * 本机版证的是**跑它的那台机器**能不能出去。2026-10-15 实跑已证明两者可以完全相反：
 * 本机直连超时、走本机代理才 401；而生产（Netlify 函数）是**直连**出口。
 * ⇒ "本机验绿"**推不出**"生产能到"。本脚本打的是**生产自己**的出口。
 *
 * ═══════════════════════════════════════════════════════════════
 * 判据
 * ═══════════════════════════════════════════════════════════════
 *   ① 匿名 `GET /api/v1/agents/diagnostics/connectivity` → **401 + JSON**
 *      （证明路由已注册，且能力闸门生效 —— 不是"谁都能拿到的诊断面"）
 *   ② 真实登录（自定义端点 `/api/auth/login`，与登录页同路径）后带 cookie 再打 → **200 + JSON**
 *   ③ 报告**五段齐备**：`endpoint` / `network` / `identity` / `credentials` / `probe`
 *      —— 少一段就说明"分层"这件事在生产上塌了一层
 *   ③b 🔴 `endpoint.provider` 必须存在，且云端算力的 probeUrl 必须是 `/.cloud/llm/models`
 *      （2026-10-20 起真实调用走云端算力；探错路径会拿到 404，看起来像"端点坏了"）
 *   ③c 🔴 **诊断口径 == 运行时口径**：与 `/api/v1/agents/usage` 的诚实块比对 provider
 *      （否则"运行真的在调云端、诊断说没配置"会把人带沟里）
 *   ④ 🔴 **服务端自己算的 summary 与客户端按同一规则重算的一致**
 *      （诊断报告若会自相矛盾，读它的人就无法据此行动）
 *   ⑤ 🔴 **不泄漏密钥**：响应体里不得出现 `sk-` / `wbpk_` 形态串，也不得出现 `Bearer `
 *   ⑥ 🔴 **单调性**：凭据层 PASS ⇒ 网络层 PASS（"凭据被端点接受"蕴含"端点回了我"）
 *   ⑦ 泄漏负测：任何响应不得含部署专用域名 `<deploy-id>--<site>.netlify.app`
 *
 * ⚠️ 能力不足（403）记 **SKIP**，不记 FAIL：
 *    它是"本环境缺前提"，不是"端点坏了"。缺前提 ≠ 破坏（与两版连通性脚本同一口径）。
 *
 * 用法：
 *   node scripts/qa/verify-agent-connectivity-server.mjs
 *   QA_BASE_URL=https://app.lokfeel.com node scripts/qa/verify-agent-connectivity-server.mjs
 *   QA_EMAIL=qa.female@lokfeel.com node scripts/qa/verify-agent-connectivity-server.mjs
 *
 * 退出码：0 = 无 FAIL；1 = 有 FAIL。
 */

import { QA_PASSWORD } from './qa-credentials.mjs'

const BASE = (process.env.QA_BASE_URL || 'https://app.lokfeel.com').replace(/\/$/, '')
const EMAIL = process.env.QA_EMAIL || 'qa.male@lokfeel.com'
const PATH = '/api/v1/agents/diagnostics/connectivity'
const DEPLOY_HOST_RE = /--[a-z0-9-]+\.netlify\.app/i

let pass = 0
let fail = 0
let skip = 0
const leaks = []

const ck = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`)
  ok ? pass++ : fail++
}
const sk = (label, extra = '') => {
  console.log(`  ⏭️  SKIP ${label}${extra ? '  ' + extra : ''}`)
  skip++
}

function noteLeak(label, text) {
  if (DEPLOY_HOST_RE.test(text)) leaks.push(label)
}

async function get(path, headers = {}, timeout = 30000) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    })
    const text = await res.text()
    // 外部诊断端点尤其不该把自己的部署域名写进响应头/体（跳转丢 cookie 的老坑）。
    noteLeak(`${path} → location`, res.headers.get('location') || '')
    noteLeak(`${path} → body`, text)
    return {
      status: res.status,
      text,
      ctype: res.headers.get('content-type') || '',
      location: res.headers.get('location') || '',
    }
  } catch (e) {
    return { status: 0, text: '', ctype: '', location: '', err: `${e.name}: ${e.message}` }
  }
}

/** 真实登录路径（与登录页完全一致：同源守卫要求的 Origin/Referer 一并带上）。 */
async function realLogin(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: BASE, Referer: `${BASE}/login` },
    body: JSON.stringify({ email, password: QA_PASSWORD }),
    redirect: 'manual',
    signal: AbortSignal.timeout(25000),
  })
  const text = await res.text()
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
  return { res, text, cookie }
}

/** 与 `summarizeConnectivity()` **逐字同规则**重算（这份重算本身就是断言）。 */
function recomputeSummary(report) {
  const layers = [report?.network, report?.identity, report?.credentials]
  if (layers.some((l) => l?.verdict === 'FAIL')) return 'FAIL'
  if (layers.some((l) => l?.verdict === 'BLOCKED')) return 'BLOCKED'
  return 'PASS'
}

const LAYERS = ['network', 'identity', 'credentials']
const VERDICTS = ['PASS', 'FAIL', 'BLOCKED', 'INFO']
/** 端点来源：`workbuddy` = 云端算力配置（2026-10-20 起的生产主路径）。 */
const SOURCES = ['workbuddy', 'env', 'kernel-default']
/** 诊断必须说明探的是哪条真实调用路径。 */
const PROVIDERS = ['workbuddy', 'openai']

async function main() {
  console.log(`\n════════ T09 生产出口连通性复验 ════════`)
  console.log(`  目标 : ${BASE}`)
  console.log(`  端点 : GET ${PATH}`)
  console.log(`  账号 : ${EMAIL}`)
  console.log(`  说明 : 该端点只读 / 不计费（仅 GET /models）/ 不落库 / 不泄漏密钥\n`)

  // ── ① 匿名必须被拒 ──────────────────────────────────────────
  console.log('[1] 匿名访问：能力闸门必须生效（否则这是个谁都能读的诊断面）')
  const anon = await get(PATH)
  ck('匿名 → 401', anon.status === 401, `status=${anon.status}${anon.err ? ` ${anon.err}` : ''}`)
  ck('匿名 → JSON 信封', /application\/json/i.test(anon.ctype), `ctype=${anon.ctype || '(空)'}`)
  if (anon.status === 404) {
    ck('路由已上线', false, '拿到 404 → 该路由未部署（或路径写错）')
  }

  // ── ② 登录 ─────────────────────────────────────────────────
  console.log('\n[2] 真实登录路径（自定义端点，与登录页同一条）')
  let login
  try {
    login = await realLogin(EMAIL)
  } catch (e) {
    ck('POST /api/auth/login 可达', false, `${e.name}: ${e.message}`)
    return finish()
  }
  ck('POST /api/auth/login → 200', login.res.status === 200, `status=${login.res.status}`)
  const hasSession = /session-token/i.test(login.cookie)
  ck('下发了会话 cookie', hasSession, login.cookie ? '(已下发)' : '(无)')
  if (!login.cookie) {
    sk('带会话复验诊断端点', '登录未拿到 cookie，后续无法进行')
    return finish()
  }

  // ── ③ 带会话打诊断端点 ──────────────────────────────────────
  console.log('\n[3] 带会话访问诊断端点（这一步读的是**生产出口**的真实结论）')
  const r = await get(PATH, { cookie: login.cookie })
  if (r.status === 403) {
    sk(
      `GET ${PATH} → 403`,
      `该账号能力不足（需要 agent.execute = OPERATOR+）。生产出口取证需用一个具备该组织角色的账号重跑：QA_EMAIL=... `,
    )
    return finish()
  }
  ck(`GET ${PATH} → 200`, r.status === 200, `status=${r.status}${r.err ? ` ${r.err}` : ''}`)
  if (r.status !== 200) {
    console.log(`     body: ${r.text.slice(0, 200).replace(/\s+/g, ' ')}`)
    return finish()
  }

  let envelope
  try {
    envelope = JSON.parse(r.text)
  } catch {
    ck('响应可解析为 JSON', false, r.text.slice(0, 160))
    return finish()
  }
  // `success()` 信封 → `{ ok: true, data: ... }`（与其它 v1 端点一致）
  const report = envelope?.data ?? envelope

  console.log('\n[4] 报告形状：五段齐备（少一段 = 分层在生产上塌了一层）')
  for (const key of ['endpoint', 'network', 'identity', 'credentials', 'probe']) {
    ck(`含 ${key}`, report?.[key] !== undefined && report[key] !== null, `type=${typeof report?.[key]}`)
  }
  ck(
    'endpoint 含 baseUrl / source / probeUrl（能说清"打的是哪个端点、谁定的"）',
    typeof report?.endpoint?.baseUrl === 'string' &&
      SOURCES.includes(report?.endpoint?.source) &&
      typeof report?.endpoint?.probeUrl === 'string',
    `baseUrl=${report?.endpoint?.baseUrl} source=${report?.endpoint?.source}`,
  )
  ck(
    'endpoint.provider ∈ workbuddy/openai（诊断必须说明探的是哪条真实调用路径）',
    PROVIDERS.includes(report?.endpoint?.provider),
    `provider=${report?.endpoint?.provider} model=${report?.endpoint?.model}`,
  )
  // 云端算力走的是自己的模型目录路径；探错路径会拿到 404，看起来像"端点坏了"。
  ck(
    '云端算力：probeUrl 是 /.cloud/llm/models（不是 OpenAI 的 /models）',
    report?.endpoint?.provider !== 'workbuddy' ||
      String(report?.endpoint?.probeUrl ?? '').endsWith('/.cloud/llm/models'),
    `probeUrl=${report?.endpoint?.probeUrl}`,
  )
  for (const l of LAYERS) {
    ck(
      `${l} 是分层结论（verdict ∈ ${VERDICTS.join('/')}，且含 detail）`,
      VERDICTS.includes(report?.[l]?.verdict) && typeof report?.[l]?.detail === 'string',
      `${l}.verdict=${report?.[l]?.verdict}`,
    )
  }

  // 🔴 诊断与运行时必须同口径：否则"运行真的在调云端、诊断说没配置"会把人带沟里。
  console.log('\n[4b] 🔴 诊断口径 == 运行时口径（读同一份诚实块比对）')
  const usage = await get('/api/v1/agents/usage', { cookie: login.cookie })
  let honesty = null
  try {
    const j = JSON.parse(usage.text)
    const data = j?.data ?? j
    honesty = data?.provider ?? data?.honesty ?? null
  } catch {
    honesty = null
  }
  const runtimeKind = honesty && typeof honesty === 'object' ? honesty.provider : undefined
  const realCalls = honesty && typeof honesty === 'object' ? honesty.realCallsEnabled : undefined
  ck('用量接口可读到诚实块', usage.status === 200 && honesty !== null, `status=${usage.status}`)
  ck(
    `诊断 provider 与运行时一致（诊断=${report?.endpoint?.provider} 运行时=${runtimeKind}）`,
    Boolean(runtimeKind) && report?.endpoint?.provider === runtimeKind,
  )
  ck(
    '诚实块 realCallsEnabled=true 时，凭据层不得是 BLOCKED（自相矛盾即不可信）',
    realCalls !== true || report?.credentials?.verdict !== 'BLOCKED',
    `realCallsEnabled=${realCalls} credentials=${report?.credentials?.verdict}`,
  )

  console.log('\n[5] 🔴 诚实性：报告不得自相矛盾、不得把前提说成结论')
  ck(
    '每一层都不是"靠猜"的：network 有 status 字段、credentials 有 keyPresent/keyLength',
    'status' in (report?.network ?? {}) &&
      typeof report?.credentials?.keyPresent === 'boolean' &&
      typeof report?.credentials?.keyLength === 'number',
  )
  const recomputed = recomputeSummary(report)
  const served = report?.summary?.verdict
  ck(
    `服务端 summary 与客户端重算一致（服务端=${served} 重算=${recomputed}）`,
    served === recomputed,
    served ? '' : '响应里没有 summary.verdict',
  )
  ck(
    '🔴 凭据层 PASS ⇒ 网络层 PASS（凭据被接受必然蕴含端点回了我）',
    report?.credentials?.verdict !== 'PASS' || report?.network?.verdict === 'PASS',
  )
  ck(
    '🔴 无 key 时凭据层**不得**报 PASS（缺前提 ≠ 通过）',
    report?.credentials?.keyPresent !== false || report?.credentials?.verdict === 'BLOCKED',
    `keyPresent=${report?.credentials?.keyPresent} verdict=${report?.credentials?.verdict}`,
  )
  ck(
    '🔴 summary=BLOCKED 时措辞必须明说"不得宣称已验"',
    served !== 'BLOCKED' || /不得宣称/.test(String(report?.summary?.message ?? '')),
  )

  console.log('\n[6] 🔴 不泄漏密钥')
  const skLike = r.text.match(/sk-[A-Za-z0-9_-]{12,}/g) || []
  const wbpkLike = r.text.match(/wbpk_[A-Za-z0-9_-]{12,}/g) || []
  ck('响应体无 sk- 形态密钥串', skLike.length === 0, skLike.length ? `命中 ${skLike.length} 处` : '')
  ck('响应体无 wbpk_ 形态应用凭据', wbpkLike.length === 0, wbpkLike.length ? `命中 ${wbpkLike.length} 处` : '')
  ck('响应体无 Bearer 明文', !/Bearer\s+\S/.test(r.text))

  console.log('\n[7] 关键读数（人工判断用）')
  console.log(`     provider   : ${report?.endpoint?.provider}  model=${report?.endpoint?.model}`)
  console.log(`     endpoint   : ${report?.endpoint?.baseUrl}  [${report?.endpoint?.source}]  probe=${report?.endpoint?.probeUrl}`)
  console.log(`     network    : ${report?.network?.verdict}  HTTP ${report?.network?.status}  ${report?.network?.latencyMs ?? '-'}ms`)
  console.log(`     identity   : ${report?.identity?.verdict}`)
  console.log(`     credentials: ${report?.credentials?.verdict}  keyPresent=${report?.credentials?.keyPresent} len=${report?.credentials?.keyLength} var=${report?.credentials?.keyVar}`)
  console.log(`     runtime    : ${runtimeKind ?? '(未读到)'}  realCallsEnabled=${realCalls}`)
  console.log(`     summary    : ${served} —— ${report?.summary?.message ?? ''}`)
  for (const l of LAYERS) console.log(`     · ${l}: ${report?.[l]?.detail ?? ''}`)

  console.log('\n[8] 泄漏负测：不得出现部署专用域名')
  ck('响应无 --xxx.netlify.app', leaks.length === 0, leaks.length ? leaks.join(' | ') : '')

  return finish()
}

function finish() {
  console.log(`\n════════ 结果：${pass} 通过 / ${fail} 失败 / ${skip} 跳过 ════════`)
  if (fail === 0 && skip === 0) {
    console.log('🟢 生产出口连通性**已被端点实证**（见上面三层读数）。\n')
  } else if (fail === 0) {
    console.log('🟡 已判定项通过，但存在未判定项 —— 不得宣称"生产出口已验"。\n')
  } else {
    console.log('🔴 未通过 —— 见上面 ❌ 项。\n')
  }
  process.exitCode = fail === 0 ? 0 : 1
  return process.exitCode
}

main().catch((e) => {
  console.error('\n💥 复验脚本崩溃：', e)
  process.exit(2)
})

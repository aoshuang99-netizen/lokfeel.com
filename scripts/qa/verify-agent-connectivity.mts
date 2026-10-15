#!/usr/bin/env node
/**
 * T09 Slice 5 · 第 ③ 项「真实端点连通性」取证
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔴 这个脚本存在的唯一理由：**把三件事分开报告**
 * ═══════════════════════════════════════════════════════════════
 *
 *   ① 出口路由  —— 「这台机器**经哪条路**能出去」（直连 / 显式代理 / 注入代理 / 系统代理）
 *   ② 网络可达  —— 「到了一个 HTTP 响应吗」（DNS 解析 + TLS 握手 + HTTP 往返）
 *   ③ 凭据可用  —— 「配的 key 能不能被端点认」
 *
 *   把三者合成一个 PASS 是本仓踩过的坑（T08 Creem 同形）：
 *   「网络通」不等于「凭据对」，「凭据对」也不等于「网络通」。
 *   运维需要知道**该修哪一侧** —— 改防火墙/代理，还是去配 env。合成一个绿点
 *   会把「网络坏」和「没配 key」压成同一个现象，等于没取证。
 *
 *   🔴 **① 是本脚本最重要的一条**（是 2026-10-15 实跑后补上的）：
 *      首版只有 `--no-proxy-server` 一条路，跑出「api.openai.com 不可达」。
 *      但同一台机器上 `curl -x http://127.0.0.1:10808 https://api.openai.com/v1/models`
 *      拿到 **401（0.7s）** —— 端点好得很，坏的是**探针自己没走对路**。
 *      把「路由没选对」报成「端点不可达」是典型的**假红**：它会让人去改
 *      根本没坏的东西。所以现在**先穷举已知出口、再取证**，并把每条路的结果
 *      逐条列出 —— 那张表本身就是结论。
 *
 *   因此本脚本**恒有第四种状态**：`BLOCKED`（缺前提，无法判定）。
 *   ⚠️ `BLOCKED` **不是** PASSED。缺 `OPENAI_API_KEY` 时凭据侧永远是 `BLOCKED`，
 *      不会因为"网络通了"就顺手报绿（那是把前提当结论）。
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔴 不产生任何计费调用
 * ═══════════════════════════════════════════════════════════════
 *   只打 `GET {baseUrl}/models`（列模型）。它**不是** `POST /chat/completions`：
 *   不计 token、不进账单。这是刻意的 ——
 *     · 连通性取证不该花用户的钱；
 *     · 它也不该在账本里留下一条"看起来像一次真实运行"的痕迹（AC-20 归因会被污染）。
 *
 *   **刻意不打 `/chat/completions`**：可达性是 host+port+TLS 的性质，与 HTTP 方法无关。
 *   同一个 origin 上 `/models` 能收到真实 OpenAI 的 401，`/chat/completions` 就同在该
 *   origin 上可达。为多证这一点而构造一个 POST，要付出浏览器 CORS 预检/下载劫持的复杂度，
 *   收益却近乎零 —— 所以不做，并在此写明这是**有意的范围边界**，不是遗漏。
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔴 为什么用真实 Chrome 而不是 Node/curl
 * ═══════════════════════════════════════════════════════════════
 *   本仓既有结论：沙箱给 shell 注入 `HTTP_PROXY=127.0.0.1:<随机端口>`，Node/curl
 *   直连外部端口一律 000。真实 Chrome 是本仓被证明能出去的通路 ——
 *   与 `scripts/qa/verify-turn-prod.mjs` 同口径。
 *
 *   ⚠️ 反过来读：本脚本若报「全部出口均不可达」，只说明**这台机器**出不去，
 *      并不说明生产端点坏了。两种结论的措辞必须严格区分 —— 见汇总段。
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔴 baseUrl 的单一事实来源
 * ═══════════════════════════════════════════════════════════════
 *   生产默认值从内核 `OPENAI_DEFAULTS.baseUrl` **导入**，不在这里抄第二份。
 *   若 `OPENAI_BASE_URL` 被设置（自建/代理端点），以 env 为准，并**明确标出**它是 env 值
 *   —— 否则脚本可能在一个"生产根本不用"的端点上验绿（假绿）。
 *
 * 用法：
 *   npx tsx scripts/qa/verify-agent-connectivity.mts                       # 自动发现出口
 *   OPENAI_API_KEY=sk-... npx tsx scripts/qa/verify-agent-connectivity.mts # 连凭据一起验
 *   QA_PROBE_PROXY=http://127.0.0.1:10808 npx tsx ...                      # 只走指定代理
 *   OPENAI_BASE_URL=https://my-gateway.example/v1 npx tsx ...              # 验自建端点
 *
 * 退出码：0 = 已判定项全绿（缺凭据记 BLOCKED，**不**影响退出码）
 *         1 = 全部出口不可达 / 端点身份可疑 / 凭据被端点拒绝
 */

import { chromium, type Browser, type Page, type Response as PWResponse } from 'playwright'
import { OPENAI_DEFAULTS } from '@/lib/agent'

// ═══════════════════════════════════════════════════════════════
// 目标端点解析
// ═══════════════════════════════════════════════════════════════

const envBase = (process.env.OPENAI_BASE_URL ?? '').trim()
const BASE_URL = (envBase || OPENAI_DEFAULTS.baseUrl).replace(/\/+$/, '')
const BASE_SOURCE: 'env' | 'kernel-default' = envBase ? 'env' : 'kernel-default'

const MODEL = (process.env.OPENAI_MODEL ?? '').trim() || OPENAI_DEFAULTS.model
const API_KEY = (process.env.OPENAI_API_KEY ?? '').trim()
const MODELS_URL = `${BASE_URL}/models`

const DISCOVERY_TIMEOUT_MS = Number((process.env.QA_PROBE_DISCOVERY_TIMEOUT_MS ?? '').trim()) || 8_000
const PROBE_TIMEOUT_MS = Number((process.env.QA_PROBE_TIMEOUT_MS ?? '').trim()) || 20_000

let hostname = ''
let isOpenAIHost = false
try {
  hostname = new URL(BASE_URL).hostname
  // 只有真·OpenAI 域名才做「响应形状"必须是 OpenAI 的 401"」这类身份断言 ——
  // 自建/代理端点的错误体形状由它自己决定，不该被本脚本判死。
  isOpenAIHost = /(^|\.)openai\.com$/i.test(hostname)
} catch {
  hostname = '(无法解析)'
}

// ═══════════════════════════════════════════════════════════════
// 结果账
// ═══════════════════════════════════════════════════════════════

type Verdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO'
const rows: Array<{ section: string; name: string; verdict: Verdict; detail: string }> = []
function record(section: string, name: string, verdict: Verdict, detail = ''): void {
  rows.push({ section, name, verdict, detail })
  const mark = verdict === 'PASS' ? '✅' : verdict === 'FAIL' ? '❌' : verdict === 'BLOCKED' ? '⛔' : 'ℹ️ '
  console.log(`  ${mark} [${verdict}] ${name}${detail ? '  → ' + detail : ''}`)
}

// ═══════════════════════════════════════════════════════════════
// 出口路由候选
//
// 顺序 = 从"最可能在生产成立"到"最可能是本机特例"：
//   · 直连放第一：生产（Netlify 函数）是直连，本机代理是**本机特例**。
//     若把它放前面，本机验绿会让人误以为"生产也就通了" —— 那是假绿的另一面。
//   · 沙箱注入的 `HTTPS_PROXY` 也列出来：它解释了"为什么 npm 能装包但探不了 openai"
//     （它只放行白名单主机，OpenAI 不在内 → CONNECT 隧道 502）。
// ═══════════════════════════════════════════════════════════════

interface Route {
  label: string
  args: string[]
}

function buildRoutes(): Route[] {
  const explicit = (process.env.QA_PROBE_PROXY ?? '').trim()
  const candidates: Route[] = [{ label: '直连（--no-proxy-server）', args: ['--no-proxy-server'] }]

  const pushProxy = (label: string, url: string) => {
    const v = url.trim()
    if (!v) return
    const normalized = /^https?:\/\//i.test(v) ? v : `http://${v}`
    if (candidates.some((c) => c.args[0] === `--proxy-server=${normalized}`)) return
    candidates.push({ label: `${label}（${normalized}）`, args: [`--proxy-server=${normalized}`] })
  }

  if (explicit) {
    pushProxy('显式指定 QA_PROBE_PROXY', explicit)
  } else {
    pushProxy('环境变量 HTTPS_PROXY', process.env.HTTPS_PROXY ?? '')
    pushProxy('环境变量 HTTP_PROXY', process.env.HTTP_PROXY ?? '')
    // 本项目已知的本地代理（v2rayN 内嵌 xray，见工作记忆）。**不是**硬编码依赖：
    // 通了就报通、不通就报不通，不影响结论以外的任何东西。
    pushProxy('本项目已知本地代理', 'http://127.0.0.1:10808')
  }

  // 兜底：让 Chrome 用系统代理设置。
  candidates.push({ label: '系统代理（Chrome 默认行为）', args: [] })
  return candidates
}

// ═══════════════════════════════════════════════════════════════
// 浏览器 / 探针
// ═══════════════════════════════════════════════════════════════

async function launchBrowser(route: Route): Promise<Browser> {
  const errors: string[] = []
  for (const opts of [{ channel: 'chrome', args: route.args }, { args: route.args }]) {
    try {
      return await chromium.launch(opts)
    } catch (e) {
      errors.push(`${opts.channel || 'chromium'}: ${(e as Error).message.split('\n')[0]}`)
    }
  }
  throw new Error('无法启动浏览器:\n  ' + errors.join('\n  '))
}

interface HttpProbe {
  /** 是否真的收到了一个 HTTP 响应。网络层可达的**唯一**硬证据。 */
  gotResponse: boolean
  status: number | null
  headers: Record<string, string>
  body: string
  /** 导航/网络层错误（DNS 失败 / 连接超时 / TLS 失败 / 隧道失败）。 */
  navError: string | null
}

/**
 * 用一次**导航**去拿响应。
 *
 * 为什么用 `waitUntil: 'commit'` + `response` 事件，而不是 `waitUntil: 'load'`：
 *   `application/json` 响应在 Chrome 里可能被当成下载 → 导航被 abort → `goto` 抛
 *   `net::ERR_ABORTED`。但**响应其实已经收到了**（TLS 过了、状态码有了）。
 *   若用 `load` 并把异常当"不可达"，就会把"端点好好的"误报成"网络坏了"。
 *   所以：状态码从 `response` 事件取，`goto` 的异常只作为**辅助**信息。
 */
async function navigateProbe(page: Page, url: string, timeoutMs: number): Promise<HttpProbe> {
  const out: HttpProbe = { gotResponse: false, status: null, headers: {}, body: '', navError: null }
  const pending: Array<Promise<void>> = []

  const onResponse = (r: PWResponse) => {
    if (r.url() !== url) return
    out.status = r.status()
    out.gotResponse = true
    pending.push(
      (async () => {
        out.headers = await r.allHeaders().catch(() => ({}))
        out.body = await r.text().catch(() => '')
      })(),
    )
  }
  page.on('response', onResponse)
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: timeoutMs })
  } catch (e) {
    out.navError = String((e as Error).message ?? e).split('\n')[0]
  }
  await Promise.all(pending)
  page.off('response', onResponse)

  // 兜底：某些 Chrome 版本在 abort 后不再补发 response 事件，异常信息里却带状态码。
  if (!out.gotResponse && out.navError) {
    const m = out.navError.match(/\b(4\d\d|5\d\d)\b/)
    if (m) {
      out.gotResponse = true
      out.status = Number(m[1])
    }
  }
  return out
}

/** 把导航异常压成一句人话（区分"路不通"与"端点不回"）。 */
function humanizeNavError(msg: string | null): string {
  if (!msg) return '(无)'
  if (/ERR_TUNNEL_CONNECTION_FAILED/i.test(msg)) return '代理拒绝了 CONNECT 隧道（该代理不放行此主机）'
  if (/ERR_NAME_NOT_RESOLVED/i.test(msg)) return 'DNS 解析失败'
  if (/ERR_CONNECTION_(REFUSED|RESET|CLOSED)/i.test(msg)) return '连接被拒绝/重置'
  if (/ERR_(PROXY_CONNECTION_FAILED|MANDATORY_PROXY_CONFIGURATION_FAILED)/i.test(msg)) return '代理不可用'
  if (/ERR_CERT|SSL/i.test(msg)) return 'TLS/证书失败'
  if (/Timeout \d+ms exceeded/i.test(msg)) return `超时（${DISCOVERY_TIMEOUT_MS}ms 内无响应）`
  return msg.split('\n')[0].slice(0, 160)
}

// ═══════════════════════════════════════════════════════════════
// 主体
// ═══════════════════════════════════════════════════════════════

async function main(): Promise<number> {
  console.log('\n════════ T09 真实端点连通性取证 ════════')
  console.log(`  目标端点 : ${BASE_URL}`)
  console.log(
    `  来源     : ${BASE_SOURCE === 'env' ? 'OPENAI_BASE_URL（env 覆盖内核默认值）' : '内核 OPENAI_DEFAULTS.baseUrl（无 env 覆盖）'}`,
  )
  console.log(`  期望模型 : ${MODEL}`)
  console.log(`  凭据     : ${API_KEY ? `已配置（长度 ${API_KEY.length}，不打印明文）` : '未配置 OPENAI_API_KEY'}`)
  console.log(`  探针     : GET ${MODELS_URL}  —— 列模型，**不计费**`)

  // ─── [1] 出口路由发现 ────────────────────────────────────────
  console.log('\n[1] 出口路由发现（哪条路能出去 —— 这张表本身就是结论）')
  const routes = buildRoutes()
  let winner: { route: Route; browser: Browser; probe: HttpProbe } | null = null
  let fallback: { route: Route; browser: Browser; probe: HttpProbe } | null = null

  for (const route of routes) {
    let browser: Browser
    try {
      browser = await launchBrowser(route)
    } catch (e) {
      record('路由', route.label, 'INFO', `浏览器启动失败：${(e as Error).message.split('\n')[0].slice(0, 120)}`)
      continue
    }
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const probe = await navigateProbe(page, MODELS_URL, DISCOVERY_TIMEOUT_MS)
    await ctx.close()

    if (probe.gotResponse && probe.status !== null && probe.status < 500) {
      record('路由', route.label, 'PASS', `收到 HTTP ${probe.status} —— 这条路能出去`)
      winner = { route, browser, probe }
      break
    }
    if (probe.gotResponse) {
      record('路由', route.label, 'INFO', `收到 HTTP ${probe.status}（5xx，疑似中间层错误，继续找可用路由）`)
      if (!fallback) fallback = { route, browser, probe }
      continue
    }
    record('路由', route.label, 'INFO', `未收到响应：${humanizeNavError(probe.navError)}`)
    await browser.close().catch(() => {})
  }

  if (!winner && fallback) {
    // 所有路由都只拿到 5xx：不算"路通"，但也不该直接扔掉证据。
    winner = fallback
    record('路由', '取舍', 'INFO', '全部路由均为 5xx，取首条继续取证（身份判定会给出结论）')
  }

  if (!winner) {
    console.log(`  已尝试 ${routes.length} 条路由，全部不可达`)
    record('路由', '可达路由', 'FAIL', '无')
    record(
      '路由',
      '结论',
      'FAIL',
      isOpenAIHost
        ? `本机到 ${hostname} 的所有已知出口均不可达。⚠️ 这只说明**探针所在机器**出不去（沙箱/防火墙/代理白名单），**不**说明生产端点坏了 —— 生产侧请在部署环境重跑本脚本。`
        : `本机到 ${hostname} 的所有已知出口均不可达 —— 若这是自建/代理端点，请先确认它已启动且网络策略放行。`,
    )
    record('路由', '建议', 'INFO', '用 QA_PROBE_PROXY=http://<host>:<port> 显式指定可用出口后重跑')
    return finish()
  }

  const { route, browser, probe: net } = winner
  record('路由', '可达路由', 'PASS', route.label)

  try {
    // ─── [2] 网络可达性 ─────────────────────────────────────────
    console.log('\n[2] 网络可达性（DNS + TLS + HTTP 往返）')
    record('网络', '收到 HTTP 响应', 'PASS', `HTTP ${net.status}（经「${route.label}」）`)
    if (net.navError) {
      record('网络', '导航副作用', 'INFO', `导航被 abort（多半是 JSON 被当作下载）：${net.navError.slice(0, 100)} —— 响应已收到，不影响结论`)
    }

    // ─── [3] 端点身份（通了 ≠ 通到对的地方） ────────────────────
    console.log('\n[3] 端点身份（防止"通了但通到门户页/被劫持的 200 HTML"）')
    const ctype = String(net.headers['content-type'] ?? '')
    record('身份', 'content-type 是 JSON', ctype.includes('json') ? 'PASS' : 'FAIL', ctype || '(缺失)')

    let bodyJson: { error?: { message?: string } } | null = null
    try {
      bodyJson = JSON.parse(net.body) as { error?: { message?: string } }
    } catch {
      bodyJson = null
    }
    const errMsg = String(bodyJson?.error?.message ?? '')

    if (!API_KEY) {
      record(
        '身份',
        '未带凭据时的鉴权闸门',
        net.status === 401 ? 'PASS' : 'INFO',
        `HTTP ${net.status}${net.status === 401 ? '（符合预期：无 key 即拒）' : '（非 401，需人工确认）'}`,
      )
      if (isOpenAIHost) {
        record(
          '身份',
          '确认是 OpenAI 本尊（非劫持）',
          net.status === 401 && !!bodyJson?.error ? 'PASS' : 'FAIL',
          errMsg ? `error.message = ${errMsg.slice(0, 120)}` : '响应里没有 error 对象 —— 可能是门户页/中间人',
        )
      } else {
        record('身份', '自建端点身份断言', 'INFO', `host=${hostname} 非 openai.com，错误体形状由端点自定，**刻意不判死**`)
      }
    } else {
      // 已有 key 时，未带凭据的 401 就不再是身份证据（会被"带了 key 的 200"取代）。
      record('身份', '身份断言', 'INFO', '已配置 key，身份结论并入 [4]（避免重复请求）')
    }

    // ─── [4] 凭据可用性 ─────────────────────────────────────────
    console.log('\n[4] 凭据可用性（同一 URL 与同一路由，注入 Authorization 头；仍**不计费**）')
    if (!API_KEY) {
      record('凭据', 'key 是否被端点认可', 'BLOCKED', '未配置 OPENAI_API_KEY —— 无法判定。⚠️ 这不是 PASS：「网络通」不能推出「凭据对」。')
      record('凭据', '修复动作', 'INFO', '配置 OPENAI_API_KEY（Netlify 站点级 env）后重跑本脚本')
    } else {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.setExtraHTTPHeaders', { headers: { authorization: `Bearer ${API_KEY}` } })
      const auth = await navigateProbe(page, MODELS_URL, PROBE_TIMEOUT_MS)
      await ctx.close()

      if (!auth.gotResponse) {
        record('凭据', 'key 是否被端点认可', 'BLOCKED', `带凭据请求未拿到响应：${humanizeNavError(auth.navError)} —— 本次网络不稳定，无法判定凭据`)
      } else if (auth.status === 200) {
        record('凭据', 'key 是否被端点认可', 'PASS', 'HTTP 200（端点接受了该凭据）')
        if (isOpenAIHost) record('身份', '确认是 OpenAI 本尊（非劫持）', /"object"\s*:\s*"list"/.test(auth.body) ? 'PASS' : 'INFO',
          /"object"\s*:\s*"list"/.test(auth.body) ? '响应是 OpenAI 风格的 {"object":"list"} 模型清单' : '响应形状非预期，请人工确认')
        // 附赠：期望模型是否在可用清单里（同一响应，零额外请求）。
        try {
          const list = JSON.parse(auth.body) as { data?: Array<{ id?: string }> }
          const ids = (list.data ?? []).map((m) => m.id).filter(Boolean) as string[]
          record(
            '凭据',
            `期望模型「${MODEL}」在可用清单里`,
            ids.includes(MODEL) ? 'PASS' : 'INFO',
            ids.length ? `清单 ${ids.length} 个${ids.includes(MODEL) ? '' : '；未列出（自建端点可能不实现 /models，非硬失败）'}` : '清单为空',
          )
        } catch {
          record('凭据', '可用模型清单', 'INFO', '响应不是预期的 {data:[...]} 形状，跳过（非硬失败）')
        }
      } else if (auth.status === 401 || auth.status === 403) {
        record('凭据', 'key 是否被端点认可', 'FAIL', `HTTP ${auth.status} —— 凭据被拒（该换/补 key，**不是**网络问题）`)
      } else {
        record('凭据', 'key 是否被端点认可', 'FAIL', `HTTP ${auth.status} —— 非预期状态，需人工确认`)
      }
    }

    return finish()
  } finally {
    await browser.close().catch(() => {})
  }
}

/** 汇总并给出退出码。只有 FAIL 影响退出码；BLOCKED 不影响（缺前提 ≠ 破坏）。 */
function finish(): number {
  const fails = rows.filter((r) => r.verdict === 'FAIL')
  const passes = rows.filter((r) => r.verdict === 'PASS')
  const blocked = rows.filter((r) => r.verdict === 'BLOCKED')

  console.log('\n──────── 汇总 ────────')
  for (const s of ['路由', '网络', '身份', '凭据']) {
    const inS = rows.filter((r) => r.section === s)
    if (!inS.length) continue
    const worst = inS.some((r) => r.verdict === 'FAIL')
      ? 'FAIL'
      : inS.some((r) => r.verdict === 'BLOCKED')
        ? 'BLOCKED'
        : inS.some((r) => r.verdict === 'PASS')
          ? 'PASS'
          : 'INFO'
    console.log(`  ${s.padEnd(4)} : ${worst}`)
  }
  console.log(`  PASS ${passes.length} · FAIL ${fails.length} · BLOCKED ${blocked.length}`)

  if (fails.length) {
    console.log('\n🔴 结论：**未通过** —— 见上面 ❌ 项。')
    return 1
  }
  if (blocked.length) {
    console.log('\n🟡 结论：**已判定项通过，但存在未判定项** —— 不得宣称"真实端点已验"。')
    return 0
  }
  console.log('\n🟢 结论：路由、网络与凭据**均已被端点实证**。')
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('\n💥 探针崩溃：', e)
    process.exit(2)
  })

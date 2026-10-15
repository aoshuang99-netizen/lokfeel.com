/**
 * T09 Slice 6 · **服务端出口连通性自检**（生产侧可复验）
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么需要一个**跑在应用里**的探针
 * ═══════════════════════════════════════════════════════════════
 * `scripts/qa/verify-agent-connectivity.mts` 证的是**跑它的那台机器**能不能出去。
 * 本仓 2026-10-15 的实跑已经证明这两件事可以完全相反：
 * 本机直连超时、走本机代理 401；而生产（Netlify 函数）是**直连**出口。
 * ⇒ "本机验绿"**推不出**"生产能到"。
 *
 * 于是把同一套分层报告做进应用：部署之后由管理员打一次这个端点，
 * 拿到的就是**生产出口**的真实结论。
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔴 三层分开报，永不合成一个布尔
 * ═══════════════════════════════════════════════════════════════
 *   · 网络可达 —— 有没有拿到一个 HTTP 响应（DNS + TLS + 往返）
 *   · 端点身份 —— 通到的是不是**那个**端点（防"门户页/中间人的 200"）
 *   · 凭据可用 —— 配的 key 是否被端点认可
 *   `BLOCKED` 是本模块的**第三种状态**，且**不是** PASS：没配 key 时凭据侧永远是
 *   `BLOCKED`，不会因为"网络通了"顺手报绿（那是把前提当结论）。
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔴 不计费 / 不落库 / 不泄漏 key
 * ═══════════════════════════════════════════════════════════════
 *   · 只打 `GET {baseUrl}/models`（列模型）。**不是** `POST /chat/completions`：
 *     不计 token、不进账单，也不会在账本里留下一条"看起来像一次真实运行"的痕迹（AC-20 归因会被污染）。
 *   · **只读**：本模块不写任何表；它连 `db` 都不 import。
 *   · 报告里**只有 key 的长度**，没有任何明文片段 —— 报告是要给管理员看的，
 *     而"能看诊断报告的账号"不该等于"能看到密钥的账号"。
 */

import { OPENAI_DEFAULTS, resolveProviderConfig, type ProviderConfigResolution } from '@/lib/agent'

/** 分层结论。`BLOCKED` = 缺前提（无法判定），**不是**通过。 */
export type ProbeVerdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO'

export interface ConnectivityLayer {
  verdict: ProbeVerdict
  /** 人话结论。会被 UI 原样渲染 ⇒ **不含** markdown 强调标记。 */
  detail: string
}

export interface ConnectivityReport {
  endpoint: {
    baseUrl: string
    /** `env` = 被 `OPENAI_BASE_URL` 覆盖（此时报告的是**那个**端点，未必是生产默认值）。 */
    source: 'env' | 'kernel-default'
    model: string
    /** 实际探测的 URL（不含任何凭据）。 */
    probeUrl: string
    timeoutMs: number
  }
  network: ConnectivityLayer & { status: number | null; latencyMs: number | null; error: string | null }
  identity: ConnectivityLayer
  credentials: ConnectivityLayer & { keyPresent: boolean; keyLength: number }
  /** 探针自身的元信息（可复跑性：什么时候、谁跑的、用了哪条路径）。 */
  probe: { ranAt: string; billed: false; wrote: false; method: 'GET' }
}

export interface ProbeOptions {
  /** 覆盖"现在"（确定性断言用）。 */
  now?: Date
  /**
   * 覆盖超时。缺省取 `min(config.timeoutMs, 20s)` ——
   * 函数平台有执行预算，诊断请求不该把预算吃光。上限仍受 `OPENAI_DEFAULTS.maxTimeoutMs` 约束。
   */
  timeoutMs?: number
  /** 注入 fetch（单测用；生产路径不传 → 用全局 fetch）。 */
  fetchImpl?: typeof fetch
}

/**
 * OpenAI 在"没带凭据 / 凭据不对"时给出的 `error.message` 特征。
 *
 * 🔴 为什么必须列**全**：401 只说明"这里有一道鉴权闸门"，**不能**证明对端是 OpenAI
 *    —— 门户页、中间人、公司网关都可能回 401。身份层要的是"错误体像是 OpenAI 写的"。
 *    真实端点至少有两种措辞：
 *      · 完全没带 → "You didn't provide an API key. You need to provide your API key
 *                   in an Authorization header using Bearer auth..."
 *      · 带了但不对 → "Incorrect API key provided: sk-***"
 *    ⚠️ 首版只列了后者，于是"无 key"（**最常见**的那种部署状态）被误判成身份可疑
 *    —— 由 `tests/agents/connectivity.test.ts` 抓到。已知措辞收在**这一处**：
 *    改的是同一件事，不该有第二个地方。
 */
const OPENAI_AUTH_ERROR_RE =
  /you didn'?t provide an api key|incorrect api key|invalid api key|missing bearer|no api key/i

/** 把网络层异常压成一句人话（区分"路不通"与"端点不回"）。 */
function humanizeFetchError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err)
  if (/abort|timeout/i.test(msg)) return `超时：${msg.slice(0, 160)}`
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return `DNS 解析失败：${msg.slice(0, 160)}`
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(msg)) return `连接失败/重置：${msg.slice(0, 160)}`
  if (/certificate|TLS|SSL/i.test(msg)) return `TLS/证书失败：${msg.slice(0, 160)}`
  return msg.slice(0, 200)
}

/**
 * 跑一次连通性自检。
 *
 * ⚠️ 有 key 时**只**带 key 请求一次（200 即同时证明网络、身份与凭据）；
 *    无 key 时请求一次不带凭据（401 + OpenAI 错误体同时证明网络与身份，凭据记 `BLOCKED`）。
 *    **不**为了"多证一点"而发第二个请求 —— 那会让这个端点变成两次出网。
 */
export async function probeAgentConnectivity(
  env: Record<string, string | undefined>,
  options: ProbeOptions = {},
): Promise<ConnectivityReport> {
  const now = options.now ?? new Date()
  const apiKey = (env.OPENAI_API_KEY ?? '').trim()
  const keyPresent = apiKey.length > 0
  const resolved: ProviderConfigResolution = resolveProviderConfig(env)

  // 🔴 目标 baseUrl 的确定要**分两条路**，而理由不同（这是本文件最容易写错的一处）：
  //   · 有 key → 直接用内核解析结果：端点的唯一事实来源就是它。
  //   · 无 key → 内核解析器**在第一道检查就早退**（"缺凭据"是它的第一条规则），
  //     拿不到 baseUrl。此时退化成"只用 `OPENAI_BASE_URL` 或内核默认值决定往哪儿打"。
  //     ⚠️ 仍然要过 http(s) 校验 —— 否则一次手滑的 `file://` 会变成一次本地读取。
  //
  //   为什么无 key 还要继续探：**"出口被墙"与"没配 key"是两种病**，处置动作完全不同。
  //   不带凭据打一次 `GET /models` 拿到 401 就能把网络与身份两层定下来（免费、不计费），
  //   凭据层如实记 `BLOCKED`。不做这一步，未配 key 的部署只能拿到一句"配置不合法"，
  //   无从知道出网到底通不通。
  let baseUrl = ''
  let configError: string | null = null
  if (resolved.ok) {
    baseUrl = resolved.config.baseUrl
  } else {
    const raw = (env.OPENAI_BASE_URL ?? '').trim() || OPENAI_DEFAULTS.baseUrl
    if (/^https?:\/\//i.test(raw)) baseUrl = raw.replace(/\/+$/, '')
    else configError = resolved.reason
  }

  // 端点本身不合法（例如 `OPENAI_BASE_URL=file:///...`）→ 三层全部无法判定。
  // 这不是"网络不通"，如实区分：目标都不合法，就不该去做一次注定无意义的出网。
  if (!baseUrl) {
    const layer: ConnectivityLayer = {
      verdict: 'FAIL',
      detail: `provider 配置不合法：${configError ?? '未知原因'}（未发起任何出网请求）`,
    }
    return {
      endpoint: {
        baseUrl: (env.OPENAI_BASE_URL ?? '').trim() || OPENAI_DEFAULTS.baseUrl,
        source: (env.OPENAI_BASE_URL ?? '').trim() ? 'env' : 'kernel-default',
        model: OPENAI_DEFAULTS.model,
        probeUrl: '(未解析)',
        timeoutMs: 0,
      },
      network: { ...layer, status: null, latencyMs: null, error: configError },
      identity: layer,
      credentials: { ...layer, keyPresent, keyLength: apiKey.length },
      probe: { ranAt: now.toISOString(), billed: false, wrote: false, method: 'GET' },
    }
  }

  const envBase = (env.OPENAI_BASE_URL ?? '').trim()
  const source: 'env' | 'kernel-default' = envBase ? 'env' : 'kernel-default'
  // ⚠️ 无 key 时解析器给不出 model/timeout，退回**同一组**内核默认常量（不是另抄一份）。
  const model = resolved.ok
    ? resolved.config.model
    : (env.OPENAI_MODEL ?? '').trim() || OPENAI_DEFAULTS.model
  const probeUrl = `${baseUrl}/models`
  const effectiveTimeout = Math.min(
    options.timeoutMs ??
      Math.min(resolved.ok ? resolved.config.timeoutMs : OPENAI_DEFAULTS.timeoutMs, 20_000),
    OPENAI_DEFAULTS.maxTimeoutMs,
  )

  let hostname = ''
  try {
    hostname = new URL(baseUrl).hostname
  } catch {
    hostname = ''
  }
  // 只有真·OpenAI 域名才做「必须是 OpenAI 形状的 401/200」这类身份断言 ——
  // 自建/代理端点的错误体形状由它自己决定，不该被本模块判死。
  const isOpenAiHost = /(^|\.)openai\.com$/i.test(hostname)

  const doFetch = options.fetchImpl ?? fetch
  const startedAt = Date.now()
  let status: number | null = null
  let body = ''
  let contentType = ''
  let error: string | null = null

  try {
    const res = await doFetch(probeUrl, {
      method: 'GET',
      // 无 key 时**不带** Authorization：401 本身就是"这里有一道鉴权闸门"的身份证据。
      headers: keyPresent ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(effectiveTimeout),
      cache: 'no-store',
    })
    status = res.status
    contentType = res.headers.get('content-type') ?? ''
    body = await res.text().catch(() => '')
  } catch (err) {
    error = humanizeFetchError(err)
  }
  const latencyMs = Date.now() - startedAt

  // ── 网络层 ──
  const reachable = status !== null
  const network: ConnectivityReport['network'] = {
    verdict: reachable ? 'PASS' : 'FAIL',
    detail: reachable
      ? `收到 HTTP ${status}（往返 ${latencyMs}ms）—— 出口能到该端点`
      : `未收到任何 HTTP 响应：${error ?? '(无错误信息)'}`,
    status,
    latencyMs,
    error,
  }

  // ── 身份层 ──
  let identity: ConnectivityLayer
  let identityEvidence = ''
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string }
      object?: string
      data?: unknown
    }
    identityEvidence = String(parsed?.error?.message ?? parsed?.object ?? '')
  } catch {
    identityEvidence = ''
  }

  if (!reachable) {
    identity = { verdict: 'BLOCKED', detail: '网络层未拿到响应，无法判定通到的是谁' }
  } else if (!isOpenAiHost) {
    identity = {
      verdict: 'INFO',
      detail: `host=${hostname} 非 openai.com —— 错误体形状由该端点自定，刻意不判死`,
    }
  } else if (status === 401) {
    const ok = OPENAI_AUTH_ERROR_RE.test(identityEvidence)
    identity = {
      verdict: ok ? 'PASS' : 'FAIL',
      detail: ok
        ? `确认是 OpenAI 本尊（error.message = ${identityEvidence.slice(0, 120)}）`
        : `HTTP 401 但错误体不是 OpenAI 的形状：${identityEvidence.slice(0, 120)}（疑似门户页/中间人）`,
    }
  } else if (status === 200) {
    const isList = /"object"\s*:\s*"list"/.test(body) || contentType.includes('json')
    identity = {
      verdict: isList ? 'PASS' : 'INFO',
      detail: isList
        ? '响应是 OpenAI 风格的模型清单（{"object":"list"}）'
        : 'HTTP 200 但响应形状非预期，请人工确认',
    }
  } else {
    identity = {
      verdict: 'INFO',
      detail: `HTTP ${status}，非 401/200 —— 身份结论需人工确认`,
    }
  }

  // ── 凭据层 ──
  let credentials: ConnectivityReport['credentials']
  if (!keyPresent) {
    credentials = {
      verdict: 'BLOCKED',
      detail:
        '未配置 OPENAI_API_KEY —— 无法判定。这不是 PASS：网络通推不出凭据对。（未带凭据的 401 只证明这里有一道鉴权闸门。）',
      keyPresent: false,
      keyLength: 0,
    }
  } else if (!reachable) {
    credentials = {
      verdict: 'BLOCKED',
      detail: `带凭据请求未拿到响应：${error ?? '(无)'} —— 本次出网不稳定，无法判定凭据`,
      keyPresent: true,
      keyLength: apiKey.length,
    }
  } else if (status === 200) {
    credentials = {
      verdict: 'PASS',
      detail: `HTTP 200 —— 端点接受了该凭据（key 长度 ${apiKey.length}，不打印明文）`,
      keyPresent: true,
      keyLength: apiKey.length,
    }
  } else if (status === 401 || status === 403) {
    credentials = {
      verdict: 'FAIL',
      detail: `HTTP ${status} —— 凭据被端点拒绝（该换/补 key；这不是网络问题）`,
      keyPresent: true,
      keyLength: apiKey.length,
    }
  } else {
    credentials = {
      verdict: 'FAIL',
      detail: `HTTP ${status} —— 非预期状态，需人工确认`,
      keyPresent: true,
      keyLength: apiKey.length,
    }
  }

  return {
    endpoint: { baseUrl, source, model, probeUrl, timeoutMs: effectiveTimeout },
    network,
    identity,
    credentials,
    probe: { ranAt: now.toISOString(), billed: false, wrote: false, method: 'GET' },
  }
}

/** 报告的整体结论（供 UI/脚本一句话展示）。`BLOCKED` 一律降级为"未判定"，不得说成通过。 */
export function summarizeConnectivity(report: ConnectivityReport): {
  verdict: ProbeVerdict
  message: string
} {
  const layers = [report.network, report.identity, report.credentials]
  if (layers.some((l) => l.verdict === 'FAIL')) {
    return { verdict: 'FAIL', message: '未通过 —— 见各层 detail（先修 FAIL 的那一层）' }
  }
  if (layers.some((l) => l.verdict === 'BLOCKED')) {
    return { verdict: 'BLOCKED', message: '已判定项通过，但存在未判定项 —— 不得宣称"真实端点已验"' }
  }
  return { verdict: 'PASS', message: '网络、身份与凭据均已被端点实证' }
}

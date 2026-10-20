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
 * 🔴 探的必须是**当前真正在用的那个** provider
 * ═══════════════════════════════════════════════════════════════
 * 2026-10-20 起真实调用有两条路（见 `provider-runtime.ts`）：
 *   WorkBuddy 云端算力（免密钥）→ OpenAI（自带 key）
 * 诊断若只认 `OPENAI_API_KEY`，就会出现"运行真的在调云端模型、诊断却说没配置"
 * 这种自相矛盾 —— 读报告的人据此行动只会走错方向。因此选择顺序**逐字复用**
 * `resolveWorkBuddyConfig` / `resolveProviderConfig` 这两个内核判据，不另写一套。
 *
 * 两个 provider 的探测面**不同**（都是实测的，不是约定）：
 *   · 云端算力：`GET {endpoint}/.cloud/llm/models`，头 `x-wb-webapp-access-key`；
 *     200 = 模型目录数组（34 个），401 = `{"error":"invalid_client"}`，
 *     带浏览器 `Origin` = 403 `{"error":"access_denied"}`。
 *   · OpenAI：`GET {baseUrl}/models`，头 `Authorization: Bearer`。
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
 * 云端算力的身份层还多担一件事：**目录里有没有配的那个模型**。
 * 因为"端点通了"与"这个 model id 存在"是两件事 —— 后者写错时，
 * 运行会在真正发 chat 请求时才炸，那比在诊断里炸贵得多。
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔴 不计费 / 不落库 / 不泄漏 key
 * ═══════════════════════════════════════════════════════════════
 *   · 只打**列模型**接口（GET）。**不是** `POST /chat/completions`：
 *     不计 token、不进账单，也不会在账本里留下一条"看起来像一次真实运行"的痕迹（AC-20 归因会被污染）。
 *   · **只读**：本模块不写任何表；它连 `db` 都不 import。
 *   · 报告里**只有 key 的长度**，没有任何明文片段 —— 报告是要给管理员看的，
 *     而"能看诊断报告的账号"不该等于"能看到密钥的账号"。
 */

import {
  OPENAI_DEFAULTS,
  WORKBUDDY_DEFAULTS,
  resolveProviderConfig,
  resolveWorkBuddyConfig,
} from '@/lib/agent'

/** 分层结论。`BLOCKED` = 缺前提（无法判定），**不是**通过。 */
export type ProbeVerdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO'

/** 本次探的是哪条真实调用路径（与运行时选择同序）。 */
export type ProbeProvider = 'workbuddy' | 'openai'

/** 端点来源：`workbuddy` = 云端算力配置；`env` = 被 `OPENAI_BASE_URL` 覆盖；`kernel-default` = 内核默认。 */
export type ProbeSource = 'workbuddy' | 'env' | 'kernel-default'

export interface ConnectivityLayer {
  verdict: ProbeVerdict
  /** 人话结论。会被 UI 原样渲染 ⇒ **不含** markdown 强调标记。 */
  detail: string
}

export interface ConnectivityReport {
  endpoint: {
    provider: ProbeProvider
    baseUrl: string
    /** `env` = 被 `OPENAI_BASE_URL` 覆盖（此时报告的是**那个**端点，未必是生产默认值）。 */
    source: ProbeSource
    model: string
    /** 实际探测的 URL（不含任何凭据）。 */
    probeUrl: string
    timeoutMs: number
  }
  network: ConnectivityLayer & { status: number | null; latencyMs: number | null; error: string | null }
  identity: ConnectivityLayer
  credentials: ConnectivityLayer & {
    keyPresent: boolean
    keyLength: number
    /** 缺失时该补的那个变量名（诊断文案要能直接指向处置动作）。 */
    keyVar: 'WORKBUDDY_LLM_KEY' | 'OPENAI_API_KEY'
  }
  /** 探针自身的元信息（可复跑性：什么时候、谁跑的、用了哪条路径）。 */
  probe: { ranAt: string; billed: false; wrote: false; method: 'GET' }
}

export interface ProbeOptions {
  /** 覆盖"现在"（确定性断言用）。 */
  now?: Date
  /**
   * 覆盖超时。缺省取 `min(config.timeoutMs, 20s)` ——
   * 函数平台有执行预算，诊断请求不该把预算吃光。上限仍受内核 `maxTimeoutMs` 约束。
   */
  timeoutMs?: number
  /** 注入 fetch（单测用；生产路径不传 → 用全局 fetch）。 */
  fetchImpl?: typeof fetch
}

/** 云端算力的模型目录路径（与官方 SDK 的 `CLOUD_MODULE_PATHS.llm` 同源：`/.cloud/llm` + `/models`）。 */
const CLOUD_MODELS_PATH = '/.cloud/llm/models'

/** 云端算力的应用级鉴权头（免密钥方案：用 publishable key，不是供应商 key）。 */
const CLOUD_KEY_HEADER = 'x-wb-webapp-access-key'

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

// ── 目标解析 ──────────────────────────────────────────────────────────

interface ProbeTarget {
  provider: ProbeProvider
  baseUrl: string
  source: ProbeSource
  model: string
  probeUrl: string
  timeoutMs: number
  headers: Record<string, string>
  key: string
  keyVar: 'WORKBUDDY_LLM_KEY' | 'OPENAI_API_KEY'
}

interface TargetConfigError {
  provider: ProbeProvider
  baseUrl: string
  source: ProbeSource
  model: string
  key: string
  keyVar: 'WORKBUDDY_LLM_KEY' | 'OPENAI_API_KEY'
  reason: string
}

type TargetResolution =
  | { ok: true; target: ProbeTarget }
  | { ok: false; error: TargetConfigError }

function capTimeout(raw: number, max: number): number {
  return Math.min(raw, max)
}

/**
 * 解析"这次该探谁"。顺序与 `resolveRuntimeProvider()` **逐字一致**：
 *   云端算力可用 → 探云端；云端只写了端点但没 key → **仍然探云端**（401 能定网络与身份）；
 *   云端没配 → 探 OpenAI（有无 key 都探，理由见下）。
 *
 * 为什么云端缺 key 还要探：**"出口被墙"与"没配 key"是两种病**，处置动作完全不同。
 * 不带凭据打一次模型目录拿到 401 就能把网络与身份两层定下来（免费、不计费），
 * 凭据层如实记 `BLOCKED`。不做这一步，未配 key 的部署只能拿到一句"配置不合法"，
 * 无从知道出网到底通不通。
 */
function resolveProbeTarget(
  env: Record<string, string | undefined>,
  overrideTimeout?: number,
): TargetResolution {
  const rawCloudEndpoint = (env.WORKBUDDY_LLM_ENDPOINT ?? '').trim()
  const cloudKey = (env.WORKBUDDY_LLM_KEY ?? '').trim()
  const cloud = resolveWorkBuddyConfig(env)

  // ① 云端算力：只要**端点被写了**就走这条路（配没配 key 都探）。
  if (rawCloudEndpoint) {
    const cloudModel = (env.WORKBUDDY_LLM_MODEL ?? '').trim() || WORKBUDDY_DEFAULTS.model
    const cloudKeyVar = 'WORKBUDDY_LLM_KEY' as const

    if (!/^https?:\/\//i.test(rawCloudEndpoint)) {
      // 端点本身不合法（例如 `file:///...`）→ 一次出网都不发。
      return {
        ok: false,
        error: {
          provider: 'workbuddy',
          baseUrl: rawCloudEndpoint,
          source: 'workbuddy',
          model: cloudModel,
          key: cloudKey,
          keyVar: cloudKeyVar,
          reason:
            cloud.ok === false
              ? cloud.reason
              : `WORKBUDDY_LLM_ENDPOINT 必须是 http(s) 地址，得到：${rawCloudEndpoint}`,
        },
      }
    }

    const baseUrl = rawCloudEndpoint.replace(/\/+$/, '')
    const configuredTimeout = cloud.ok ? cloud.config.timeoutMs : WORKBUDDY_DEFAULTS.timeoutMs
    return {
      ok: true,
      target: {
        provider: 'workbuddy',
        baseUrl,
        source: 'workbuddy',
        model: cloud.ok ? cloud.config.model : cloudModel,
        probeUrl: `${baseUrl}${CLOUD_MODELS_PATH}`,
        timeoutMs: capTimeout(
          overrideTimeout ?? Math.min(configuredTimeout, 20_000),
          WORKBUDDY_DEFAULTS.maxTimeoutMs,
        ),
        // 无 key 时**不带**鉴权头：401/invalid_client 本身就是"这里有一道闸门"的身份证据。
        headers: cloudKey ? { [CLOUD_KEY_HEADER]: cloudKey } : {},
        key: cloudKey,
        keyVar: cloudKeyVar,
      },
    }
  }

  // ② OpenAI：与改造前完全同口径（有 key 走解析结果，无 key 走 env 覆盖或内核默认）。
  const openai = resolveProviderConfig(env)
  const rawOpenAiBase = (env.OPENAI_BASE_URL ?? '').trim()
  const openaiKey = (env.OPENAI_API_KEY ?? '').trim()
  const openaiModel = openai.ok
    ? openai.config.model
    : (env.OPENAI_MODEL ?? '').trim() || OPENAI_DEFAULTS.model

  let baseUrl = ''
  let configError: string | null = null
  if (openai.ok) {
    baseUrl = openai.config.baseUrl
  } else {
    const raw = rawOpenAiBase || OPENAI_DEFAULTS.baseUrl
    if (/^https?:\/\//i.test(raw)) baseUrl = raw.replace(/\/+$/, '')
    else configError = openai.reason
  }

  if (!baseUrl) {
    return {
      ok: false,
      error: {
        provider: 'openai',
        baseUrl: rawOpenAiBase || OPENAI_DEFAULTS.baseUrl,
        source: rawOpenAiBase ? 'env' : 'kernel-default',
        model: openaiModel,
        key: openaiKey,
        keyVar: 'OPENAI_API_KEY',
        reason: configError ?? '未知原因',
      },
    }
  }

  return {
    ok: true,
    target: {
      provider: 'openai',
      baseUrl,
      source: rawOpenAiBase ? 'env' : 'kernel-default',
      model: openaiModel,
      probeUrl: `${baseUrl}/models`,
      timeoutMs: capTimeout(
        overrideTimeout ??
          Math.min(openai.ok ? openai.config.timeoutMs : OPENAI_DEFAULTS.timeoutMs, 20_000),
        OPENAI_DEFAULTS.maxTimeoutMs,
      ),
      headers: openaiKey ? { authorization: `Bearer ${openaiKey}` } : {},
      key: openaiKey,
      keyVar: 'OPENAI_API_KEY',
    },
  }
}

// ── 响应解析（两种 provider 各一套形状判据）────────────────────────────

/** 云端网关的错误体：`{"error":"invalid_client","error_description":"..."}`。 */
function parseCloudError(body: string): { code: string; description: string } | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; error_description?: unknown }
    if (typeof parsed?.error === 'string') {
      return {
        code: parsed.error,
        description:
          typeof parsed.error_description === 'string' ? parsed.error_description.slice(0, 160) : '',
      }
    }
    return null
  } catch {
    return null
  }
}

/** 模型目录：实测是裸数组（34 项），SDK 也接受 `{data:[...]}` —— 两种都认。 */
function parseModelCatalog(body: string): Array<Record<string, unknown>> | null {
  try {
    const parsed = JSON.parse(body) as unknown
    if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { data?: unknown }).data)
    ) {
      return (parsed as { data: Array<Record<string, unknown>> }).data
    }
    return null
  } catch {
    return null
  }
}

/** 取目录项的 id（兼容 `id` / `model` 两种字段名，取舍与 SDK 的 normalizeModel 对齐）。 */
function catalogId(entry: Record<string, unknown>): string {
  if (typeof entry.id === 'string' && entry.id.length > 0) return entry.id
  if (typeof entry.model === 'string' && entry.model.length > 0) return entry.model
  return ''
}

/** 云端算力的身份层：通到的是不是那个网关，且**目录里有没有我们配的模型**。 */
function cloudIdentity(status: number | null, body: string, model: string): ConnectivityLayer {
  if (status === 200) {
    const catalog = parseModelCatalog(body)
    if (catalog === null) {
      return {
        verdict: 'FAIL',
        detail: `HTTP 200 但响应不是模型目录（疑似门户页/中间人）—— 前 120 字：${body.slice(0, 120)}`,
      }
    }
    const ids = catalog.map(catalogId).filter((id) => id.length > 0)
    const entry = catalog.find((item) => catalogId(item) === model)
    if (entry === undefined) {
      return {
        verdict: 'FAIL',
        detail: `模型目录（${ids.length} 个）里没有配置的 ${model} —— 检查 WORKBUDDY_LLM_MODEL（写错的话运行会在发 chat 请求时才炸）`,
      }
    }
    if (entry.enabled === false) {
      return {
        verdict: 'FAIL',
        detail: `目录里有 ${model}，但它标记为 enabled=false（已停用）—— 换一个模型或找管理员启用`,
      }
    }
    return {
      verdict: 'PASS',
      detail: `确认是云端算力模型目录（${ids.length} 个模型，含 ${model}）`,
    }
  }

  if (status === 401 || status === 403) {
    const expected = status === 401 ? 'invalid_client' : 'access_denied'
    const err = parseCloudError(body)
    const matches = err !== null && err.code === expected
    return {
      verdict: matches ? 'PASS' : 'INFO',
      detail: matches
        ? `错误体是云端算力网关的形状（error=${err.code}）`
        : `HTTP ${status} 但错误体不是网关形状：${body.slice(0, 120)}（疑似门户页/中间人）`,
    }
  }

  return {
    verdict: 'INFO',
    detail: `HTTP ${status ?? '(无)'}，非 200/401/403 —— 身份结论需人工确认`,
  }
}

/** 云端算力的凭据层：publishable key 是否被网关接受。 */
function cloudCredentials(
  status: number | null,
  body: string,
  key: string,
): ConnectivityReport['credentials'] {
  const keyPresent = key.length > 0
  const base = { keyPresent, keyLength: key.length, keyVar: 'WORKBUDDY_LLM_KEY' as const }

  if (!keyPresent) {
    return {
      ...base,
      verdict: 'BLOCKED',
      detail:
        '未配置 WORKBUDDY_LLM_KEY —— 无法判定。这不是 PASS：网络通推不出凭据对。（未带凭据的 401 只证明这里有一道鉴权闸门。）',
    }
  }
  if (status === null) {
    return {
      ...base,
      verdict: 'BLOCKED',
      detail: '带凭据请求未拿到响应 —— 本次出网不稳定，无法判定凭据',
    }
  }
  if (status === 200) {
    return {
      ...base,
      verdict: 'PASS',
      detail: `HTTP 200 —— 云端算力接受了该应用级凭据（key 长度 ${key.length}，不打印明文）`,
    }
  }
  if (status === 401) {
    const err = parseCloudError(body)
    return {
      ...base,
      verdict: 'FAIL',
      detail: `HTTP 401 ${err ? `error=${err.code}` : ''} —— 云端算力拒绝该凭据（WORKBUDDY_LLM_KEY 无效或已轮换）`,
    }
  }
  if (status === 403) {
    const err = parseCloudError(body)
    return {
      ...base,
      verdict: 'FAIL',
      detail: `HTTP 403 ${err ? `error=${err.code}` : ''} —— 来源/策略被拒：该端点只接受服务端直接调用（带浏览器 Origin 会被拒），不要在浏览器里直连`,
    }
  }
  return {
    ...base,
    verdict: 'FAIL',
    detail: `HTTP ${status} —— 非预期状态，需人工确认`,
  }
}

/** OpenAI 的身份层：只有真·openai.com 才做形状断言（自建/代理端点的错误体由它自己定）。 */
function openAiIdentity(
  status: number | null,
  body: string,
  contentType: string,
  reachable: boolean,
  isOpenAiHost: boolean,
  hostname: string,
): ConnectivityLayer {
  let evidence = ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; object?: string }
    evidence = String(parsed?.error?.message ?? parsed?.object ?? '')
  } catch {
    evidence = ''
  }

  if (!reachable) {
    return { verdict: 'BLOCKED', detail: '网络层未拿到响应，无法判定通到的是谁' }
  }
  if (!isOpenAiHost) {
    return {
      verdict: 'INFO',
      detail: `host=${hostname} 非 openai.com —— 错误体形状由该端点自定，刻意不判死`,
    }
  }
  if (status === 401) {
    const ok = OPENAI_AUTH_ERROR_RE.test(evidence)
    return {
      verdict: ok ? 'PASS' : 'FAIL',
      detail: ok
        ? `确认是 OpenAI 本尊（error.message = ${evidence.slice(0, 120)}）`
        : `HTTP 401 但错误体不是 OpenAI 的形状：${evidence.slice(0, 120)}（疑似门户页/中间人）`,
    }
  }
  if (status === 200) {
    const isList = /"object"\s*:\s*"list"/.test(body) || contentType.includes('json')
    return {
      verdict: isList ? 'PASS' : 'INFO',
      detail: isList
        ? '响应是 OpenAI 风格的模型清单（{"object":"list"}）'
        : 'HTTP 200 但响应形状非预期，请人工确认',
    }
  }
  return { verdict: 'INFO', detail: `HTTP ${status}，非 401/200 —— 身份结论需人工确认` }
}

/** OpenAI 的凭据层：与改造前逐字同口径（避免既有诊断读数漂移）。 */
function openAiCredentials(
  status: number | null,
  key: string,
  reachable: boolean,
  error: string | null,
): ConnectivityReport['credentials'] {
  const keyPresent = key.length > 0
  const base = { keyPresent, keyLength: key.length, keyVar: 'OPENAI_API_KEY' as const }

  if (!keyPresent) {
    return {
      ...base,
      verdict: 'BLOCKED',
      detail:
        '未配置 OPENAI_API_KEY —— 无法判定。这不是 PASS：网络通推不出凭据对。（未带凭据的 401 只证明这里有一道鉴权闸门。）',
    }
  }
  if (!reachable) {
    return {
      ...base,
      verdict: 'BLOCKED',
      detail: `带凭据请求未拿到响应：${error ?? '(无)'} —— 本次出网不稳定，无法判定凭据`,
    }
  }
  if (status === 200) {
    return {
      ...base,
      verdict: 'PASS',
      detail: `HTTP 200 —— 端点接受了该凭据（key 长度 ${key.length}，不打印明文）`,
    }
  }
  if (status === 401 || status === 403) {
    return {
      ...base,
      verdict: 'FAIL',
      detail: `HTTP ${status} —— 凭据被端点拒绝（该换/补 key；这不是网络问题）`,
    }
  }
  return {
    ...base,
    verdict: 'FAIL',
    detail: `HTTP ${status} —— 非预期状态，需人工确认`,
  }
}

/**
 * 跑一次连通性自检。
 *
 * ⚠️ **只发一次请求**：有 key 时带 key（200 即同时证明网络、身份与凭据）；
 *    无 key 时不带凭据（401 同时证明网络与身份，凭据记 `BLOCKED`）。
 *    **不**为了"多证一点"而发第二个请求 —— 那会让这个端点变成两次出网。
 */
export async function probeAgentConnectivity(
  env: Record<string, string | undefined>,
  options: ProbeOptions = {},
): Promise<ConnectivityReport> {
  const now = options.now ?? new Date()
  const resolution = resolveProbeTarget(env, options.timeoutMs)

  // 端点本身不合法（例如 `file:///...`）→ 三层全部无法判定。
  // 这不是"网络不通"，如实区分：目标都不合法，就不该去做一次注定无意义的出网。
  if (!resolution.ok) {
    const { error: cfg } = resolution
    const layer: ConnectivityLayer = {
      verdict: 'FAIL',
      detail: `provider 配置不合法：${cfg.reason}（未发起任何出网请求）`,
    }
    return {
      endpoint: {
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        source: cfg.source,
        model: cfg.model,
        probeUrl: '(未解析)',
        timeoutMs: 0,
      },
      network: { ...layer, status: null, latencyMs: null, error: cfg.reason },
      identity: layer,
      credentials: {
        ...layer,
        keyPresent: cfg.key.length > 0,
        keyLength: cfg.key.length,
        keyVar: cfg.keyVar,
      },
      probe: { ranAt: now.toISOString(), billed: false, wrote: false, method: 'GET' },
    }
  }

  const target = resolution.target
  let hostname = ''
  try {
    hostname = new URL(target.baseUrl).hostname
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
    const res = await doFetch(target.probeUrl, {
      method: 'GET',
      headers: target.headers,
      signal: AbortSignal.timeout(target.timeoutMs),
      cache: 'no-store',
    })
    status = res.status
    contentType = res.headers.get('content-type') ?? ''
    body = await res.text().catch(() => '')
  } catch (err) {
    error = humanizeFetchError(err)
  }
  const latencyMs = Date.now() - startedAt

  // ── 网络层（两种 provider 同一口径：拿到 HTTP 响应就算通）──
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

  // ── 身份层 / 凭据层（按 provider 各自的响应形状判定）──
  const identity: ConnectivityLayer =
    target.provider === 'workbuddy'
      ? reachable
        ? cloudIdentity(status, body, target.model)
        : { verdict: 'BLOCKED', detail: '网络层未拿到响应，无法判定通到的是谁' }
      : openAiIdentity(status, body, contentType, reachable, isOpenAiHost, hostname)

  const credentials: ConnectivityReport['credentials'] =
    target.provider === 'workbuddy'
      ? cloudCredentials(status, body, target.key)
      : openAiCredentials(status, target.key, reachable, error)

  return {
    endpoint: {
      provider: target.provider,
      baseUrl: target.baseUrl,
      source: target.source,
      model: target.model,
      probeUrl: target.probeUrl,
      timeoutMs: target.timeoutMs,
    },
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

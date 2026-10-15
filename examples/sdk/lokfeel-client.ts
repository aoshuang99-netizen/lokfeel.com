/**
 * LokFeel Connection OS · 互操作客户端（示例）
 *
 * ── 本文件是什么 ────────────────────────────────────────────────
 *   一个**零依赖**的 TypeScript 客户端，覆盖本服务对外暴露的三个面：
 *     · MCP   —— `POST /api/mcp`（JSON-RPC 2.0 · Streamable HTTP）
 *     · A2A   —— `GET  /.well-known/agent-card.json` + `POST /api/v1/a2a/tasks`
 *     · REST  —— `GET/POST /api/v1/**`（能力守卫与 MCP/A2A 同一张表）
 *
 * ── 本文件不是什么 ──────────────────────────────────────────────
 *   · **不是** SDK 本体（不发布到 npm，也不承诺语义化版本）—— 它是**可运行的文档**：
 *     读者照抄即可接上服务，且 `npx tsc --noEmit` 会跟着源码一起检查它，
 *     所以它不会像 markdown 那样悄悄腐烂。
 *   · **不含**任何凭据。凭据由 `config.ts` 从环境变量取，或由本文件的 `login()` 现换。
 *
 * ── 🔴 一个必须先说清楚的事实：本服务**没有** Bearer 令牌入口 ────
 *   服务端的身份判定是 `requireAuth()` → NextAuth `auth()`，也就是**会话 cookie**。
 *   代码里**不存在**读 `Authorization: Bearer …` 的分支。
 *   所以：
 *     · 示例**不**发明一个 `LOKFEEL_TOKEN` 然后发 Bearer —— 那个请求只会拿到 401，
 *       而"示例看起来写得很专业、实际跑不通"正是 T11 铁律要防的事。
 *     · 示例的做法与浏览器**完全一致**：走一次 `/api/auth/login` 拿 Set-Cookie，
 *       之后复用这个 cookie。
 *   若将来需要长期有效的机器令牌（用于无头集成），那是一条**新的认证能力**：
 *   要有签发、轮换、吊销与作用域，必须单独评审，不该顺手塞进"示例"这一层。
 *
 * ── 另一个刻意的设计：把"HTTP 状态码"与"业务结果"分开 ──────────────
 *   三个面对"失败"的表达方式**不一致**，这是协议决定的，不是随意的：
 *     · 无会话          → 三个面**都**是 HTTP 401（传输层未认证）
 *     · 有会话但能力不足 → MCP 是 `result.isError = true`（HTTP 200）
 *                          A2A 是 `task.status.state = "failed"`（HTTP 200）
 *                          REST 是 HTTP 403
 *   所以客户端不能只看 `res.ok`。`mcpRaw()` 把结果归一成 `McpOutcome` 三态，
 *   让调用方显式区分「协议错」「业务被拒」「成功」——这三件事的处置方式完全不同。
 */

export type InteropTool = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: { requiredCapability: string; readOnlyHint: boolean }
}

export type McpContent = { type: string; text: string }
export type McpError = { code: number; message: string; data?: unknown }

/** `tools/call` 的结果信封（`isError` 为 true 表示"调用成功、业务被拒"）。 */
export type ToolResult = { content: McpContent[]; isError?: boolean }

/** MCP 一次交换的归一化结果。 */
export type McpOutcome =
  | { status: number; kind: 'result'; result: unknown }
  | { status: number; kind: 'error'; error: McpError }
  /** 通知（`notifications/initialized`）→ 202 且**无响应体**。 */
  | { status: number; kind: 'accepted' }

export type HttpOutcome = { status: number; body: unknown }

export type LokFeelClientOptions = {
  /** 例：`https://app.lokfeel.com`（末尾斜杠会被去掉）。 */
  baseUrl: string
  /** 会话 Cookie 头值；省略即匿名调用（用于验证"发现公开、协作需授权"）。 */
  cookie?: string
  /** 便于在测试里注入桩；默认 `globalThis.fetch`。 */
  fetchImpl?: typeof fetch
}

/**
 * 切分 `Set-Cookie` 原始头。
 *
 * 为什么不能简单 `split(',')`：`Expires=Wed, 21 Oct 2026 07:28:00 GMT` 里也有逗号。
 * 只在「逗号后紧跟 `name=`」处切分即可避开 —— 这条只在环境缺少
 * `Headers.getSetCookie()` 时才走到。
 */
function splitSetCookieHeader(raw: string): string[] {
  return raw
    .split(/,(?=\s*[A-Za-z0-9_.-]+=)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export class LokFeelClient {
  readonly baseUrl: string
  private cookie?: string
  private readonly fetchImpl: typeof fetch
  private seq = 0

  constructor(opts: LokFeelClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.cookie = opts.cookie
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch
  }

  /** 当前是否携带凭据（不打印凭据本身）。 */
  get hasCredential(): boolean {
    return !!this.cookie
  }

  /**
   * 走**真实登录端点**换取会话 cookie，并写回本客户端。
   *
   * `Origin` / `Referer` 必须带 —— `/api/*` 会过 `proxy.ts` 的 CORS 判定；
   * 少了它们症状是**全站 403**，看起来像"授权把好人也拒了"。
   */
  async login(email: string, password: string): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Origin: this.baseUrl,
        Referer: `${this.baseUrl}/login`,
      },
      body: JSON.stringify({ email, password }),
      redirect: 'manual',
    })
    if (res.status !== 200) {
      throw new Error(
        `登录失败：status=${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`,
      )
    }

    // `getSetCookie()` 是较新的标准；旧运行时回退到原始头切分。
    const headers = res.headers as unknown as { getSetCookie?: () => string[] }
    let raw: string[] = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
    if (raw.length === 0) {
      const single = res.headers.get('set-cookie')
      if (single) raw = splitSetCookieHeader(single)
    }
    const pairs = raw.map((c) => c.split(';')[0]).filter(Boolean)
    if (pairs.length === 0) throw new Error('登录成功但没拿到任何 Set-Cookie')
    this.cookie = pairs.join('; ')
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      // 与浏览器同形：服务端按 Origin 做 CORS 判定（见 proxy.ts）。
      Origin: this.baseUrl,
      Referer: `${this.baseUrl}/workspace`,
      ...extra,
    }
    if (this.cookie) h.cookie = this.cookie
    return h
  }

  // ── MCP ────────────────────────────────────────────────────────
  /** 原样发一条 JSON-RPC 2.0 消息并归一化结果。 */
  async mcpRaw(method: string, params?: unknown): Promise<McpOutcome> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/mcp`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.seq,
        method,
        ...(params === undefined ? {} : { params }),
      }),
    })

    // 202 = 通知已受理，**没有**响应体（对 202 调 .json() 会抛）。
    if (res.status === 202) return { status: 202, kind: 'accepted' }

    const body = (await res.json().catch(() => null)) as
      | { result?: unknown; error?: McpError }
      | null
    if (body?.error) return { status: res.status, kind: 'error', error: body.error }
    return { status: res.status, kind: 'result', result: body?.result }
  }

  /** 握手。**无需会话** —— 外部 Agent 必须先能"看见"服务器。 */
  initialize() {
    return this.mcpRaw('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'lokfeel-example', version: '0.1.0' },
    })
  }

  /** 告知服务器握手完成。得到 202（无响应体）。 */
  notifyInitialized() {
    return this.mcpRaw('notifications/initialized')
  }

  /** 能力清单。**无需会话** —— 公开的是"能做什么"，不是"数据"。 */
  async listTools(): Promise<InteropTool[]> {
    const out = await this.mcpRaw('tools/list')
    if (out.kind !== 'result') return []
    const result = out.result as { tools?: InteropTool[] } | undefined
    return result?.tools ?? []
  }

  /**
   * 调用一个工具。**必须**有会话，且需要该工具声明的 `requiredCapability`。
   * @param organizationId 省略时服务端取调用者唯一的 ACTIVE 成员关系。
   */
  callTool(name: string, args: Record<string, unknown> = {}): Promise<McpOutcome> {
    return this.mcpRaw('tools/call', { name, arguments: args })
  }

  // ── A2A ────────────────────────────────────────────────────────
  /** agent card：描述本 Agent 能做什么。**静态文件、无凭据、无需会话**。 */
  async agentCard(): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}/.well-known/agent-card.json`)
    return res.json().catch(() => null)
  }

  /** 发一个 A2A 任务。语义与 MCP `tools/call` 同源（同一个能力表）。 */
  async sendTask(skillId: string, input: Record<string, unknown> = {}): Promise<HttpOutcome> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/a2a/tasks`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ skillId, input }),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  // ── REST ───────────────────────────────────────────────────────
  /** 通用 REST 调用（本文示例只用 GET/POST）。 */
  async rest(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<HttpOutcome> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }
    return { status: res.status, body: parsed }
  }
}

// ── 结果解读小工具（三个面各自不同，故集中在一处，避免每个示例各写一份）──
export function toolText(out: McpOutcome): string {
  if (out.kind === 'accepted') return '(202 已受理，无响应体)'
  if (out.kind === 'error') return `[JSON-RPC ${out.error.code}] ${out.error.message}`
  const r = out.result as ToolResult | undefined
  return r?.content?.[0]?.text ?? '(空结果)'
}

/** 返回 `undefined` 表示"这次交换根本没到工具结果层"（协议错 / 未认证）。 */
export function toolIsError(out: McpOutcome): boolean | undefined {
  if (out.kind !== 'result') return undefined
  return (out.result as ToolResult | undefined)?.isError === true
}

/**
 * T11 · MCP 适配层（`/api/mcp`）单测
 *
 * ── 这一层要钉住的三件事 ──────────────────────────────────────────
 *  ① **协议形状**：JSON-RPC 2.0 信封校验、错误码、`initialize` 协商、
 *     `notifications/*` 无响应体（202 而不是空 200）。
 *  ② **授权边界**：`tools/list` 公开（发现能力面不需要会话）；
 *     `tools/call` **必须**会话 + 能力 —— 这正是 AC-22 的「授权范围内」。
 *  ③ **能力名不漂移**：每个工具声明的 `requiredCapability` 必须**真实存在**于
 *     `capabilities.ts`。契约里写一个不存在的能力，比不写更糟 —— 它"看起来在执法"。
 *
 * ── 为什么可以 mock 掉 IO ─────────────────────────────────────────
 *  `@/lib/tenancy`、`@/lib/connection`、`@/lib/bridges`、`@/lib/outcome` 四个 barrel
 *  在这里被整体替换：路由的职责是**协议 + 授权分派**，不是业务计算。
 *  另外 `@/lib/bridges` 等 barrel 会拖入 `@/lib/db → next-auth`（纯 ESM），
 *  jest（CJS）require 不了 —— 走 mock 同时也绕开了这个既有的加载陷阱。
 *  真实的端到端行为（含越权）由 `scripts/qa/verify-ac22-open-sdk.mjs` 取证。
 */
jest.mock('@/lib/tenancy', () => ({ resolveTenant: jest.fn() }))
jest.mock('@/lib/connection', () => ({ listMissions: jest.fn() }))
jest.mock('@/lib/bridges', () => ({ listBridges: jest.fn(), listBridgeDiscoveries: jest.fn() }))
jest.mock('@/lib/outcome', () => ({ listOutcomes: jest.fn(), reportOutcome: jest.fn() }))

import { NextRequest } from 'next/server'
import { resolveTenant, type TenantContext } from '@/lib/tenancy'
import { listMissions } from '@/lib/connection'
import { listBridges, listBridgeDiscoveries } from '@/lib/bridges'
import { listOutcomes, reportOutcome } from '@/lib/outcome'
import { ForbiddenError, UnauthorizedError, ValidationError } from '@/lib/errors'
import { TENANT_CAPABILITIES, type TenantRole } from '@/lib/tenancy/capabilities'
import { GET, POST } from '@/app/api/mcp/route'

const mockedResolve = resolveTenant as jest.Mock
const mockedListMissions = listMissions as jest.Mock
const mockedListBridges = listBridges as jest.Mock
const mockedDiscovery = listBridgeDiscoveries as jest.Mock
const mockedListOutcomes = listOutcomes as jest.Mock
const mockedReportOutcome = reportOutcome as jest.Mock

function ctxOf(role: TenantRole, organizationId = 'org-1'): TenantContext {
  return { organizationId, userId: 'user-1', role } as unknown as TenantContext
}

function rpc(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function call(body: unknown) {
  const res = await POST(rpc(body))
  let json: Record<string, unknown> | null = null
  const text = await res.text()
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      json = null
    }
  }
  return { status: res.status, json, text }
}

/** 取 `tools/call` 的内容文本（失败时也在 content 里，不是 JSON-RPC error）。 */
function toolText(json: Record<string, unknown> | null): string {
  const result = json?.result as { content?: { text?: string }[] } | undefined
  return result?.content?.[0]?.text ?? ''
}
function toolIsError(json: Record<string, unknown> | null): boolean {
  return (json?.result as { isError?: boolean } | undefined)?.isError === true
}

beforeEach(() => {
  jest.clearAllMocks()
  mockedResolve.mockResolvedValue(ctxOf('OPERATOR'))
  mockedListMissions.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
  mockedListBridges.mockResolvedValue({ items: [] })
  mockedDiscovery.mockResolvedValue({ members: [], gatedOut: [] })
  mockedListOutcomes.mockResolvedValue([])
  mockedReportOutcome.mockResolvedValue({ id: 'o-1' })
})

// ────────────────────────────────────────────────────────────────
// ① 协议形状
// ────────────────────────────────────────────────────────────────
describe('MCP · 协议形状', () => {
  it('非法 JSON → HTTP 400 + JSON-RPC -32700（Parse error）', async () => {
    const req = new NextRequest('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: { code: number } }
    expect(json.error.code).toBe(-32700)
  })

  it('缺 jsonrpc 字段 → -32600（Invalid Request）', async () => {
    const { status, json } = await call({ id: 1, method: 'ping' })
    expect(status).toBe(400)
    expect((json?.error as { code: number }).code).toBe(-32600)
  })

  it('未知 method → -32601（Method not found）', async () => {
    const { status, json } = await call({ jsonrpc: '2.0', id: 7, method: 'resources/list' })
    expect(status).toBe(404)
    const err = json?.error as { code: number }
    expect(err.code).toBe(-32601)
  })

  it('GET → 405 且带 Allow: POST（不假装支持 SSE 流）', async () => {
    const res = await GET()
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('POST')
  })

  it('notifications/initialized → 202 且**无响应体**（通知不需要回执）', async () => {
    const { status, text } = await call({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(status).toBe(202)
    expect(text).toBe('')
  })

  it('ping → 空 result', async () => {
    const { status, json } = await call({ jsonrpc: '2.0', id: 3, method: 'ping' })
    expect(status).toBe(200)
    expect(json?.result).toEqual({})
  })

  it('id 原样回显（字符串 id 也保持字符串）', async () => {
    const { json } = await call({ jsonrpc: '2.0', id: 'abc', method: 'ping' })
    expect(json?.id).toBe('abc')
  })
})

// ────────────────────────────────────────────────────────────────
// ② initialize
// ────────────────────────────────────────────────────────────────
describe('MCP · initialize', () => {
  it('协商协议版本，且**不需要会话**（未调用 resolveTenant）', async () => {
    const { status, json } = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
    })
    expect(status).toBe(200)
    const r = json?.result as { protocolVersion: string; serverInfo: { name: string } }
    expect(r.protocolVersion).toBe('2025-06-18')
    expect(r.serverInfo.name).toBe('lokfeel-connection-os')
    expect(mockedResolve).not.toHaveBeenCalled()
  })

  it('声明 tools 能力且 listChanged=false（工具集是编译期固定的）', async () => {
    const { json } = await call({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    const caps = (json?.result as { capabilities: { tools: { listChanged: boolean } } }).capabilities
    expect(caps.tools.listChanged).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────
// ③ tools/list —— 公开的能力面
// ────────────────────────────────────────────────────────────────
describe('MCP · tools/list', () => {
  it('**无会话也返回**工具清单（发现是公开的，数据才需要授权）', async () => {
    const { status, json } = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(status).toBe(200)
    const tools = (json?.result as { tools: unknown[] }).tools
    expect(tools.length).toBeGreaterThanOrEqual(4)
    expect(mockedResolve).not.toHaveBeenCalled()
  })

  it('每个工具都有 name / title / description / inputSchema', async () => {
    const { json } = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const tools = (json?.result as { tools: Record<string, unknown>[] }).tools
    for (const t of tools) {
      expect(typeof t.name).toBe('string')
      expect(typeof t.title).toBe('string')
      expect((t.description as string).length).toBeGreaterThan(5)
      expect(t.inputSchema).toBeTruthy()
    }
  })

  it('🔴 每个工具声明的 requiredCapability 都**真实存在**于 capabilities.ts（无"幽灵能力"）', async () => {
    const { json } = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const tools = (json?.result as { tools: { name: string; annotations: { requiredCapability: string } }[] }).tools
    const known = new Set<string>(TENANT_CAPABILITIES)
    for (const t of tools) {
      expect(known.has(t.annotations.requiredCapability)).toBe(true)
    }
    // 顺带：能力名必须形如 `domain.action`
    for (const t of tools) expect(t.annotations.requiredCapability).toMatch(/^[a-z_]+\.[a-z_]+$/)
  })

  it('工具清单里**不含**实现细节（不出现 env 名 / 表名 / 路径）', async () => {
    const { json } = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const serialized = JSON.stringify(json)
    for (const leak of ['process.env', 'prisma', 'CommunityBridge', 'src/lib']) {
      expect(serialized).not.toContain(leak)
    }
  })
})

// ────────────────────────────────────────────────────────────────
// ④ tools/call —— 授权边界（AC-22 的核心）
// ────────────────────────────────────────────────────────────────
describe('MCP · tools/call 授权', () => {
  it('未知工具 → -32602 且**列出**可用工具（便于客户端自纠）', async () => {
    const { json } = await call({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'delete_everything', arguments: {} },
    })
    const err = json?.error as { code: number; data: { available: string[] } }
    expect(err.code).toBe(-32602)
    expect(err.data.available).toContain('list_missions')
  })

  it('🔴 无会话 → HTTP **401**（认证失败是协议层，不是工具结果）', async () => {
    mockedResolve.mockRejectedValue(new UnauthorizedError('no session'))
    const { status, json } = await call({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'list_missions', arguments: {} },
    })
    expect(status).toBe(401)
    expect((json?.error as { code: number }).code).toBe(-32001)
  })

  it('无成员关系（403）→ HTTP 403', async () => {
    mockedResolve.mockRejectedValue(new ForbiddenError('not a member'))
    const { status } = await call({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'list_missions', arguments: {} },
    })
    expect(status).toBe(403)
  })

  it('🔴 能力不足（MEMBER 调 mission.read 工具）→ HTTP 200 但 **isError:true**，且**不调**服务层', async () => {
    mockedResolve.mockResolvedValue(ctxOf('MEMBER'))
    const { status, json } = await call({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'list_missions', arguments: {} },
    })
    expect(status).toBe(200)
    expect(toolIsError(json)).toBe(true)
    expect(toolText(json)).toContain('mission.read')
    expect(toolText(json)).toContain('MEMBER')
    expect(mockedListMissions).not.toHaveBeenCalled()
  })

  it('有权限（OPERATOR）→ isError:false，且服务层收到**租户上下文**', async () => {
    const ctx = ctxOf('OPERATOR', 'org-42')
    mockedResolve.mockResolvedValue(ctx)
    const { json } = await call({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'list_missions', arguments: { pageSize: 5 } },
    })
    expect(toolIsError(json)).toBe(false)
    expect(mockedListMissions).toHaveBeenCalledTimes(1)
    const [calledCtx, opts] = mockedListMissions.mock.calls[0]
    expect(calledCtx).toBe(ctx)
    expect(opts.pageSize).toBe(5)
  })

  it('arguments.organizationId 会透传给 resolveTenant（多组织成员必须显式指定）', async () => {
    await call({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'list_outcomes', arguments: { organizationId: 'org-9' } },
    })
    expect(mockedResolve).toHaveBeenCalledWith({ organizationId: 'org-9' })
  })

  it('query 上的 organizationId 作为兜底（arguments 未给时）', async () => {
    const req = new NextRequest('http://localhost:3000/api/mcp?organizationId=org-q', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'list_outcomes', arguments: {} },
      }),
    })
    await POST(req)
    expect(mockedResolve).toHaveBeenCalledWith({ organizationId: 'org-q' })
  })

  it('服务层抛 ApiError → isError:true 且回显状态码（业务失败不是协议错误）', async () => {
    mockedListBridges.mockRejectedValue(new ValidationError('limit 不合法'))
    const { status, json } = await call({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'list_bridges', arguments: {} },
    })
    expect(status).toBe(200)
    expect(toolIsError(json)).toBe(true)
    expect(toolText(json)).toContain('400')
  })

  it('服务层抛非 ApiError → isError:true 且**不泄漏**内部细节', async () => {
    mockedListOutcomes.mockRejectedValue(new Error('SQLITE_ERROR: no such column: secret_col'))
    const { json } = await call({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'list_outcomes', arguments: {} },
    })
    expect(toolIsError(json)).toBe(true)
    expect(toolText(json)).not.toContain('secret_col')
    expect(toolText(json)).not.toContain('SQLITE')
  })

  it('bridge_discovery 把 bridgeId 原样交给服务层（跨群发现的唯一入口）', async () => {
    await call({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'bridge_discovery', arguments: { bridgeId: 'br-1' } },
    })
    expect(mockedDiscovery).toHaveBeenCalledTimes(1)
    expect(mockedDiscovery.mock.calls[0][1]).toBe('br-1')
  })

  it('MEMBER 可以 report_outcome（outcome.report 属自助能力）', async () => {
    mockedResolve.mockResolvedValue(ctxOf('MEMBER'))
    const { json } = await call({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'report_outcome', arguments: { proposalId: 'p-1', summary: '已面谈' } },
    })
    expect(toolIsError(json)).toBe(false)
    expect(mockedReportOutcome).toHaveBeenCalledTimes(1)
  })

  it('成功结果以 JSON 文本返回（MCP content[].type === "text"）', async () => {
    mockedListOutcomes.mockResolvedValue([{ id: 'o-1' }] as never)
    const { json } = await call({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: { name: 'list_outcomes', arguments: {} },
    })
    const content = (json?.result as { content: { type: string; text: string }[] }).content
    expect(content[0].type).toBe('text')
    expect(JSON.parse(content[0].text)).toEqual([{ id: 'o-1' }])
  })
})

/**
 * 限流（2026-10-17 补）。
 *
 * 这里**故意用独立 IP**：桶是 `mcp:rpc:<ip>`，若复用默认 'anonymous'，
 * 本组把额度打满后，同文件后续用例会全部 429 —— 那是最容易被误读成
 * "路由坏了"的假失败。
 */
describe('限流：120 次/分钟/IP', () => {
  const IP = '198.51.100.201'

  function limitedRpc() {
    return POST(
      new NextRequest('http://localhost:3000/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': IP },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    )
  }

  it('第 121 次被拒：429 + JSON-RPC 错误信封 + Retry-After', async () => {
    let res = await limitedRpc()
    for (let i = 1; i < 120; i++) res = await limitedRpc()
    expect(res.status).toBe(200) // 第 120 次仍在额度内

    const blocked = await limitedRpc()
    expect(blocked.status).toBe(429)

    // 形状必须仍是 JSON-RPC —— 裸文本会被客户端当成传输故障，而不是"被限流"
    const body = JSON.parse(await blocked.text()) as {
      jsonrpc: string
      id: null
      error: { code: number; message: string }
      result?: unknown
    }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBeNull()
    expect(body.error.code).toBe(-32000)
    expect(body.result).toBeUndefined()
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
  })

  it('429 发生在解析请求体之前（垃圾请求体同样被限流，不会先 400）', async () => {
    const res = await POST(
      new NextRequest('http://localhost:3000/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': IP },
        body: 'not-json',
      }),
    )
    expect(res.status).toBe(429)
  })
})

describe('额度回显：RateLimit-* 三件套', () => {
  const IP = '198.51.100.203'
  const rpc = () =>
    POST(
      new NextRequest('http://localhost:3000/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': IP },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    )

  it('每个响应都带 Limit/Remaining/Reset，且 Remaining 逐次递减', async () => {
    const first = await rpc()
    expect(first.headers.get('ratelimit-limit')).toBe('120')
    expect(first.headers.get('ratelimit-remaining')).toBe('119')
    expect(Number(first.headers.get('ratelimit-reset'))).toBeGreaterThanOrEqual(1)
    // 测试环境没有 Upstash 凭据 ⇒ 计数只在进程内有效，必须如实回显 `memory`
    // （生产上若是 memory，就说明限流在多实例下被放大了 N 倍）
    expect(first.headers.get('ratelimit-backend')).toBe('memory')

    const second = await rpc()
    expect(second.headers.get('ratelimit-remaining')).toBe('118')
  })
})


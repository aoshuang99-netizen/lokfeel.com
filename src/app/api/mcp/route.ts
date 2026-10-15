/**
 * T11 · MCP 适配层（Model Context Protocol · Streamable HTTP）
 *
 * ── 为什么是 HTTP 而不是 stdio ─────────────────────────────────────
 *   Netlify 免费计划**没有常驻进程**，stdio 型 MCP server 无处安放；
 *   而 HTTP 型端点随应用一起部署，且**复用同一套租户守卫** ——
 *   这两点决定了「越权必须失败」能在**真实链路**上取证，而不是只在单测里假设。
 *
 * ── 能力边界（本文件的核心设计）────────────────────────────────────
 *   MCP 是**单端点**，但不同工具需要不同能力 ⇒ **不能**用 `withTenant(cap)` 包住整个路由
 *   （那会把最严的能力强加给最松的工具）。这里改为：
 *     · 路由层只做「JSON-RPC 形状校验」
 *     · **逐工具** 在 `tools/call` 内 `resolveTenant()` + `can(role, tool.capability)`
 *   拒绝语义与 REST 面**一致**：无会话 → HTTP 401；有会话但能力不足 → 工具级失败
 *   （`result.isError = true`，HTTP 仍 200 —— 因为"调用成功、业务拒绝"是工具结果，不是协议错误）。
 *
 * ── 暴露面 ────────────────────────────────────────────────────────
 *   `initialize` 与 `tools/list` **不需要会话**：外部 Agent 必须先"看见"服务器有什么能力，
 *   才能谈授权。敏感的是**数据**（`tools/call` 的结果），不是**能力清单**。
 *   因此：**发现（工具清单）公开，协作（调用工具）必须授权** —— 这正是 AC-22 的形状。
 *
 * ── 工具定义在哪 ──────────────────────────────────────────────────
 *   **不在本文件** —— 见 `@/lib/interop/tools`。MCP 与 A2A 共用同一份目录，
 *   避免两套协议的工具清单各自漂移（那种漂移是静默的）。
 *
 * ── 不做什么（诚实声明）────────────────────────────────────────────
 *   · 不做 SSE 流式（`GET` 返回 405）：本项目工具都是**短请求**，流式没有收益。
 *   · 不做 resources / prompts（只实现 `tools`）—— 未用到的能力声明出来只会误导客户端。
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveTenant, type TenantContext } from '@/lib/tenancy'
import { can } from '@/lib/tenancy/capabilities'
import { ApiError } from '@/lib/errors'
import { INTEROP_TOOL_NAMES, publicToolList, toolByName } from '@/lib/interop/tools'

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'lokfeel-connection-os', version: '0.2.0' }

// ── JSON-RPC 2.0 小工具 ────────────────────────────────────────────
type JsonRpcId = string | number | null

function rpcResult(id: JsonRpcId, result: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: '2.0', id, result }, { status })
}
function rpcError(id: JsonRpcId, code: number, message: string, status = 200, data?: unknown) {
  return NextResponse.json(
    { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } },
    { status },
  )
}

/** MCP `tools/call` 的结果信封：业务失败走 `isError`，**不**走 JSON-RPC error。 */
function toolContent(id: JsonRpcId, text: string, isError: boolean) {
  return rpcResult(id, { content: [{ type: 'text', text }], isError })
}

// ── 路由 ───────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic'

/** Streamable HTTP 的 GET 用于 SSE 流；本项目工具都是短请求，不做流式。 */
export async function GET() {
  return NextResponse.json(
    { error: 'Method Not Allowed: 本服务不提供 SSE 流式（工具均为短请求），请用 POST 发 JSON-RPC。' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return rpcError(null, -32700, 'Parse error: 请求体不是合法 JSON', 400)
  }

  const msg = payload as { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: unknown }
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError((msg?.id as JsonRpcId) ?? null, -32600, 'Invalid Request: 需要 JSON-RPC 2.0 信封', 400)
  }
  const id: JsonRpcId = msg.id ?? null
  const orgIdFromQuery = req.nextUrl.searchParams.get('organizationId') ?? undefined

  switch (msg.method) {
    // ── 握手（无需会话）──────────────────────────────────────────
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'LokFeel 连接引擎。所有工具都在**租户授权范围内**执行：无会话 401，能力不足则工具返回 isError。' +
          '调用 list_bridges 找到协议 id，再用 bridge_discovery 发现对方组织中自愿披露的成员。',
      })

    case 'notifications/initialized':
      // 通知没有响应体 —— 返回 202 表示已受理。
      return new NextResponse(null, { status: 202 })

    case 'ping':
      return rpcResult(id, {})

    // ── 能力清单（无需会话）──────────────────────────────────────
    case 'tools/list':
      return rpcResult(id, { tools: publicToolList() })

    // ── 工具调用（**必须**会话 + 能力）────────────────────────────
    case 'tools/call': {
      const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown }
      const tool = toolByName(params.name)
      if (!tool) {
        return rpcError(id, -32602, `Unknown tool: ${typeof params.name === 'string' ? params.name : '(missing)'}`, 200, {
          available: INTEROP_TOOL_NAMES,
        })
      }

      // ① 身份：无会话 ⇒ HTTP 401（与 REST 面一致）
      let ctx: TenantContext
      try {
        const args = (params.arguments ?? {}) as Record<string, unknown>
        const organizationId =
          typeof args.organizationId === 'string' ? args.organizationId : orgIdFromQuery
        ctx = await resolveTenant({ organizationId })
      } catch (err) {
        const status = err instanceof ApiError && err.statusCode === 401 ? 401 : 403
        return rpcError(id, -32001, 'Unauthorized: 需要有效的会话与组织成员关系', status)
      }

      // ② 能力：逐工具判定（不是把最严能力套在整个端点上）
      if (!can(ctx.role, tool.capability)) {
        console.error(
          `[mcp] capability denied: tool=${tool.name} org=${ctx.organizationId} role=${ctx.role} required=${tool.capability}`,
        )
        return toolContent(
          id,
          `权限不足：工具 ${tool.name} 需要 ${tool.capability} 能力，当前角色是 ${ctx.role}。`,
          true,
        )
      }

      // ③ 执行：只调服务层（服务层还会复判一次能力 —— 纵深防御）
      try {
        const data = await tool.run(ctx, (params.arguments ?? {}) as Record<string, unknown>)
        return toolContent(id, JSON.stringify(data, null, 2), false)
      } catch (err) {
        if (err instanceof ApiError) {
          return toolContent(id, `执行失败（${err.statusCode}）：${err.message}`, true)
        }
        console.error(`[mcp] tool error: ${tool.name}`, err)
        return toolContent(id, `执行失败：内部错误（工具 ${tool.name}）`, true)
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`, 404)
  }
}

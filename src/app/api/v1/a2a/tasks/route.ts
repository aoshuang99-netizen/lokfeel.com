/**
 * T11 · A2A 适配层（Agent-to-Agent · **最小可用**）
 *
 * ── 本切片的范围（用户拍板：最小可用）────────────────────────────
 *   保留 A2A 的**形状**（`task` + `status.state` + `artifacts`），省略：
 *     · SSE 流式（`streaming: false` 已在 agent card 里声明）
 *     · push notification / 长任务（本项目工具都是短请求，一个来回就结束）
 *     · `tasks/get` 的持久化查询（任务**不落库** —— 无状态适配层，见下）
 *
 * ── 为什么任务不落库 ──────────────────────────────────────────────
 *   若把 task 落库，就产生了"第二套运行记录"，与 T09 的 `AgentRun` 语义重叠
 *   （谁是真相来源？重试以谁为准？）—— 那需要一个完整的状态机，属于"完整生命周期"。
 *   最小可用刻意选择**无状态**：`task.id` 只在本次响应里有效，客户端要再查就重发。
 *   这样适配层不引入任何新的持久化面，也不会与 T09 打架。
 *
 * ── 授权 ──────────────────────────────────────────────────────────
 *   与 MCP **完全同源**：`resolveTenant()` 拿上下文 → `can(role, skill.capability)` 判能力。
 *   无会话 → HTTP 401；有会话但能力不足 → `status.state = "failed"`（HTTP 200，
 *   因为"任务被受理但被业务拒绝"是任务结果，不是传输错误）。
 *   工具目录与 MCP 共用（`@/lib/interop/tools`），不会两套清单各自漂移。
 *
 * ── 与 agent card 的关系 ──────────────────────────────────────────
 *   本端点声明的技能必须与 `public/.well-known/agent-card.json` 的 `skills` 一致；
 *   两者的来源都是 `INTEROP_TOOLS`，由 `npm run check:openapi-contract` 之外的
 *   `npm run verify:ac22:open-sdk` 在**运行时**逐条核对（agent card 里的每个 skill
 *   都必须真的能被本端点执行，且需要的能力真的存在）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveTenant } from '@/lib/tenancy'
import { can } from '@/lib/tenancy/capabilities'
import { ApiError } from '@/lib/errors'
import { rateLimit, retryAfterSeconds, applyRateLimitHeaders } from '@/lib/rate-limit'
import { INTEROP_TOOL_NAMES, toolByName } from '@/lib/interop/tools'

export const dynamic = 'force-dynamic'

/**
 * 限流（2026-10-17 补）。与 MCP 同因同额度：本端点也是**公开可达**的机器接口，
 * 早先零限流（AC-24 阳性对照实测：200 次请求零 429）。
 * 桶名独立（`a2a:task`）—— 与 MCP 分开计数，否则一边被刷会连坐另一边。
 */
const a2aLimit = rateLimit({ name: 'a2a:task', windowMs: 60_000, max: 120 })

type ArtifactPart = { type: 'data'; data: unknown } | { type: 'text'; text: string }

function taskEnvelope(
  skillId: string,
  state: 'completed' | 'failed',
  parts: ArtifactPart[],
  statusMessage?: string,
) {
  return {
    task: {
      id: `a2a-${crypto.randomUUID()}`,
      skillId,
      status: { state, ...(statusMessage ? { message: statusMessage } : {}), timestamp: new Date().toISOString() },
      artifacts: state === 'completed' ? [{ artifactId: 'result', parts }] : [],
    },
  }
}

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 限流先于解析：见 MCP 路由同样的理由（429 用本层的错误信封）。
  const verdict = await a2aLimit(req)
  if (!verdict.success) {
    const res = fail(429, 'RESOURCE_EXHAUSTED', 'Too many requests：请降低调用频率后重试')
    res.headers.set('Retry-After', String(retryAfterSeconds(verdict)))
    applyRateLimitHeaders(res, verdict)
    return res
  }
  const res = await handleTask(req)
  applyRateLimitHeaders(res, verdict)
  return res
}

async function handleTask(req: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail(400, 'INVALID_ARGUMENT', '请求体不是合法 JSON')
  }

  const input = (body ?? {}) as { skillId?: unknown; input?: unknown }
  const skillId = typeof input.skillId === 'string' ? input.skillId : ''
  if (!skillId) {
    return fail(400, 'INVALID_ARGUMENT', `缺少 skillId。可用技能：${INTEROP_TOOL_NAMES.join(', ')}`)
  }

  const tool = toolByName(skillId)
  if (!tool) {
    return fail(404, 'SKILL_NOT_FOUND', `未知技能 ${skillId}。可用技能：${INTEROP_TOOL_NAMES.join(', ')}`)
  }

  // ① 身份：无会话 ⇒ 401（与 MCP / REST 面同一语义）
  let ctx: Awaited<ReturnType<typeof resolveTenant>>
  try {
    ctx = await resolveTenant({ organizationId: (input.input as { organizationId?: string })?.organizationId })
  } catch (err) {
    const status = err instanceof ApiError && err.statusCode === 401 ? 401 : 403
    return fail(status, 'UNAUTHENTICATED', '需要有效的会话与组织成员关系')
  }

  // ② 能力：逐技能判定
  if (!can(ctx.role, tool.capability)) {
    console.error(
      `[a2a] capability denied: skill=${skillId} org=${ctx.organizationId} role=${ctx.role} required=${tool.capability}`,
    )
    return NextResponse.json(
      taskEnvelope(skillId, 'failed', [], `权限不足：技能 ${skillId} 需要 ${tool.capability} 能力，当前角色是 ${ctx.role}。`),
      { status: 200 },
    )
  }

  // ③ 执行：只调服务层
  try {
    const data = await tool.run(ctx, (input.input ?? {}) as Record<string, unknown>)
    return NextResponse.json(taskEnvelope(skillId, 'completed', [{ type: 'data', data }]), { status: 200 })
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        taskEnvelope(skillId, 'failed', [], `执行失败（${err.statusCode}）：${err.message}`),
        { status: 200 },
      )
    }
    console.error(`[a2a] skill error: ${skillId}`, err)
    return NextResponse.json(
      taskEnvelope(skillId, 'failed', [], `执行失败：内部错误（技能 ${skillId}）`),
      { status: 200 },
    )
  }
}

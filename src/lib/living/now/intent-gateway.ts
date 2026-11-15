/**
 * V21 · C03 —— IntentGateway（客户端侧）
 *
 * 「目标 → 理解」的**唯一**入口：不再在浏览器里直接 `compileWorkspaceSpec` 充当理解，
 * 而是先走服务端真实链路 `POST /api/v1/agents/runs`（skill=INTENT_EXTRACTION）：
 *   服务端 → WorkBuddy/OpenAI 模型 → `WorkspaceSpecSchema` 校验 → 诚实降级兜底。
 *
 * 🔴 三条纪律（与 tests/living/now-intent-gateway.test.ts 一一对应）：
 *   1. **不冒充**：`provenance` 只有两种值 —— 'ai'（模型产出且未降级）与 'rule'。
 *      服务端 `DEGRADED` 一律是规则产物，`providerKind` 说什么都不改判。
 *   2. **不沉默**：任何降级/兜底都把原因写进 `note`，UI 必须展示。
 *   3. **不假成功**：服务端没给**契约合法**的 spec，就绝不下发 ok ——
 *      哪怕 HTTP 200（防御纵深：客户端再过一遍 `WorkspaceSpecSchema`）。
 *
 * 为什么客户端还要再校验一次 proposal：服务端契约承诺「proposal 是唯一可渲染来源」，
 * 但跨网络传输后它只是一段 JSON。渲染前再校验一层，等于「不信任任何声明，只信任
 * 当次校验结果」——与服务端 `degrade()` 的哲学同源。
 *
 * 何时允许本地规则兜底：服务端**能力不足（403）**或**不可达（网络/5xx/429）**。
 * 不兜底的两种：401（先登录）与 400（输入本身错）——兜底会掩盖真实问题。
 */

import {
  MIN_GOAL_LENGTH,
  WorkspaceSpecSchema,
  compileWorkspaceSpec,
  type WorkspaceSpec,
} from '@/lib/workspace-spec'

export type IntentProvenance = 'ai' | 'rule'

export interface IntentRunMeta {
  /** 服务端 run id；本地兜底时为 null（没有 run 可指）。 */
  runId: string | null
  status: string | null
  providerKind: string | null
  degradeCode: string | null
  /** 服务端注入信号告警（旁证，透传给 UI 展示）。 */
  injectionFlagged: boolean
  /** 幂等重放：true = 服务端判定重复提交，返回的是同一条 run。 */
  replayed: boolean
}

export type IntentOutcome =
  | {
      kind: 'ok'
      spec: WorkspaceSpec
      provenance: IntentProvenance
      /** 降级/兜底的人话说明；'ai' 且无异常时为 null。 */
      note: string | null
      meta: IntentRunMeta
    }
  | { kind: 'error'; reason: string; suggestions: string[] }

export interface IntentGatewayDeps {
  /** 注入以便单测在系统边界 mock；缺省用全局 fetch。 */
  fetchImpl?: typeof fetch
  /**
   * V21 第二批 · 异步竞态：由「最新提交获胜」控制器注入。
   * 新目标提交 / 取消 / 超时都会 abort 它；**被取消的请求不许降级成规则成功**
   * （那会用一份旧方案冒充本次理解结果）。
   */
  signal?: AbortSignal
}

/** 服务端 run 响应里客户端会消费的字段（AgentRunDto 的子集）。 */
interface RunPayload {
  id?: string
  status?: string
  providerKind?: string
  proposal?: unknown
  reason?: string | null
  degradeCode?: string | null
  injectionFlagged?: boolean
}

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string }
}

const LOCAL_FALLBACK_NOTE = '已降级为「规则式」理解：'
const localRunMeta: IntentRunMeta = {
  runId: null,
  status: null,
  providerKind: 'rules',
  degradeCode: null,
  injectionFlagged: false,
  replayed: false,
}

/** 本地规则兜底：编译成功才 ok，失败把原因与建议原样上抛。 */
function localRuleFallback(goal: string, why: string): IntentOutcome {
  const compiled = compileWorkspaceSpec(goal)
  if (!compiled.ok) return { kind: 'error', reason: `${why}，且本地规则也编译不了：${compiled.reason}`, suggestions: compiled.suggestions }
  return {
    kind: 'ok',
    spec: compiled.spec,
    provenance: 'rule',
    note: `${LOCAL_FALLBACK_NOTE}${why}。`,
    meta: localRunMeta,
  }
}

/**
 * 把一句目标交给服务端理解，拿到**契约合法**的 WorkspaceSpec 与真实来源。
 * `idempotencyKey` 由调用方管理（同目标重试复用同键，目标换了换新键）。
 */
export async function resolveIntent(
  goal: string,
  idempotencyKey: string,
  deps: IntentGatewayDeps = {},
): Promise<IntentOutcome> {
  const trimmed = goal.trim()
  if (trimmed.length < MIN_GOAL_LENGTH) {
    return { kind: 'error', reason: `至少说清一句话（${MIN_GOAL_LENGTH} 个字起）`, suggestions: [] }
  }
  if (!idempotencyKey) {
    return { kind: 'error', reason: '缺少幂等键，本次未发起请求', suggestions: [] }
  }

  const doFetch = deps.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch('/api/v1/agents/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ skill: 'INTENT_EXTRACTION', input: { goal: trimmed } }),
      ...(deps.signal ? { signal: deps.signal } : {}),
    })
  } catch {
    // 🔴 取消 ≠ 网络故障：被新提交取代/超时的请求绝不走本地规则兜底，
    //    否则旧 A 的「规则方案」会覆盖新 B 的结果（用户点名的异步串台风险）。
    if (deps.signal?.aborted) {
      return { kind: 'error', reason: '这次理解已取消或超时，请重新提交。', suggestions: [] }
    }
    // 网络不可达：产品仍可用（本地规则），但来源必须写清。
    return localRuleFallback(trimmed, '服务端暂不可达')
  }

  const json = (await res.json().catch(() => null)) as ApiEnvelope<{ run?: RunPayload; replayed?: boolean }> | null

  if (res.status === 401) {
    return { kind: 'error', reason: json?.error?.message ?? '登录已过期，请重新登录', suggestions: [] }
  }
  if (res.status === 400) {
    return { kind: 'error', reason: json?.error?.message ?? '请求被服务端拒绝（400）', suggestions: [] }
  }
  if (res.status === 403) {
    // 当前角色没有 agent.run 能力 —— 不是错误场景，是产品对 MEMBER 的正常形态。
    return localRuleFallback(trimmed, json?.error?.message ?? '当前角色不能发起 AI 理解')
  }
  if (!res.ok) {
    // 429 / 5xx 等：服务端在但没接住 —— 兜底并写明。
    return localRuleFallback(trimmed, json?.error?.message ?? `服务端暂时没能处理（HTTP ${res.status}）`)
  }

  const run = json?.data?.run
  if (!run) {
    return { kind: 'error', reason: '服务端响应里没有运行记录 —— 按失败处理，不报告成功', suggestions: [] }
  }

  const meta: IntentRunMeta = {
    runId: run.id ?? null,
    status: run.status ?? null,
    providerKind: run.providerKind ?? null,
    degradeCode: run.degradeCode ?? null,
    injectionFlagged: run.injectionFlagged === true,
    replayed: res.headers.get('Idempotent-Replayed') === 'true' || json?.data?.replayed === true,
  }

  // 服务端声明 DEGRADED ⇒ payload 一定是规则产物（服务端 degrade() 契约）。
  const degraded = run.status === 'DEGRADED'
  const parsed = WorkspaceSpecSchema.safeParse(run.proposal)
  if (!parsed.success) {
    // 2xx 但产出不合法：先按服务端 reason 报错；goal 若能本地编译则兜底。
    const why = run.reason ?? '服务端产出未通过契约校验'
    return localRuleFallback(trimmed, why)
  }

  const provenance: IntentProvenance =
    degraded || !(run.providerKind === 'workbuddy' || run.providerKind === 'openai') ? 'rule' : 'ai'

  return {
    kind: 'ok',
    spec: parsed.data,
    provenance,
    note: degraded ? (run.reason ?? '已降级为「规则式」理解') : null,
    meta,
  }
}

/** 来源徽章：只认 provenance，不猜。 */
export function provenanceBadge(provenance: IntentProvenance): { label: string; detail: string } {
  if (provenance === 'ai') {
    return { label: 'AI 理解', detail: '本方案由模型理解你的目标生成，服务端已校验结构。' }
  }
  return { label: '规则方案', detail: '本方案由内置规则生成（未用模型）——能力弱一些，内容仍需你确认。' }
}

/**
 * T09 · Agent 服务层 —— 运行的持久化、审批与用量（Slice 2）
 *
 * 🔴 为什么本文件**不在** `src/lib/agent/`（单数）里：
 *    那个目录是**无 IO 的内核**，由 `scripts/check-agent-invariants.mjs` 的 A1/A2 守着
 *    （不得 import tenancy、不得 import 数据库）。本文件两样都要 —— 所以它在外面。
 *    **目录边界就是执法点**：混进内核目录，A1/A2 立刻失效，而"内核无 IO"会**静默**
 *    退化成一句口头约定。
 *
 * 本层承担三件事，且每件都有明确的**唯一**落点：
 *   1. **持久化** —— `runSkill()` 只返回提案（内存对象），落库是这一层的事；
 *      `rawText`（模型原文）落库只为审计，**永不进 DTO**（见 dto.ts）。
 *   2. **限额** —— 从 `AgentCall` 读回**本期**已发生的调用喂给 `runSkill` 做**调用前**
 *      判定（AC-20）。只看本次请求的账 = "每次请求都从 0 开始算额度"，那不是限额。
 *   3. **审批** —— 只经 `approval.ts` 的真相表迁移；本层**仍然不写 `EXECUTED`**。
 *
 * 🔴 本层**不执行任何副作用**：审批的产物是"状态变成 APPROVED"，
 *    不是"消息发出去了" —— 后者在 `executor.ts`（经 T06 的统一投递出口）。
 *    `EXECUTED` 只有一个写入点，就是那个文件；这条"只有一条路径"由
 *    `tests/agents/execution-gated.test.ts` 的**静态断言**守着
 *    （服务层 + 路由层源码里 `EXECUTED` 字面量只允许出现在 `executor.ts`）。
 *    把执行单独放一个文件，是为了让这条性质可被检查，而不是靠"我记得没在别处写过"。
 */

import { db } from '@/lib/db'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import { can } from '@/lib/tenancy/capabilities'
import type { TenantContext } from '@/lib/tenancy/resolve'
import {
  DEFAULT_PRICE_TABLE,
  SKILLS,
  assertTransition,
  canTransition,
  formatMicroCents,
  isSkillKey,
  ledgerTotals,
  runSkill,
  type AgentCallRecord,
  type AgentQuota,
  type AgentRunStatus,
  type LedgerSnapshot,
  type PriceTable,
  type ProviderResolution,
  type RiskLevel,
  type SkillKey,
} from '@/lib/agent'
import { hashRequest, requireIdempotencyKey, withIdempotency } from '@/lib/connection/idempotency'
// 额度的**来源**：方案的限额表（T08）—— 本层不新造第二张额度表，见 ./quota.ts 的文件头。
import { PLAN_LABELS, type EffectivePlan } from '@/lib/billing/plans'
import { resolveOrganizationAgentQuota } from './quota'
// 对外送达（Slice 6）：目标在**创建时**解析并落库；披露依据在读取/执行时复验。
import {
  loadOutboundGates,
  normalizeDeliveryInput,
  resolveDeliveryTarget,
  toDeliveryTargetCreate,
  toDeliveryTargetRow,
  type OutboundGate,
} from './delivery-target'
import {
  providerKindFromDb,
  providerKindToDb,
  toAgentRunDto,
  toAgentRunSummaryDto,
  type AgentRunDto,
  type AgentRunRow,
  type AgentRunSummaryDto,
  type AgentRunViewer,
} from './dto'
import { providerHonesty, resolveRuntimeProvider, type ProviderHonesty } from './provider-openai'

/** 幂等作用域（与 `IdempotencyRecord.scope` 对齐）。 */
export const AGENT_RUN_SCOPE = 'agent.run'

/**
 * DTO 的 `canApprove` / `canReject` 里**权限那一半**。
 *
 * 🔴 只在这一层判：权限判定（`can`）属服务层，DTO 只做投影 —— 所以这里把它算成一个
 *    布尔传下去，而不是把角色传进 DTO。判据与路由的 `withTenant('agent.approve')`
 *    用的是**同一个函数**，因此"界面说能点、接口说 403"这种分叉在结构上不存在。
 */
function viewerOf(ctx: TenantContext, outbound?: OutboundGate): AgentRunViewer {
  // ⚠️ `undefined` 与"空闸门"是**不同**的事：前者 = 这条运行根本没有对外送达这一步；
  //    后者会被 DTO 读成"要送、但没有目标" ⇒ 界面显示不可执行（那是错的，不是保守）。
  return {
    canDecide: can(ctx.role, 'agent.approve'),
    ...(outbound ? { outbound } : {}),
  }
}

export const AGENT_LIMITS = {
  subjectLabelMax: 120,
  noteMax: 300,
  /** 列表页单次上限（与 `listOutcomes` 的钳制同一取向）。 */
  listMax: 100,
  listDefault: 30,
} as const

// ═══════════════════════════════════════════════════════════
// 查询形状
// ═══════════════════════════════════════════════════════════

/**
 * 🔴 刻意**不 select `rawText`**：模型原文连进内存的机会都没有，就没有误用它的可能。
 *    这比"记得不要在 DTO 里带上它"更可靠 —— 后者依赖每个新加字段的人都记得。
 */
const CALL_SELECT = {
  seq: true,
  skill: true,
  providerKind: true,
  risk: true,
  highCost: true,
  ok: true,
  inputTokens: true,
  outputTokens: true,
  microCents: true,
  at: true,
} as const

const APPROVAL_SELECT = {
  decision: true,
  actorId: true,
  deciderRole: true,
  note: true,
  decidedAt: true,
} as const

/** 执行记录（Slice 4）。同样是"只增不改"的事件，全部字段都可读。 */
const EXECUTION_SELECT = {
  id: true,
  kind: true,
  channel: true,
  recipientId: true,
  deliveryId: true,
  deliveryStatus: true,
  actorId: true,
  executedAt: true,
} as const

/**
 * 送达目标的行形状（Slice 6）。
 *
 * ⚠️ 四个字段都要：`targetUserId` / `authorizedFieldKeys` 是内核判据的输入，
 *    `intentId` 用来在执行时读回**当时生效**的披露表（撤销即刻生效的落点），
 *    `audience` 只进审计（"当时按哪一档送的"）。
 */
const DELIVERY_TARGET_SELECT = {
  targetUserId: true,
  intentId: true,
  audience: true,
  authorizedFieldKeys: true,
} as const

const RUN_SELECT = {
  id: true,
  skill: true,
  status: true,
  risk: true,
  requiresApproval: true,
  requestedBy: true,
  subjectLabel: true,
  goal: true,
  proposalJson: true,
  reason: true,
  degradeCode: true,
  providerKind: true,
  injectionSignals: true,
  costMicroCents: true,
  createdAt: true,
  updatedAt: true,
} as const

// ═══════════════════════════════════════════════════════════
// 校验与工具
// ═══════════════════════════════════════════════════════════

export function requireSkillKey(raw: unknown): SkillKey {
  if (!isSkillKey(raw)) {
    throw new ValidationError(`unknown skill: ${String(raw)}`, {
      field: 'skill',
      allowed: Object.keys(SKILLS),
    })
  }
  return raw
}

/**
 * 输入先用**技能自己的**契约校验，不合格 → 400。
 *
 * 为什么在服务层先做一次（`runSkill` 内部也会做）：输入不合法是**调用方的错**，
 * 不该被持久化成一条 `FAILED` 的运行 —— 那会让"运行列表"里塞满从未真正跑过的记录，
 * 也会污染按状态统计的用量。这里挡住，`runSkill` 里那次就只是内部兜底。
 */
function assertSkillInput(skill: SkillKey, raw: unknown): void {
  const parsed = SKILLS[skill].inputSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new ValidationError(
      `输入不符合技能契约：${first?.path.join('.') ?? '(root)'} ${first?.message ?? ''}`,
      { field: 'input', skill },
    )
  }
}

function normalizeLabel(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') {
    throw new ValidationError('subjectLabel must be a string', { field: 'subjectLabel' })
  }
  const label = raw.trim()
  if (!label) return null
  if (label.length > AGENT_LIMITS.subjectLabelMax) {
    throw new ValidationError(
      `subjectLabel must be at most ${AGENT_LIMITS.subjectLabelMax} characters`,
      { field: 'subjectLabel' },
    )
  }
  return label
}

function normalizeNote(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') {
    throw new ValidationError('note must be a string', { field: 'note' })
  }
  const note = raw.trim()
  if (!note) return null
  if (note.length > AGENT_LIMITS.noteMax) {
    throw new ValidationError(`note must be at most ${AGENT_LIMITS.noteMax} characters`, {
      field: 'note',
    })
  }
  return note
}

/** 从原始输入里取 goal（落库要有"这条运行是为什么跑的"）。 */
function rawGoalOf(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const g = (raw as { goal?: unknown }).goal
    if (typeof g === 'string') return g
  }
  return ''
}

/** 自然月期次键（UTC，`YYYY-MM`）。与 T08 用量账同口径：期次是账单本来的概念。 */
export function periodKeyOf(now: Date): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function startOfPeriod(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
}

// ═══════════════════════════════════════════════════════════
// 账本装载（AC-20 的"调用之前"）
// ═══════════════════════════════════════════════════════════

function toCallRecord(row: {
  skill: string
  providerKind: string
  risk: string
  highCost: boolean
  ok: boolean
  inputTokens: number
  outputTokens: number
  microCents: number
  at: Date
}): AgentCallRecord {
  return {
    skill: row.skill,
    providerKind: providerKindFromDb(row.providerKind),
    risk: row.risk as RiskLevel,
    highCost: row.highCost,
    ok: row.ok,
    usage: { inputTokens: row.inputTokens, outputTokens: row.outputTokens },
    microCents: row.microCents,
    at: row.at.toISOString(),
  }
}

/**
 * 读回**本期**（当前 UTC 自然月）已发生的调用，作为限额判定的输入。
 *
 * ⚠️ 返回的是**本期**（UTC 自然月）的流水，不是"这个组织有多少额度"。
 * 额度从哪来见 `./quota.ts`：按订阅方案派生（不再是全局常量）。
 * 数字本身**仍是占位假设**，因此随响应下发（见 `agentUsage` 的 `assumptions`），
 * 而不是藏在代码里 —— 否则"额度用完了"这句提示就成了没有依据的断言。
 */
async function loadLedger(organizationId: string, now: Date): Promise<LedgerSnapshot> {
  const rows = await db.agentCall.findMany({
    where: { organizationId, at: { gte: startOfPeriod(now) } },
    orderBy: { at: 'asc' },
    select: {
      skill: true,
      providerKind: true,
      risk: true,
      highCost: true,
      ok: true,
      inputTokens: true,
      outputTokens: true,
      microCents: true,
      at: true,
    },
  })
  return { calls: rows.map(toCallRecord) }
}

// ═══════════════════════════════════════════════════════════
// 读取
// ═══════════════════════════════════════════════════════════

/**
 * 按 id 读一条运行。**租户谓词不可省** —— 复合条件写在一起，
 * 而不是"先按 id 查、再断言 organizationId 相等"：
 * 后者只要有人漏写那次断言，就是一次跨租户读取。
 */
/**
 * ⚠️ **导出**（而不是各模块各写一个查询）：执行器 `executor.ts` 必须看到与读取路径
 * **逐字相同**的行形状 —— 特别是 `approval`（"有没有一条 APPROVED 裁决"）与
 * `execution`（是不是已经执行过）。各写一份迟早分叉，而分叉的后果是
 * "DTO 说能执行、执行器说不给执行"这种最难查的不一致。
 */
export async function findRunRow(
  organizationId: string,
  runId: string,
): Promise<AgentRunRow | null> {
  const row = await db.agentRun.findFirst({
    where: { id: runId, organizationId },
    select: {
      ...RUN_SELECT,
      calls: { select: CALL_SELECT, orderBy: { seq: 'asc' } },
      approval: { select: APPROVAL_SELECT },
      execution: { select: EXECUTION_SELECT },
      deliveryTarget: { select: DELIVERY_TARGET_SELECT },
    },
  })
  return (row as AgentRunRow | null) ?? null
}

export async function getAgentRun(ctx: TenantContext, runId: string): Promise<AgentRunDto> {
  if (typeof runId !== 'string' || !runId.trim()) {
    throw new NotFoundError('Agent run not found')
  }
  const row = await findRunRow(ctx.organizationId, runId)
  if (!row) throw new NotFoundError('Agent run not found')
  const gates = await loadOutboundGates(ctx.organizationId, [row], new Date())
  return toAgentRunDto(row, viewerOf(ctx, gates.get(row.id)))
}

export interface ListAgentRunsOptions {
  status?: AgentRunStatus | null
  skill?: SkillKey | null
  limit?: number | null
}

export interface ListAgentRunsResult {
  items: AgentRunSummaryDto[]
  count: number
  filters: { status: AgentRunStatus | null; skill: SkillKey | null; limit: number }
}

export async function listAgentRuns(
  ctx: TenantContext,
  options: ListAgentRunsOptions = {},
): Promise<ListAgentRunsResult> {
  const limit = Math.min(
    Math.max(options.limit ?? AGENT_LIMITS.listDefault, 1),
    AGENT_LIMITS.listMax,
  )
  const status = options.status ?? null
  const skill = options.skill ?? null

  const rows = await db.agentRun.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(status ? { status } : {}),
      ...(skill ? { skill } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      ...RUN_SELECT,
      approval: { select: APPROVAL_SELECT },
      // 列表也带执行记录：列表页要用它显示"已执行/未执行"，缺了就只能显示成"从未执行"。
      execution: { select: EXECUTION_SELECT },
      // 同上：列表页的"能不能执行"按钮同样要过对外送达闸门 —— 缺了它，列表会给出
      // 一个点了必然 409 的按钮（与详情页不一致，而"不一致"本身就是缺陷）。
      deliveryTarget: { select: DELIVERY_TARGET_SELECT },
      // 列表要的是"跑了几次"，不是逐次明细 —— 用 `_count` 而不是把 calls 全读进来。
      _count: { select: { calls: true } },
    },
  })

  // 🔴 一次批量取闸门（把所有 intentId 去重成一次查询）—— 逐条查意图就是 N+1。
  const gates = await loadOutboundGates(ctx.organizationId, rows as unknown as AgentRunRow[], new Date())

  const items = rows.map((r) => {
    const { _count, ...rest } = r as unknown as AgentRunRow & { _count: { calls: number } }
    return toAgentRunSummaryDto(
      { ...rest, calls: [] },
      _count?.calls ?? 0,
      viewerOf(ctx, gates.get(r.id)),
    )
  })

  return { items, count: items.length, filters: { status, skill, limit } }
}

// ═══════════════════════════════════════════════════════════
// 创建（AC-08 / AC-20 的入口）
// ═══════════════════════════════════════════════════════════

export interface CreateAgentRunInput {
  skill: unknown
  input: unknown
  /** 来自 `Idempotency-Key` 请求头（**必需** —— 缺省不退化为非幂等）。 */
  idempotencyKey: unknown
  subjectLabel?: unknown
  /**
   * 对外送达目标（**仅**收件人为对手方的技能接受，当前只有 `INTRO_DRAFT`）。
   *
   * `{ targetUserId, intentId }`：后者是**发起人自己**的意图 —— 披露依据必须是"我授权了什么"，
   * 而不是调用方声称的字段集。形状校验在服务层入口（无 IO），语义校验在
   * `resolveDeliveryTarget()`（要查库：意图归属、同任务参与、披露非空）。
   */
  delivery?: unknown
  /**
   * 测试/接线用：显式覆盖 provider 解析。
   * 生产路径不传 → 走 `resolveRuntimeProvider(process.env)`：
   * 缺 `OPENAI_API_KEY` 即 `unavailable` → 内核走**明示降级**（绝不静默用假模型）。
   */
  provider?: ProviderResolution
  /**
   * 单价。默认 `DEFAULT_PRICE_TABLE`（**占位假设**）。
   */
  /**
   * 额度。**不传** → 按本组织的有效订阅方案派生（`resolveOrganizationAgentQuota`）。
   *
   * 🔴 为什么仍然保留这个**注入点**：注入才能让"额度耗尽 → 拒绝且零调用"这件事
   *    **真的被跑出来**（FREE 档是 500 分，要触发 `BLOCKED_QUOTA` 得先灌真实账）。
   *    注入点解决的是"能不能测"，方案派生解决的是"配置从哪来" —— 两件事，都要。
   */
  quota?: AgentQuota
  price?: PriceTable
  now?: Date
}

export interface CreateAgentRunResult {
  run: AgentRunDto
  /** true = 命中幂等记录，本次**没有**产生新的模型调用。 */
  replayed: boolean
}

export async function createAgentRun(
  ctx: TenantContext,
  input: CreateAgentRunInput,
): Promise<CreateAgentRunResult> {
  const skill = requireSkillKey(input.skill)
  assertSkillInput(skill, input.input)
  const key = requireIdempotencyKey(input.idempotencyKey)
  const subjectLabel = normalizeLabel(input.subjectLabel)
  // 形状校验（无 IO）刻意放在 `withIdempotency` **之前**：形状都不对就不该占一把幂等键。
  // 🔴 `delivery` 要进请求指纹：同一把幂等键配"送给 A"与"送给 B"是**两件事**，
  //    唯一约束只能保证"不重复"，保证不了"同一把键没被复用于另一个意图"。
  const delivery = normalizeDeliveryInput(input.delivery)
  const now = input.now ?? new Date()
  const requestHash = hashRequest({ skill, input: input.input, subjectLabel, delivery })

  const outcome = await withIdempotency<AgentRunDto>({
    organizationId: ctx.organizationId,
    scope: AGENT_RUN_SCOPE,
    key,
    requestHash,
    resourceType: 'agent_run',
    load: async (id) => {
      const row = await findRunRow(ctx.organizationId, id)
      return row ? toAgentRunDto(row, viewerOf(ctx)) : null
    },
    create: async () => {
      // ① 先把"送给谁"定下来（要查库：意图归属 / 同任务参与 / 披露非空）。
      //    放在花钱之前：目标不合法就该一条调用都不发生。
      const resolved = delivery ? await resolveDeliveryTarget(ctx, { skill, ...delivery }, now) : null

      // ② 🔴 披露授权集合由**服务端**给出（T05 当刻的读数），**不采信**调用方传的
      //    `allowedFieldKeys` —— 否则"模型能用哪些字段"就变成了请求体的一个字段。
      //    ⚠️ 只在输入契约里**有**这个位置时注入：其余技能的输入是 strictObject，
      //       多一个键会被契约拒掉（那是正确行为，但会把一次合法请求变成 400）。
      const canInject = (raw: unknown): raw is Record<string, unknown> =>
        Boolean(raw) && typeof raw === 'object' && !Array.isArray(raw) && 'allowedFieldKeys' in (raw as object)
      const effectiveInput =
        resolved && canInject(input.input)
          ? { ...input.input, allowedFieldKeys: resolved.authorizedFieldKeys }
          : input.input
      if (effectiveInput !== input.input) assertSkillInput(skill, effectiveInput)

      const provider = input.provider ?? resolveRuntimeProvider(process.env)
      // ③ 先把账本与额度都读回来（**调用之前**），④ 再跑编排。
      //    顺序是刻意的：额度必须在"决定要不要花钱"之前就知道（AC-20）。
      const ledger = await loadLedger(ctx.organizationId, now)
      const quota = input.quota ?? (await resolveOrganizationAgentQuota(ctx)).quota
      const result = await runSkill({
        skill,
        input: effectiveInput,
        provider,
        ledger,
        // 两侧同源：注入什么就判什么；不注入则从**订阅方案**派生（FREE = 从未订阅）。
        quota,
        price: input.price ?? DEFAULT_PRICE_TABLE,
        now: () => now,
      })

      // 本次运行**新增**的调用 = 账本尾部（`runSkill` 返回的是"入参账本 + 本次"）。
      // 用切片而不是"重新算一遍"：重新算就要在这里重复一遍记账逻辑，
      // 那是同一件事的第二个实现 —— 迟早与内核不一致。
      const newCalls = result.ledger.calls.slice(ledger.calls.length)
      const costMicroCents = newCalls.reduce((sum, c) => sum + c.microCents, 0)

      const created = await db.agentRun.create({
        data: {
          organizationId: ctx.organizationId,
          skill,
          status: result.status,
          risk: result.risk,
          requiresApproval: result.requiresApproval,
          requestedBy: ctx.userId,
          subjectLabel,
          goal: rawGoalOf(input.input),
          proposalJson: result.payload === null ? null : JSON.stringify(result.payload),
          rawText: result.rawText,
          reason: result.reason,
          degradeCode: result.degradeCode,
          providerKind: providerKindToDb(result.providerKind),
          injectionSignals:
            result.injectionSignals.length > 0 ? JSON.stringify(result.injectionSignals) : null,
          costMicroCents,
          dedupeKey: key,
          requestHash,
          // 🔴 送达目标与运行**同一个 create** 落库（嵌套写 = 原子）：
          //    否则会出现"运行有了、目标没落"的中间态，而那种运行永远执行不了。
          //    ⚠️ 用**写形状**（多一个 organizationId）：嵌套写里 Prisma 推不出组织外键，
          //       缺了是编译期错误 —— 这是好事，好过落一条组织为空的孤儿行。
          ...(resolved
            ? { deliveryTarget: { create: toDeliveryTargetCreate(resolved, ctx.organizationId) } }
            : {}),
          calls: {
            create: newCalls.map((c, index) => ({
              organizationId: ctx.organizationId,
              seq: index + 1,
              skill: c.skill,
              providerKind: providerKindToDb(c.providerKind),
              risk: c.risk,
              highCost: c.highCost,
              ok: c.ok,
              inputTokens: c.usage.inputTokens,
              outputTokens: c.usage.outputTokens,
              microCents: c.microCents,
              at: new Date(c.at),
            })),
          },
        },
        select: {
          ...RUN_SELECT,
          calls: { select: CALL_SELECT, orderBy: { seq: 'asc' } },
          approval: { select: APPROVAL_SELECT },
          // 新建的运行必然没有执行记录 —— 但 select 保持一致，
          // 否则 DTO 的 `executionRecord` 在这里会是 undefined 而不是 null（形状漂移）。
          execution: { select: EXECUTION_SELECT },
          deliveryTarget: { select: DELIVERY_TARGET_SELECT },
        },
      }) as AgentRunRow

      // 审计是**旁路**：失败不改变业务结果（与 `writeTenantAudit` 的约定一致）。
      // safeMetadata 只放枚举与数字 —— `goal` 是用户文本，不进审计。
      await writeTenantAudit({
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        eventType: 'agent.run.created',
        resourceType: 'agent_run',
        resourceId: created.id,
        safeMetadata: {
          skill,
          status: result.status,
          providerKind: result.providerKind,
          costMicroCents,
          requiresApproval: result.requiresApproval,
          calls: newCalls.length,
          // 只记"送不送、按哪一档送、授权了几项"—— 目标 id 与字段名都不进审计面。
          outbound: resolved
            ? { audience: resolved.audience, authorizedFieldCount: resolved.authorizedFieldKeys.length }
            : null,
        },
      }).catch(() => {})

      if (result.status === 'DEGRADED') {
        await writeTenantAudit({
          organizationId: ctx.organizationId,
          actorId: ctx.userId,
          eventType: 'agent.run.degraded',
          resourceType: 'agent_run',
          resourceId: created.id,
          safeMetadata: { skill, degradeCode: result.degradeCode, providerKind: result.providerKind },
        }).catch(() => {})
      }
      if (result.status === 'BLOCKED_QUOTA') {
        await writeTenantAudit({
          organizationId: ctx.organizationId,
          actorId: ctx.userId,
          eventType: 'agent.run.blocked_quota',
          resourceType: 'agent_run',
          resourceId: created.id,
          safeMetadata: { skill, reason: result.reason },
        }).catch(() => {})
      }

      // 读回一次闸门（与 get/list 走**同一条**取值路径），而不是拿"刚解析的那份"顶替：
      // 后者会在派生逻辑变化时与详情页给出不同答案。
      const createdGates = resolved
        ? await loadOutboundGates(
            ctx.organizationId,
            [{ id: created.id, deliveryTarget: toDeliveryTargetRow(resolved) }],
            now,
          )
        : null
      return {
        resourceId: created.id,
        resource: toAgentRunDto(created, viewerOf(ctx, createdGates?.get(created.id))),
      }
    },
    // 幂等记录写入失败（并发重放）时回收本次创建出来的孤儿运行。
    compensate: async (resourceId) => {
      await db.agentRun.deleteMany({
        where: { id: resourceId, organizationId: ctx.organizationId },
      })
    },
  })

  return { run: outcome.resource, replayed: outcome.replayed }
}

// ═══════════════════════════════════════════════════════════
// 审批（AC-08 的"人工那一环"）
// ═══════════════════════════════════════════════════════════

export type AgentDecision = 'APPROVED' | 'REJECTED'

function requireDecision(raw: unknown): AgentDecision {
  if (raw !== 'APPROVED' && raw !== 'REJECTED') {
    throw new ValidationError(`unknown decision: ${String(raw)}`, {
      field: 'decision',
      allowed: ['APPROVED', 'REJECTED'],
    })
  }
  return raw
}

/**
 * 裁决一条运行。
 *
 * 🔴 三条结构性保证：
 *   ① **不可改判**：已有裁决 → 409。要推翻就重新发起一次运行 —— 历史裁决是审计证据。
 *   ② **必须过真相表**：`assertTransition()` 是唯一判据。`AWAITING_APPROVAL → EXECUTED`
 *      的边不存在，所以这条路**绕不过**人工批准。
 *   ③ **不执行副作用**：本函数把状态写成 `APPROVED` / `REJECTED` 就结束。
 *      `EXECUTED` 的写入点只有 `executor.ts` 一处 —— 在本文件里写它会让
 *      "执行只有一条路径"这条静态断言变红，而那正是它**该有**的反应。
 */
export async function decideAgentRun(
  ctx: TenantContext,
  runId: string,
  rawDecision: unknown,
  rawNote?: unknown,
  options: { now?: Date } = {},
): Promise<AgentRunDto> {
  // ① 服务端**重新**判能力（纵深防御，与 `executeAgentRun` / `updateOrganization` 同一口径）。
  //
  //    🔴 这条不是装饰：路由层的 `withTenant('agent.approve')` 只挡得住 HTTP 入口，
  //    而服务函数可以被脚本 / cron / 任务直接调用 —— 少了它，"OPERATOR 能跑不能批"
  //    这条**制度层**的 AC-08 保证就只存在于路由里，任何内部调用者都能绕过它。
  //    （本仓已有先例：`updateOrganization` 与 `executeAgentRun` 都复判。）
  if (!can(ctx.role, 'agent.approve')) {
    throw new ForbiddenError('当前角色不能裁决 Agent 运行（需要 agent.approve）', {
      capability: 'agent.approve',
      role: ctx.role,
    })
  }

  const decision = requireDecision(rawDecision)
  const note = normalizeNote(rawNote)
  const now = options.now ?? new Date()

  if (typeof runId !== 'string' || !runId.trim()) {
    throw new NotFoundError('Agent run not found')
  }

  const row = await findRunRow(ctx.organizationId, runId)
  if (!row) throw new NotFoundError('Agent run not found')

  if (row.approval) {
    throw new ConflictError(
      `该运行已有裁决（${row.approval.decision}），不可改判 —— 要推翻请重新发起一次运行`,
    )
  }

  const from = row.status as AgentRunStatus
  try {
    assertTransition(from, decision)
  } catch {
    // 把状态机错误翻成 HTTP 语义：**不是**权限问题，也不是"找不到"，
    // 而是"当前状态不允许这个动作" → 409（与 T05 §3.6「再介绍一次」同口径）。
    throw new ConflictError(
      `当前状态（${from}）不允许${decision === 'APPROVED' ? '批准' : '驳回'}`,
      { from, to: decision, allowed: canTransition(from, 'APPROVED') ? ['APPROVED', 'REJECTED'] : [] },
    )
  }

  // 两条写操作在同一个事务里：否则可能出现"裁决已写入、状态没更新"的中间态，
  // 而那个中间态在界面上表现为"我点了批准，但还显示待批"。
  // ⚠️ 并发保护还有第二道：`AgentApproval.runId` 是唯一索引 ——
  //    两个请求同时到达时，第二条插入会撞唯一约束（由调用方映射为 409）。
  await db.$transaction([
    db.agentApproval.create({
      data: {
        organizationId: ctx.organizationId,
        runId: row.id,
        decision,
        actorId: ctx.userId,
        deciderRole: ctx.role,
        note,
        decidedAt: now,
      },
    }),
    db.agentRun.update({
      where: { id: row.id },
      data: { status: decision },
    }),
  ])

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: decision === 'APPROVED' ? 'agent.run.approved' : 'agent.run.rejected',
    resourceType: 'agent_run',
    resourceId: row.id,
    // ⚠️ **不记 note**：它是人写的自由文本，可能含档案信息（与「拒绝理由不回流」同一取向）。
    safeMetadata: { skill: row.skill, risk: row.risk, deciderRole: ctx.role, hasNote: note !== null },
  }).catch(() => {})

  const updated = await findRunRow(ctx.organizationId, row.id)
  if (!updated) throw new NotFoundError('Agent run not found')
  const gates = await loadOutboundGates(ctx.organizationId, [updated], new Date())
  return toAgentRunDto(updated, viewerOf(ctx, gates.get(updated.id)))
}

// ═══════════════════════════════════════════════════════════
// 用量（AC-20 的可核对面）
// ═══════════════════════════════════════════════════════════

export interface AgentUsageDto {
  /** 期次（UTC 自然月）。 */
  periodKey: string
  totals: {
    calls: number
    okCalls: number
    failedCalls: number
    highCostCalls: number
    inputTokens: number
    outputTokens: number
    microCents: number
  }
  bySkill: Array<{ skill: string; calls: number; microCents: number }>
  runs: {
    total: number
    byStatus: Record<string, number>
  }
  quota: {
    maxMicroCents: number
    maxHighCostCalls: number
    usedMicroCents: number
    remainingMicroCents: number
    highCostCalls: number
  }
  /**
   * 额度派生所用的**有效订阅方案**（`FREE` = 本组织从未订阅）。
   *
   * `null` = 本次**未走**组织级派生（调用方显式注入了额度：测试/脚本路径）。
   * 让这个字段可空、而不是回填一个假的 `FREE` —— 否则界面上会出现
   * "测试注入的额度"被标成"FREE 档额度"这种假陈述。
   */
  plan: EffectivePlan | null
  /** 🔴 **假设随响应下发**（T08 口径）：额度与单价都是占位假设，不是财务事实。 */
  assumptions: {
    quota: string
    price: PriceTable
    period: string
  }
  /**
   * 🔴 **诚实块**（与 T08 `gateway` 同口径）：真实模型调用到底开没开。
   *
   * 为什么要下发它、而不是让前端自己猜：没有它，"跑了 3 次、花了 0 分"
   * 会被读成"模型免费" —— 而真相是"没配凭据，走的是规则式兜底"。
   * 对账脚本用它与 `AgentCall.providerKind` **双向核对**（见 `agent-reconcile.mjs` §6）。
   */
  provider: ProviderHonesty
}

export async function agentUsage(
  ctx: TenantContext,
  options: {
    now?: Date
    price?: PriceTable
    /**
     * 与 `createAgentRun` 同源：**下发的那份额度必须就是执行时用的那份**。
     * 不传 → 与 `createAgentRun` 走**同一段**派生（`resolveOrganizationAgentQuota`），
     * 于是"界面显示的上限"与"判定时用的上限"在结构上不可能分叉。
     */
    quota?: AgentQuota
    env?: Record<string, string | undefined>
  } = {},
): Promise<AgentUsageDto> {
  const now = options.now ?? new Date()
  const price = options.price ?? DEFAULT_PRICE_TABLE
  // 🔴 只在**不注入**时查订阅：纯注入路径因此不需要任何订阅夹具（测试不用起库造事件），
  //    而生产路径**永远**走组织级派生 —— 不存在"忘了传就退回全局常量"的暗门。
  // 显式分支而不是 `?? organization!.quota`：后者要用非空断言，而断言会把
  // "这段逻辑被改错"变成运行期崩溃，而不是编译期报错。
  let quota: AgentQuota
  let plan: EffectivePlan | null = null
  if (options.quota !== undefined) {
    quota = options.quota
  } else {
    const resolved = await resolveOrganizationAgentQuota(ctx)
    quota = resolved.quota
    plan = resolved.plan
  }
  const periodKey = periodKeyOf(now)

  const ledger = await loadLedger(ctx.organizationId, now)
  const totals = ledgerTotals(ledger)

  const runRows = await db.agentRun.findMany({
    where: { organizationId: ctx.organizationId },
    select: { status: true },
  })
  const byStatus: Record<string, number> = {}
  for (const r of runRows) {
    const s = String(r.status)
    byStatus[s] = (byStatus[s] ?? 0) + 1
  }

  const bySkill = Object.entries(totals.bySkill)
    .map(([skill, v]) => ({ skill, calls: v.calls, microCents: v.microCents }))
    .sort((a, b) => b.calls - a.calls || a.skill.localeCompare(b.skill))

  return {
    periodKey,
    totals: {
      calls: totals.calls,
      okCalls: totals.okCalls,
      failedCalls: totals.failedCalls,
      highCostCalls: totals.highCostCalls,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      microCents: totals.microCents,
    },
    bySkill,
    runs: { total: runRows.length, byStatus },
    quota: {
      maxMicroCents: quota.maxMicroCents,
      maxHighCostCalls: quota.maxHighCostCalls,
      usedMicroCents: totals.microCents,
      remainingMicroCents: Math.max(quota.maxMicroCents - totals.microCents, 0),
      highCostCalls: totals.highCostCalls,
    },
    // 契约固定：这个字段要么是派生方案，要么是显式 null（注入路径）—— 见 DTO 注释。
    plan,
    assumptions: {
      // ⚠️ 这串字会**原样渲染**在 Agents 屏上 ⇒ 不含 markdown 星号（R9）。
      quota:
        plan === null
          ? '注入的额度（测试/接线）：与执行时判定用的是同一份对象，本次未查订阅方案。'
          : `组织级额度：按有效订阅方案派生 —— 方案 ${PLAN_LABELS[plan]}，` +
            `每月上限 ${formatMicroCents(quota.maxMicroCents)}、高成本调用 ${quota.maxHighCostCalls} 次。` +
            '这些数字仍是待定价的占位假设（见 T08/changes.md 假设表），不是已定价格。',
      price,
      period: '按 UTC 自然月归集（与 T08 用量账同口径：期次是纯等值比较，与日期格式解耦）。',
    },
    // env 显式可注入：让"真实调用是否开启"这件事在测试里是确定的，而不是看跑测的机器配没配密钥。
    provider: providerHonesty(options.env ?? process.env),
  }
}

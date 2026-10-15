/**
 * T09 · Agent **执行器**（Slice 4）—— `AgentRunStatus.EXECUTED` 的**唯一**写入点
 *
 * ═══════════════════════════════════════════════════════════════
 * 这个文件存在的理由：**"批准"与"交付"是两件事**
 * ═══════════════════════════════════════════════════════════════
 * Slice 2/3 只做到"提案 + 审批"：批准把状态写成 `APPROVED` 就结束，
 * **没有任何代码**产生副作用（甚至有一条阶段断言钉住 `EXECUTED` 必须为 0）。
 * 那是刻意的 —— 执行 = 产生对外可见的副作用，宁可不做也不伪造成功。
 *
 * 本切片把它接上，且坚持三条形状：
 *
 *   ① **只有一条路径能到 `EXECUTED`**：本文件。由
 *      `tests/agents/execution-gated.test.ts` 的静态断言守着
 *      （服务层与路由层源码里 `EXECUTED` 字面量只允许出现在本文件）。
 *   ② **服务端两次判权限**：路由的 `withTenant('agent.execute')` + 本文件内的 `can(ctx.role, …)`。
 *      第二道不是重复 —— 直接调服务层的路径（脚本、测试、将来的批处理）不该绕过角色判定。
 *   ③ **副作用先发生、状态后落库**（见下面 ⑥ 的顺序论证）。
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔴 本切片的效果是**内部回执**，不是"把介绍发给对手方"
 * ═══════════════════════════════════════════════════════════════
 * 收件人**恒为发起人**（`AgentRun.requestedBy`），渠道恒为站内信。理由：
 *   - `AgentRun` 只存 `subjectLabel` / `counterpartLabel` 这类**标签**（刻意的）；
 *   - "把 A 介绍给 B"里的 B 必须在**创建时**由服务端确定、并被**那一次批准**覆盖；
 *     若在执行时才由调用方传入收件人，就等于允许"批准的是 A、发出去的是 B" ——
 *     审批会退化成橡皮图章。
 * ⇒ 对外送达需要 target 身份 + T05 的 `discloseSubject()` 出口，属**下一片**。
 *   本文件的诚实声明写在 `executeAgentRun` 的返回值与审计元数据里，而不是只写在注释中。
 */

import { db } from '@/lib/db'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import { can } from '@/lib/tenancy/capabilities'
import type { TenantContext } from '@/lib/tenancy/resolve'
import {
  agentExecutionDedupeKey,
  isSkillKey,
  planExecution,
  type AgentRunStatus,
  type ExecutionDecision,
} from '@/lib/agent'
import { deliverNotification, type DeliveryResult, type DeliveryStatus } from '@/lib/workflow'
import { toAgentRunDto, toExecutionDto, type AgentExecutionDto, type AgentRunDto } from './dto'
import { findRunRow } from './runs'

/** 投递出口的形状（可注入 —— 单测用它把"投递失败"变成可控输入，而不是靠网络）。 */
export type DeliverFn = typeof deliverNotification

export interface ExecuteAgentRunOptions {
  /** 覆盖"现在"（确定性断言用）。 */
  now?: Date
  /**
   * 投递出口。**默认就是 T06 的统一投递出口**（`deliverNotification`）。
   *
   * 为什么留注入点：投递是**唯一的外部依赖**。若不注入，"投递失败后状态不该变成 EXECUTED"
   * 这条最关键的顺序论证就无法被测到（要靠真网络去制造失败）。
   * ⚠️ 生产路径**不传** —— 传了就等于让调用方决定"副作用打到哪里去"。
   */
  deliver?: DeliverFn
}

export interface ExecuteAgentRunResult {
  run: AgentRunDto
  /** 执行记录（`replayed:true` 时是既有那条）。 */
  execution: AgentExecutionDto | null
  /** true = 该运行此前**已执行过** —— 本次没有产生第二次投递。 */
  replayed: boolean
  /** 本次投递的结果（`replayed:true` 时为 null —— 没有产生新投递）。 */
  delivery: { id: string; status: DeliveryStatus; provider: string } | null
}

/**
 * 观察者视角（供 DTO 算 `canApprove` / `canReject`）。
 * ⚠️ 执行器只持 `agent.execute`，**不**代表能批准 —— 但这次响应里回的就是这条运行，
 *    界面拿到它之后要能显示"我还能不能批"，所以口径与 `runs.ts` 的 `viewerOf` 一致。
 */
function viewerOf(ctx: TenantContext): { canDecide: boolean } {
  return { canDecide: can(ctx.role, 'agent.approve') }
}

/** 收件人恒为发起人 —— 单独抽成函数，是为了让"谁是收件人"只有一处可改、且改动要过评审。 */
function resolveRecipient(row: { requestedBy: string }): string {
  return row.requestedBy
}

/**
 * 执行一条运行。
 *
 * 抛出语义（与 T05/T06 同口径）：
 *   - 运行不存在 / 跨租户 → **404**
 *   - 角色缺 `agent.execute` → **403**
 *   - 状态不允许 / 缺批准记录 / 该技能无执行器 → **409**（带 `code`，前端不解析文案）
 *   - 投递失败（网络/凭据/守卫）→ **原样抛出**，且**状态不变**（可重试）
 */
export async function executeAgentRun(
  ctx: TenantContext,
  runId: string,
  options: ExecuteAgentRunOptions = {},
): Promise<ExecuteAgentRunResult> {
  const now = options.now ?? new Date()
  const deliver = options.deliver ?? deliverNotification

  // ① 服务端**重新**判能力（纵深防御，见文件头 ②）。
  if (!can(ctx.role, 'agent.execute')) {
    throw new ForbiddenError('当前角色不能执行 Agent 运行（需要 agent.execute）', {
      capability: 'agent.execute',
      role: ctx.role,
    })
  }

  if (typeof runId !== 'string' || !runId.trim()) {
    throw new NotFoundError('Agent run not found')
  }

  const row = await findRunRow(ctx.organizationId, runId)
  if (!row) throw new NotFoundError('Agent run not found')

  // ② 已执行过 → **幂等返回**。放在放行判据**之前**：执行是终态，重复请求是"再问一次结果"，
  //    不是"再执行一次"。若放在之后，第二次请求会拿到 409（"状态不允许"），
  //    而调用方真正想知道的是"它执行过了吗、结果如何"。
  if (row.execution) {
    return {
      run: toAgentRunDto(row, viewerOf(ctx)),
      execution: toExecutionDto(row.execution),
      replayed: true,
      delivery: null,
    }
  }

  const status = row.status as AgentRunStatus

  // ③ 唯一的放行判据（内核纯函数）。DTO 用的是**同一个**函数 —— 所以
  //    "界面说能执行、执行器说不给执行"这种不一致在结构上不存在。
  const decision: ExecutionDecision = isSkillKey(row.skill)
    ? planExecution({
        skill: row.skill,
        status,
        requiresApproval: row.requiresApproval,
        hasApprovedDecision: row.approval?.decision === 'APPROVED',
      })
    : {
        executable: false,
        code: 'NOT_REGISTERED',
        reason: `未知技能 ${row.skill}（数据库值与内核 SKILL_KEYS 不一致）—— 没有注册执行器。`,
      }

  if (!decision.executable) {
    throw new ConflictError(decision.reason, {
      code: decision.code,
      status,
      skill: row.skill,
      requiresApproval: row.requiresApproval,
    })
  }

  const plan = decision.plan
  const recipientId = resolveRecipient(row)

  // ④ 组织名：通知的身份声明需要它（AC-09「不得静默冒充真人」）。
  //    取不到就用兜底文案 —— 与 T06 的 `runtime.ts` 同一取向（宁可文案朴素，也不要发不出去）。
  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { name: true },
  })

  // ⑤ 副作用：经 **T06 的统一投递出口**（不是自己拼一个 `db.notification.create()`）。
  //    走出口才能同时拿到：披露守卫（`assertNoLeakage`）、身份声明断言、投递幂等、投递留痕。
  //    🔴 `protectedTexts` 传空数组（与 `connection.introduced` 同口径）：
  //       运行目标与草稿正文**不在**渲染入参里（模板压根没有这些位置），
  //       "通知体不含它们"由单测断言钉住；不在运行期拿它们做子串比对，是因为
  //       组织名会出现在正文里，而用户的目标文本完全可能包含组织名 ——
  //       那会把一次正常执行误判成泄漏（判据要能被证伪，也要不误伤）。
  const delivery: DeliveryResult = await deliver(
    {
      organizationId: ctx.organizationId,
      dedupeKey: agentExecutionDedupeKey(row.id),
      channel: plan.channel,
      recipientId,
      template: 'agent.delivery',
      organizationName: org?.name ?? '你的社群',
      missionTitle: null,
      actionUrl: '/console/agents',
      proposalId: null,
      missionId: null,
      protectedTexts: [],
    },
    { now },
  )

  // ⑥ 落执行记录 + 迁移状态（**同一个事务**：不能出现"记录有了、状态没变"或反之）。
  //
  //    🔴 顺序论证（为什么投递在前、状态在后）：
  //       - 若**先**改状态再投递：投递失败就会留下"状态 EXECUTED、但什么都没发出"的**假成功** ——
  //         而重试会因为状态是终态而被拒（`EXECUTED` 没有出边），那条产出**永远发不出去**。
  //       - 先投递后落库的最坏情况是"消息已投递、状态还是 APPROVED"。这不是问题：
  //         投递本身**幂等**（`dedupeKey = agent-exec:<runId>`），重试命中既有记录并**不重发**，
  //         随后补上记录与状态。⇒ 两个方向的代价不对称，故取后者。
  try {
    await db.$transaction([
      db.agentExecution.create({
        data: {
          organizationId: ctx.organizationId,
          runId: row.id,
          kind: plan.kind,
          channel: plan.channel,
          recipientId,
          deliveryId: delivery.id,
          deliveryStatus: delivery.status,
          actorId: ctx.userId,
          executedAt: now,
        },
      }),
      db.agentRun.update({
        where: { id: row.id },
        data: { status: 'EXECUTED' },
      }),
    ])
  } catch (err) {
    // 并发：两个请求同时执行 → 第二个撞 `AgentExecution.runId` 唯一键。
    // 读回胜者并按幂等返回 —— 把"重复执行"变成一次正常的回答，而不是 500。
    const winner = await db.agentExecution.findUnique({ where: { runId: row.id } }).catch(() => null)
    if (winner) {
      const fresh = await findRunRow(ctx.organizationId, row.id)
      if (fresh) {
        return {
          run: toAgentRunDto(fresh, viewerOf(ctx)),
          execution: toExecutionDto(winner),
          replayed: true,
          delivery: null,
        }
      }
    }
    throw err
  }

  // ⑦ 审计（旁路：失败不改变业务结果，与 `writeTenantAudit` 的约定一致）。
  //    只放枚举与布尔 —— 目标文本、收件人 id 都不进审计（收件人恒为发起人，记这个事实即可）。
  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'agent.run.executed',
    resourceType: 'agent_run',
    resourceId: row.id,
    safeMetadata: {
      skill: row.skill,
      kind: plan.kind,
      channel: plan.channel,
      deliveryStatus: delivery.status,
      deliveryProvider: delivery.provider,
      /** 收件人是"发起人本人"这一**事实**（而不是把 id 写进审计面）。 */
      recipientIsRequester: true,
      actorRole: ctx.role,
    },
  })

  const updated = await findRunRow(ctx.organizationId, row.id)
  if (!updated) throw new NotFoundError('Agent run not found')

  return {
    run: toAgentRunDto(updated, viewerOf(ctx)),
    execution: toExecutionDto(updated.execution),
    replayed: false,
    delivery: { id: delivery.id, status: delivery.status, provider: delivery.provider },
  }
}

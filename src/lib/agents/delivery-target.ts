/**
 * T09 Slice 6 · **对外送达的目标**（创建时固定 / 执行时复验）
 *
 * ═══════════════════════════════════════════════════════════════
 * 这个文件解决什么
 * ═══════════════════════════════════════════════════════════════
 * `INTRO_DRAFT` 的执行计划是 `recipient: 'TARGET'` —— 产出要送达**对手方**。
 * 于是有两个必须由**服务端**回答的问题，且它们必须在**不同时刻**回答：
 *
 *   ① **创建时**：目标是谁？（`resolveDeliveryTarget()`）
 *      身份一旦确定就落进 `AgentDeliveryTarget`，并被**那一次**批准覆盖。
 *      执行时再问一遍 = 允许"批准的是 A、发出去的是 B"。
 *
 *   ② **执行时**：凭什么还能发？（`loadOutboundGate()`）
 *      T05 的披露授权可能已被**撤销或收窄**。撤销即刻生效 —— 于是"能否送达"
 *      不是一个一次性的判断，而要在投递那一刻用**当时**的披露表复验。
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔴 送达的**通知体里没有档案字段**（这是刻意的，不是遗漏）
 * ═══════════════════════════════════════════════════════════════
 * T06 的文件头写得很明确：通知是旁路渠道，绕开了页面上的披露投影，因此
 * "不得包含 rationale 全文与对侧档案"（`notification-content.ts`）。本切片不破这条纪律。
 *
 * 那么披露闸门守的是什么？守的是**送达这件事本身的前提**：
 * `AgentDeliveryTarget.authorizedFieldKeys` 是创建那一刻 T05 对"对手方能看见哪些字段"
 * 的读数快照。执行时若这份授权已归零或不再覆盖那批字段，说明**这次批准所依据的材料前提变了**
 * —— 此时仍以发起人的名义去敲对方的门，是用一次已失效的授权替人代言。
 *
 * ⚠️ 因此本文件**不做判定**：它只负责取数（快照 / 实时读数），判定一律交给内核的
 *    `planOutboundDelivery()`。这样"什么情况下不给送"有一条可离线穷举的真相表。
 */

import { db } from '@/lib/db'
import { ValidationError } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy/resolve'
import {
  COUNTERPARTY_PROFILE_AUDIENCE,
  fieldsVisibleTo,
  liveDisclosureOf,
  type ExternalAudience,
} from '@/lib/connection'
import { isSkillKey, executionPlanOf, type SkillKey } from '@/lib/agent'

/**
 * 送达对手方时采用的披露档位。
 *
 * 🔴 收敛成一个常量（与 `recall.ts` / `proposals.ts` 同一手法）：
 *    想改"送上门时对方能看到什么"，改的是 T05 的档位语义，而不是散落各处的 `'COUNTERPARTY'` 字面量。
 *    `CANDIDATE_PROFILE_AUDIENCE`（同任务的候选）**刻意不用**：它是另一种受众，
 *    "送给候选"若要做，是另一种目标类型，必须连同 `EXECUTION_PLANS` 一起改，
 *    而不是把这里的常量换掉。
 */
export const DELIVERY_PROFILE_AUDIENCE: ExternalAudience = COUNTERPARTY_PROFILE_AUDIENCE

/** 创建时解析出的送达目标（含披露依据的快照）。 */
export interface ResolvedDeliveryTarget {
  skill: SkillKey
  targetUserId: string
  /** 依据哪一份意图（发起人自己的）—— 执行时用它读回**当时生效**的披露表。 */
  intentId: string
  /** 该意图所属任务（创建时校验过目标成员确实在这个任务里）。 */
  missionId: string
  /** 送达档位（当前恒为 `COUNTERPARTY`，落库以便审计可读、将来可扩展）。 */
  audience: ExternalAudience
  /** 创建那一刻，目标受众可见的字段键（**快照**；执行时用它做收窄判定）。 */
  authorizedFieldKeys: string[]
}

/** 执行/读取时用的对外送达视图（DTO 的 `execution` 与 executor 的放行判据共用）。 */
export interface OutboundGate {
  targetUserId: string | null
  authorizedFieldKeys: readonly string[]
  visibleFieldKeys: readonly string[]
}

/**
 * 把 `input.delivery`（API 层来的未知值）收敛成形状确定的对象。
 *
 * ⚠️ 只做**形状**校验（是不是对象、两个字段是不是非空字符串）；
 *    "这个技能支不支持对外送达"在 `resolveDeliveryTarget()` 里判 ——
 *    因为那需要读 `EXECUTION_PLANS`，而形状校验必须能在**不做任何 IO** 的前提下先跑。
 */
export function normalizeDeliveryInput(
  raw: unknown,
): { targetUserId: string; intentId: string } | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('delivery must be an object with targetUserId and intentId', {
      field: 'delivery',
    })
  }
  const targetUserId = (raw as { targetUserId?: unknown }).targetUserId
  const intentId = (raw as { intentId?: unknown }).intentId
  if (typeof targetUserId !== 'string' || !targetUserId.trim()) {
    throw new ValidationError('delivery.targetUserId must be a non-empty string', {
      field: 'delivery.targetUserId',
    })
  }
  if (typeof intentId !== 'string' || !intentId.trim()) {
    throw new ValidationError('delivery.intentId must be a non-empty string', {
      field: 'delivery.intentId',
    })
  }
  return { targetUserId: targetUserId.trim(), intentId: intentId.trim() }
}

/**
 * **创建时**解析并校验送达目标。
 *
 * 四道校验，每道都对应一种"发出去就是错的"的情形：
 *   ① 技能必须**声明**对外送达（`EXECUTION_PLANS[skill].recipient === 'TARGET'`）——
 *      否则调用方可以给任何技能挂一个收件人，"对外送达"就变成了通用后门。
 *   ② 目标不能是发起人自己（自己给自己发"介绍"是配置错误，不是业务动作）。
 *   ③ 目标必须与该意图**同一个任务**且仍在参与（否则是跨任务的越界送达）。
 *   ④ 该意图**当前**必须对送达档位披露了至少一个字段 —— 否则没有可送达的介绍内容。
 *
 * 🔴 校验全部在**服务端**：`targetUserId` / `intentId` 来自请求体，属**不可信输入**。
 *    尤其 ③：只信"目标存在"是不够的，必须信"目标与这份披露依据属于同一个任务"。
 */
export async function resolveDeliveryTarget(
  ctx: TenantContext,
  input: { skill: SkillKey; targetUserId: string; intentId: string },
  now: Date,
): Promise<ResolvedDeliveryTarget> {
  const plan = executionPlanOf(input.skill)
  if (!plan || plan.recipient !== 'TARGET') {
    throw new ValidationError(
      `技能 ${input.skill} 的执行计划不支持对外送达（收件人不是对手方）`,
      { field: 'delivery', skill: input.skill, recipient: plan?.recipient ?? null },
    )
  }

  if (input.targetUserId === ctx.userId) {
    throw new ValidationError('delivery.targetUserId 不能是发起人自己', {
      field: 'delivery.targetUserId',
    })
  }

  // ① 披露依据必须是**发起人本人**在该租户下的意图。
  //    查询条件写在一起（而不是"先查 id 再断言 userId"）：后者漏一次断言就是一次越权引用。
  const intent = await db.socialIntent.findFirst({
    where: {
      id: input.intentId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
    },
    select: { id: true, missionId: true, disclosure: true, status: true, expiresAt: true },
  })
  if (!intent) {
    throw new ValidationError('delivery.intentId 不存在，或不属于你（需用你自己的意图作为披露依据）', {
      field: 'delivery.intentId',
    })
  }

  // ② 目标必须是**同一个任务**的参与成员（含"仍在参与"这一条：已退出/被移出的人不该再收到）。
  const participation = await db.missionParticipation.findFirst({
    where: {
      organizationId: ctx.organizationId,
      missionId: intent.missionId,
      userId: input.targetUserId,
      status: 'INTERESTED',
    },
    select: { id: true },
  })
  if (!participation) {
    throw new ValidationError(
      'delivery.targetUserId 不是该意图所属任务的参与成员 —— 对外送达只允许送给同一个任务里的对手方',
      { field: 'delivery.targetUserId' },
    )
  }

  // ③ 披露依据的快照：**创建这一刻**对手方能看到哪些字段。
  const live = liveDisclosureOf(intent, now)
  const authorizedFieldKeys = fieldsVisibleTo(live, DELIVERY_PROFILE_AUDIENCE)
  if (authorizedFieldKeys.length === 0) {
    throw new ValidationError(
      '该意图当前未向对手方披露任何字段（或已被撤销/过期）—— 没有可送达的介绍内容；请先在意图里授权要披露的字段',
      { field: 'delivery.intentId', audience: DELIVERY_PROFILE_AUDIENCE },
    )
  }

  return {
    skill: input.skill,
    targetUserId: input.targetUserId,
    intentId: intent.id,
    missionId: intent.missionId,
    audience: DELIVERY_PROFILE_AUDIENCE,
    authorizedFieldKeys,
  }
}

/** 落库用的行形状（`AgentDeliveryTarget`）。 */
export interface DeliveryTargetRow {
  targetUserId: string
  intentId: string
  audience: string
  authorizedFieldKeys: string | null
}

/** 解析库里的 `authorizedFieldKeys`（JSON 文本数组）。坏数据 → 空数组（读路径 fail silent）。 */
export function decodeAuthorizedFieldKeys(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((k): k is string => typeof k === 'string')
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((k): k is string => typeof k === 'string')
  } catch {
    return []
  }
}

/** 由解析结果构造落库行（同一处，避免"创建时写的形状"与"读取时解析的形状"分叉）。 */
export function toDeliveryTargetRow(resolved: ResolvedDeliveryTarget): DeliveryTargetRow {
  return {
    targetUserId: resolved.targetUserId,
    intentId: resolved.intentId,
    audience: resolved.audience,
    authorizedFieldKeys:
      resolved.authorizedFieldKeys.length > 0 ? JSON.stringify(resolved.authorizedFieldKeys) : null,
  }
}

/**
 * 嵌套写入用的**写形状**：在行形状之上补 `organizationId`。
 *
 * 🔴 为什么必须显式给：`deliveryTarget` 是挂在 `agentRun.create` 里的**嵌套写**，
 *    Prisma 只会给"指向父级"的外键（`runId`）自动补值；`organizationId` 指向的是
 *    另一张表（Organization），推不出来，缺了就是编译期报错（这正是它该有的行为 ——
 *    宁可编译不过，也不要一条 `organizationId` 为空的孤儿送达行）。
 *    ⚠️ 因此它**只**用于写路径；读路径的形状仍是 `DeliveryTargetRow`（不含该列，
 *    因为 select 里没有它，声称有它就是在撒谎）。
 */
export function toDeliveryTargetCreate(
  resolved: ResolvedDeliveryTarget,
  organizationId: string,
): DeliveryTargetRow & { organizationId: string } {
  return { ...toDeliveryTargetRow(resolved), organizationId }
}

/**
 * 读取一条运行在当前时刻的**对外送达闸门输入**（执行器用）。
 *
 * 返回 `null` = 这条运行根本没有目标行（`NO_TARGET` 由内核判，不在这里"顺手补一个"）。
 * 目标行存在 → 用它的 `intentId` 读回**当时生效**的披露表，算出实时可见字段。
 *
 * ⚠️ 意图已不存在（被删）时 `visibleFieldKeys` 为空 ⇒ 内核判 `DISCLOSURE_EMPTY`。
 *    这是**有意的保守**：读不到依据就不送，而不是"读不到就当没限制"。
 */
export async function loadOutboundGate(
  organizationId: string,
  row: { deliveryTarget?: DeliveryTargetRow | null },
  now: Date,
): Promise<OutboundGate | null> {
  const target = row.deliveryTarget
  if (!target) return null

  const intent = await db.socialIntent.findFirst({
    where: { id: target.intentId, organizationId },
    select: { disclosure: true, status: true, expiresAt: true },
  })
  const live = intent ? liveDisclosureOf(intent, now) : {}
  return {
    targetUserId: target.targetUserId,
    authorizedFieldKeys: decodeAuthorizedFieldKeys(target.authorizedFieldKeys),
    visibleFieldKeys: fieldsVisibleTo(live, DELIVERY_PROFILE_AUDIENCE),
  }
}

/**
 * 批量读取（列表页用）。
 *
 * 🔴 为什么要批量：列表最多 100 条，逐条查意图就是 100 次往返（N+1）。
 *    这里先把所有 `intentId` 去重成一次 `findMany`，再在内存里折叠。
 *    只有**需要**的 run 才会进入结果 Map —— 收件人是发起人的运行不求值（那种运行没有闸门）。
 */
export async function loadOutboundGates(
  organizationId: string,
  rows: ReadonlyArray<{ id: string; deliveryTarget?: DeliveryTargetRow | null }>,
  now: Date,
): Promise<Map<string, OutboundGate>> {
  const out = new Map<string, OutboundGate>()
  const withTarget = rows.filter((r) => Boolean(r.deliveryTarget))
  if (withTarget.length === 0) return out

  const intentIds = [...new Set(withTarget.map((r) => r.deliveryTarget!.intentId))]
  const intents = intentIds.length
    ? await db.socialIntent.findMany({
        where: { id: { in: intentIds }, organizationId },
        select: { id: true, disclosure: true, status: true, expiresAt: true },
      })
    : []
  const liveById = new Map(intents.map((i) => [i.id, liveDisclosureOf(i, now)]))

  for (const r of withTarget) {
    const target = r.deliveryTarget!
    const live = liveById.get(target.intentId) ?? {}
    out.set(r.id, {
      targetUserId: target.targetUserId,
      authorizedFieldKeys: decodeAuthorizedFieldKeys(target.authorizedFieldKeys),
      visibleFieldKeys: fieldsVisibleTo(live, DELIVERY_PROFILE_AUDIENCE),
    })
  }
  return out
}

/** 供路由/服务层复用的技能判定（避免各处再写一遍 `isSkillKey` + 计划查询）。 */
export function skillSupportsOutboundDelivery(skill: unknown): boolean {
  if (!isSkillKey(skill)) return false
  const plan = executionPlanOf(skill)
  return Boolean(plan && plan.recipient === 'TARGET')
}

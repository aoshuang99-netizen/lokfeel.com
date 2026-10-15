/**
 * T10 · Bridge **服务层** —— 成员逐个 opt-in / opt-out
 *
 * 这是 AC-19 后半句「**仅**共享**明确 opt-in** 的数据」的落点：
 * `BridgeMemberOptIn` 是**逐人**一行，**没有**任何"群级默认值"。
 * 缺行 = 未加入，而不是"默认跟随群主"。
 *
 * ── 🔴 fail loud：成员不能放得比群主宽 ──────────────────────────────
 *   内核的三方交集**天然**会把超出的字段收窄掉。但那属于**静默收窄** ——
 *   症状是"我明明勾了 email 却没生效"，而用户拿不到任何解释。
 *   因此服务层在这里**显式拒绝**（400 + 记一条 `bridge.optin_rejected` 审计），
 *   把"配置错误"与"配置正确但恰好无交集"分开。这叫 fail loud，
 *   与 plan.md §1「任一层出现下层比上层宽 ⇒ 服务层拒绝该字段并记审计」逐字对应。
 *
 * ── 为什么 opt-in 不要求协议已 `ACTIVE` ────────────────────────────
 *   `PENDING` 时允许 opt-in：成员提前表态无害 —— 协议不 `ACTIVE` 时投影恒为空
 *   （内核 `bridgeUsableReason()` 先判 `BRIDGE_PENDING`）。
 *   禁止提前表态只会制造"必须先等对方批准，然后才能选"的多余时序依赖。
 *   但 `REVOKED` / `EXPIRED` **必须**拒绝：那时的 opt-in 是一种会误导用户的死动作。
 *
 * ── 为什么 opt-out 一律允许（甚至协议已撤销/过期）──────────────────
 *   撤销自己的加入永远是**收窄**方向。任何"因为协议已经完了所以不让你退出"的规则，
 *   都会让用户在界面上留一个无法消除的"已加入"标记。
 */

import { db } from '@/lib/db'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy/resolve'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import { bridgeStatusView, normalizeFieldKeys } from '@/lib/bridge'
import {
  allowedFieldKeysForSide,
  findBridgeRow,
  findMyOptInRow,
  requireBridgeId,
  requireFieldKeys,
  toBridgeView,
} from './bridges'
import { toMemberOptInDto, type MemberOptInDto, type MemberOptInRow } from './dto'

const OPT_IN_SELECT = {
  id: true,
  bridgeId: true,
  organizationId: true,
  userId: true,
  status: true,
  disclosedFieldKeys: true,
  optedInAt: true,
  withdrawnAt: true,
} as const

/**
 * 成员加入共享（幂等 upsert）。
 *
 * @param disclosedFieldKeys 成员选择共享的字段键。**必须 ⊆ 本组织在协议里配置的字段**。
 *
 * 重复 opt-in 是**幂等更新**（不是新增行）—— 库级由 `@@unique([bridgeId, userId])` 保证，
 * 应用级用 `upsert` 表达。`WITHDRAWN` 后再次 opt-in 也会复活同一行（`withdrawnAt` 清空）。
 */
export async function optInBridgeMember(
  ctx: TenantContext,
  bridgeIdRaw: unknown,
  disclosedFieldKeysRaw: unknown,
  now: Date = new Date(),
): Promise<MemberOptInDto> {
  const bridgeId = requireBridgeId(bridgeIdRaw)
  const row = await findBridgeRow(ctx.organizationId, bridgeId)
  if (!row) throw new NotFoundError('Bridge not found')

  // 协议状态闸门（**不含** PENDING —— 见文件头）。
  const statusView = bridgeStatusView(toBridgeView(row), now)
  if (statusView === 'REVOKED') {
    throw new ConflictError('Bridge has been revoked; opting in is no longer possible')
  }
  if (statusView === 'EXPIRED') {
    throw new ConflictError('Bridge has expired; opting in is no longer possible')
  }

  const requested = requireFieldKeys(disclosedFieldKeysRaw, 'disclosedFieldKeys')
  const allowed = allowedFieldKeysForSide(row, ctx.organizationId)

  // 🔴 fail loud：越界字段**整单拒绝**，并留下审计。不静默丢弃、也不静默收窄。
  const allowedSet = new Set(allowed)
  const offending = requested.filter((k) => !allowedSet.has(k))
  if (offending.length > 0) {
    await writeTenantAudit({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      eventType: 'bridge.optin_rejected',
      resourceType: 'bridge',
      resourceId: row.id,
      // 只记**违规键**（那是本次请求里用户自己提交的值，不是对方数据），不记允许集全量。
      safeMetadata: { offending: normalizeFieldKeys(offending), allowedCount: allowed.length },
    }).catch(() => {})
    throw new ValidationError(
      'disclosedFieldKeys must be a subset of the fields your organization allows on this bridge',
      { field: 'disclosedFieldKeys', offending: normalizeFieldKeys(offending) },
    )
  }

  let saved: MemberOptInRow
  try {
    saved = (await db.bridgeMemberOptIn.upsert({
      where: { bridgeId_userId: { bridgeId: row.id, userId: ctx.userId } },
      create: {
        bridgeId: row.id,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        status: 'ACTIVE',
        disclosedFieldKeys: JSON.stringify(requested),
        optedInAt: now,
        withdrawnAt: null,
      },
      update: {
        // 复活已退出的行：状态回 ACTIVE，清空 withdrawnAt（历史仍可从审计里读回）。
        status: 'ACTIVE',
        disclosedFieldKeys: JSON.stringify(requested),
        optedInAt: now,
        withdrawnAt: null,
      },
      select: OPT_IN_SELECT,
    })) as MemberOptInRow
  } catch (err) {
    // 唯一的竞态：同一成员并发 opt-in 触发 (bridgeId,userId) 唯一约束。
    // 那是同一个人重复表态，重读现况即可 —— 不把它当错误（与"重复 opt-in 是幂等"一致）。
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
      const current = await findMyOptInRow(row.id, ctx.userId)
      if (current) return toMemberOptInDto(current)
    }
    throw err
  }

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'member.opted_in',
    resourceType: 'bridge_opt_in',
    resourceId: saved.id,
    // 🔴 只记**计数与状态**，不记字段键的值。
    safeMetadata: { bridgeId: row.id, status: saved.status, disclosedCount: requested.length },
  }).catch(() => {})

  return toMemberOptInDto(saved)
}

/**
 * 成员退出共享（幂等方向上的"收窄"，因此不受协议状态限制）。
 *
 * ⚠️ 保留行（置 `WITHDRAWN`）而不是删除 —— 「谁曾加入过、何时退出」是审计问题，
 *    删行就答不了了。与 T06 保留失败投递记录同一取向。
 */
export async function optOutBridgeMember(
  ctx: TenantContext,
  bridgeIdRaw: unknown,
  now: Date = new Date(),
): Promise<MemberOptInDto> {
  const bridgeId = requireBridgeId(bridgeIdRaw)
  const row = await findBridgeRow(ctx.organizationId, bridgeId)
  if (!row) throw new NotFoundError('Bridge not found')

  const current = await findMyOptInRow(row.id, ctx.userId)
  if (!current) {
    throw new NotFoundError('You have not joined this bridge')
  }
  if (current.status === 'WITHDRAWN') {
    // 不静默成功：那会掩盖"我以为我还加入着"的错觉（而投影结果已经在说"不可见"了）。
    throw new ConflictError('You have already withdrawn from this bridge')
  }

  const updated = (await db.bridgeMemberOptIn.update({
    where: { bridgeId_userId: { bridgeId: row.id, userId: ctx.userId } },
    data: { status: 'WITHDRAWN', withdrawnAt: now },
    select: OPT_IN_SELECT,
  })) as MemberOptInRow

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'member.opted_out',
    resourceType: 'bridge_opt_in',
    resourceId: updated.id,
    safeMetadata: { bridgeId: row.id, status: updated.status },
  }).catch(() => {})

  return toMemberOptInDto(updated)
}

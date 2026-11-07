/**
 * T07 · 成员移除（写路径）
 *
 * 「移除」在这里是 **软移出**：把成员关系置为 `SUSPENDED`，不删行。
 * 三个理由，每个都不是洁癖：
 *   1. **审计要能对上**。硬删会让 `TenantAuditEvent.resourceId` 指向一个不存在的行，
 *      "谁被谁在什么时候移出过"从此无法回溯 —— 而这恰恰是安全事件最需要的证据。
 *   2. **会话立即失效**。`resolveTenant()` 只认 `status='ACTIVE'` 的成员关系，
 *      所以置为 SUSPENDED 的**下一次请求**就 403，不需要等 JWT 过期。
 *      （注意：该用户在其他组织的会话不受影响 —— 这是正确的，移除是租户内的动作。）
 *   3. **可恢复**。重新邀请时把同一行改回 ACTIVE 即可，不会撞
 *      `@@unique([organizationId, userId])`。
 *
 * 不变量与角色变更是同一条，共用一份判定口径：
 *   **任何操作都不能让一个组织失去最后一名 ACTIVE 管理员。**
 *   移除比降级更容易踩到它 —— "把人踢出去"通常不会想到他还是唯一能审批的人。
 */

import { db } from '@/lib/db'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { writeTenantAudit } from './audit'
import { can, type TenantRole } from './capabilities'
import { ADMIN_EQUIVALENT_ROLES, isAdminEquivalent } from './member-roles'
import { MEMBERSHIP_SELECT, toMemberDto, type MemberDto, type MembershipRow, type MembershipStatusValue } from './members'
import { TENANT_TX } from './tx'
import type { TenantContext } from './resolve'

export type MemberRemovalRejectionCode =
  | 'CAPABILITY_REQUIRED' // 发起人没有 member.remove
  | 'SELF_REMOVE' // 不能移除自己（退出组织是另一个动作，语义不同）
  | 'OWNER_PROTECTED' // 非 OWNER 不能移除 OWNER
  | 'NOT_ACTIVE' // 目标已经不是 ACTIVE（"成功但没改"是谎报）
  | 'LAST_ADMIN' // 会把租户的管理员数量降到 0

export interface MemberRemovalRejection {
  ok: false
  status: 400 | 403 | 409
  code: MemberRemovalRejectionCode
  message: string
}

export type MemberRemovalDecision = { ok: true; role: TenantRole } | MemberRemovalRejection

export interface MemberRemovalInput {
  actorRole: TenantRole
  actorUserId: string
  target: { userId: string; role: TenantRole; status: MembershipStatusValue }
  /** 本租户 ACTIVE 管理员数（OWNER + ADMIN），**含**目标本身；须在同一事务内读取。 */
  activeAdminCount: number
}

export function planMemberRemoval(input: MemberRemovalInput): MemberRemovalDecision {
  const { actorRole, actorUserId, target, activeAdminCount } = input

  if (!can(actorRole, 'member.remove')) {
    return {
      ok: false,
      status: 403,
      code: 'CAPABILITY_REQUIRED',
      message: 'Forbidden: missing capability member.remove',
    }
  }

  if (target.userId === actorUserId) {
    return {
      ok: false,
      status: 409,
      code: 'SELF_REMOVE',
      message: 'Conflict: you cannot remove yourself (use "leave organization" instead)',
    }
  }

  if (target.role === 'OWNER' && actorRole !== 'OWNER') {
    return {
      ok: false,
      status: 403,
      code: 'OWNER_PROTECTED',
      message: 'Forbidden: only the owner can remove the owner',
    }
  }

  if (target.status !== 'ACTIVE') {
    return {
      ok: false,
      status: 400,
      code: 'NOT_ACTIVE',
      message: `member is not active (status=${target.status})`,
    }
  }

  // 注意判据是"目标是 ACTIVE 管理员"且"管理员总数为 1"，而不是"角色是 ADMIN 就拦"。
  // 移除一名 MEMBER 永远不该被这条挡住 —— 否则门禁会宽到没有意义。
  if (isAdminEquivalent(target.role) && activeAdminCount <= 1) {
    return {
      ok: false,
      status: 409,
      code: 'LAST_ADMIN',
      message: 'Conflict: an organization must keep at least one active admin',
    }
  }

  return { ok: true, role: target.role }
}

function rejectToError(rejection: MemberRemovalRejection): Error {
  const details = { code: rejection.code }
  if (rejection.status === 403) return new ForbiddenError(rejection.message, details)
  if (rejection.status === 409) return new ConflictError(rejection.message, details)
  if (rejection.status === 400) return new ValidationError(rejection.message, details)
  return new ValidationError(rejection.message, details)
}

/**
 * 移出成员。跨租户的 membershipId → **404**（不是 403）：403 会泄露"该 id 真实存在"。
 */
export async function removeMember(ctx: TenantContext, membershipId: string): Promise<MemberDto> {
  if (!can(ctx.role, 'member.remove')) {
    throw new ForbiddenError('Forbidden: missing capability member.remove')
  }
  if (!membershipId) {
    throw new NotFoundError('Member not found')
  }

  const result = await db.$transaction(async (tx) => {
    const target = await tx.membership.findFirst({
      where: { id: membershipId, organizationId: ctx.organizationId },
      select: { id: true, userId: true, role: true, status: true },
    })
    if (!target) throw new NotFoundError('Member not found')

    // 实时计数，与写入同一事务：两个管理员同时移除对方时，
    // 若各自读到"还有 2 个"就会一起通过，最终留下 0 个。
    const activeAdminCount = await tx.membership.count({
      where: {
        organizationId: ctx.organizationId,
        status: 'ACTIVE',
        role: { in: [...ADMIN_EQUIVALENT_ROLES] },
      },
    })

    const decision = planMemberRemoval({
      actorRole: ctx.role,
      actorUserId: ctx.userId,
      target: {
        userId: target.userId,
        role: target.role as TenantRole,
        status: target.status as MembershipStatusValue,
      },
      activeAdminCount,
    })
    if (!decision.ok) throw rejectToError(decision)

    const updated = await tx.membership.update({
      where: { id: target.id },
      // 只改状态，不改角色：角色是"他曾经是什么"，移除后仍需在审计里读得出来。
      data: { status: 'SUSPENDED' },
      select: MEMBERSHIP_SELECT,
    })

    return { member: toMemberDto(updated as unknown as MembershipRow), role: decision.role }
  }, TENANT_TX)

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'membership.removed',
    resourceType: 'membership',
    resourceId: membershipId,
    // 不写 userId / 邮箱：resourceId 已能定位，审计流里不留人身份副本。
    safeMetadata: { previousRole: result.role, effect: 'suspended' },
  }).catch(() => {})

  return result.member
}

/**
 * T07 · 成员角色变更（写路径）+ 「每个租户至少一名管理员」不变量
 *
 * 为什么单独一个文件：
 *   `members.ts` 刻意只读（目录投影），写路径要处理的是**状态机与不变量**，
 *   两者的失败模式完全不同 —— 混在一起会让「只读投影」这个约束失守。
 *
 * 本文件解决的是 D-12 暴露的真问题（见 `docs/implementation/v20/60`）：
 *   生产 `default` 组织**没有 ADMIN**，而产品里**没有任何入口**能把人提成管理员。
 *   于是「组织一旦失去管理员，就永久失去审批与核验能力」——
 *   这是可用性缺口，不是数据脏。
 *
 * 三层防线（缺一不可）：
 *   1. **不给逃逸口**：`planRoleChange()` 是纯函数，所有拒绝原因都显式列出，
 *      不依赖 DB 状态之外的任何隐式条件，因此能被穷举单测。
 *   2. **不允许把最后一个管理员降级**：`LAST_ADMIN`。这条只在**写入前**
 *      用同一事务内的实时计数判定，不用缓存值。
 *   3. **不留提权捷径**：`OWNER` 只能通过 `org.transfer` 转移，不能由 `PATCH role`
 *      直接授予；ADMIN 也不能改动 OWNER 的角色。
 *
 * 🔴 并发：判定与写入在**同一个交互事务**内完成（`db.$transaction(async tx => ...)`）。
 *    否则两个管理员互相降级可以同时通过「计数 ≥ 2」的检查，最终留下 0 个管理员。
 *    事务是这条不变量真正的承重结构，纯函数只是把判定说清楚。
 */

import { db } from '@/lib/db'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { writeTenantAudit } from './audit'
import { TENANT_ROLES, can, parseTenantRole, type TenantRole } from './capabilities'
import { MEMBERSHIP_SELECT, toMemberDto, type MemberDto, type MembershipRow, type MembershipStatusValue } from './members'
import type { TenantContext } from './resolve'

/** 「管理员」的等价角色集合。OWNER 天然具备全部管理能力，必须计入。 */
export const ADMIN_EQUIVALENT_ROLES: readonly TenantRole[] = ['OWNER', 'ADMIN'] as const

export function isAdminEquivalent(role: TenantRole | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}

/** 拒绝码。**对外稳定**：调用方（UI / 脚本 / 测试）按码分支，不解析文案。 */
export type RoleChangeRejectionCode =
  | 'CAPABILITY_REQUIRED' // 发起人没有 member.update_role
  | 'INVALID_ROLE' // 目标角色不是合法枚举值
  | 'NO_CHANGE' // 新旧角色相同（"成功但没改"是谎报）
  | 'OWNER_PROTECTED' // 非 OWNER 试图改动 OWNER 的角色
  | 'OWNER_GRANT_FORBIDDEN' // 任何角色都不能通过本接口授予 OWNER
  | 'SELF_ROLE_CHANGE' // 不能改自己的角色（含自我降级与自我提权）
  | 'LAST_ADMIN' // 会把租户的管理员数量降到 0

export interface RoleChangeRejection {
  ok: false
  status: 400 | 403 | 409
  code: RoleChangeRejectionCode
  message: string
}

export type RoleChangeDecision =
  | { ok: true; from: TenantRole; to: TenantRole }
  | RoleChangeRejection

export interface RoleChangeTarget {
  userId: string
  role: TenantRole
  status: MembershipStatusValue
}

export interface RoleChangeInput {
  actorRole: TenantRole
  actorUserId: string
  target: RoleChangeTarget
  nextRole: TenantRole
  /**
   * 本租户 **ACTIVE** 的管理员数量（OWNER + ADMIN），**含**目标本身。
   * 由调用方在写入前用同一事务读取 —— 传入缓存值等于放弃这条不变量。
   */
  activeAdminCount: number
}

/**
 * 纯判定：这次角色变更是否允许，以及拒绝的确切原因。
 *
 * 判定顺序是有意的（越靠前越"根本"）：
 *   能力 → 取值 → 无变化 → OWNER 保护 → 授予 OWNER → 自我修改 → 最后一名管理员
 *
 * 注意 `LAST_ADMIN` 只看 **ACTIVE** 成员：
 * 把一名 SUSPENDED 的管理员降级不会减少可用管理员数量，因此不该被拦。
 */
export function planRoleChange(input: RoleChangeInput): RoleChangeDecision {
  const { actorRole, actorUserId, target, nextRole, activeAdminCount } = input

  if (!can(actorRole, 'member.update_role')) {
    return {
      ok: false,
      status: 403,
      code: 'CAPABILITY_REQUIRED',
      message: 'Forbidden: missing capability member.update_role',
    }
  }

  if (!(TENANT_ROLES as readonly string[]).includes(nextRole)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_ROLE',
      message: `role must be one of ${TENANT_ROLES.join(' | ')}`,
    }
  }

  if (nextRole === target.role) {
    return {
      ok: false,
      status: 400,
      code: 'NO_CHANGE',
      message: `member already has role ${nextRole}`,
    }
  }

  if (target.role === 'OWNER' && actorRole !== 'OWNER') {
    return {
      ok: false,
      status: 403,
      code: 'OWNER_PROTECTED',
      message: 'Forbidden: only the owner can change the owner role',
    }
  }

  if (nextRole === 'OWNER') {
    return {
      ok: false,
      status: 403,
      code: 'OWNER_GRANT_FORBIDDEN',
      message: 'Forbidden: ownership must be transferred via org.transfer, not a role patch',
    }
  }

  if (target.userId === actorUserId) {
    return {
      ok: false,
      status: 409,
      code: 'SELF_ROLE_CHANGE',
      message: 'Conflict: you cannot change your own role',
    }
  }

  if (
    target.status === 'ACTIVE' &&
    isAdminEquivalent(target.role) &&
    !isAdminEquivalent(nextRole) &&
    activeAdminCount <= 1
  ) {
    return {
      ok: false,
      status: 409,
      code: 'LAST_ADMIN',
      message: 'Conflict: an organization must keep at least one active admin',
    }
  }

  return { ok: true, from: target.role, to: nextRole }
}

/** 把拒绝原因翻译成对外的 HTTP 错误（保留 `code`，便于调用方分支）。 */
function rejectToError(rejection: RoleChangeRejection): Error {
  const details = { code: rejection.code }
  if (rejection.status === 403) return new ForbiddenError(rejection.message, details)
  if (rejection.status === 409) return new ConflictError(rejection.message, details)
  if (rejection.status === 400) return new ValidationError(rejection.message, details)
  // 类型上不可达（status 只有 400/403/409），但宁可抛 400 也不静默放行。
  return new ValidationError(rejection.message, details)
}

/**
 * 解析 `PATCH /api/v1/members/[membershipId]` 的请求体。
 *
 * 与本仓其它 PATCH 的口径一致：未知键忽略（向前兼容），但**给了就必须合法** ——
 * 大小写宽松（`admin` → `ADMIN`），非法值直接 400 而不是"悄悄跳过"。
 */
export function parseMemberRolePatch(body: unknown): { role: TenantRole } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object')
  }
  const raw = body as Record<string, unknown>
  if (raw.role === undefined) {
    throw new ValidationError('role is required', { field: 'role' })
  }
  if (typeof raw.role !== 'string') {
    throw new ValidationError('role must be a string', { field: 'role' })
  }
  const role = parseTenantRole(raw.role.trim().toUpperCase())
  if (!role) {
    throw new ValidationError(`role must be one of ${TENANT_ROLES.join(' | ')}`, {
      field: 'role',
    })
  }
  return { role }
}

/**
 * 变更成员角色。
 *
 * 跨租户的 membershipId → 404（不是 403）：403 会泄露"该 id 真实存在"。
 * 审计在事务**提交之后**写，且失败不改变业务结果（审计是旁路，见 `audit.ts`）。
 */
export async function updateMemberRole(
  ctx: TenantContext,
  membershipId: string,
  nextRole: TenantRole
): Promise<MemberDto> {
  // 路由层已 gate；服务层再判一次是纵深防御（脚本/任务会直接调用服务函数）。
  if (!can(ctx.role, 'member.update_role')) {
    throw new ForbiddenError('Forbidden: missing capability member.update_role')
  }
  if (!membershipId) {
    throw new NotFoundError('Member not found')
  }

  const result = await db.$transaction(async (tx) => {
    const target = await tx.membership.findFirst({
      where: { id: membershipId, organizationId: ctx.organizationId },
      select: { id: true, userId: true, role: true, status: true },
    })
    if (!target) {
      throw new NotFoundError('Member not found')
    }

    // 实时计数：与写入同一事务，避免两个管理员并发互降导致 0 管理员。
    const activeAdminCount = await tx.membership.count({
      where: {
        organizationId: ctx.organizationId,
        status: 'ACTIVE',
        role: { in: [...ADMIN_EQUIVALENT_ROLES] },
      },
    })

    const decision = planRoleChange({
      actorRole: ctx.role,
      actorUserId: ctx.userId,
      target: {
        userId: target.userId,
        role: target.role as TenantRole,
        status: target.status as MembershipStatusValue,
      },
      nextRole,
      activeAdminCount,
    })
    if (!decision.ok) {
      throw rejectToError(decision)
    }

    const updated = await tx.membership.update({
      where: { id: target.id },
      data: { role: nextRole },
      select: MEMBERSHIP_SELECT,
    })

    return {
      member: toMemberDto(updated as unknown as MembershipRow),
      from: decision.from,
      to: decision.to,
    }
  })

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'membership.role_changed',
    resourceType: 'membership',
    resourceId: membershipId,
    // 只记角色迁移本身；userId 属标识符，仍不入审计（最小化）。
    safeMetadata: { from: result.from, to: result.to },
  }).catch(() => {})

  return result.member
}

/** 租户管理员体检结果（供运维脚本与 Console 横幅复用）。 */
export interface OrgAdminAudit {
  organizationId: string
  slug: string
  status: string
  activeAdmins: number
  activeMembers: number
  /** 与 `activeAdmins === 0` 同义，单独取名是为了让调用点读起来是"结论"而不是"算术"。 */
  missingAdmin: boolean
}

/**
 * 统计单个租户的管理员健康度。
 *
 * ⚠️ 只读。**不要**在请求热路径里对全部租户调用（N+1）；它服务于运维脚本与
 * 单租户的诊断横幅。
 */
export async function auditOrganizationAdmins(organizationId: string): Promise<OrgAdminAudit | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, slug: true, status: true },
  })
  if (!org) return null

  const [activeAdmins, activeMembers] = await Promise.all([
    db.membership.count({
      where: {
        organizationId,
        status: 'ACTIVE',
        role: { in: [...ADMIN_EQUIVALENT_ROLES] },
      },
    }),
    db.membership.count({ where: { organizationId, status: 'ACTIVE' } }),
  ])

  return {
    organizationId: org.id,
    slug: org.slug,
    status: org.status,
    activeAdmins,
    activeMembers,
    missingAdmin: activeAdmins === 0,
  }
}

/**
 * T01 · 租户解析（唯一的租户事实来源）
 *
 * ⚠️ 本文件是「**绝不信任客户端 organizationId**」这条契约要求
 * （contracts/schema.sql:64）的唯一落点。规则：
 *
 *   1. `organizationId` 只能作为**选择器**传入，永远不能作为**授权凭证**。
 *      传入后必须回查 memberships 表确认「该用户确实是该租户的 ACTIVE 成员」，
 *      查不到即 403 —— 而不是直接采信。
 *   2. 未传 `organizationId` 时，取该用户的默认租户（最早加入的 ACTIVE 成员关系）。
 *   3. 一律从**服务端会话**（NextAuth）取 userId；绝不读 `req.body` / `req.query`
 *      / 客户端 header 里的用户身份。
 *
 * 复用了 `src/lib/auth/auth.ts:requireAuth()`，因此自动继承：
 *   - 匿名 → 401
 *   - 游客会话（guest）→ 401
 *   - tokenVersion 失配（密码已改/已登出）→ 401「Session expired」
 * 即 AC-01 中「匿名 / 过期 token」两类拒绝，在进入租户层之前就已成立。
 */

import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { ForbiddenError } from '@/lib/errors'
import { parseTenantRole, type TenantRole } from './capabilities'
import { writeTenantAudit } from './audit'

/** 已解析、已授权的租户上下文。所有租户作用域操作都必须以它为入参。 */
export interface TenantContext {
  /** 已通过成员关系校验的租户 id。 */
  organizationId: string
  /** 已通过会话校验的用户 id。 */
  userId: string
  /** 该用户在此租户内的角色。 */
  role: TenantRole
  /** 成员关系主键（写审计时用作 actor 归属）。 */
  membershipId: string
}

/** 用户可访问的租户摘要（用于租户切换器）。 */
export interface TenantSummary {
  organizationId: string
  name: string
  slug: string
  role: TenantRole
}

const MEMBERSHIP_SELECT = {
  id: true,
  organizationId: true,
  role: true,
} as const

/**
 * 按 userId 解析租户（不含会话校验）。
 *
 * 仅供**服务端可信调用方**使用（脚本、迁移、测试夹具）。
 * 从 HTTP 路由调用时请用 `resolveTenant()`，它额外做了会话校验。
 */
export async function resolveTenantForUser(
  userId: string,
  options: { organizationId?: string } = {}
): Promise<TenantContext> {
  const requested = options.organizationId?.trim()

  const membership = await db.membership.findFirst({
    where: {
      userId,
      status: 'ACTIVE',
      // 租户本身必须可用：SUSPENDED 的租户不允许任何写入/读取。
      organization: { status: 'ACTIVE' },
      ...(requested ? { organizationId: requested } : {}),
    },
    select: MEMBERSHIP_SELECT,
    // 未指定租户时，取最早加入的作为默认租户（稳定、可预测）。
    orderBy: { createdAt: 'asc' },
  })

  if (!membership) {
    // 这是**安全事件**：要么用户在猜别家租户 id，要么其成员关系已被撤销。
    // 只在「显式指定了租户」时记录，避免无租户用户的正常 403 造成审计噪音。
    if (requested) {
      await writeTenantAudit({
        organizationId: requested,
        actorId: userId,
        eventType: 'tenant.access_denied',
        resourceType: 'organization',
        resourceId: requested,
        safeMetadata: { reason: 'not_a_member_or_tenant_inactive' },
      }).catch(() => {
        /* 审计失败不得改变拒绝行为 —— 默认拒绝优先 */
      })
    }

    throw new ForbiddenError(
      requested
        ? 'Forbidden: you are not an active member of this organization'
        : 'Forbidden: no active organization membership'
    )
  }

  const role = parseTenantRole(membership.role)
  if (!role) {
    // DB 里出现了矩阵未定义的角色值 → 默认拒绝（fail-closed），不猜测意图。
    throw new ForbiddenError('Forbidden: unrecognized membership role')
  }

  return {
    organizationId: membership.organizationId,
    userId,
    role,
    membershipId: membership.id,
  }
}

/**
 * 从当前请求的会话解析租户上下文。**这是路由层应当使用的入口。**
 *
 * @param options.organizationId 可选的租户选择器（来自路由参数/查询串）。
 *        它只是「用户想看哪个租户」，授权仍由 memberships 表决定。
 */
export async function resolveTenant(
  options: { organizationId?: string } = {}
): Promise<TenantContext> {
  const { user } = await requireAuth() // 匿名 / 游客 / 过期 token 在此被拒（401）
  return resolveTenantForUser(user.id, options)
}

/** 列出用户可访问的全部租户（租户切换器用）。空数组表示该用户不属于任何租户。 */
export async function listTenants(userId: string): Promise<TenantSummary[]> {
  const rows = await db.membership.findMany({
    where: { userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
    select: {
      organizationId: true,
      role: true,
      organization: { select: { name: true, slug: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const out: TenantSummary[] = []
  for (const r of rows) {
    const role = parseTenantRole(r.role)
    if (!role) continue // 未知角色不进入可选列表
    out.push({
      organizationId: r.organizationId,
      name: r.organization?.name ?? '(unnamed)',
      slug: r.organization?.slug ?? '',
      role,
    })
  }
  return out
}

/** 仅做「是否成员」判定，不抛异常。用于条件渲染等非关键路径。 */
export async function isMemberOf(userId: string, organizationId: string): Promise<boolean> {
  const found = await db.membership.findFirst({
    where: { userId, organizationId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
    select: { id: true },
  })
  return Boolean(found)
}

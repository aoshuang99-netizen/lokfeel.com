/**
 * T01 · 租户守卫（路由层接入点）
 *
 * 提供两种用法：
 *   1. 命令式：`const tenant = await resolveTenant(); assertCapability(tenant, 'mission.create')`
 *   2. 声明式：`export const POST = withTenant('mission.create')(async (req, tenant) => {...})`
 *
 * 与既有 `src/lib/with-permission.ts` 的分工：
 *   - `withPermission`  → **平台**管理后台（/api/admin/*，全局角色 + 权限码）
 *   - `withTenant`      → **租户**作用域接口（/api/v1/*，租户角色 + 能力）
 * 两者互不替代；`withTenant` 内部仍复用 `requireAuth()` 做身份校验。
 */

import { NextRequest, NextResponse } from 'next/server'
import { forbidden, unauthorized, serverError } from '@/lib/api-response'
import { ApiError, ForbiddenError } from '@/lib/errors'
import { can, type TenantCapability } from './capabilities'
import { resolveTenant, type TenantContext } from './resolve'
import { writeTenantAudit } from './audit'

/**
 * 断言上下文具备某能力，否则抛 403。
 * 判定是**查表**（capabilities.ts），不含任何推理或 LLM 参与。
 */
export function assertCapability(ctx: TenantContext, capability: TenantCapability): void {
  if (!can(ctx.role, capability)) {
    throw new ForbiddenError(`Forbidden: missing capability ${capability}`)
  }
}

/** 非抛异常版本，便于条件分支。 */
export function hasCapability(ctx: TenantContext, capability: TenantCapability): boolean {
  return can(ctx.role, capability)
}

type TenantHandler = (
  req: NextRequest,
  ctx: TenantContext,
  routeParams?: unknown
) => Promise<NextResponse> | NextResponse

/**
 * 高阶包装：解析租户 → 校验能力 → 执行 handler。
 *
 * @param capability 单个或「任一满足」的能力集合
 *
 * 失败语义（全部默认拒绝）：
 *   - 匿名 / 游客 / 过期 token → 401
 *   - 无成员关系 / 成员被停用 / 租户被停用 → 403
 *   - 角色能力不足 → 403（并写 `tenant.capability_denied` 审计）
 */
export function withTenant(capability: TenantCapability | TenantCapability[]) {
  const required = Array.isArray(capability) ? capability : [capability]

  return (handler: TenantHandler) => {
    return async (req: NextRequest, context?: { params?: Promise<unknown> }) => {
      let tenant: TenantContext
      try {
        // 租户选择器只允许从查询串读取；即便被篡改，也会在 memberships 回查时被拒。
        const organizationId = req.nextUrl.searchParams.get('organizationId') ?? undefined
        tenant = await resolveTenant({ organizationId })
      } catch (err) {
        if (err instanceof ApiError) {
          return err.statusCode === 401 ? unauthorized(err.message) : forbidden(err.message)
        }
        return serverError('Internal server error')
      }

      const allowed = required.some((c) => can(tenant.role, c))
      if (!allowed) {
        console.error(
          `[tenant] capability denied: ${req.method} ${req.nextUrl.pathname} | org=${tenant.organizationId} | role=${tenant.role} | required=${required.join(',')}`
        )
        await writeTenantAudit({
          organizationId: tenant.organizationId,
          actorId: tenant.userId,
          eventType: 'tenant.capability_denied',
          resourceType: 'api',
          resourceId: `${req.method} ${req.nextUrl.pathname}`,
          safeMetadata: { role: tenant.role, required },
        }).catch(() => {})

        return forbidden(`Forbidden: missing capability ${required.join(' or ')}`)
      }

      try {
        const params = context?.params ? await context.params : undefined
        return await handler(req, tenant, params)
      } catch (err) {
        if (err instanceof ApiError) {
          return NextResponse.json({ error: err.message }, { status: err.statusCode })
        }
        console.error(`[tenant] handler error: ${req.method} ${req.nextUrl.pathname}`, err)
        return serverError('Internal server error')
      }
    }
  }
}

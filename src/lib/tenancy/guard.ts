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
 * V17 · 能力集合的合取 / 析取语义。
 *
 * 🔴 历史缺陷（WB17-01 修复）：`withTenant` 曾接受数组并按 **`some()`（任一满足）** 判定，
 * 而函数签名对「一个集合」与「一组备选」不加区分。调用方若写
 * `withTenant(['mission.read', 'mission.update'])` 本意是「两个都要」，实际却只要
 * 有 `mission.read` 就放行 —— 这就是「混入弱能力 ⇒ 静默降级」。
 *
 * 现在语义必须**写出来**：
 *   - `withTenant(cap)`      只有一个能力（类型层禁止数组）
 *   - `withTenantAll([...])` **全部**满足（合取，取严）
 *   - `withTenantAny([...])` **任一**满足（析取，仅用于"多个入口等价"的场景）
 *
 * 实测基线：仓内 57 处调用全部是单能力，零数组调用点，故本次语义收紧不改变任何现网行为。
 */
type CapabilitySet = readonly TenantCapability[]
type GuardMode = 'all' | 'any'

function describe(required: CapabilitySet, mode: GuardMode): string {
  return mode === 'all' ? required.join(' and ') : required.join(' or ')
}

function makeGuard(mode: GuardMode, required: CapabilitySet) {
  if (required.length === 0) {
    // 空集合在 `every()` 下恒真 ⇒ 会变成"无需能力即可访问"。宁可起不来，也不静默放行。
    throw new TypeError('withTenant*: capability set must not be empty')
  }

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

      const allowed =
        mode === 'all'
          ? required.every((c) => can(tenant.role, c))
          : required.some((c) => can(tenant.role, c))
      if (!allowed) {
        console.error(
          `[tenant] capability denied: ${req.method} ${req.nextUrl.pathname} | org=${tenant.organizationId} | role=${tenant.role} | mode=${mode} | required=${required.join(',')}`
        )
        await writeTenantAudit({
          organizationId: tenant.organizationId,
          actorId: tenant.userId,
          eventType: 'tenant.capability_denied',
          resourceType: 'api',
          resourceId: `${req.method} ${req.nextUrl.pathname}`,
          safeMetadata: { role: tenant.role, required, mode },
        }).catch(() => {})

        return forbidden(`Forbidden: missing capability ${describe(required, mode)}`)
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

/**
 * 单能力守卫。**类型层不接受数组** —— 想要"多个"请显式选 `withTenantAll` 或 `withTenantAny`。
 *
 * 失败语义（全部默认拒绝）：
 *   - 匿名 / 游客 / 过期 token → 401
 *   - 无成员关系 / 成员被停用 / 租户被停用 → 403
 *   - 角色能力不足 → 403（并写 `tenant.capability_denied` 审计）
 */
export function withTenant(capability: TenantCapability) {
  const raw: unknown = capability
  // 运行时兜底：JS 调用方 / `as never` / 误传数组都不得退化成"任一满足"。
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new TypeError(
      'withTenant() accepts exactly one capability; use withTenantAll() or withTenantAny() for multiple'
    )
  }
  return makeGuard('all', [capability])
}

/** 合取守卫：**全部**能力都具备才放行。用于"读 + 写"这类必须同时成立的入口。 */
export function withTenantAll(capabilities: CapabilitySet) {
  return makeGuard('all', capabilities)
}

/** 析取守卫：**任一**能力具备即放行。仅在多个入口确实等价时使用（例如"本人或管理员"）。 */
export function withTenantAny(capabilities: CapabilitySet) {
  return makeGuard('any', capabilities)
}

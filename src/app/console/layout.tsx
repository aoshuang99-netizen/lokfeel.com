/**
 * T07 · 组织态骨架（`/console/*`）
 *
 * 这是「**个人态 vs 组织态**」分层在代码里的唯一落点（见 `docs/implementation/T07/plan.md` §1）：
 *   · `/dashboard/*` = 个人态（我），走 `(dashboard)` 的 B2C 骨架；
 *   · `/console/*`   = 组织态（我的社群），走这一套骨架。
 * 两者**不共用** chrome —— 共用会让两套 IA 在侧边栏里互相污染。
 *
 * 服务端职责（都有明确失败语义）：
 *   1. 未登录 → 跳登录（保留回跳地址）；
 *   2. 已登录但**不属于任何 ACTIVE 组织** → 渲染说明页（`no-org.tsx`），
 *      **不是**错误页、**不是**静默 403 —— B2C 用户点进来必须看得懂发生了什么；
 *   3. 正常 → 把组织名与角色传给客户端骨架，页面只消费。
 */

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth/auth'
import {
  capabilitiesOf,
  listTenants,
  resolveActiveTenant,
  type TenantCapability,
  type TenantSummary,
} from '@/lib/tenancy'
import ConsoleShell from './console-shell'
import ConsoleNoOrg from './no-org'

// 依赖会话与 DB，不能静态化。
export const dynamic = 'force-dynamic'

export const metadata = {
  title: '社群控制台',
}

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  if (!session?.user?.id) {
    // 保留用户实际想访问的地址（取自 Referer）—— 与 (dashboard) 布局同款做法。
    // ⚠️ 原先写死 '/console'：深链（如 /console/settings）登录后会被送回入口，
    //    与文件头「未登录 → 跳登录（保留回跳地址）」的约定不符（2026-10-12 发版复验发现并修正）。
    //    只接受落在 /console 命名空间内的相对路径；Referer 缺失/非法（如直接开书签）→ 回落入口。
    //    这里不做授权判断 —— 由 /login 侧的 isSafeRedirect 兜底校验。
    const headersList = await headers()
    let callbackUrl = '/console'
    try {
      const refUrl = new URL(headersList.get('referer') || '')
      if (refUrl.pathname.startsWith('/console')) {
        callbackUrl = refUrl.pathname + refUrl.search
      }
    } catch {
      /* Referer 缺失或非法 → 保持入口 */
    }
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  }

  let organizationName = ''
  let capabilities: readonly TenantCapability[] = []
  let tenantCount = 0
  let tenants: TenantSummary[] = []
  let activeOrganizationId = ''

  try {
    // ⚠️ 这里从 `resolveTenantForUser` 换成 `resolveActiveTenant`（V20.5 Batch 3）：
    //    前者永远返回"最早加入的社群"，导致多社群用户看不到第二个社群。
    //    后者先读 cookie 软偏好（用户在切换器里选的），失效再回落默认。
    //
    // 🔴 V20.5 Batch 5（性能）：两者必须**并行**。它们各自打一趟 Turso 往返
    //    （本地实测单趟 1.5–1.9s），串行时 /console 的 TTFB = 两趟之和 ≈ 3.3s，
    //    直接把 LCP 顶穿 2500ms 预算；并行后 TTFB 收敛到单趟。
    //    两者都只依赖 userId，无共享依赖，Promise.all 安全。
    const [tenant, tenantList] = await Promise.all([
      resolveActiveTenant(session.user.id),
      listTenants(session.user.id),
    ])
    tenants = tenantList
    organizationName =
      tenants.find((t) => t.organizationId === tenant.organizationId)?.name ?? '你的社群'
    capabilities = capabilitiesOf(tenant.role)
    tenantCount = tenants.length
    activeOrganizationId = tenant.organizationId
  } catch {
    // 没有 ACTIVE 成员关系（或租户被停用）→ 说明页。
    // ⚠️ 这里**故意不**把异常往上抛：抛出去会变成 Next 的错误页，
    //    而"你还没加入任何社群"是一个**正常状态**，不是一个错误。
    return <ConsoleNoOrg />
  }

  return (
    <ConsoleShell
      organizationName={organizationName}
      capabilities={capabilities}
      tenantCount={tenantCount}
      tenants={tenants}
      activeOrganizationId={activeOrganizationId}
    >
      {children}
    </ConsoleShell>
  )
}

/**
 * `/api/v1/organizations` —— 组织（租户）的创建与列举
 *
 *   GET   列出我可访问的组织（租户切换器用）
 *   POST  新建组织；**创建者自动成为 OWNER**（同一事务，见 org-create.ts）
 *
 * 为什么这个路由**不带** `withTenant()`：
 *   它恰恰是"还没有租户"的人要用的接口 —— 新注册用户不属于任何组织，
 *   若挂在租户作用域下就会得到「Forbidden: no active organization membership」，
 *   形成"要建组织必须先有组织"的死锁。
 *   因此这里只做**会话**校验（requireAuth：匿名/游客/过期 token 一律 401），
 *   不做租户解析。授权边界由"谁能建"= 任何已登录非游客用户 决定。
 *
 * 🔴 不信任客户端 organizationId 的铁律在这里依然成立：POST 的 body 里**没有**
 *    `organizationId` 字段可传，新 id 由服务端生成。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth/auth'
import { ValidationError } from '@/lib/errors'
import { listTenants } from '@/lib/tenancy/resolve'
import { createOrganizationWithOwner } from '@/lib/tenancy/org-create'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { user } = await requireAuth()
    const tenants = await listTenants(user.id)
    return success({ organizations: tenants })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth()

    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Request body must be an object')
    }
    const { name, slug } = body as { name?: unknown; slug?: unknown }

    const organization = await createOrganizationWithOwner({
      actorUserId: user.id,
      name,
      slug,
    })
    // 注意 `success()` 的第二个参数是分页 meta，不是状态码 —— 状态码是第三个。
    return success({ organization }, undefined, 201)
  } catch (error) {
    return errorResponse(error)
  }
}

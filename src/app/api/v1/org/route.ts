/**
 * T07 · `/api/v1/org` —— 当前租户的社群档案
 *
 *   GET    读取本社群档案 + 我的角色与能力（能力 `org.read`：**所有 ACTIVE 成员**）
 *   PATCH  修改 `name` / `slug`（能力 `org.update`：**仅 OWNER**）
 *
 * ⚠️ 这里没有 `organizationId` 路径参数或查询参数 —— 租户由 `withTenant` 从会话解析，
 *    调用方**无法**用参数指定别家租户（这是 T01 起的铁律；写成 `/org/{id}` 会
 *    把"猜 id"变成一个可尝试的攻击面）。
 *
 * ⚠️ `status` 刻意**不可改**：允许自助把 `SUSPENDED` 改回 `ACTIVE`，等于让被风控/
 *    欠费的社群自己解封。状态变更走 T08 的计费与风控路径。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { getOrganizationOverview, parseOrganizationUpdate, updateOrganization } from '@/lib/tenancy/org'

export const GET = withTenant('org.read')(async (_req: NextRequest, tenant) => {
  try {
    return success(await getOrganizationOverview(tenant))
  } catch (error) {
    return errorResponse(error)
  }
})

export const PATCH = withTenant('org.update')(async (req: NextRequest, tenant) => {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    const patch = parseOrganizationUpdate(body)
    return success({ organization: await updateOrganization(tenant, patch) })
  } catch (error) {
    return errorResponse(error)
  }
})

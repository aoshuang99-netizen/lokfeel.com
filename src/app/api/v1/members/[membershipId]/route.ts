/**
 * T07 · `/api/v1/members/[membershipId]`
 *
 *   PATCH  变更成员角色（能力 `member.update_role`，ADMIN+）
 *
 * 只写「角色」这一个字段。姓名/邮箱属用户自己的资料；状态（停用/恢复）与移除
 * 是另外两个状态机切片（`member.remove`），不与角色变更混在同一条 PATCH 里 ——
 * 混在一起会让「降级」和「踢人」共享同一条审计语义，事后无法区分。
 *
 * 不变量的判定全部在 `updateMemberRole()` 内（同一事务），本文件只负责
 * 解析参数 + 把错误翻译成状态码。这里**不复制任何业务规则**。
 *
 * 跨租户：`membershipId` 属于别的租户 → 404（服务层用 `organizationId` 谓词查不到）。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { parseMemberRolePatch, updateMemberRole } from '@/lib/tenancy/member-roles'

function membershipIdOf(params: unknown): string {
  const id = (params as { membershipId?: string } | undefined)?.membershipId
  if (!id || typeof id !== 'string') throw new NotFoundError('Member not found')
  return id
}

export const PATCH = withTenant('member.update_role')(async (req: NextRequest, tenant, params) => {
  try {
    const membershipId = membershipIdOf(params)
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    const { role } = parseMemberRolePatch(body)
    return success(await updateMemberRole(tenant, membershipId, role))
  } catch (error) {
    return errorResponse(error)
  }
})

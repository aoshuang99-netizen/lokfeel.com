/**
 * T07 · `/api/v1/members`
 *
 *   GET  列出本租户成员（能力 `member.read`，分页 + `role` / `status` / `q` 过滤）
 *
 * 租户解析与能力判定由 `withTenant('member.read')` 在进入 handler **之前**完成：
 *   - 匿名 / 游客 / 过期 token → 401
 *   - 非本租户成员 / 能力不足   → 403（并写审计）
 * 因此 handler 内部只关心查询参数与投影。
 *
 * 本端点**只读**。邀请 / 改角色 / 移除（`member.invite` / `member.update_role` /
 * `member.remove`）属后续切片 —— 在此之前不要在 Console 上渲染对应的按钮。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, paginated, parsePagination } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { listMembers, parseMemberFilters } from '@/lib/tenancy/members'

export const GET = withTenant('member.read')(async (req: NextRequest, tenant) => {
  try {
    const { page, pageSize } = parsePagination(req.nextUrl.searchParams)
    const filters = parseMemberFilters(req.nextUrl.searchParams)

    const { items, total } = await listMembers(tenant, { page, pageSize, ...filters })
    return paginated(items, {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    return errorResponse(error)
  }
})

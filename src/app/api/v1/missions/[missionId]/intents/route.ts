/**
 * T03 · `/api/v1/missions/[missionId]/intents` —— 任务下的意图清单（**组织者视角**）
 *
 *   GET  能力 `mission.read`（OPERATOR 及以上）
 *
 * 这是 **AC-03 的执法点**：组织者读取成员意图时，输出经
 * `discloseSubject(profile, live, 'ORGANIZER')` 白名单投影 ——
 * 未被授权到 ORGANIZER 档的字段（例如年龄、性别认同、邮箱），
 * 其**键在响应 JSON 里根本不存在**，而不是 `null`。
 *
 * 顺带说明为什么能力用 `mission.read` 而不是新增一个 `intent.read.all`：
 *   本端点是 mission 的**子资源视图**，权限语义与"读这个任务"一致；
 *   普通成员（MEMBER）没有 `mission.read`，因此天然看不到别人的披露内容。
 *   `intent.read` / `intent.manage` 这两个自助能力只覆盖"自己的意图"。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, paginated, parsePagination } from '@/lib/api-response'
import { NotFoundError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { listMissionIntentsForOrganizer } from '@/lib/connection'

function missionIdOf(params: unknown): string {
  const id = (params as { missionId?: string } | undefined)?.missionId
  if (!id || typeof id !== 'string') throw new NotFoundError('Mission not found')
  return id
}

export const GET = withTenant('mission.read')(async (req: NextRequest, tenant, params) => {
  try {
    const { page, pageSize } = parsePagination(req.nextUrl.searchParams)
    const { items, total } = await listMissionIntentsForOrganizer(
      tenant,
      missionIdOf(params),
      { page, pageSize }
    )
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

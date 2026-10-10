/**
 * T02 · `/api/v1/missions`
 *
 *   POST  创建 Mission（**要求 `Idempotency-Key`**，能力 `mission.create`）
 *   GET   列出本租户 Mission（能力 `mission.read`，分页）
 *
 * 租户与权限由 `withTenant()` 在进入 handler 之前完成：
 *   - 匿名 / 游客 / 过期 token → 401
 *   - 非本租户成员 / 能力不足   → 403（并写审计）
 * 因此 handler 内部**只关心业务**，且**所有** DB 谓词都带 `tenant.organizationId`。
 */

import type { NextRequest } from 'next/server'
import { created, errorResponse, paginated, parsePagination } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import {
  createMission,
  getMissionById,
  hardDeleteMission,
  hashRequest,
  listMissions,
  parseMissionCreate,
  requireIdempotencyKey,
  withIdempotency,
  type PublicMissionStatus,
} from '@/lib/connection'

const ALLOWED_STATUS_FILTERS: readonly string[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED']

export const POST = withTenant('mission.create')(async (req: NextRequest, tenant) => {
  try {
    // 契约要求：Idempotency-Key 必需。缺失 → 400（**不**退化为"非幂等"）。
    const key = requireIdempotencyKey(req.headers.get('Idempotency-Key'))

    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    const input = parseMissionCreate(body)

    const { resource, replayed } = await withIdempotency({
      organizationId: tenant.organizationId,
      scope: 'mission.create',
      key,
      requestHash: hashRequest(input),
      resourceType: 'mission',
      load: (id) => getMissionById(tenant, id),
      create: async () => {
        const mission = await createMission(tenant, input)
        return { resourceId: mission.id, resource: mission }
      },
      compensate: (id) => hardDeleteMission(tenant, id),
    })

    const res = created(resource)
    if (replayed) {
      // 契约只定义 201。用响应头显式区分重放，避免调用方把重放误判成
      // "又创建了一条" —— 静默的语义差异比状态码差异危险得多。
      res.headers.set('Idempotent-Replayed', 'true')
    }
    return res
  } catch (error) {
    return errorResponse(error)
  }
})

export const GET = withTenant('mission.read')(async (req: NextRequest, tenant) => {
  try {
    const { page, pageSize } = parsePagination(req.nextUrl.searchParams)
    const rawStatus = req.nextUrl.searchParams.get('status')
    const status =
      rawStatus && ALLOWED_STATUS_FILTERS.includes(rawStatus.toUpperCase())
        ? (rawStatus.toUpperCase() as PublicMissionStatus)
        : null

    const { items, total } = await listMissions(tenant, { page, pageSize, status })
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

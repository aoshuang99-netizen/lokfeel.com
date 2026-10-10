/**
 * T03 · `/api/v1/intents`
 *
 *   POST  提交成员意图（**要求 `Idempotency-Key`**，能力 `intent.manage`）
 *   GET   列出**自己**的意图（能力 `intent.read`，可按 missionId 过滤）
 *
 * 与 T02 的 `/api/v1/missions` 同形。三点差异值得注意：
 *   1. 能力是**自助**的：`intent.manage` / `intent.read` 属于任何 ACTIVE 成员，
 *      因为意图是个人数据（T01 的 ROLE_CAPABILITIES 里已在 SELF_SERVICE 中）。
 *   2. 创建前必须先加入任务（服务层会 409），这是 T02/T03 的分工边界。
 *   3. 组织者读取走 `GET /api/v1/missions/[missionId]/intents`（不同能力、不同投影）。
 */

import type { NextRequest } from 'next/server'
import { created, errorResponse, paginated, parsePagination } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import {
  createIntent,
  getIntentById,
  hardDeleteIntent,
  hashRequest,
  listMyIntents,
  parseIntentCreate,
  requireIdempotencyKey,
  withIdempotency,
} from '@/lib/connection'

export const POST = withTenant('intent.manage')(async (req: NextRequest, tenant) => {
  try {
    const key = requireIdempotencyKey(req.headers.get('Idempotency-Key'))

    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    const input = parseIntentCreate(body)

    const { resource, replayed } = await withIdempotency({
      organizationId: tenant.organizationId,
      scope: 'intent.create',
      key,
      // ⚠️ input 里含 `Date`（expiresAt）与嵌套披露表。指纹必须能区分二者，
      // 否则"同键不同体"会被误判为重放（见 idempotency.ts 对 Date 的处理）。
      requestHash: hashRequest(input),
      resourceType: 'intent',
      load: (id) => getIntentById(tenant, id),
      create: async () => {
        const intent = await createIntent(tenant, input)
        return { resourceId: intent.id, resource: intent }
      },
      compensate: (id) => hardDeleteIntent(tenant, id),
    })

    const res = created(resource)
    if (replayed) res.headers.set('Idempotent-Replayed', 'true')
    return res
  } catch (error) {
    return errorResponse(error)
  }
})

export const GET = withTenant('intent.read')(async (req: NextRequest, tenant) => {
  try {
    const { page, pageSize } = parsePagination(req.nextUrl.searchParams)
    const missionId = req.nextUrl.searchParams.get('missionId')

    const { items, total } = await listMyIntents(tenant, { page, pageSize, missionId })
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

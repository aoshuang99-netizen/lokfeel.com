/**
 * T07 · `GET /api/v1/connections/pipeline` —— 本社群的连接全貌（运营视图）
 *
 *   能力 `workflow.read`（OPERATOR+）
 *
 * 与同级的 `/connections/proposals` **不是**同一件事：
 *   - `/proposals` 是**自助**的（只返回"与我有关"的提案，`proposal.read` 人人有）；
 *   - 本端点是**租户级**的（返回本社群全部提案 + T06 阶段 + 停滞 + 可介绍性）。
 *
 * 🔴 为什么只 gate 一个能力，而不是写成 `['proposal.read', 'workflow.read']`：
 *   `withTenant` 对数组是 **`some()`（任一满足）**，不是 `every()`。
 *   把弱能力（`proposal.read` 连 MEMBER 都有）混进数组，会把本端点**降级**成
 *   所有成员都能读全社群提案 —— 守卫看起来更"完整"，实际更松。
 *   这里选 `workflow.read`（OPERATOR+）单条，与 `plan.md` §5 的"Connections = OPERATOR+"一致。
 *
 * 查询参数：
 *   `bucket`   全部 | PENDING_CONSENT | READY_TO_INTRODUCE | INTRODUCED | CLOSED（未知值 → 400）
 *   `stalled`  `1` = 只看停滞的（阶段超时未推进）
 *   `page` / `pageSize` 分页（**在派生过滤之后**，见 operations.ts 的分页口径说明）
 *
 * ⚠️ 响应含 `truncated`：为 `true` 时说明有提案落在扫描窗口之外，
 *    此时 `total` 只是窗口内的数 —— 调用方**必须**把这件事显示出来，不要当全量。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, parsePagination, success } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { listOrgConnections, parseConnectionBucket } from '@/lib/connection/operations'

export const GET = withTenant('workflow.read')(async (req: NextRequest, tenant) => {
  try {
    const bucketRaw = req.nextUrl.searchParams.get('bucket')
    const bucket = parseConnectionBucket(bucketRaw)
    if (bucket === null) {
      throw new ValidationError(`unknown bucket: ${bucketRaw}`, { field: 'bucket' })
    }

    const stalledOnly = req.nextUrl.searchParams.get('stalled') === '1'
    const { page, pageSize } = parsePagination(req.nextUrl.searchParams)

    const result = await listOrgConnections(tenant, { bucket, stalledOnly, page, pageSize })
    return success(result)
  } catch (error) {
    return errorResponse(error)
  }
})

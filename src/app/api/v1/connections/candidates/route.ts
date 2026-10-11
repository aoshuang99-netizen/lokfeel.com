/**
 * T04 · `/api/v1/connections/candidates` —— 我的双向互补候选
 *
 *   GET  ?missionId=<id>   能力 `intent.read`（任何 ACTIVE 成员的自助能力）
 *
 * 三条与 T03 一致、值得复述的边界：
 *
 *   1. **能力用自助的 `intent.read`**，不是 `mission.read`。
 *      本端点是"我的匹配"，读的是我与同任务成员的互补关系，而不是"任务管理视图"。
 *      更关键的是：服务层会校验"我在这条任务上有**生效中**的意图"，
 *      因此没有提交意图的人拿不到任何候选 —— 权限之外还有一道**业务前置**。
 *
 *   2. **空候选不是错误**：`204`/`404` 都不合适，因为"没有候选"本身是正常结果，
 *      而且必须带上原因码（`no_own_intent` / `no_other_intents` / `all_gated_out` /
 *      `no_reciprocal_overlap`）—— 用户有权知道"为什么一个都没匹配到"。
 *      所以一律 `200` + `data.noCandidatesReason`。
 *
 *   3. **输出经 `discloseSubject(..., 'CANDIDATE')` 白名单投影**（AC-03）。
 *      未被授权到「同任务的伙伴」档的字段，其**键在响应 JSON 里根本不存在**。
 *      `data.profileAudience` 自描述本次用的档位，便于审计与负测。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { listCandidates } from '@/lib/connection'

export const GET = withTenant('intent.read')(async (req: NextRequest, tenant) => {
  try {
    const missionId = req.nextUrl.searchParams.get('missionId')
    if (!missionId) throw new ValidationError('missionId is required', { field: 'missionId' })

    const limitRaw = req.nextUrl.searchParams.get('limit')
    const limit = limitRaw ? Number(limitRaw) : undefined
    if (limitRaw && (!Number.isFinite(limit) || (limit as number) < 1)) {
      throw new ValidationError('limit must be a positive integer', { field: 'limit' })
    }

    const result = await listCandidates(tenant, missionId, { limit })
    return success(result)
  } catch (error) {
    return errorResponse(error)
  }
})

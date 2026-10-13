/**
 * T08 · `/api/v1/outcomes` —— 成果列表与上报
 *
 *   GET  能力 `outcome.read`（**全员**）：列本租户成果
 *   POST 能力 `outcome.report`（**全员**）：上报成果（自报）
 *
 * 🔴 请求体**没有** `verificationLevel` 字段 —— 级别由 `OutcomeVerification`
 * 记录集派生（AC-15「自报不算验证成功」）。想让成果变"已验证"，
 * 只能走 `.../{id}/confirm`（对手方）或 `.../{id}/verify`（运营）。
 *
 * ⚠️ `withTenant` 对能力数组是 **`some()`（任一满足）**：这里两处都只 gate
 * **单个**能力，避免"看起来更完整、实际更松"的降级。
 */

import type { NextRequest } from 'next/server'
import { created, errorResponse, success } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import {
  listOutcomes,
  parseVerificationLevel,
  reportOutcome,
  type OutcomeVerificationLevel,
} from '@/lib/outcome'

/** 解析 `?limit=`（缺省交给服务层 50；上限 200，与 `listOutcomes` 的钳制一致）。 */
function parseLimit(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw new ValidationError(`limit must be a positive integer, got: ${raw}`, { field: 'limit' })
  }
  return Math.min(n, 200)
}

/** 解析 `?level=` —— 未知值 → 400（**不静默忽略**，否则用户以为过滤生效了）。 */
function parseLevel(raw: string | null): OutcomeVerificationLevel | undefined {
  if (raw === null || raw === '') return undefined
  const level = parseVerificationLevel(raw)
  if (level === null) throw new ValidationError(`unknown level: ${raw}`, { field: 'level' })
  return level
}

export const GET = withTenant('outcome.read')(async (req: NextRequest, tenant) => {
  try {
    const level = parseLevel(req.nextUrl.searchParams.get('level'))
    const missionId = req.nextUrl.searchParams.get('missionId') ?? undefined
    const verifiedOnly = req.nextUrl.searchParams.get('verified') === '1'
    const limit = parseLimit(req.nextUrl.searchParams.get('limit'))

    const items = await listOutcomes(tenant, { level, missionId, verifiedOnly, limit })
    return success({
      items,
      count: items.length,
      /** 仅自报（未被确认）的条数 —— AC-15 的"分离"在响应里的直接体现。 */
      unverifiedCount: items.filter((o) => !o.verified).length,
      filters: {
        level: level ?? null,
        missionId: missionId ?? null,
        verifiedOnly,
        limit: limit ?? 50,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
})

export const POST = withTenant('outcome.report')(async (req: NextRequest, tenant) => {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const result = await reportOutcome(tenant, {
      proposalId: typeof body.proposalId === 'string' ? body.proposalId : '',
      summary: typeof body.summary === 'string' ? body.summary : '',
      occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : null,
    })
    return created(result)
  } catch (error) {
    return errorResponse(error)
  }
})

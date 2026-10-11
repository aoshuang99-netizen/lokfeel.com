/**
 * T05 · `GET /api/v1/connections/introductions` —— 我已建立连接的对手方
 *
 *   能力 `proposal.read`（自助）
 *
 * 这是 `COUNTERPARTY` 披露档位**唯一的读路径**。只返回 `introducedAt !== null`
 * 的提案 —— 双方"都同意但尚未介绍"不在此列（同意 ≠ 已介绍）。
 *
 * 两条与 AC-03 直接相关的约束：
 *   1. 每个对方档案都经 `discloseSubject(profile, live, 'COUNTERPARTY')` 投影，
 *      未授权到该档的字段**键不存在**；
 *   2. 对方若已撤销意图，`liveDisclosureOf()` 当次即为空表 → 投影**当场归零**。
 *      因此这里不需要（也不应该有）任何缓存。
 *
 * `audience` 字段是**自描述**的：它让调用方与测试能断言"这条通道确实用的是
 * `COUNTERPARTY` 档"，而不必去读代码猜。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { listIntroductions } from '@/lib/connection'

export const GET = withTenant('proposal.read')(async (req: NextRequest, tenant) => {
  try {
    const limitRaw = req.nextUrl.searchParams.get('limit')
    const limit = limitRaw ? Number(limitRaw) : undefined
    if (limitRaw && (!Number.isFinite(limit) || (limit as number) < 1)) {
      throw new ValidationError('limit must be a positive integer', { field: 'limit' })
    }

    const items = await listIntroductions(tenant, { limit })
    return success({ introductions: items })
  } catch (error) {
    return errorResponse(error)
  }
})

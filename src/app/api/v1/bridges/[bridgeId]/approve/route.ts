/**
 * T10 · `POST /api/v1/bridges/{bridgeId}/approve` —— 被邀方群主批准
 *
 *   能力 `bridge.manage`（**ADMIN+**）。这是 AC-19「**双边群主配置生效**」的落点：
 *   `ACTIVE` 的**唯一**入口就是这一条 —— 发起方在创建时已自动批准，
 *   因此代码里**不存在**"单边发起即可共享"的边（见内核 `planBridgeTransition` 的真相表）。
 *
 * 🔴 立场由**服务层从 DB 行推导**（`sideOf(row, ctx.organizationId)`），
 *    **不**从请求体读 —— 否则调用方可以自称"我是被邀方"来绕过 `WRONG_SIDE`。
 *    这同时意味着：发起方调用本端点必然 403（`WRONG_SIDE`），那是**正确**行为，
 *    不是配置问题。
 *
 * 语义（与服务层 `decideBridge` 一致）：
 *   - 已被撤销 / 已过期 / 已经 `ACTIVE` → 409（各自的领域结论映射成不同的错误信息）
 *   - 非当事组织 / 协议不存在 → 404
 *   - 发起方调用 → 403（只有被邀方能批准）
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { decideBridge } from '@/lib/bridges'
import { bridgeIdOf } from '../../_shared/params'

export const POST = withTenant('bridge.manage')(async (_req: NextRequest, tenant, params) => {
  try {
    const bridge = await decideBridge(tenant, bridgeIdOf(params), 'APPROVE')
    return success(bridge)
  } catch (error) {
    return errorResponse(error)
  }
})

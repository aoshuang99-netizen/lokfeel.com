/**
 * T10 · `POST /api/v1/bridges/{bridgeId}/opt-in` —— 成员逐个加入
 *
 *   能力 `bridge.optin`（**自助**，SELF_SERVICE）—— 这一条就是 AC-19 后半句
 *   「**仅**共享**明确 opt-in** 的数据」在权限模型上的落点：
 *   加入与否**只能由成员自己**决定，群主的管理权（`bridge.manage`）无法代他表态。
 *
 * 🔴 请求体 `disclosedFieldKeys` 必须 ⊆ **本组织**在这份协议里配置的字段
 *    （发起方看 `initiatorFieldKeys`、被邀方看 `recipientFieldKeys`）。
 *    越界**整单拒绝**（400 + `bridge.optin_rejected` 审计），而不是静默收窄 ——
 *    静默收窄的症状是"我明明勾了却没生效"，用户拿不到任何解释（fail loud）。
 *
 * ⚠️ 幂等：重复 opt-in 是**更新**（不是新增行，库级 `@@unique([bridgeId, userId])`），
 *    因此本端点**不要求** `Idempotency-Key` —— 它天然幂等，且语义是"把我的选择设成这个"。
 *    这与 `POST /api/v1/bridges`（会创建资源）的要求刻意不同。
 *
 * ⚠️ `PENDING` 时**可以** opt-in（提前表态无害：协议不 `ACTIVE` 时投影恒为空）；
 *    `REVOKED` / `EXPIRED` 时 409（那时的 opt-in 是会误导用户的死动作）。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { optInBridgeMember } from '@/lib/bridges'
import { bridgeIdOf } from '../../_shared/params'

export const POST = withTenant('bridge.optin')(async (req: NextRequest, tenant, params) => {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const optIn = await optInBridgeMember(tenant, bridgeIdOf(params), body.disclosedFieldKeys)
    return success({ optIn })
  } catch (error) {
    return errorResponse(error)
  }
})

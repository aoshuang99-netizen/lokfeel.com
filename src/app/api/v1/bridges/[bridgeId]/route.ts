/**
 * T10 · `GET /api/v1/bridges/{bridgeId}` —— 协议详情 + **本人**可见性投影
 *
 *   能力 `bridge.read`（自助）：成员都要能回答两个问题 ——
 *     ① 「这份协议现在是什么状态、双方都同意共享什么？」（`bridge`）
 *     ② 「**我的**数据会被对方看到哪些字段？如果看不到，是我没配好还是群主没开？」（`myProjection`）
 *
 * 🔴 为什么把 `myProjection` 并进这个端点（而不是单开一个 `GET /opt-in`）：
 *    两者回答的是同一件事的两个角度（"协议是什么" / "我在协议里的位置"），
 *    拆成两个端点会让 UI 必须发两次请求才能渲染一个面板，且两次的 `now` 可能不同
 *    （一份显示"已生效"、另一份显示"已过期"）。这里**共用同一个 `now`**。
 *
 * 🔴 逐字段收窄归因（`narrowed` + `owner`）**只**出现在这里，不出现在跨群 discovery 里 ——
 *    「该找谁」是本人视角的问题；把它下发给对方组织等于泄漏对方组织的内部配置
 *    （见 `src/lib/bridges/dto.ts` 的长注释）。这是本端点存在的**主要**理由。
 *
 * 跨租户/不存在一律 404（谓词写进 `findBridgeRow` 的 `WHERE`，连"存在"这一事实都不泄露）。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { getBridge, planMyBridgeVisibility } from '@/lib/bridges'
import { bridgeIdOf } from '../_shared/params'

export const GET = withTenant('bridge.read')(async (_req: NextRequest, tenant, params) => {
  try {
    const bridgeId = bridgeIdOf(params)
    // 共享同一个 `now`：两个投影必须对"过期没过期"给出一致答案。
    const now = new Date()
    const [bridge, myProjection] = await Promise.all([
      getBridge(tenant, bridgeId, now),
      planMyBridgeVisibility(tenant, bridgeId, { now }),
    ])
    return success({ bridge, myProjection })
  } catch (error) {
    return errorResponse(error)
  }
})

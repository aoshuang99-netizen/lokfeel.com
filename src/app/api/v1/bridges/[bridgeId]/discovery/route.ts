/**
 * T10 · `GET /api/v1/bridges/{bridgeId}/discovery` —— 跨群可见成员投影
 *
 *   能力 `bridge.read`（自助）。**这是本模块唯一的跨群读取路径**，也是 AC-19
 *   在运行时的取证点。它回答：「对方组织里，**此刻**有哪些成员愿意被我看到、
 *   以及我能看到他们的哪些字段？」
 *
 * ── 🔴 四道闸门（缺一即返回空，见内核 `planBridgeVisibility`）──────────
 *   ① 协议必须 `ACTIVE` 且未过期（`PENDING` = 等对方批准 ⇒ 空；`REVOKED` ⇒ 空）；
 *   ② 对方成员必须**逐个** opt-in 且状态为 `ACTIVE`；
 *   ③ 该成员自己的意图必须对候选档披露了字段（否则没有披露依据）；
 *   ④ 字段必须是**三方交集**（双方群主配置 ∩ 成员 opt-in ∩ 成员披露档位）。
 *
 * ── 反向对照（E2E 会逐条取证）──────────────────────────────────
 *   · 未 opt-in 的成员**不在**返回里（查询谓词就没有他们）；
 *   · 单边批准（`PENDING`）⇒ 返回空 + `bridgeRefusalCode: 'BRIDGE_PENDING'`；
 *   · 成员 opt-in 收窄后 ⇒ 该字段的键**根本不存在**于 `subject` 里；
 *   · 群主 revoke 后**立即**为空（投影实时读库，不缓存"上次可见的集合"）。
 *
 * ⚠️ 协议不可用时**不返回 4xx**，而是 200 + 空列表 + 原因码：`PENDING` 是**正常**状态，
 *    客户端要渲染的是"等待对方群主批准"，不是一个错误页（见 `discovery.ts` 的说明）。
 *
 * ⚠️ 响应里**没有**逐字段收窄归因：那是**对方组织的内部配置**
 *    （"张三没勾 email"），下发给我们属元数据泄漏。只有聚合计数（`gatedOut`）。
 *    本人要看归因，走 `GET /api/v1/bridges/{bridgeId}` 的 `myProjection`。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { listBridgeDiscoveries, parseBridgeLimit } from '@/lib/bridges'
import { bridgeIdOf } from '../../_shared/params'

export const GET = withTenant('bridge.read')(async (req: NextRequest, tenant, params) => {
  try {
    const limit = parseBridgeLimit(req.nextUrl.searchParams.get('limit'))
    const result = await listBridgeDiscoveries(tenant, bridgeIdOf(params), { limit })
    return success(result)
  } catch (error) {
    return errorResponse(error)
  }
})

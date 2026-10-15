/**
 * T10 · `POST /api/v1/bridges/{bridgeId}/revoke` —— 任一方群主撤销
 *
 *   能力 `bridge.manage`（ADMIN+）。
 *
 * 🔴 **撤销即刻生效，且不可逆**：`REVOKED` 是一个终态（内核真相表里没有出边）。
 *    投影每次**实时**读 DB（`bridgeUsableReason` 先判 `BRIDGE_REVOKED`），
 *    因此不需要 sweeper、也不需要"刷新缓存"—— 撤销后的下一次 discovery 立即为空。
 *
 * 🔴 撤销**不删除** opt-in 行：`BridgeMemberOptIn` 保留（状态不动或保留 `ACTIVE`），
 *    因为「谁曾加入过」是审计问题；而协议状态一旦是 `REVOKED`，
 *    所有 opt-in 在投影层就**永久**不再被当作授权。删行只会丢失审计证据。
 *
 * 「双方都有权撤销」是刻意的：只要有一方不再愿意共享，共享就必须停止 ——
 * 要求"双方同意才能撤销"等于给一方否决权去强制另一方继续披露。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { decideBridge } from '@/lib/bridges'
import { bridgeIdOf } from '../../_shared/params'

export const POST = withTenant('bridge.manage')(async (_req: NextRequest, tenant, params) => {
  try {
    const bridge = await decideBridge(tenant, bridgeIdOf(params), 'REVOKE')
    return success(bridge)
  } catch (error) {
    return errorResponse(error)
  }
})

/**
 * T10 · `/api/v1/bridges` —— 跨群协议列表与发起
 *
 *   GET  能力 `bridge.read`（**自助**，SELF_SERVICE）：列本组织**参与**的协议
 *   POST 能力 `bridge.manage`（ADMIN+）：发起一份协议（**幂等**）
 *
 * ── GET 的可见范围 ───────────────────────────────────────────────
 *   「本组织参与的协议」= 作为发起方 **或** 被邀方。谓词写进 SQL（`OR`），
 *   调用方无法通过参数扩大范围 —— 没有"查别人协议"的入参，也没有那个分支。
 *
 * ── 🔴 POST 的三条硬约束 ─────────────────────────────────────────
 *   ① **必须带 `Idempotency-Key`** —— 缺省 → 400，不退化为"非幂等也能用"。
 *      理由：一份协议会开启**跨组织的授权面**。网络重试若被当成新请求，
 *      要么重复建协议（被唯一约束挡下变成 500），要么在将来引入字段更新时**覆盖配置**。
 *   ② 落库即 `PENDING` —— `recipientApprovedAt` 为 `null`，内核判 `BRIDGE_PENDING`，
 *      投影恒为空。**代码里不存在"单边发起即可共享"的路径**。
 *   ③ 被邀方组织由**服务端**回查（存在 + `ACTIVE`），且不得是自邀。
 *      请求体属不可信输入，`recipientOrgId` 只是**声明**，不是授权依据。
 *
 * ⚠️ 响应形状是 `{ bridge, replayed }` 而不是裸的 bridge：命中幂等记录时**不**返回 201
 *    —— 本次没有创建资源，`replayed: true` 更诚实（与 T09 `POST /agents/runs` 同一约定）。
 */

import type { NextRequest } from 'next/server'
import { created, errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import {
  createBridge,
  listBridges,
  parseBridgeLimit,
  parseBridgeStatusView,
} from '@/lib/bridges'

export const GET = withTenant('bridge.read')(async (req: NextRequest, tenant) => {
  try {
    const status = parseBridgeStatusView(req.nextUrl.searchParams.get('status'))
    const limit = parseBridgeLimit(req.nextUrl.searchParams.get('limit'))
    const result = await listBridges(tenant, { status, limit })
    return success(result)
  } catch (error) {
    return errorResponse(error)
  }
})

export const POST = withTenant('bridge.manage')(async (req: NextRequest, tenant) => {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    // 🔴 幂等键**从 header 取**（不是 body）—— 与 T02/T09 的既有约定一致。
    const idempotencyKey = req.headers.get('idempotency-key')

    const result = await createBridge(tenant, {
      recipientOrgId: body.recipientOrgId,
      initiatorFieldKeys: body.initiatorFieldKeys,
      recipientFieldKeys: body.recipientFieldKeys,
      shareableMissionKinds: body.shareableMissionKinds,
      purpose: body.purpose,
      expiresAt: body.expiresAt,
      idempotencyKey,
    })

    if (result.replayed) {
      return success({ bridge: result.bridge, replayed: true })
    }
    return created({ bridge: result.bridge, replayed: false })
  } catch (error) {
    return errorResponse(error)
  }
})

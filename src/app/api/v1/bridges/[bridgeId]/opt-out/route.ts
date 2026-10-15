/**
 * T10 · `POST /api/v1/bridges/{bridgeId}/opt-out` —— 成员退出共享
 *
 *   能力 `bridge.optin`（自助）。**收窄方向**的动作，因此不受协议状态限制 ——
 *   即使协议已 `REVOKED` / 已过期，成员也必须能让自己的"已加入"标记消失。
 *   任何"因为协议已经完了所以不让你退出"的规则，都会在界面上留下一个无法消除的标记。
 *
 * 🔴 保留行（置 `WITHDRAWN`）而不是删除：「谁曾加入过、何时退出」是审计问题。
 *    投影层不依赖这行的存在与否 —— 它靠 `status === 'WITHDRAWN'` 判 `MEMBER_OPTED_OUT`。
 *
 * 语义（与服务层 `optOutBridgeMember` 一致）：
 *   - 从未加入 → 404（"你尚未加入"，不是 200 —— 静默成功会掩盖"我以为我还加入着"的错觉）
 *   - 已经退出 → 409（同上，明确告知，而不是假装成功）
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { optOutBridgeMember } from '@/lib/bridges'
import { bridgeIdOf } from '../../_shared/params'

export const POST = withTenant('bridge.optin')(async (_req: NextRequest, tenant, params) => {
  try {
    const optIn = await optOutBridgeMember(tenant, bridgeIdOf(params))
    return success({ optIn })
  } catch (error) {
    return errorResponse(error)
  }
})

/**
 * T08 · `POST /api/v1/billing/charges` —— 发起一次扣款（AC-21，**沙箱态**）
 *
 *   能力 `billing.manage`（**ADMIN+**）。
 *
 * 🔴 当前**无 Creem 凭据** ⇒ 走沙箱：不扣款，但把"本来会发出去的请求"完整返回
 *    （`requestSnapshot`）并把账本事件标为 `gatewayStatus = CAPTURED`。
 *    可证的是**金额、币种、幂等键、去向**；不可证的是 Creem 是否受理
 *    —— 那条**永久 BLOCKED**（`T08/risks.md` R1）。响应会带 `gateway` 块复述这一点。
 *
 * 🔴 有凭据却没接入真实网关时**明确 501**，而不是静默走沙箱
 *    —— 让"我配了 key"与"我在收款"绝不可能看起来一样（见 `creem.ts` 文件头）。
 *
 * 账本语义与网关现实是**两个正交的轴**（别混读）：
 *   · `state.charges[].status` —— 账本认为这笔账已结清（沙箱下也走完 PENDING → SUCCEEDED）；
 *   · `event.gatewayStatus`   —— 网关现实（沙箱下恒为 `CAPTURED`，**永不** SUCCEEDED）。
 */

import type { NextRequest } from 'next/server'
import { created, errorResponse } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { gatewayReality, startCharge } from '@/lib/billing'

export const POST = withTenant('billing.manage')(async (req: NextRequest, tenant) => {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    const amountCents = typeof body.amountCents === 'number' ? body.amountCents : Number.NaN
    if (!Number.isInteger(amountCents) || amountCents < 0) {
      throw new ValidationError('amountCents 必须是非负整数（单位：分）', {
        field: 'amountCents',
        got: body.amountCents,
      })
    }

    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (!description) {
      throw new ValidationError('description 必填（它会进账单，不能留空）', { field: 'description' })
    }

    const bodyKey = typeof body.dedupeKey === 'string' && body.dedupeKey.trim() ? body.dedupeKey.trim() : null
    const headerKey = req.headers.get('idempotency-key')?.trim() || null
    if (bodyKey && headerKey && bodyKey !== headerKey) {
      throw new ValidationError('dedupeKey 与 Idempotency-Key 头不一致', { field: 'dedupeKey' })
    }
    const dedupeKey = bodyKey ?? headerKey
    if (!dedupeKey) {
      throw new ValidationError('需要 dedupeKey 或 Idempotency-Key 头（账本不允许没有幂等键）', {
        field: 'dedupeKey',
      })
    }

    const currency = typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim() : 'USD'

    const result = await startCharge(tenant, {
      amountCents,
      description,
      currency,
      dedupeKey,
      actorId: tenant.userId ?? null,
    })

    return created({
      ...result,
      // 复述"真实收款是否可用" —— 沙箱态下这是响应里最重要的一行。
      gateway: gatewayReality(),
    })
  } catch (error) {
    return errorResponse(error)
  }
})

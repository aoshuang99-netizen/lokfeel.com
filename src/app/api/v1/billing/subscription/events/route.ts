/**
 * T08 · `POST /api/v1/billing/subscription/events` —— 追加计费事件（AC-21）
 *
 *   能力 `billing.manage`（**ADMIN+**）。事件溯源的**唯一写入面**。
 *
 * 🔴 幂等有两道，缺一不可：
 *   ① 账本层 `dedupeKey` 唯一约束 + `requestHash` 指纹 —— **同键同体 → 回放**、
 *      **同键不同体 → 409**。放在账本里（而非只放 HTTP 层）是因为脚本/回填也要受保护；
 *   ② 本端点还接受标准 `Idempotency-Key` 头作为 `dedupeKey` 的别名（与本项目
 *      `POST /missions` 等既有端点的用法一致）。两者同时给出但**不一致** → 400
 *      （那说明调用方在自相矛盾，静默取一个会让"为什么没生效"变成谜）。
 *
 * 🔴 非法迁移在服务层**写入前**被拒（409），不会污染账本 —— 见 `subscription.ts`。
 *    AC-21 点名的 `REFUNDED → SUCCEEDED` 就走这条路径。
 */

import type { NextRequest } from 'next/server'
import { created, errorResponse, success } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { hashRequest } from '@/lib/connection/idempotency'
import { BILLING_EVENT_TYPES, appendBillingEvent, type BillingEventType } from '@/lib/billing'

const GATEWAY_STATUSES = ['CAPTURED', 'SUCCEEDED', 'FAILED'] as const

/** 只接受三个已知网关状态；未知非空值 → 400（**不静默忽略**）。 */
function parseGatewayStatus(raw: unknown) {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw !== 'string') {
    throw new ValidationError('gatewayStatus 必须是字符串', { field: 'gatewayStatus' })
  }
  const v = raw.trim().toUpperCase()
  if (!(GATEWAY_STATUSES as readonly string[]).includes(v)) {
    throw new ValidationError(`unknown gatewayStatus: ${raw}`, { field: 'gatewayStatus' })
  }
  return v as (typeof GATEWAY_STATUSES)[number]
}

function str(body: Record<string, unknown>, key: string): string | null {
  const v = body[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

export const POST = withTenant('billing.manage')(async (req: NextRequest, tenant) => {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    const rawType = str(body, 'type')
    const type = (rawType ?? '').toUpperCase()
    if (!(BILLING_EVENT_TYPES as readonly string[]).includes(type)) {
      throw new ValidationError(`unknown billing event type: ${rawType ?? '(missing)'}`, { field: 'type' })
    }

    // 幂等键：body.dedupeKey 与 Idempotency-Key 头互为别名（但必须一致）。
    const bodyKey = str(body, 'dedupeKey')
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

    const plan = str(body, 'plan')
    const chargeId = str(body, 'chargeId')
    const currency = str(body, 'currency')
    const reason = str(body, 'reason')
    const amountCents = typeof body.amountCents === 'number' ? body.amountCents : null

    const result = await appendBillingEvent(tenant, {
      type: type as BillingEventType,
      plan,
      chargeId,
      amountCents,
      currency,
      reason,
      gatewayStatus: parseGatewayStatus(body.gatewayStatus),
      dedupeKey,
      // 指纹取自**业务字段**（不含 dedupeKey 本身）：同键换个金额/方案 ⇒ 不同意图 ⇒ 409。
      requestHash: hashRequest({ type, plan, chargeId, amountCents, currency, reason }),
      actorId: tenant.userId ?? null,
    })

    return created({
      event: result.event,
      /** true = 命中已有事件（本次未新增）—— 与项目既有幂等端点的语义一致。 */
      replayed: result.replayed,
      state: result.state,
    })
  } catch (error) {
    return errorResponse(error)
  }
})

/**
 * 便于人工核对：列出本端点接受的事件类型。
 *
 * ⚠️ 这里**刻意不声明** `req` / `tenant` 形参：本端点不需要它们，而 eslint 的
 * `no-unused-vars`（`args: 'after-used'`）会报"末尾未使用的形参"。
 * `withTenant` 的 handler 类型允许少声明形参，故留空是最干净的写法。
 * （等价写法 `async (_req, tenant) => …` 只在**同时用到 tenant**时才不报警 —— 见同目录
 * 的 `subscription/route.ts`。）
 */
export const GET = withTenant('billing.read')(async () => {
  return success({ eventTypes: [...BILLING_EVENT_TYPES] })
})

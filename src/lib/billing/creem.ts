/**
 * T08 · Creem 计费网关 —— **沙箱适配器**（AC-21）
 *
 * ═══════════════════════════════════════════════════════════════
 * 这个文件的存在理由：把"能证明的"与"证明不了的"分开
 * ═══════════════════════════════════════════════════════════════
 * 主指令：**「没有真实凭据的流程只能标记 MOCKED / BLOCKED，不能标记 PASSED」**。
 * 本项目已有一次正确先例（T06 的邮件出口 `delivery.ts`）：无 `RESEND_API_KEY` 时
 * **不发送**，但把"要发什么"完整落库（`status = CAPTURED`）。于是"内容是否合规"这条
 * 判据可以在**没有外部凭据**的情况下被真实验证，只有"真实外发"标 BLOCKED。
 *
 * 本适配器照办：
 *   · 无 Creem 凭据（当前状态）→ **不扣款**，但把"本来会发出去的请求"完整构造出来
 *     并落库（`gatewayStatus = CAPTURED` + `providerRef = sandbox:<指纹>`）。
 *     可证的是：**金额、币种、幂等键、去向**这些"要发什么"。
 *     不可证的是：Creem 是否受理 —— 那条**永久 BLOCKED**（`T08/risks.md` R1）。
 *   · 有凭据 → 🔴 **明确报 501，而不是静默走沙箱**。
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔴 为什么"有凭据时静默走沙箱"是最坏的选项
 * ═══════════════════════════════════════════════════════════════
 * 那会让"我配了 key"与"我在收款"看起来完全一样：账面上有 `CHARGE_SUCCEEDED`、
 * 用户看到已订阅、运营看到收入 —— 而钱一分没动。等到有人对账时，**没有任何日志或
 * 状态能指出是哪一天开始错的**。故凭据存在而真实接入未实现时，必须**响亮地失败**：
 *   501 Not Implemented + 明确说明"网关接入点尚未实现，请勿在此时收款"。
 * 这不是"功能缺失"，而是把未知**限制在一个可枚举的边界上**。
 *
 * ⚠️ 真实接入点**刻意不猜**：Creem 的接口形状必须在拿到凭据后按其**官方文档**实现
 *    并用真实沙箱凭据跑通（含 webhook 回执对账）。凭猜写的 HTTP 调用即使单测全绿，
 *    也只是在验证我们自己的想象 —— 那比没有更危险。
 */

import { ApiError, ValidationError } from '@/lib/errors'

/** 网关侧结果（会原样落进 `BillingEvent.gatewayStatus`）。 */
export type CreemGatewayStatus = 'CAPTURED' | 'SUCCEEDED' | 'FAILED'

export interface CreemCredentials {
  apiKey: string
  webhookSecret: string
}

export interface CreemChargeInput {
  organizationId: string
  /** 账本侧的款项 id（`BillingEvent.chargeId`）。 */
  chargeId: string
  amountCents: number
  currency: string
  /** 人类可读描述（进账单）。 */
  description: string
}

export interface CreemChargeResult {
  gatewayStatus: CreemGatewayStatus
  /** 网关回执引用。沙箱下是请求指纹（**不是**回执，故前缀 `sandbox:` 让它一眼可辨）。 */
  providerRef: string
  /** 失败原因（`FAILED` 时非空）。 */
  reason: string | null
  /**
   * 「本来会发出去的请求」的完整快照。
   * 沙箱下这就是**唯一可证的东西** —— 测试会逐字段断言它。
   */
  requestSnapshot: Record<string, unknown>
}

/**
 * 未接入真实网关时抛这个（映射为 501）。
 * 与"凭据缺失"区分开：缺凭据是**正常沙箱态**，未接入是**明确的未实现**。
 */
export class BillingGatewayNotImplementedError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(501, message, { code: 'GATEWAY_NOT_IMPLEMENTED', ...details })
    this.name = 'BillingGatewayNotImplementedError'
  }
}

/** 解析凭据。返回 `null` = 没有可用凭据 → 调用方走沙箱捕获（**不**伪造成功）。 */
export function resolveCreemCredentials(
  env: Record<string, string | undefined> = process.env
): CreemCredentials | null {
  const apiKey = (env.CREEM_API_KEY || '').trim()
  const webhookSecret = (env.CREEM_WEBHOOK_SECRET || '').trim()
  // 两个都要齐：只有 apiKey 而没有 webhookSecret 时无法校验回执，
  // 那种"半个凭据"状态比没有更危险（会让人以为可以收款）。
  if (!apiKey || !webhookSecret) return null
  return { apiKey, webhookSecret }
}

/** 凭据是否**部分**存在（用于给出"半配置"的精确告警，而不是笼统的"没配"）。 */
export function describeMissingCredentials(
  env: Record<string, string | undefined> = process.env
): string[] {
  const missing: string[] = []
  if (!(env.CREEM_API_KEY || '').trim()) missing.push('CREEM_API_KEY')
  if (!(env.CREEM_WEBHOOK_SECRET || '').trim()) missing.push('CREEM_WEBHOOK_SECRET')
  return missing
}

/**
 * 构造"要发出去的请求"。**纯函数**，沙箱与真实模式**共用同一份构造** ——
 * 否则沙箱证明的形状与实际发出的形状会漂移，而沙箱的全部价值就在于它等于真实请求。
 *
 * ⚠️ 字段名刻意用**中性命名**（`amount`/`currency`/`reference`），并显式标注为
 *    "待按 Creem 官方文档校准"：现在不可能校准对，写死一套想象中的字段名会给人
 *    "已经对接好了"的错觉。凭据到位后**只改本函数**，其余逻辑不动。
 */
export function buildCreemChargeRequest(input: CreemChargeInput): Record<string, unknown> {
  if (!Number.isFinite(input.amountCents) || input.amountCents < 0) {
    throw new ValidationError('amountCents 必须是非负整数（单位：分）', {
      field: 'amountCents',
      got: input.amountCents,
    })
  }
  const currency = (input.currency || 'USD').toUpperCase()
  return {
    // TODO(creem): 字段名待按 Creem 官方文档校准（见文件头"刻意不猜"）。
    amount: input.amountCents,
    currency,
    reference: input.chargeId,
    description: input.description,
    metadata: {
      organizationId: input.organizationId,
      chargeId: input.chargeId,
    },
  }
}

/** 请求指纹（稳定序列化后哈希）。沙箱下作为 `providerRef`，让"同一次请求"可被断言。 */
export function fingerprintRequest(request: Record<string, unknown>): string {
  const stable = JSON.stringify(sortDeep(request))
  // 只做同步纯计算，避免引入 crypto 的异步面；这是**标识**不是安全边界。
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < stable.length; i++) {
    const c = stable.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

export interface CreemChargeDeps {
  env?: Record<string, string | undefined>
  /**
   * 真实网关的传输实现（**尚未提供**）。留作接入缝隙：
   * 接入时只需提供它 + 补 `buildCreemChargeRequest` 的字段名，本文件其余部分不变。
   */
  transport?: CreemTransport
}

export interface CreemTransport {
  (req: {
    url: string
    method: string
    headers: Record<string, string>
    body: string
  }): Promise<{ status: number; text: string }>
}

/**
 * 发起一次扣款。
 *
 * 三条分支（互斥且穷尽）：
 *   ① **无凭据** → `CAPTURED`（沙箱）：不扣款，返回请求快照与指纹。
 *   ② **有凭据 + 有 transport** → 真实调用（当前**不可能走到**，因为没实现 transport）。
 *   ③ **有凭据 + 无 transport** → 🔴 **501**（见文件头：比静默沙箱安全得多）。
 */
export async function createCreemCharge(
  input: CreemChargeInput,
  deps: CreemChargeDeps = {}
): Promise<CreemChargeResult> {
  const requestSnapshot = buildCreemChargeRequest(input)
  const creds = resolveCreemCredentials(deps.env ?? process.env)

  if (!creds) {
    // ① 沙箱：捕获"要发什么"，绝不冒充已扣款。
    return {
      gatewayStatus: 'CAPTURED',
      providerRef: `sandbox:${fingerprintRequest(requestSnapshot)}`,
      reason: null,
      requestSnapshot,
    }
  }

  if (!deps.transport) {
    // ③ 有凭据但真实接入未实现 —— 响亮失败。
    throw new BillingGatewayNotImplementedError(
      '检测到 Creem 凭据，但真实网关接入点尚未实现：拒绝以沙箱代替真实扣款',
      { missing: 'CreemTransport' }
    )
  }

  // ② 真实调用（接入时启用）。
  const res = await deps.transport({
    url: 'https://api.creem.io/v1/charges', // TODO(creem): 待按官方文档校准
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestSnapshot),
  })

  if (res.status >= 200 && res.status < 300) {
    let providerRef = `creem:${fingerprintRequest(requestSnapshot)}`
    try {
      const parsed = JSON.parse(res.text) as { id?: unknown }
      if (typeof parsed?.id === 'string' && parsed.id) providerRef = parsed.id
    } catch {
      // 回执不是 JSON 也要保留成功判定，但 providerRef 退化为请求指纹
      // —— 关键是**不吞掉**成功事实，也不伪造回执 id。
    }
    return { gatewayStatus: 'SUCCEEDED', providerRef, reason: null, requestSnapshot }
  }

  return {
    gatewayStatus: 'FAILED',
    providerRef: `creem:${fingerprintRequest(requestSnapshot)}`,
    reason: `gateway_http_${res.status}`,
    requestSnapshot,
  }
}

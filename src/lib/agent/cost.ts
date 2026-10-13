/**
 * T09 · Agent Runtime —— 成本账本与限额判定（**纯函数**）
 *
 * 目的（AC-20）：**每次调用可归因** + **限额触发时停止高成本任务**。
 *
 * 两个刻意的设计：
 *
 *   1. **金额用整数"微分"结算，不用浮点分**。
 *      浮点累加会让"对账"变成"看运气"（T08 立的口径：指标必须可复算）。
 *      1 分 = 1_000_000 微分；单价表也以微分声明。
 *
 *   2. **单价表是"声明式假设"，可注入**。
 *      与 T08「假设随响应下发」同一取向：单价变了，结果**必须**跟着变
 *      （否则无法做变异自证："改单价 → 汇总不变" 就说明单价根本没被用）。
 *      ⚠️ `DEFAULT_PRICE_TABLE` 是**占位假设**，不是任何供应商的真实报价。
 *
 *   3. **限额判定发生在"发起调用之前"**（`checkQuota`）。
 *      判定放在调用之后等于"已经花了钱才发现超限" —— 那不是限额，是事后通知。
 */

import type { ProviderKind, RiskLevel } from './types'

/** 单价表：微分 / 1K token。占位假设，真实部署必须按供应商报价注入。 */
export interface PriceTable {
  inputMicroCentsPerK: number
  outputMicroCentsPerK: number
}

/** 1 分 = 1_000_000 微分。 */
export const MICRO_CENTS_PER_CENT = 1_000_000

export const DEFAULT_PRICE_TABLE: Readonly<PriceTable> = {
  inputMicroCentsPerK: 15_000,
  outputMicroCentsPerK: 60_000,
}

export interface ModelUsage {
  inputTokens: number
  outputTokens: number
}

export const ZERO_USAGE: Readonly<ModelUsage> = { inputTokens: 0, outputTokens: 0 }

/** 一次调用的归因记录。`highCost` 落进记录，使"高成本调用次数"**可从账本本身推出**。 */
export interface AgentCallRecord {
  skill: string
  providerKind: ProviderKind
  risk: RiskLevel
  /** 该技能是否属"高成本"（AC-20 里"停止高成本任务"判定的对象）。 */
  highCost: boolean
  /** 是否成功（失败的调用**也记账** —— 否则"失败不花钱"这个假设没人验证过）。 */
  ok: boolean
  usage: ModelUsage
  microCents: number
  at: string
}

export interface LedgerSnapshot {
  readonly calls: readonly AgentCallRecord[]
}

export const EMPTY_LEDGER: LedgerSnapshot = { calls: [] }

/** 单价 × 用量 → 微分（整数，四舍五入到 1 微分）。 */
export function costMicroCents(usage: ModelUsage, price: PriceTable = DEFAULT_PRICE_TABLE): number {
  const raw =
    (usage.inputTokens * price.inputMicroCentsPerK + usage.outputTokens * price.outputMicroCentsPerK) / 1000
  return Math.round(raw)
}

/** 微分 → 可读的"分"（仅用于展示，不参与计算）。 */
export function microCentsToCents(micro: number): number {
  return micro / MICRO_CENTS_PER_CENT
}

/** 微分 → 可读字符串，如 `0.0150 分`。 */
export function formatMicroCents(micro: number): string {
  return `${microCentsToCents(micro).toFixed(4)} 分`
}

export interface LedgerTotals {
  calls: number
  okCalls: number
  failedCalls: number
  highCostCalls: number
  inputTokens: number
  outputTokens: number
  microCents: number
  bySkill: Record<string, { calls: number; microCents: number }>
}

/** 汇总（纯函数，输入相同则输出相同 —— 对账脚本依赖这一点）。 */
export function ledgerTotals(snapshot: LedgerSnapshot): LedgerTotals {
  const totals: LedgerTotals = {
    calls: 0,
    okCalls: 0,
    failedCalls: 0,
    highCostCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    microCents: 0,
    bySkill: {},
  }
  for (const c of snapshot.calls) {
    totals.calls += 1
    if (c.ok) totals.okCalls += 1
    else totals.failedCalls += 1
    if (c.highCost) totals.highCostCalls += 1
    totals.inputTokens += c.usage.inputTokens
    totals.outputTokens += c.usage.outputTokens
    totals.microCents += c.microCents
    const bucket = totals.bySkill[c.skill] ?? { calls: 0, microCents: 0 }
    bucket.calls += 1
    bucket.microCents += c.microCents
    totals.bySkill[c.skill] = bucket
  }
  return totals
}

/** 追加一条记录（返回**新**快照，不修改入参）。 */
export function appendCall(snapshot: LedgerSnapshot, record: AgentCallRecord): LedgerSnapshot {
  return { calls: [...snapshot.calls, record] }
}

export interface AgentQuota {
  /** 总额度（微分）。 */
  maxMicroCents: number
  /** 高成本调用次数上限（"限额触发时停止高成本任务"的落点）。 */
  maxHighCostCalls: number
}

export const DEFAULT_QUOTA: Readonly<AgentQuota> = {
  maxMicroCents: 500 * MICRO_CENTS_PER_CENT, // 500 分
  maxHighCostCalls: 20,
}

export type QuotaRefusalCode = 'INSUFFICIENT_BUDGET' | 'HIGH_COST_CALL_LIMIT'

export type QuotaDecision =
  | { allowed: true; estimateMicroCents: number }
  | { allowed: false; code: QuotaRefusalCode; reason: string; estimateMicroCents: number }

/** 预估一次调用的成本（**必须在调用前**用它做判定）。 */
export function estimateMicroCents(
  costProfile: { estimatedInputTokens: number; estimatedOutputTokens: number },
  price: PriceTable = DEFAULT_PRICE_TABLE,
): number {
  return costMicroCents(
    { inputTokens: costProfile.estimatedInputTokens, outputTokens: costProfile.estimatedOutputTokens },
    price,
  )
}

/**
 * 限额判定。
 *
 * 🔴 **这是唯一的放行点**：`allowed: false` → 调用方**不得**发起模型调用。
 * 两条判据都取**严**（额度/次数任一触顶即拒），并且**不做静默降级**
 * —— "偷偷用更便宜的模型把活干完"会让账本与实际不符，那是账本污染，不是省钱。
 */
export function checkQuota(
  snapshot: LedgerSnapshot,
  quota: AgentQuota,
  skill: {
    key: string
    highCost: boolean
    costProfile: { estimatedInputTokens: number; estimatedOutputTokens: number }
  },
  price: PriceTable = DEFAULT_PRICE_TABLE,
): QuotaDecision {
  const estimate = estimateMicroCents(skill.costProfile, price)
  const totals = ledgerTotals(snapshot)

  if (totals.microCents + estimate > quota.maxMicroCents) {
    return {
      allowed: false,
      code: 'INSUFFICIENT_BUDGET',
      reason:
        `额度不足：已用 ${formatMicroCents(totals.microCents)} + 本次预估 ${formatMicroCents(estimate)} ` +
        `> 上限 ${formatMicroCents(quota.maxMicroCents)}。`,
      estimateMicroCents: estimate,
    }
  }

  if (skill.highCost && totals.highCostCalls >= quota.maxHighCostCalls) {
    return {
      allowed: false,
      code: 'HIGH_COST_CALL_LIMIT',
      reason: `高成本调用已达上限（${totals.highCostCalls}/${quota.maxHighCostCalls}），停止高成本任务（AC-20）。`,
      estimateMicroCents: estimate,
    }
  }

  return { allowed: true, estimateMicroCents: estimate }
}

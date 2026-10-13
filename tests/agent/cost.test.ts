/**
 * T09 · 成本账本与限额（AC-20）
 *
 * 重点：
 *   - 金额用**整数微分**结算（可复算，不受浮点漂移影响）；
 *   - **单价表可注入**（改单价必须让结果变 → 否则说明单价根本没被用）；
 *   - 限额判定在**调用之前**，且高成本任务单独计数。
 */

import {
  DEFAULT_PRICE_TABLE,
  MICRO_CENTS_PER_CENT,
  ZERO_USAGE,
  appendCall,
  checkQuota,
  costMicroCents,
  estimateMicroCents,
  formatMicroCents,
  ledgerTotals,
  microCentsToCents,
  type AgentCallRecord,
  type AgentQuota,
  type LedgerSnapshot,
  type PriceTable,
} from '@/lib/agent'

const skill = {
  key: 'INTRO_DRAFT',
  highCost: true,
  costProfile: { estimatedInputTokens: 1000, estimatedOutputTokens: 1000 },
}

const cheapSkill = {
  key: 'INTENT_EXTRACTION',
  highCost: false,
  costProfile: { estimatedInputTokens: 1000, estimatedOutputTokens: 1000 },
}

function record(over: Partial<AgentCallRecord> = {}): AgentCallRecord {
  return {
    skill: 'INTENT_EXTRACTION',
    providerKind: 'stub',
    risk: 'LOW',
    highCost: false,
    ok: true,
    usage: { inputTokens: 1000, outputTokens: 0 },
    microCents: 15_000,
    at: '2026-10-13T00:00:00.000Z',
    ...over,
  }
}

describe('costMicroCents', () => {
  it('按单价折算且为整数（无浮点尾数）', () => {
    const micro = costMicroCents({ inputTokens: 1_000_000, outputTokens: 0 }, DEFAULT_PRICE_TABLE)
    expect(Number.isInteger(micro)).toBe(true)
    // 1,000,000 token × 15,000 微分/1K = 15,000,000 微分 = 15 分
    expect(microCentsToCents(micro)).toBeCloseTo(15, 6)
  })

  it('零用量 → 0', () => {
    expect(costMicroCents(ZERO_USAGE)).toBe(0)
  })

  it('单价表可注入，且改单价结果必须变（否则单价没被用）', () => {
    const baseline = costMicroCents({ inputTokens: 1000, outputTokens: 0 }, DEFAULT_PRICE_TABLE)
    const doubled: PriceTable = {
      inputMicroCentsPerK: DEFAULT_PRICE_TABLE.inputMicroCentsPerK * 2,
      outputMicroCentsPerK: DEFAULT_PRICE_TABLE.outputMicroCentsPerK * 2,
    }
    const after = costMicroCents({ inputTokens: 1000, outputTokens: 0 }, doubled)
    expect(after).toBe(baseline * 2)
  })
})

describe('ledgerTotals', () => {
  it('空账本全为 0', () => {
    const t = ledgerTotals({ calls: [] })
    expect(t).toMatchObject({ calls: 0, okCalls: 0, failedCalls: 0, highCostCalls: 0, microCents: 0 })
  })

  it('按技能分桶，且失败也计入', () => {
    const ledger: LedgerSnapshot = {
      calls: [
        record(),
        record({ ok: false, microCents: 5_000 }),
        record({ skill: 'INTRO_DRAFT', highCost: true, microCents: 60_000 }),
      ],
    }
    const t = ledgerTotals(ledger)
    expect(t.calls).toBe(3)
    expect(t.okCalls).toBe(2)
    expect(t.failedCalls).toBe(1)
    expect(t.highCostCalls).toBe(1)
    expect(t.microCents).toBe(80_000)
    expect(t.bySkill.INTENT_EXTRACTION).toEqual({ calls: 2, microCents: 20_000 })
  })

  it('appendCall 不修改入参（返回新快照）', () => {
    const base: LedgerSnapshot = { calls: [] }
    const next = appendCall(base, record())
    expect(base.calls).toHaveLength(0)
    expect(next.calls).toHaveLength(1)
  })
})

describe('checkQuota（必须在调用之前用）', () => {
  const quota: AgentQuota = { maxMicroCents: 100_000, maxHighCostCalls: 2 }
  /**
   * 额度给足、**只让"高成本次数"成为唯一约束**的配额。
   * 若沿用上面的 `quota`（100_000 微分），本次预估（75_000 微分）会先把预算顶破，
   * 于是先返回 `INSUFFICIENT_BUDGET` —— 那样测到的是预算判据，**测不到**本判据。
   */
  const ampleBudget: AgentQuota = { maxMicroCents: 10_000_000, maxHighCostCalls: 2 }

  it('额度充足时放行，并给出本次预估', () => {
    const d = checkQuota({ calls: [] }, quota, skill)
    expect(d.allowed).toBe(true)
    if (d.allowed) expect(d.estimateMicroCents).toBeGreaterThan(0)
  })

  it('预估会把总额顶破上限 → 拒绝，而不是"先跑再说"', () => {
    const ledger: LedgerSnapshot = { calls: [record({ microCents: 99_000 })] }
    const d = checkQuota(ledger, quota, skill)
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.code).toBe('INSUFFICIENT_BUDGET')
  })

  it('高成本调用次数触顶 → 停止高成本任务（AC-20）', () => {
    const ledger: LedgerSnapshot = {
      calls: [record({ highCost: true }), record({ highCost: true })],
    }
    const d = checkQuota(ledger, ampleBudget, skill)
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.code).toBe('HIGH_COST_CALL_LIMIT')
  })

  it('高成本触顶只拦高成本技能，**不**拦低成本技能', () => {
    const ledger: LedgerSnapshot = { calls: [record({ highCost: true }), record({ highCost: true })] }
    expect(checkQuota(ledger, ampleBudget, cheapSkill).allowed).toBe(true)
  })

  it('拒绝原因里带可核对的两个数字（已用 / 上限）', () => {
    const ledger: LedgerSnapshot = { calls: [record({ microCents: quota.maxMicroCents })] }
    const d = checkQuota(ledger, quota, cheapSkill)
    expect(d.allowed).toBe(false)
    if (!d.allowed) {
      expect(d.reason).toContain(formatMicroCents(quota.maxMicroCents))
    }
  })

  it('estimateMicroCents 与单价表一致（可注入）', () => {
    const doubled: PriceTable = {
      inputMicroCentsPerK: DEFAULT_PRICE_TABLE.inputMicroCentsPerK * 2,
      outputMicroCentsPerK: DEFAULT_PRICE_TABLE.outputMicroCentsPerK * 2,
    }
    expect(estimateMicroCents(skill.costProfile, doubled)).toBe(estimateMicroCents(skill.costProfile) * 2)
  })

  it('MICRO_CENTS_PER_CENT 常量自洽', () => {
    expect(microCentsToCents(MICRO_CENTS_PER_CENT)).toBe(1)
  })
})

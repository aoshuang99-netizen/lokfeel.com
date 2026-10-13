/**
 * T08 · 商业指标**纯函数内核**（AC-16）
 *
 * 本文件证明三件事：
 *   ① **每个数字都是输入计数的确定性函数** —— 同输入同输出（可复算的前提）；
 *   ② **假设真的被用上了** —— 换一组 assumptions 必须让工时/成本跟着变
 *      （否则"可配置"就是假的，等价于写死）；
 *   ③ **AC-15 与 AC-16 不脱节** —— 指标里"已验证"用的级别集合**不含** `SELF_REPORTED`，
 *      与 `isVerified()` 是同一个判据。否则会出现"成果页说未验证、指标说已验证"。
 */

import {
  METRIC_ASSUMPTIONS,
  METRIC_UNITS,
  computeOutcomeMetrics,
  percent,
  round1,
  round2,
  unitsOf,
  type MetricAssumptions,
  type OutcomeMetricCounts,
} from '@/lib/outcome/metrics'
import { VERIFIED_LEVELS, isVerified } from '@/lib/outcome/verification'

/** 一组"每个字段都不同、都非 0"的计数 —— 谁被漏算都会立刻显形。 */
const COUNTS: OutcomeMetricCounts = {
  proposals: 10,
  consentPending: 4,
  mutuallyAccepted: 6,
  introduced: 3,
  outcomesReported: 2,
  outcomesVerified: 1,
  takeovers: 2,
  deadLettered: 1,
}

const ZERO: OutcomeMetricCounts = {
  proposals: 0,
  consentPending: 0,
  mutuallyAccepted: 0,
  introduced: 0,
  outcomesReported: 0,
  outcomesVerified: 0,
  takeovers: 0,
  deadLettered: 0,
}

describe('数值工具 —— 确定性舍入', () => {
  it('percent：正常换算保留 1 位小数', () => {
    expect(percent(6, 10)).toBe(60)
    expect(percent(1, 3)).toBe(33.3)
    expect(percent(2, 3)).toBe(66.7)
  })

  it('🔴 percent：分母为 0 → 0（不是 NaN / null —— 界面出现 NaN% 比 0% 更糟）', () => {
    expect(percent(5, 0)).toBe(0)
    expect(percent(0, 0)).toBe(0)
    expect(percent(-3, 0)).toBe(0)
  })

  it('percent：非有限输入 → 0（防御 DB 返回异常值）', () => {
    expect(percent(Number.NaN, 10)).toBe(0)
    expect(percent(1, Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('round1 / round2 用整数运算，不依赖 toFixed 的二进制边缘行为', () => {
    expect(round1(66.66)).toBe(66.7)
    expect(round1(0.04)).toBe(0)
    expect(round2(45 / 60)).toBe(0.75)
    expect(round2(1.234)).toBe(1.23)
  })
})

describe('unitsOf —— 成本单元的映射是唯一事实来源', () => {
  it('四个单元分别取自哪个计数（改错一个就会让成本对不上）', () => {
    expect(unitsOf(COUNTS)).toEqual({
      proposal: 10,
      introduction: 3,
      outcome: 2,
      // 「核验」按**已验证成果数**计费，不是验证记录条数（见 metrics.ts 注释）
      verification: 1,
    })
  })
})

describe('computeOutcomeMetrics —— 漏斗', () => {
  it('计数原样透传（不做任何再解释）', () => {
    const m = computeOutcomeMetrics(COUNTS)
    expect(m.funnel.proposals).toBe(10)
    expect(m.funnel.consentPending).toBe(4)
    expect(m.funnel.mutuallyAccepted).toBe(6)
    expect(m.funnel.introduced).toBe(3)
    expect(m.funnel.outcomesReported).toBe(2)
    expect(m.funnel.outcomesVerified).toBe(1)
  })

  it('四段转化率各用正确的分母（分母写错是最常见、最隐蔽的错）', () => {
    const m = computeOutcomeMetrics(COUNTS)
    expect(m.funnel.rates).toEqual({
      acceptedPerProposal: 60, // 6/10
      introducedPerAccepted: 50, // 3/6
      outcomePerIntroduced: 66.7, // 2/3
      verifiedPerOutcome: 50, // 1/2
    })
  })

  it('全 0 输入 → 全部比率 0（不是 NaN）', () => {
    const m = computeOutcomeMetrics(ZERO)
    expect(m.funnel.rates).toEqual({
      acceptedPerProposal: 0,
      introducedPerAccepted: 0,
      outcomePerIntroduced: 0,
      verifiedPerOutcome: 0,
    })
    expect(m.cost.totalCostCents).toBe(0)
    expect(m.workload.estimatedHumanMinutes).toBe(0)
  })

  it('防御：负数 / NaN / undefined 计数一律收敛为 0', () => {
    const m = computeOutcomeMetrics({
      proposals: -5,
      consentPending: Number.NaN,
      mutuallyAccepted: 1.9,
      introduced: 3,
      outcomesReported: 0,
      outcomesVerified: 0,
      takeovers: undefined as unknown as number,
      deadLettered: 2,
    })
    expect(m.funnel.proposals).toBe(0)
    expect(m.funnel.consentPending).toBe(0)
    expect(m.funnel.mutuallyAccepted).toBe(1)
    expect(m.workload.takeovers).toBe(0)
    expect(m.workload.deadLettered).toBe(2)
  })
})

describe('computeOutcomeMetrics —— 人工工时', () => {
  it('interventions = 接管 + 死信；工时 = 介入数 × 每次分钟数', () => {
    const m = computeOutcomeMetrics(COUNTS)
    expect(m.workload.interventions).toBe(3) // 2 + 1
    expect(m.workload.minutesPerIntervention).toBe(METRIC_ASSUMPTIONS.minutesPerIntervention)
    expect(m.workload.estimatedHumanMinutes).toBe(45) // 3 × 15
    expect(m.workload.estimatedHumanHours).toBe(0.75)
  })

  it('🔴 变异自证：换掉"每次介入分钟数"必须让工时跟着变（否则假设是写死的摆设）', () => {
    const fake: MetricAssumptions = {
      ...METRIC_ASSUMPTIONS,
      minutesPerIntervention: 60,
    }
    const m = computeOutcomeMetrics(COUNTS, { assumptions: fake })
    expect(m.workload.minutesPerIntervention).toBe(60)
    expect(m.workload.estimatedHumanMinutes).toBe(180) // 3 × 60
    expect(m.workload.estimatedHumanHours).toBe(3)
  })
})

describe('computeOutcomeMetrics —— 任务成本', () => {
  it('逐项 = 单元数 × 单价；总额 = 各项之和（整数分累加）', () => {
    const m = computeOutcomeMetrics(COUNTS)
    const byUnit = Object.fromEntries(m.cost.lineItems.map((i) => [i.unit, i]))
    expect(byUnit.proposal.costCents).toBe(10 * 20)
    expect(byUnit.introduction.costCents).toBe(3 * 500)
    expect(byUnit.outcome.costCents).toBe(2 * 300)
    expect(byUnit.verification.costCents).toBe(1 * 100)

    const sum = m.cost.lineItems.reduce((s, i) => s + i.costCents, 0)
    expect(m.cost.totalCostCents).toBe(sum)
    expect(m.cost.totalCostCents).toBe(200 + 1500 + 600 + 100)
    expect(m.cost.totalCost).toBe(24) // 2400 分 = 24.00
    expect(m.cost.currency).toBe(METRIC_ASSUMPTIONS.currency)
  })

  it('lineItems 覆盖全部单元且顺序稳定（对账脚本按顺序逐项比对）', () => {
    const m = computeOutcomeMetrics(COUNTS)
    expect(m.cost.lineItems.map((i) => i.unit)).toEqual([...METRIC_UNITS])
  })

  it('🔴 变异自证：换掉单价必须让总额跟着变', () => {
    const fake: MetricAssumptions = {
      ...METRIC_ASSUMPTIONS,
      currency: 'CNY',
      unitCostsCents: { proposal: 1, introduction: 1, outcome: 1, verification: 1 },
    }
    const m = computeOutcomeMetrics(COUNTS, { assumptions: fake })
    expect(m.currency).toBe('CNY')
    expect(m.cost.totalCostCents).toBe(10 + 3 + 2 + 1)
    expect(m.cost.totalCost).toBe(0.16)
  })
})

describe('computeOutcomeMetrics —— 自描述与 AC-15 的衔接', () => {
  it('basis.assumptions 随响应下发（对账脚本据此复算，不必硬编码）', () => {
    const m = computeOutcomeMetrics(COUNTS)
    expect(m.basis.assumptions).toEqual(METRIC_ASSUMPTIONS)
  })

  it('🔴 verifiedLevels 不含 SELF_REPORTED —— 与 isVerified 同一判据', () => {
    const m = computeOutcomeMetrics(COUNTS)
    expect(m.basis.verifiedLevels).toEqual([...VERIFIED_LEVELS])
    expect(m.basis.verifiedLevels).not.toContain('SELF_REPORTED')
    // 自证：判据本身
    expect(isVerified('SELF_REPORTED')).toBe(false)
    for (const level of m.basis.verifiedLevels) {
      expect(isVerified(level)).toBe(true)
    }
  })

  it('scope 恒为 all-time，missionId 原样回显（口径自描述）', () => {
    expect(computeOutcomeMetrics(COUNTS).basis.scope).toBe('all-time')
    expect(computeOutcomeMetrics(COUNTS).basis.missionId).toBe(null)
    expect(computeOutcomeMetrics(COUNTS, { missionId: 'm_9' }).basis.missionId).toBe('m_9')
  })

  it('纯：同输入两次调用结果完全相同', () => {
    expect(computeOutcomeMetrics(COUNTS)).toEqual(computeOutcomeMetrics(COUNTS))
  })

  it('空输入对象也能算（服务层查询尚未返回时的健壮性）', () => {
    const m = computeOutcomeMetrics({} as OutcomeMetricCounts)
    expect(m.funnel.proposals).toBe(0)
    expect(m.cost.lineItems).toHaveLength(METRIC_UNITS.length)
  })
})

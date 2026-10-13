/**
 * T08 · 用量口径内核测试（AC-21「使用量可复算」的机械前提）
 *
 * 三类断言：
 *   ① **词表同源** —— 用量单元必须与指标单元逐项一致（否则"介绍 3 次"会出现两个数）；
 *   ② **期次确定** —— UTC 自然月、上界开、跨年正确（对账脚本拿它当等值谓词）；
 *   ③ **限额边界** —— 用满（`>=`）与超额（`>`）必须分开（合成一个会超卖或误报）。
 */

import { METRIC_UNITS } from '@/lib/outcome/metrics'
import type { PlanLimits } from '@/lib/billing/plans'
import {
  DB_TO_USAGE_UNIT,
  USAGE_UNITS,
  USAGE_UNIT_TO_DB,
  aggregateUsage,
  emptyUsageTotals,
  evaluateLimits,
  parsePeriodKey,
  parseUsageUnit,
  periodBoundsOf,
  periodKeyOf,
  shiftPeriodKey,
  usageDedupeKey,
  usageSourceRefOf,
  usageSourceTypeOf,
} from '@/lib/billing/usage'

describe('词表同源（防漂移）', () => {
  it('USAGE_UNITS 与 METRIC_UNITS 逐项相等（含顺序）', () => {
    expect(USAGE_UNITS).toEqual(METRIC_UNITS)
  })

  it('指标口径 ↔ 数据库枚举是双射，且往返一致', () => {
    expect(Object.keys(USAGE_UNIT_TO_DB).sort()).toEqual([...USAGE_UNITS].sort())
    for (const unit of USAGE_UNITS) {
      const db = USAGE_UNIT_TO_DB[unit]
      expect(DB_TO_USAGE_UNIT[db]).toBe(unit)
    }
  })

  it('数据库枚举映射值就是大写单元名（没有第二套命名）', () => {
    for (const unit of USAGE_UNITS) {
      expect(USAGE_UNIT_TO_DB[unit]).toBe(unit.toUpperCase())
    }
  })

  it('来源类型 = 单元名（对账脚本按 sourceType 分组时依赖这条）', () => {
    for (const unit of USAGE_UNITS) {
      expect(usageSourceTypeOf(unit)).toBe(unit)
      expect(usageSourceRefOf(unit, 'x1')).toEqual({ unit, sourceType: unit, sourceId: 'x1' })
    }
  })

  it('parseUsageUnit：大小写不敏感；未知值 → null', () => {
    expect(parseUsageUnit('proposal')).toBe('proposal')
    expect(parseUsageUnit('INTRODUCTION')).toBe('introduction')
    expect(parseUsageUnit(' storage ')).toBeNull()
    expect(parseUsageUnit(null)).toBeNull()
  })

  it('usageDedupeKey：`<unit>:<sourceId>`', () => {
    expect(usageDedupeKey('introduction', 'p_123')).toBe('introduction:p_123')
  })
})

describe('期次（UTC 自然月）', () => {
  it('periodKeyOf：年月补零，取 UTC', () => {
    expect(periodKeyOf(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01')
    expect(periodKeyOf(new Date('2026-10-31T23:59:59.999Z'))).toBe('2026-10')
    expect(periodKeyOf(new Date('2026-09-01T00:00:00Z'))).toBe('2026-09')
  })

  it('periodKeyOf：跨日/跨月边界不越期（UTC 而非本地时区）', () => {
    // 若实现误用本地时区，这一条会在非 UTC 机器上给出不同结果 —— 账单边界必须只有一个。
    expect(periodKeyOf(new Date('2026-03-01T00:00:00Z'))).toBe('2026-03')
    expect(periodKeyOf(new Date('2026-02-28T23:59:59Z'))).toBe('2026-02')
  })

  it('periodBoundsOf：上界**开**（避免相邻两期在边界重复计数）', () => {
    expect(periodBoundsOf('2026-10')).toEqual({
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-11-01T00:00:00.000Z',
    })
    const dec = periodBoundsOf('2026-12')
    expect(dec).toEqual({ start: '2026-12-01T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' })
  })

  it('parsePeriodKey：严格 `YYYY-MM`；越界月份与脏值 → null', () => {
    expect(parsePeriodKey('2026-10')).toBe('2026-10')
    expect(parsePeriodKey(' 2026-01 ')).toBe('2026-01')
    expect(parsePeriodKey('2026-13')).toBeNull()
    expect(parsePeriodKey('2026-00')).toBeNull()
    expect(parsePeriodKey('2026-1')).toBeNull()
    expect(parsePeriodKey('2026-10-01')).toBeNull()
    expect(parsePeriodKey('')).toBeNull()
    expect(parsePeriodKey(undefined)).toBeNull()
  })

  it('periodBoundsOf：非法期次 → null', () => {
    expect(periodBoundsOf('nope')).toBeNull()
  })

  it('shiftPeriodKey：跨年正负偏移正确', () => {
    expect(shiftPeriodKey('2026-01', -1)).toBe('2025-12')
    expect(shiftPeriodKey('2026-12', 1)).toBe('2027-01')
    expect(shiftPeriodKey('2026-06', 12)).toBe('2027-06')
    expect(shiftPeriodKey('2026-06', -18)).toBe('2024-12')
    expect(shiftPeriodKey('bad', 1)).toBeNull()
  })
})

describe('聚合', () => {
  it('emptyUsageTotals 四单元全 0', () => {
    expect(emptyUsageTotals()).toEqual({ proposal: 0, introduction: 0, outcome: 0, verification: 0 })
  })

  it('quantity 缺省按 1 计', () => {
    const totals = aggregateUsage([
      { unit: 'proposal' },
      { unit: 'proposal', quantity: 2 },
      { unit: 'introduction', quantity: 3 },
    ])
    expect(totals).toEqual({ proposal: 3, introduction: 3, outcome: 0, verification: 0 })
  })

  it('防御：未知 unit / 负数 / 小数 / undefined 都不污染结果', () => {
    const totals = aggregateUsage([
      { unit: 'nope' as never },
      { unit: 'outcome', quantity: -5 },
      { unit: 'outcome', quantity: 2.9 },
      { unit: 'verification', quantity: Number.NaN },
      { unit: null as never },
    ])
    expect(totals).toEqual({ proposal: 0, introduction: 0, outcome: 2, verification: 0 })
  })
})

describe('限额判定', () => {
  const limits: PlanLimits = {
    proposalPerMonth: 4,
    introductionPerMonth: 2,
    outcomePerMonth: null, // 不限
    verificationPerMonth: 0, // 一个都不给（用于钉住 0 与 null 的区别）
    seats: 5,
  }

  it('limit = null → 不限：remaining 为 null，既未用尽也未超额', () => {
    const [proposal, , outcome] = evaluateLimits(
      'FREE',
      { proposal: 0, introduction: 0, outcome: 9999, verification: 0 },
      limits
    )
    expect(proposal.limit).toBe(4)
    expect(outcome).toMatchObject({ limit: null, used: 9999, remaining: null, exhausted: false, exceeded: false })
  })

  it('🔴 用满（used === limit）→ exhausted=true 但 exceeded=false，remaining=0', () => {
    const statuses = evaluateLimits('FREE', { proposal: 4, introduction: 0, outcome: 0, verification: 0 }, limits)
    expect(statuses[0]).toMatchObject({ used: 4, limit: 4, remaining: 0, exhausted: true, exceeded: false })
  })

  it('used > limit → 两个都为 true，remaining 钳到 0（不出现负数）', () => {
    const statuses = evaluateLimits('FREE', { proposal: 6, introduction: 0, outcome: 0, verification: 0 }, limits)
    expect(statuses[0]).toMatchObject({ used: 6, limit: 4, remaining: 0, exhausted: true, exceeded: true })
  })

  it('limit = 0 与 limit = null 语义不同（0 = 完全不给，null = 不限）', () => {
    const statuses = evaluateLimits('FREE', { proposal: 0, introduction: 0, outcome: 0, verification: 0 }, limits)
    const verification = statuses.find((s) => s.unit === 'verification')!
    expect(verification).toMatchObject({ limit: 0, remaining: 0, exhausted: true, exceeded: false })
    const outcome = statuses.find((s) => s.unit === 'outcome')!
    expect(outcome).toMatchObject({ limit: null, remaining: null, exhausted: false, exceeded: false })
  })

  it('返回顺序与 USAGE_UNITS 一致（界面按此渲染）', () => {
    expect(evaluateLimits('FREE', emptyUsageTotals(), limits).map((s) => s.unit)).toEqual([...USAGE_UNITS])
  })

  it('假设可注入（变异自证）：换一组限额，判定随之改变', () => {
    const totals = { proposal: 4, introduction: 0, outcome: 0, verification: 0 }
    expect(evaluateLimits('FREE', totals, limits)[0].exhausted).toBe(true)
    const looser: PlanLimits = { ...limits, proposalPerMonth: 10 }
    expect(evaluateLimits('FREE', totals, looser)[0].exhausted).toBe(false)
  })

  it('未传 limits 时按方案目录取值（FREE 比 STARTER 更紧）', () => {
    // 25 这个取值刻意同时钉住两件事：
    //   · FREE 四个单元全部超额（它的限额是 20/3/10/2）；
    //   · STARTER 只有 verification **刚好用满**（限额 25）→ exhausted 但**不** exceeded。
    //     若把 `>` 误写成 `>=`，这一条会立刻变红。
    const totals = { proposal: 25, introduction: 25, outcome: 25, verification: 25 }
    const free = evaluateLimits('FREE', totals)
    const starter = evaluateLimits('STARTER', totals)
    const pick = (list: ReturnType<typeof evaluateLimits>, unit: string) =>
      list.find((s) => s.unit === unit)!

    expect(free.every((s) => s.exceeded)).toBe(true)
    expect(starter.some((s) => s.exceeded)).toBe(false)
    expect(pick(starter, 'proposal')).toMatchObject({ used: 25, limit: 200, remaining: 175, exhausted: false })
    expect(pick(starter, 'verification')).toMatchObject({ used: 25, limit: 25, remaining: 0, exhausted: true, exceeded: false })
  })

  it('SCALE 全单元不限', () => {
    const statuses = evaluateLimits('SCALE', { proposal: 999999, introduction: 999999, outcome: 999999, verification: 999999 })
    expect(statuses.every((s) => s.limit === null && !s.exhausted && !s.exceeded)).toBe(true)
  })
})

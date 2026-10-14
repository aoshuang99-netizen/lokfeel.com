/**
 * P2 · Outcome Observatory —— 时间轴与指标**装配器**单测
 * （`src/lib/living/observatory/timeline.ts`）
 *
 * 五条纪律逐条钉死：
 *   1. 零 IO / 确定性；
 *   2. **判据不重写**：「已验证」只读服务端下发的 `verified` 布尔
 *      —— 本文件用"`verified:true` 但级别是 SELF_REPORTED"这类**互相矛盾**的载荷
 *      来证明前端没有自己比较枚举字面量；
 *   3. 口径随载荷下发（`basis.verifiedLevels` / `assumptions` 原样展示）；
 *   4. 载荷自洽性自证（`count` / `unverifiedCount` 不符要说出来）；
 *   5. 顺序确定（时间降序、同刻按 id；不可解析时间排最后）。
 */

import {
  assembleObservatoryMetrics,
  assembleObservatoryTimeline,
  formatCurrency,
  observatoryActionRequest,
  type ObservatoryMetricsView,
  type ObservatoryTimeline,
} from '@/lib/living/observatory'

// ─────────────────────────────────────────────────────────────────────────────
// 夹具：形状逐字对齐服务端 `OutcomeDto` 列表 / `OutcomeMetricsDto`
// ─────────────────────────────────────────────────────────────────────────────

const outcome = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'o1',
  summary: '达成合作',
  verificationLevel: 'SELF_REPORTED',
  verified: false,
  occurredAt: '2026-10-01T00:00:00.000Z',
  reportedAt: '2026-10-01T01:00:00.000Z',
  myRole: 'REPORTER',
  canConfirm: true,
  canVerify: false,
  verifications: [],
  ...over,
})

const list = (items: Record<string, unknown>[], over: Record<string, unknown> = {}) => ({
  items,
  count: items.length,
  unverifiedCount: items.filter((o) => o.verified !== true).length,
  ...over,
})

const metricPayload = (over: Record<string, unknown> = {}): Record<string, unknown> => {
  const base = {
    currency: 'CNY',
    basis: {
      scope: 'all-time',
      missionId: null,
      verifiedLevels: ['COUNTERPARTY_CONFIRMED', 'EXTERNALLY_VERIFIED'],
      assumptions: {
        currency: 'CNY',
        minutesPerIntervention: 6,
        unitCostsCents: { proposal: 120, introduction: 800, outcome: 200, verification: 1500 },
      },
    },
    funnel: {
      proposals: 10,
      consentPending: 3,
      mutuallyAccepted: 7,
      introduced: 5,
      outcomesReported: 4,
      outcomesVerified: 2,
      rates: {
        acceptedPerProposal: 70,
        introducedPerAccepted: 71.4,
        outcomePerIntroduced: 80,
        verifiedPerOutcome: 50,
      },
    },
    workload: {
      takeovers: 1,
      deadLettered: 0,
      interventions: 4,
      minutesPerIntervention: 6,
      estimatedHumanMinutes: 24,
      estimatedHumanHours: 0.4,
    },
    cost: {
      currency: 'CNY',
      // 刻意把 introduction 放在前面：装配器必须按服务端定义的单元次序重排
      lineItems: [
        { unit: 'introduction', units: 5, unitCostCents: 800, costCents: 4000 },
        { unit: 'proposal', units: 10, unitCostCents: 120, costCents: 1200 },
      ],
      totalCostCents: 5200,
      totalCost: 52,
    },
    generatedAt: '2026-10-14T00:00:00.000Z',
  }
  return { ...base, ...over }
}

function timelineOf(payload: unknown): ObservatoryTimeline {
  const r = assembleObservatoryTimeline(payload)
  if (!r.ok) throw new Error(`预期装配成功，实际失败：${r.error}`)
  return r.value
}

function metricsOf(payload: unknown): ObservatoryMetricsView {
  const r = assembleObservatoryMetrics(payload)
  if (!r.ok) throw new Error(`预期装配成功，实际失败：${r.error}`)
  return r.value
}

const notesOf = (m: { notes: string[] }) => m.notes.join('\n')

// ─────────────────────────────────────────────────────────────────────────────

describe('时间轴 · 纪律 3：来源不可用 ≠ 没有数据', () => {
  it('载荷不可用 ⇒ 整块拒绝并指明位置', () => {
    const r = assembleObservatoryTimeline(null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('顶层形状')

    const r2 = assembleObservatoryTimeline({})
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error).toContain('items')
  })

  it('加载中 / 读不到是容器组件的事，装配器只认载荷（空列表是**真实结论**）', () => {
    const t = timelineOf(list([]))
    expect(t.entries).toEqual([])
    expect(t.counts.total).toBe(0)
  })
})

describe('时间轴 · 纪律 5：顺序确定', () => {
  it('按发生时间降序', () => {
    const t = timelineOf(
      list([
        outcome({ id: 'a', occurredAt: '2026-10-01T00:00:00.000Z' }),
        outcome({ id: 'b', occurredAt: '2026-10-03T00:00:00.000Z' }),
        outcome({ id: 'c', occurredAt: '2026-10-02T00:00:00.000Z' }),
      ]),
    )
    expect(t.entries.map((e) => e.id)).toEqual(['b', 'c', 'a'])
  })

  it('同一时刻按 id 升序（不随服务端返回顺序漂移）', () => {
    const at = '2026-10-01T00:00:00.000Z'
    const t = timelineOf(
      list([outcome({ id: 'zzz', occurredAt: at }), outcome({ id: 'aaa', occurredAt: at })]),
    )
    expect(t.entries.map((e) => e.id)).toEqual(['aaa', 'zzz'])
  })

  it('两个都不可解析的时间不会因 `Infinity - Infinity = NaN` 而乱序', () => {
    const t = timelineOf(
      list([outcome({ id: 'b', occurredAt: 'nope' }), outcome({ id: 'a', occurredAt: 'nope' })]),
    )
    expect(t.entries.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('不可解析的时间排在末尾，且**不被丢弃**并说明原因', () => {
    const t = timelineOf(
      list([
        outcome({ id: 'bad', occurredAt: 'not-a-date' }),
        outcome({ id: 'good', occurredAt: '2026-10-01T00:00:00.000Z' }),
      ]),
    )
    expect(t.entries.map((e) => e.id)).toEqual(['good', 'bad'])
    expect(notesOf(t)).toContain('无法解析')
    expect(t.entries).toHaveLength(2)
  })

  it('同输入两次装配完全相等', () => {
    const p = list([outcome({ id: 'a' }), outcome({ id: 'b', occurredAt: '2026-09-01T00:00:00.000Z' })])
    expect(timelineOf(p)).toEqual(timelineOf(p))
  })
})

describe('时间轴 · 纪律 2：判据不重写（只读服务端 verified）', () => {
  it('`verified:true` 但级别是 SELF_REPORTED ⇒ 仍算已验证（前端没有比较枚举字面量）', () => {
    const t = timelineOf(list([outcome({ verified: true, verificationLevel: 'SELF_REPORTED' })]))
    expect(t.entries[0].verified).toBe(true)
  })

  it('`verified:false` 但级别是 EXTERNALLY_VERIFIED ⇒ 仍算未验证（同理，反之亦然）', () => {
    const t = timelineOf(list([outcome({ verified: false, verificationLevel: 'EXTERNALLY_VERIFIED' })]))
    expect(t.entries[0].verified).toBe(false)
  })

  it('级别文案取自镜像表，而不是把枚举原样丢给界面', () => {
    const t = timelineOf(list([outcome({ verificationLevel: 'COUNTERPARTY_CONFIRMED', verified: true })]))
    expect(t.entries[0].levelLabel).toBe('对手方已确认')
  })

  it('验证记录逐条带出（含中文级别），供详情面板复算', () => {
    const t = timelineOf(
      list([
        outcome({
          verifications: [
            { level: 'COUNTERPARTY_CONFIRMED', at: '2026-10-02T00:00:00.000Z' },
            { level: 'EXTERNALLY_VERIFIED', at: '2026-10-03T00:00:00.000Z' },
          ],
        }),
      ]),
    )
    expect(t.entries[0].verifications).toEqual([
      { level: 'COUNTERPARTY_CONFIRMED', levelLabel: '对手方已确认', at: '2026-10-02T00:00:00.000Z' },
      { level: 'EXTERNALLY_VERIFIED', levelLabel: '外部已核验', at: '2026-10-03T00:00:00.000Z' },
    ])
  })
})

describe('时间轴 · 纪律 4：载荷自洽性自证', () => {
  it('`count` 与实际下发条数不符 ⇒ 产 note，并**按实际条数**展示', () => {
    const t = timelineOf(list([outcome()], { count: 9 }))
    expect(notesOf(t)).toContain('载荷自洽性未通过')
    expect(t.entries).toHaveLength(1)
  })

  it('`unverifiedCount > count` ⇒ 产 note 且不给"已验证"计数', () => {
    const t = timelineOf(list([outcome()], { count: 1, unverifiedCount: 5 }))
    expect(notesOf(t)).toContain('自相矛盾')
    expect(t.counts.verified).toBe(0)
  })

  it('`unverified` 的口径标注为服务端（不是前端 filter 出来的）', () => {
    const t = timelineOf(list([outcome()]))
    expect(t.counts.unverifiedSource).toBe('server')
  })

  it('`verified = count - unverifiedCount`（两个数都来自服务端）', () => {
    const t = timelineOf(list([outcome()], { count: 10, unverifiedCount: 4 }))
    expect(t.counts).toMatchObject({ total: 10, verified: 6, unverified: 4 })
  })
})

describe('指标 · 纪律 3：口径随载荷下发', () => {
  it('载荷不可用 ⇒ 拒绝', () => {
    expect(assembleObservatoryMetrics(null).ok).toBe(false)
    expect(assembleObservatoryMetrics({}).ok).toBe(false)
  })

  it('`verifiedLevels` 原样带出（供对账复算，不是前端猜的）', () => {
    expect(metricsOf(metricPayload()).verifiedLevels).toEqual([
      'COUNTERPARTY_CONFIRMED',
      'EXTERNALLY_VERIFIED',
    ])
  })

  it('假设集原样带出（单价的来源），不是 UI 修辞', () => {
    const m = metricsOf(metricPayload())
    expect(m.assumptions.currency).toBe('CNY')
    expect(m.assumptions.minutesPerIntervention).toBe(6)
    expect(m.assumptions.unitCosts).toEqual([
      'introduction: CNY 8.00',
      'outcome: CNY 2.00',
      'proposal: CNY 1.20',
      'verification: CNY 15.00',
    ])
  })

  it('服务端没下发"已验证级别集合" ⇒ 不自行推断，产 note', () => {
    const p = metricPayload()
    ;(p.basis as Record<string, unknown>).verifiedLevels = []
    expect(notesOf(metricsOf(p))).toContain('不自行推断')
  })

  it('口径标签随 missionId 变（"全部" vs "限定任务 X"）', () => {
    expect(metricsOf(metricPayload()).scopeLabel).toBe('全部（不限任务）')
    const p = metricPayload()
    ;(p.basis as Record<string, unknown>).missionId = 'm-1'
    expect(metricsOf(p).scopeLabel).toBe('限定任务 m-1')
    expect(metricsOf(p).missionId).toBe('m-1')
  })
})

describe('指标 · 漏斗（consentPending 单列，不入主线）', () => {
  const m = metricsOf(metricPayload())

  it('五级依次，且最后一级没有"下一级"可算', () => {
    expect(m.funnel.map((f) => f.stage)).toEqual([
      'proposals',
      'mutuallyAccepted',
      'introduced',
      'outcomesReported',
      'outcomesVerified',
    ])
    expect(m.funnel[4].rateToNext).toBeNull()
    expect(m.funnel[4].rateLabel).toBeNull()
  })

  it('每一级挂的是**它到下一级**的那条率（与服务端 rates 键一一对应）', () => {
    expect(m.funnel[0]).toMatchObject({ count: 10, rateToNext: 70, rateLabel: '提案 → 双方同意' })
    expect(m.funnel[1]).toMatchObject({ count: 7, rateToNext: 71.4, rateLabel: '同意 → 完成介绍' })
    expect(m.funnel[2]).toMatchObject({ count: 5, rateToNext: 80, rateLabel: '介绍 → 产生成果' })
    expect(m.funnel[3]).toMatchObject({ count: 4, rateToNext: 50, rateLabel: '成果 → 通过验证' })
  })

  it('`consentPending` 单独一个字段带出（它是 proposals 的子集状态，不是一级）', () => {
    expect(m.consentPending).toBe(3)
    expect(m.funnel.map((f) => f.stage as string)).not.toContain('consentPending')
  })
})

describe('指标 · 成本（逐项次序稳定 + 自洽性自证）', () => {
  it('逐项按服务端定义的单元次序重排（输入顺序无关）', () => {
    expect(metricsOf(metricPayload()).cost.rows.map((r) => r.unit)).toEqual([
      'proposal',
      'introduction',
    ])
  })

  it('逐项之和与服务端合计一致 ⇒ **不产** note', () => {
    expect(notesOf(metricsOf(metricPayload()))).not.toContain('不一致')
  })

  it('逐项之和与合计不符 ⇒ 产 note，但**以服务端合计为准**展示', () => {
    const p = metricPayload()
    ;(p.cost as Record<string, unknown>).totalCostCents = 9999
    const m = metricsOf(p)
    expect(notesOf(m)).toContain('不一致')
    expect(m.cost.totalCostCents).toBe(9999)
  })

  it('工时/接管等人工读数原样带出', () => {
    expect(metricsOf(metricPayload()).workload).toEqual({
      takeovers: 1,
      deadLettered: 0,
      interventions: 4,
      minutesPerIntervention: 6,
      estimatedHumanMinutes: 24,
      estimatedHumanHours: 0.4,
    })
  })
})

describe('金额换算：整数分 → 两位小数（确定性，不依赖 Intl）', () => {
  it('常规、零、负数、跨位都给出同一个字符串', () => {
    expect(formatCurrency(0, 'CNY')).toBe('CNY 0.00')
    expect(formatCurrency(5, 'CNY')).toBe('CNY 0.05')
    expect(formatCurrency(12345, 'CNY')).toBe('CNY 123.45')
    expect(formatCurrency(-5, 'CNY')).toBe('-CNY 0.05')
    expect(formatCurrency(100, 'CNY')).toBe('CNY 1.00')
  })

  it('同输入恒同输出（无区域/时区依赖）', () => {
    expect(formatCurrency(12345, 'CNY')).toBe(formatCurrency(12345, 'CNY'))
  })
})

describe('动作：两个端点都不接受 level 入参（级别永远由记录集派生）', () => {
  it('confirm / verify 各有自己的端点', () => {
    expect(observatoryActionRequest('o1', 'confirm').url).toBe('/api/v1/outcomes/o1/confirm')
    expect(observatoryActionRequest('o1', 'verify').url).toBe('/api/v1/outcomes/o1/verify')
  })

  it('请求体为空，且**不带** `level`（让客户端"自报已验证"在结构上做不到）', () => {
    const r = observatoryActionRequest('o1', 'verify')
    expect(r.body).toEqual({})
    expect('level' in r.body).toBe(false)
  })

  it('成果 id 做 URL 编码', () => {
    expect(observatoryActionRequest('a/b c', 'confirm').url).toBe('/api/v1/outcomes/a%2Fb%20c/confirm')
  })
})

/**
 * V16 · T05 回归：Adaptive Dual World 阶段条的状态推导
 *
 * 这一组用例保护的是**诚实性**，不是样式：
 *   1. 读不到数据 → 显示「未就绪」，**不得**折成 0（0 是"真的没有"）；
 *   2. 「有待办」与「已完成」不能混：`ready` 由端点是否返回决定，不由计数决定；
 *   3. 聚焦阶段必须是"第一个待办"，没有待办才回落到最后一个已就绪阶段。
 *
 * 变异验证：把 `count: null` 改回 `?? 0`、或把 `focusStage` 的 `attention`
 * 查找改成 `ready` 查找 —— 下面都会红。
 */
import { buildOsStages, focusStage, stageStatusLabel } from '@/lib/living/adaptive/stages'

const emptyInputs = {
  proposals: null,
  runs: null,
  outcomes: null,
  specReady: false,
} as const

describe('buildOsStages · 数据未就绪', () => {
  it('三个端点都没返回时，四段计数全是 null 而不是 0', () => {
    const stages = buildOsStages({ ...emptyInputs })
    expect(stages).toHaveLength(4)
    for (const s of stages) {
      expect(s.count).toBeNull()
      expect(s.ready).toBe(false)
      expect(stageStatusLabel(s, false)).toBe('未就绪')
    }
  })

  it('空数组是"读到了、真的没有"，与 null 必须区分', () => {
    const stages = buildOsStages({ proposals: [], runs: [], outcomes: { total: 0, unverified: 0 }, specReady: true })
    expect(stages[0].count).toBe(0)
    expect(stages[0].ready).toBe(true)
    expect(stages[0].attention).toBe(false)
    expect(stageStatusLabel(stages[0], false)).toBe('无待办')
  })

  it('计数口径写进 countHint，读不到时明确说"不显示数字"', () => {
    const missing = buildOsStages({ ...emptyInputs })
    expect(missing[0].countHint).toContain('尚未返回')
    const loaded = buildOsStages({ proposals: [], runs: [], outcomes: null, specReady: false })
    expect(loaded[0].countHint).toContain('/api/v1/connections/proposals')
    expect(loaded[3].countHint).toContain('counts.unverified')
  })
})

describe('buildOsStages · 计数与待办', () => {
  it('提案段只数 CONSENT_PENDING，同意段只数 MUTUALLY_ACCEPTED', () => {
    const stages = buildOsStages({
      ...emptyInputs,
      proposals: [
        { state: 'CONSENT_PENDING', canIntroduce: false },
        { state: 'CONSENT_PENDING', canIntroduce: false },
        { state: 'MUTUALLY_ACCEPTED', canIntroduce: true },
        { state: 'REJECTED', canIntroduce: false },
      ],
      specReady: true,
    })
    expect(stages[0].count).toBe(2)
    expect(stages[1].count).toBe(1)
    expect(stages[0].attention).toBe(true)
    expect(stages[1].attention).toBe(true)
  })

  it('同意段只看服务端给的 canIntroduce（前端不自己判权限）', () => {
    const stages = buildOsStages({
      ...emptyInputs,
      proposals: [{ state: 'MUTUALLY_ACCEPTED', canIntroduce: false }],
      specReady: true,
    })
    expect(stages[1].count).toBe(1)
    expect(stages[1].attention).toBe(false)
  })

  it('执行段数 AWAITING_APPROVAL 与"已批准且需审批"的运行', () => {
    const stages = buildOsStages({
      ...emptyInputs,
      runs: [
        { status: 'AWAITING_APPROVAL', requiresApproval: true },
        { status: 'APPROVED', requiresApproval: true },
        { status: 'APPROVED', requiresApproval: false },
        { status: 'EXECUTED', requiresApproval: true },
        { status: 'FAILED', requiresApproval: true },
      ],
      specReady: true,
    })
    expect(stages[2].count).toBe(2)
    expect(stages[2].attention).toBe(true)
  })

  it('成果段直接取服务端 unverified，不在前端重算', () => {
    const stages = buildOsStages({ ...emptyInputs, outcomes: { total: 9, unverified: 3 }, specReady: true })
    expect(stages[3].count).toBe(3)
    expect(stages[3].attention).toBe(true)
    expect(stages[3].ready).toBe(true)
  })
})

describe('focusStage · 变形驱动', () => {
  it('没有任何待办时回落到最后一个已就绪阶段', () => {
    const stages = buildOsStages({ proposals: [], runs: [], outcomes: { total: 2, unverified: 0 }, specReady: true })
    expect(focusStage(stages)).toBe('outcome')
  })

  it('有多个待办时取第一个（提案优先于执行）', () => {
    const stages = buildOsStages({
      ...emptyInputs,
      proposals: [{ state: 'CONSENT_PENDING', canIntroduce: false }],
      runs: [{ status: 'AWAITING_APPROVAL', requiresApproval: true }],
      outcomes: { total: 1, unverified: 1 },
      specReady: true,
    })
    expect(focusStage(stages)).toBe('proposal')
  })

  it('全都读不到时返回 null（不编一个起点）', () => {
    expect(focusStage(buildOsStages({ ...emptyInputs }))).toBeNull()
  })

  it('当前阶段的文案与其它阶段不同（"在等你"只在聚焦段出现）', () => {
    const stages = buildOsStages({ ...emptyInputs, outcomes: { total: 5, unverified: 2 }, specReady: true })
    const focusedStage = stages[3]
    expect(stageStatusLabel(focusedStage, true)).toBe('在等你')
    expect(stageStatusLabel(focusedStage, false)).toBe('待处理')
    expect(stageStatusLabel(stages[0], false)).toBe('未就绪')
  })
})

describe('buildOsStages · 阶段名与真实流水线对齐', () => {
  it('四段的 key / view 固定，改顺序会被这条用例拦住', () => {
    const stages = buildOsStages({ ...emptyInputs })
    expect(stages.map((s) => s.key)).toEqual(['proposal', 'consent', 'execution', 'outcome'])
    expect(stages.map((s) => s.view)).toEqual(['consent', 'consent', 'agents', 'outcomes'])
  })

  it('还没编译出工作区时，提案段提示里要写明', () => {
    const withoutSpec = buildOsStages({ ...emptyInputs, specReady: false })
    const withSpec = buildOsStages({ ...emptyInputs, specReady: true })
    expect(withoutSpec[0].hint).toContain('还没有编译出工作区')
    expect(withSpec[0].hint).not.toContain('还没有编译出工作区')
  })
})

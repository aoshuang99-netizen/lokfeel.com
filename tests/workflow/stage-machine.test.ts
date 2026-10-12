/**
 * T06 · 阶段状态机（纯函数）—— AC-14 的推进判据 + AC-17 的幂等性
 *
 * 本文件要钉死一条不变式：**阶段只前进，不回退**。
 * 它就是"重复事件天然幂等"的证明 —— 重放一个 INTRODUCED 不会把已经到
 * COORDINATING 的流程打回去，于是重放任务不会造成流程倒退。
 */

import {
  STAGE_LABELS,
  STAGE_ORDER,
  appendTimeline,
  applyEvent,
  isStageAdvance,
  isTerminalStage,
  stageIndex,
  type TimelineEntry,
  type WorkflowEvent,
  type WorkflowStage,
} from '@/lib/workflow/stage-machine'

describe('T06 · 阶段次序', () => {
  it('STAGE_ORDER 是语义顺序：PROPOSED → … → OUTCOME_RECORDED', () => {
    expect([...STAGE_ORDER]).toEqual([
      'PROPOSED',
      'CONSENT_PENDING',
      'INTRODUCED',
      'COORDINATING',
      'ACTION_COMPLETED',
      'OUTCOME_RECORDED',
    ])
  })

  it('stageIndex 单调递增（数组顺序即语义顺序）', () => {
    for (let i = 1; i < STAGE_ORDER.length; i++) {
      expect(stageIndex(STAGE_ORDER[i])).toBeGreaterThan(stageIndex(STAGE_ORDER[i - 1]))
    }
  })

  it('未知阶段收敛为 0（最保守的起点），不返回 -1 让比较静默错位', () => {
    expect(stageIndex('NOPE' as WorkflowStage)).toBe(0)
  })

  it('isStageAdvance 只在严格前进时为真', () => {
    expect(isStageAdvance('PROPOSED', 'INTRODUCED')).toBe(true)
    expect(isStageAdvance('INTRODUCED', 'INTRODUCED')).toBe(false)
    expect(isStageAdvance('COORDINATING', 'INTRODUCED')).toBe(false)
  })

  it('唯一终态是 OUTCOME_RECORDED', () => {
    expect(isTerminalStage('OUTCOME_RECORDED')).toBe(true)
    for (const s of STAGE_ORDER.filter((x) => x !== 'OUTCOME_RECORDED')) {
      expect(isTerminalStage(s)).toBe(false)
    }
  })

  it('每个阶段都有可读标签（运营视图不漏阶段）', () => {
    for (const s of STAGE_ORDER) expect(STAGE_LABELS[s]).toBeTruthy()
  })
})

describe('T06 · applyEvent（只前进不回退）', () => {
  it('CONSENT_RECORDED：PROPOSED → CONSENT_PENDING（有人表态就不停在 PROPOSED）', () => {
    expect(applyEvent('PROPOSED', 'CONSENT_RECORDED')).toBe('CONSENT_PENDING')
  })

  it('MUTUALLY_ACCEPTED 也落在 CONSENT_PENDING（等待运营介绍）', () => {
    expect(applyEvent('PROPOSED', 'MUTUALLY_ACCEPTED')).toBe('CONSENT_PENDING')
  })

  it('INTRODUCED：从 CONSENT_PENDING 前进到 INTRODUCED', () => {
    expect(applyEvent('CONSENT_PENDING', 'INTRODUCED')).toBe('INTRODUCED')
  })

  it('★ 幂等：重放同一事件不改变结果（AC-17 在流程层的落点）', () => {
    const once = applyEvent('CONSENT_PENDING', 'INTRODUCED')
    const twice = applyEvent(once, 'INTRODUCED')
    expect(twice).toBe(once)
    expect(twice).toBe('INTRODUCED')
  })

  it('★ 不回退：已到 COORDINATING 后收到 INTRODUCED → 保持 COORDINATING', () => {
    expect(applyEvent('COORDINATING', 'INTRODUCED')).toBe('COORDINATING')
  })

  it('★ 不回退：已到 INTRODUCED 后收到迟到的 CONSENT_RECORDED → 保持 INTRODUCED', () => {
    expect(applyEvent('INTRODUCED', 'CONSENT_RECORDED')).toBe('INTRODUCED')
    expect(applyEvent('INTRODUCED', 'MUTUALLY_ACCEPTED')).toBe('INTRODUCED')
  })

  it('终态吸收一切事件（OUTCOME_RECORDED 之后不再变）', () => {
    for (const e of [
      'MUTUALLY_ACCEPTED',
      'CONSENT_RECORDED',
      'INTRODUCED',
      'COORDINATION_STARTED',
      'ACTION_COMPLETED',
      'OUTCOME_RECORDED',
    ] as WorkflowEvent[]) {
      expect(applyEvent('OUTCOME_RECORDED', e)).toBe('OUTCOME_RECORDED')
    }
  })

  it('完整链路可一路推进到终态（AC-14 的流程骨架）', () => {
    let stage: WorkflowStage = 'PROPOSED'
    stage = applyEvent(stage, 'MUTUALLY_ACCEPTED') // → CONSENT_PENDING
    stage = applyEvent(stage, 'INTRODUCED') // → INTRODUCED
    stage = applyEvent(stage, 'COORDINATION_STARTED') // → COORDINATING
    stage = applyEvent(stage, 'ACTION_COMPLETED') // → ACTION_COMPLETED
    stage = applyEvent(stage, 'OUTCOME_RECORDED') // → OUTCOME_RECORDED
    expect(stage).toBe('OUTCOME_RECORDED')
  })
})

describe('T06 · appendTimeline', () => {
  const entry = (stage: WorkflowStage, reason = 'r'): TimelineEntry => ({
    stage,
    at: '2026-10-12T00:00:00.000Z',
    by: null,
    reason,
  })

  it('null / undefined → 生成只含一条的数组', () => {
    expect(appendTimeline(null, entry('PROPOSED'))).toHaveLength(1)
    expect(appendTimeline(undefined, entry('PROPOSED'))).toHaveLength(1)
  })

  it('阶段变化 → 追加', () => {
    const list = appendTimeline([entry('PROPOSED')], entry('INTRODUCED'))
    expect(list.map((e) => e.stage)).toEqual(['PROPOSED', 'INTRODUCED'])
  })

  it('★ 阶段不变 → **不追加**（否则重复投递会在时间线上堆一串同阶段条目）', () => {
    const base = [entry('PROPOSED'), entry('CONSENT_PENDING')]
    const list = appendTimeline(base, entry('CONSENT_PENDING', 'again'))
    expect(list).toHaveLength(2)
    expect(list).toEqual(base) // 内容与顺序都不变
    expect(list.at(-1)?.reason).toBe('r') // 末尾仍是首次那条，不是重复条目
  })

  it('不改动原数组（不可变）', () => {
    const base = [entry('PROPOSED')]
    const snapshot = [...base]
    appendTimeline(base, entry('INTRODUCED'))
    expect(base).toEqual(snapshot)
  })
})

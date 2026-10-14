/**
 * P2 · Outcome Observatory —— 镜像取值域回归（硬编码 + 服务端真值比对）
 *
 * 与 `tests/living/consent/types.test.ts` 同一取向：本文件是
 * `src/lib/living/observatory/types.ts` 的编译期双向等价断言的**第二根柱子**。
 * 编译期守卫防"单侧漂移"，本文件防"双侧漂移"。
 *
 * ⚠️ 本区最要紧的一条语言纪律在此被**机械钉住**：
 *    「已验证」的判据只有服务端 `isVerified()` 一处实现。镜像只提供**文案**与
 *    **漏斗主线**，绝不复制判据。若有人日后在镜像里加一个
 *    `VERIFIED_LEVELS = ['COUNTERPARTY_CONFIRMED','EXTERNALLY_VERIFIED']`，
 *    本文件对 `VERIFIED_LEVELS`（服务端派生值）的断言会立刻暴露那份重复。
 */

import { METRIC_UNIT_LABELS, METRIC_UNITS } from '@/lib/outcome/metrics'
import { LEVEL_LABELS, LEVEL_ORDER, VERIFIED_LEVELS, isVerified } from '@/lib/outcome/verification'
import {
  OBSERVATORY_FUNNEL_LABELS,
  OBSERVATORY_FUNNEL_STAGES,
  OBSERVATORY_LEVELS,
  OBSERVATORY_LEVEL_HINTS,
  OBSERVATORY_LEVEL_LABELS,
  OBSERVATORY_METRIC_UNITS,
  OBSERVATORY_METRIC_UNIT_LABELS,
  OBSERVATORY_RATE_KEYS,
  OBSERVATORY_RATE_LABELS,
  OBSERVATORY_ROLES,
  OBSERVATORY_ROLE_LABELS,
  type ObservatoryFunnelStage,
  type ObservatoryLevel,
  type ObservatoryMetricUnit,
  type ObservatoryRateKey,
  type ObservatoryRole,
} from '@/lib/living/observatory'

function expectLabelMap<K extends string>(codes: readonly K[], labels: Record<K, string>): void {
  expect(Object.keys(labels).sort()).toEqual([...codes].sort())
  for (const code of codes) {
    expect(typeof labels[code]).toBe('string')
    expect(labels[code].trim().length).toBeGreaterThan(0)
  }
}

describe('镜像一 · 三级成果验证', () => {
  it('逐字钉住，且与服务端 LEVEL_ORDER 完全同序（顺序即语义）', () => {
    expect([...OBSERVATORY_LEVELS]).toEqual([
      'SELF_REPORTED',
      'COUNTERPARTY_CONFIRMED',
      'EXTERNALLY_VERIFIED',
    ])
    expect([...OBSERVATORY_LEVELS]).toEqual([...LEVEL_ORDER])
  })

  it('文案与服务端 LEVEL_LABELS **相同**（同一档位两处不同说法 = 用户以为是两回事）', () => {
    expect(OBSERVATORY_LEVEL_LABELS).toEqual(LEVEL_LABELS)
  })

  it('每一档都有一句"为什么算/不算已验证"的说明', () => {
    expectLabelMap<ObservatoryLevel>(OBSERVATORY_LEVELS, OBSERVATORY_LEVEL_HINTS)
    expect(OBSERVATORY_LEVEL_HINTS.SELF_REPORTED).toContain('不计入')
    expect(OBSERVATORY_LEVEL_HINTS.COUNTERPARTY_CONFIRMED).toContain('一致')
    expect(OBSERVATORY_LEVEL_HINTS.EXTERNALLY_VERIFIED).toContain('核验')
  })

  it('镜像**不复制**判据：判据只认服务端 `isVerified`，其结果与 `!== SELF_REPORTED` 等价', () => {
    for (const level of OBSERVATORY_LEVELS) {
      expect(isVerified(level)).toBe(level !== 'SELF_REPORTED')
    }
    expect([...VERIFIED_LEVELS]).toEqual(['COUNTERPARTY_CONFIRMED', 'EXTERNALLY_VERIFIED'])
  })

  it('文案表完整且无多余键', () => {
    expectLabelMap<ObservatoryLevel>(OBSERVATORY_LEVELS, OBSERVATORY_LEVEL_LABELS)
  })
})

describe('镜像二 · 我的角色', () => {
  it('逐字钉住（服务端只有类型、没有运行期常量，因此这里必须硬编码）', () => {
    expect([...OBSERVATORY_ROLES]).toEqual(['REPORTER', 'COUNTERPARTY', 'OBSERVER'])
    expectLabelMap<ObservatoryRole>(OBSERVATORY_ROLES, OBSERVATORY_ROLE_LABELS)
  })
})

describe('镜像三 · 计费单元', () => {
  it('与服务端 METRIC_UNITS 同集同序', () => {
    expect([...OBSERVATORY_METRIC_UNITS]).toEqual(['proposal', 'introduction', 'outcome', 'verification'])
    expect([...OBSERVATORY_METRIC_UNITS]).toEqual([...METRIC_UNITS])
  })

  it('文案与服务端一致（成本逐项靠它对齐，措辞漂了就对不上账）', () => {
    expect(OBSERVATORY_METRIC_UNIT_LABELS).toEqual(METRIC_UNIT_LABELS)
    expectLabelMap<ObservatoryMetricUnit>(OBSERVATORY_METRIC_UNITS, OBSERVATORY_METRIC_UNIT_LABELS)
  })
})

describe('镜像四 · 漏斗主线（`consentPending` 刻意不在主线里）', () => {
  it('逐字钉住五级', () => {
    expect([...OBSERVATORY_FUNNEL_STAGES]).toEqual([
      'proposals',
      'mutuallyAccepted',
      'introduced',
      'outcomesReported',
      'outcomesVerified',
    ])
    expectLabelMap<ObservatoryFunnelStage>(OBSERVATORY_FUNNEL_STAGES, OBSERVATORY_FUNNEL_LABELS)
  })

  it('`consentPending` **不是**漏斗一级 —— 它是 proposals 的子集状态', () => {
    // 插进主线会让漏斗看起来像"从提案掉到待表态"，而真实语义是"提案中有一批还没表态"
    expect(OBSERVATORY_FUNNEL_STAGES as readonly string[]).not.toContain('consentPending')
    // 反向自证：它确实是服务端 funnel 下的一个字段（所以"刻意不列"才有意义）
    expect('consentPending' in OBSERVATORY_FUNNEL_LABELS).toBe(false)
  })

  it('4 个转化率正好对齐 5 级的 4 次相邻跳转', () => {
    expect([...OBSERVATORY_RATE_KEYS]).toEqual([
      'acceptedPerProposal',
      'introducedPerAccepted',
      'outcomePerIntroduced',
      'verifiedPerOutcome',
    ])
    expect(OBSERVATORY_FUNNEL_STAGES.length - 1).toBe(OBSERVATORY_RATE_KEYS.length)
    expectLabelMap<ObservatoryRateKey>(OBSERVATORY_RATE_KEYS, OBSERVATORY_RATE_LABELS)
  })

  it('每一条率的文案都写成"A → B"的形状（读得懂是从哪一级到哪一级）', () => {
    for (const key of OBSERVATORY_RATE_KEYS) {
      expect(OBSERVATORY_RATE_LABELS[key]).toContain('→')
    }
  })
})

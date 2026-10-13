/**
 * T08 · 三级成果验证 —— **纯函数内核**单测（零 IO、零 mock）
 *
 * 本文件是 **AC-15「自报不算验证成功」的判据本身**的回归护栏：
 *   - `isVerified('SELF_REPORTED')` 必须为 `false` —— 这条一旦被改，整个 AC-15 就失效；
 *   - `deriveVerificationLevel` 必须是"取记录集最高"且**穷举**所有组合都对；
 *   - `VERIFIED_LEVELS` 必须**由 `isVerified` 派生**（不含 `SELF_REPORTED`），
 *     否则 SQL 下推的"已验证"过滤会把自报也算进去。
 */

import {
  LEVEL_LABELS,
  LEVEL_ORDER,
  VERIFIED_LEVELS,
  deriveVerificationLevel,
  isLevelAdvance,
  isVerified,
  levelIndex,
  outcomeRoleOf,
  parseVerificationLevel,
  type OutcomeVerificationLevel,
} from '@/lib/outcome/verification'

describe('LEVEL_ORDER / levelIndex —— 顺序即语义', () => {
  it('三级由低到高，顺序固定', () => {
    expect(LEVEL_ORDER).toEqual(['SELF_REPORTED', 'COUNTERPARTY_CONFIRMED', 'EXTERNALLY_VERIFIED'])
  })

  it('levelIndex 单调递增', () => {
    expect(levelIndex('SELF_REPORTED')).toBe(0)
    expect(levelIndex('COUNTERPARTY_CONFIRMED')).toBe(1)
    expect(levelIndex('EXTERNALLY_VERIFIED')).toBe(2)
  })

  it('每个级别都有中文标签（界面不会漏显示原值）', () => {
    for (const level of LEVEL_ORDER) {
      expect(typeof LEVEL_LABELS[level]).toBe('string')
      expect(LEVEL_LABELS[level].length).toBeGreaterThan(0)
    }
  })
})

describe('🔴 isVerified —— AC-15 的唯一判据', () => {
  it('SELF_REPORTED **不算**验证成功', () => {
    expect(isVerified('SELF_REPORTED')).toBe(false)
  })

  it('其余两级算验证成功', () => {
    expect(isVerified('COUNTERPARTY_CONFIRMED')).toBe(true)
    expect(isVerified('EXTERNALLY_VERIFIED')).toBe(true)
  })

  it('VERIFIED_LEVELS 由 isVerified 派生（不含 SELF_REPORTED）', () => {
    expect([...VERIFIED_LEVELS]).toEqual(['COUNTERPARTY_CONFIRMED', 'EXTERNALLY_VERIFIED'])
    expect(VERIFIED_LEVELS).not.toContain('SELF_REPORTED')
  })
})

describe('deriveVerificationLevel —— 派生取最高', () => {
  it('空集 → SELF_REPORTED（上报即得的"下限"，不需要额外记录来证明它）', () => {
    expect(deriveVerificationLevel([])).toBe('SELF_REPORTED')
  })

  it('只有自身级别的记录 → 该级别', () => {
    expect(deriveVerificationLevel([{ level: 'SELF_REPORTED' }])).toBe('SELF_REPORTED')
    expect(deriveVerificationLevel([{ level: 'COUNTERPARTY_CONFIRMED' }])).toBe(
      'COUNTERPARTY_CONFIRMED'
    )
  })

  it('穷举 3×3×3 组合：结果恒为集合中最高的一档', () => {
    const pick = (combo: OutcomeVerificationLevel[]): OutcomeVerificationLevel =>
      [...combo].sort((a, b) => levelIndex(b) - levelIndex(a))[0]
    for (const a of LEVEL_ORDER) {
      for (const b of LEVEL_ORDER) {
        for (const c of LEVEL_ORDER) {
          const combo = [a, b, c]
          const expected = pick(combo)
          expect(deriveVerificationLevel(combo.map((level) => ({ level })))).toBe(expected)
        }
      }
    }
  })

  it('无序输入同样取最高（记录顺序不影响结论）', () => {
    expect(
      deriveVerificationLevel([{ level: 'EXTERNALLY_VERIFIED' }, { level: 'SELF_REPORTED' }])
    ).toBe('EXTERNALLY_VERIFIED')
    expect(
      deriveVerificationLevel([{ level: 'SELF_REPORTED' }, { level: 'EXTERNALLY_VERIFIED' }])
    ).toBe('EXTERNALLY_VERIFIED')
    expect(
      deriveVerificationLevel([{ level: 'COUNTERPARTY_CONFIRMED' }, { level: 'SELF_REPORTED' }])
    ).toBe('COUNTERPARTY_CONFIRMED')
  })
})

describe('parseVerificationLevel —— 未知值不静默忽略', () => {
  it('合法值原样返回', () => {
    for (const level of LEVEL_ORDER) {
      expect(parseVerificationLevel(level)).toBe(level)
    }
  })

  it('未知 / 非字符串 → null（由调用方转 400）', () => {
    for (const bad of ['NOT_A_LEVEL', 'self_reported', '', 42, null, undefined, {}]) {
      expect(parseVerificationLevel(bad)).toBeNull()
    }
  })
})

describe('isLevelAdvance —— 同级不算前进', () => {
  it('严格前进才为 true', () => {
    expect(isLevelAdvance('SELF_REPORTED', 'COUNTERPARTY_CONFIRMED')).toBe(true)
    expect(isLevelAdvance('SELF_REPORTED', 'EXTERNALLY_VERIFIED')).toBe(true)
    expect(isLevelAdvance('COUNTERPARTY_CONFIRMED', 'EXTERNALLY_VERIFIED')).toBe(true)
  })

  it('同级 / 后退为 false（回退不是"前进"）', () => {
    expect(isLevelAdvance('SELF_REPORTED', 'SELF_REPORTED')).toBe(false)
    expect(isLevelAdvance('EXTERNALLY_VERIFIED', 'EXTERNALLY_VERIFIED')).toBe(false)
    expect(isLevelAdvance('EXTERNALLY_VERIFIED', 'SELF_REPORTED')).toBe(false)
  })
})

describe('outcomeRoleOf —— 角色判定（DTO 只暴露角色，不暴露 userId）', () => {
  const row = { reporterId: 'u_reporter', counterpartyId: 'u_counterparty' }

  it('上报人 / 对手方 / 第三方', () => {
    expect(outcomeRoleOf(row, 'u_reporter')).toBe('REPORTER')
    expect(outcomeRoleOf(row, 'u_counterparty')).toBe('COUNTERPARTY')
    expect(outcomeRoleOf(row, 'u_stranger')).toBe('OBSERVER')
  })

  it('同一 userId 同时是双方时，优先判为 REPORTER（不得自我确认这条兜底）', () => {
    expect(
      outcomeRoleOf({ reporterId: 'u_x', counterpartyId: 'u_x' }, 'u_x')
    ).toBe('REPORTER')
  })
})

/**
 * AC-10 · 生命周期保留政策（纯函数）
 *
 * 这里守的是**一条不变式**与**两档窗口**：
 *   - 🔴 非终态任务（PENDING / RUNNING）**永不被清** —— 它是"没做完的事"，不是垃圾；
 *   - 投递记录分两档：僵死 PENDING 短窗口、投递**证据**长窗口（AC-09 的证据面）；
 *   - 未读站内信**永不**被清（用户还没看见）。
 */

import {
  DEFAULT_RETENTION,
  LIFECYCLE_POLICY_VERSION,
  cutoffFor,
  describePolicy,
  policyFromEnv,
  shouldPurgeDelivery,
  shouldPurgeJob,
  shouldPurgeNotification,
} from '@/lib/lifecycle/policy'

const NOW = new Date('2026-10-12T00:00:00.000Z')

/** N 天前的时刻。 */
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000)

describe('AC-10 · cutoffFor', () => {
  it('now - days', () => {
    expect(cutoffFor(1, NOW).toISOString()).toBe('2026-10-11T00:00:00.000Z')
    expect(cutoffFor(90, NOW).toISOString()).toBe('2026-07-14T00:00:00.000Z')
  })
})

describe('AC-10 · shouldPurgeJob', () => {
  it('终态 + 超过保留期 → 可清', () => {
    for (const status of ['SUCCEEDED', 'FAILED', 'DEAD', 'TAKEN_OVER', 'CANCELLED'] as const) {
      expect(shouldPurgeJob({ status, createdAt: daysAgo(91) }, NOW)).toBe(true)
    }
  })

  it('终态但仍在保留期内 → 不清', () => {
    expect(shouldPurgeJob({ status: 'SUCCEEDED', createdAt: daysAgo(89) }, NOW)).toBe(false)
  })

  it('🔴 非终态任务永不清（哪怕躺了十年）', () => {
    expect(shouldPurgeJob({ status: 'PENDING', createdAt: daysAgo(3650) }, NOW)).toBe(false)
    expect(shouldPurgeJob({ status: 'RUNNING', createdAt: daysAgo(3650) }, NOW)).toBe(false)
  })
})

describe('AC-10 · shouldPurgeDelivery', () => {
  it('僵死 PENDING 超过短窗口 → 可清（它不是证据，是半成品）', () => {
    expect(shouldPurgeDelivery({ status: 'PENDING', createdAt: daysAgo(8) }, NOW)).toBe(true)
    expect(shouldPurgeDelivery({ status: 'PENDING', createdAt: daysAgo(6) }, NOW)).toBe(false)
  })

  it('投递证据用长窗口（默认 2 年）—— 100 天内不动', () => {
    for (const status of ['SENT', 'CAPTURED', 'FAILED']) {
      expect(shouldPurgeDelivery({ status, createdAt: daysAgo(100) }, NOW)).toBe(false)
      expect(shouldPurgeDelivery({ status, createdAt: daysAgo(731) }, NOW)).toBe(true)
    }
  })

  it('未知状态 → 不清（枚举漂移时宁可留下，也不误删）', () => {
    expect(shouldPurgeDelivery({ status: 'WHO_KNOWS', createdAt: daysAgo(5000) }, NOW)).toBe(false)
  })
})

describe('AC-10 · shouldPurgeNotification', () => {
  it('已读 + 超期 → 可清', () => {
    expect(shouldPurgeNotification({ isRead: true, createdAt: daysAgo(61) }, NOW)).toBe(true)
  })

  it('已读但未超期 → 不清', () => {
    expect(shouldPurgeNotification({ isRead: true, createdAt: daysAgo(59) }, NOW)).toBe(false)
  })

  it('🔴 未读永不清（用户还没看见）', () => {
    expect(shouldPurgeNotification({ isRead: false, createdAt: daysAgo(3650) }, NOW)).toBe(false)
  })
})

describe('AC-10 · policyFromEnv', () => {
  it('无覆盖 → 等于默认政策', () => {
    expect(policyFromEnv({})).toEqual(DEFAULT_RETENTION)
  })

  it('覆盖生效，非法值回退默认', () => {
    const p = policyFromEnv({
      LIFECYCLE_TERMINAL_JOB_DAYS: '30',
      LIFECYCLE_BATCH_SIZE: 'oops',
      LIFECYCLE_DELIVERY_EVIDENCE_DAYS: '-1',
    })
    expect(p.terminalJobDays).toBe(30)
    expect(p.batchSize).toBe(DEFAULT_RETENTION.batchSize) // 非法 → 回退
    expect(p.deliveryEvidenceDays).toBe(DEFAULT_RETENTION.deliveryEvidenceDays) // 负数 → 回退
  })
})

describe('AC-10 · describePolicy', () => {
  it('摘要里带上版本与全部窗口（便于回答"当时按哪版清的"）', () => {
    const s = describePolicy()
    expect(s).toContain(`v${LIFECYCLE_POLICY_VERSION}`)
    expect(s).toContain('90d')
    expect(s).toContain('730d')
  })
})

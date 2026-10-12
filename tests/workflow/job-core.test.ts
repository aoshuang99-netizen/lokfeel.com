/**
 * T06 · 任务内核（纯函数）—— AC-07 / AC-17 的判定层
 *
 * 这些断言全部离线可跑、不需要数据库。之所以把判定抽成纯函数（见 `job-core.ts`
 * 文件头），就是为了让"重试/超时/死信/租约"这些最易写错、又最难在集成测试里复现的
 * 分支能被秒级穷举 —— 造 5 次连续失败、等租约过期在真库里都很贵。
 */

import {
  DEFAULT_BACKOFF,
  DEFAULT_LEASE_MS,
  DEFAULT_STAGE_TIMEOUT_MS,
  JobFailure,
  TERMINAL_JOB_STATUSES,
  decideAfterFailure,
  deliveryDedupeKey,
  failureKindOf,
  isClaimable,
  isJobFailure,
  isLeaseAlive,
  isStageTimedOut,
  isTerminalJobStatus,
  jobDedupeKey,
  leaseExpiry,
  nextBackoffMs,
  stageTimeoutLabel,
  type WorkflowJobStatus,
} from '@/lib/workflow/job-core'

const T = (iso: string) => new Date(iso)

// ═══════════════════════════════════════════════════════════════
// AC-07 · 幂等键的形状
// ═══════════════════════════════════════════════════════════════

describe('T06 · 幂等键（AC-07 的一半）', () => {
  it('INTRODUCE_CONNECTION 是**提案级**：键里不含收件人', () => {
    // 介绍只发生一次，与谁收到通知无关。若键里含 recipientId，
    // "通知双方"会退化成两条介绍任务 → 可能介绍两次。R1 明确要求 (proposalId, 'introduce')。
    expect(jobDedupeKey('INTRODUCE_CONNECTION', { proposalId: 'p_1' })).toBe('introduce:p_1')
    expect(
      jobDedupeKey('INTRODUCE_CONNECTION', { proposalId: 'p_1', recipientId: 'u_x' })
    ).toBe('introduce:p_1')
  })

  it('通知类任务含收件人：否则"通知双方"会退化成"只通知一个"', () => {
    expect(jobDedupeKey('PROPOSAL_CREATED', { proposalId: 'p_1', recipientId: 'u_a' })).toBe(
      'proposal-created:p_1:u_a'
    )
    expect(jobDedupeKey('CONSENT_ACCEPTED', { proposalId: 'p_1', recipientId: 'u_a' })).toBe(
      'consent-accepted:p_1:u_a'
    )
    expect(jobDedupeKey('COORDINATION_FOLLOWUP', { proposalId: 'p_1', recipientId: 'u_a' })).toBe(
      'coordination-followup:p_1:u_a'
    )
  })

  it('同一提案的两个收件人 → 两个**不同**的键（但不影响介绍键唯一）', () => {
    const a = jobDedupeKey('PROPOSAL_CREATED', { proposalId: 'p_1', recipientId: 'u_a' })
    const b = jobDedupeKey('PROPOSAL_CREATED', { proposalId: 'p_1', recipientId: 'u_b' })
    expect(a).not.toBe(b)
  })

  it('通知类缺收件人 → 抛错（而不是造出一个"谁都不发"的键）', () => {
    expect(() => jobDedupeKey('PROPOSAL_CREATED', { proposalId: 'p_1' })).toThrow(/recipientId/)
    expect(() => jobDedupeKey('CONSENT_ACCEPTED', { proposalId: 'p_1' })).toThrow(/recipientId/)
    expect(() => jobDedupeKey('COORDINATION_FOLLOWUP', { proposalId: 'p_1' })).toThrow(/recipientId/)
  })

  it('键里不含时间戳/随机数：同输入必得同键（幂等的前提）', () => {
    const k1 = jobDedupeKey('PROPOSAL_CREATED', { proposalId: 'p_1', recipientId: 'u_a' })
    const k2 = jobDedupeKey('PROPOSAL_CREATED', { proposalId: 'p_1', recipientId: 'u_a' })
    expect(k1).toBe(k2)
  })

  it('投递键 = 任务键 + 渠道 + 收件人（同一动作的两个渠道是两条独立投递）', () => {
    const jobKey = 'introduce:p_1'
    expect(deliveryDedupeKey({ jobDedupeKey: jobKey, channel: 'IN_APP', recipientId: 'u_a' })).toBe(
      'introduce:p_1:in_app:u_a'
    )
    expect(deliveryDedupeKey({ jobDedupeKey: jobKey, channel: 'EMAIL', recipientId: 'u_a' })).toBe(
      'introduce:p_1:email:u_a'
    )
  })
})

// ═══════════════════════════════════════════════════════════════
// 终态集合
// ═══════════════════════════════════════════════════════════════

describe('T06 · 终态集合（AC-17 不变量 3）', () => {
  it('五种终态：SUCCEEDED / FAILED / DEAD / TAKEN_OVER / CANCELLED', () => {
    expect([...TERMINAL_JOB_STATUSES].sort()).toEqual(
      ['CANCELLED', 'DEAD', 'FAILED', 'SUCCEEDED', 'TAKEN_OVER'].sort()
    )
  })

  it('PENDING / RUNNING 不是终态', () => {
    expect(isTerminalJobStatus('PENDING')).toBe(false)
    expect(isTerminalJobStatus('RUNNING')).toBe(false)
  })

  it('每个终态都被 isTerminalJobStatus 认出', () => {
    for (const s of TERMINAL_JOB_STATUSES) expect(isTerminalJobStatus(s)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// 退避（指数 + 抖动）
// ═══════════════════════════════════════════════════════════════

describe('T06 · 退避（指数 + 抖动）', () => {
  it('随机源固定在区间下沿时 → 得到确定的最小值（指数正确增长）', () => {
    // rand=0 → jittered = capped - spread（区间下沿）。用它把"指数因子"钉死。
    expect(nextBackoffMs(1, DEFAULT_BACKOFF, () => 0)).toBe(22_500) // 30000*0.75
    expect(nextBackoffMs(2, DEFAULT_BACKOFF, () => 0)).toBe(45_000) // 60000*0.75
    expect(nextBackoffMs(3, DEFAULT_BACKOFF, () => 0)).toBe(90_000) // 120000*0.75
  })

  it('随机源取 0.5 → 恰好是未抖动的基准值（证明抖动是居中的）', () => {
    expect(nextBackoffMs(1, DEFAULT_BACKOFF, () => 0.5)).toBe(30_000)
    expect(nextBackoffMs(2, DEFAULT_BACKOFF, () => 0.5)).toBe(60_000)
  })

  it('抖动确实存在：rand=0 与 rand=1 给出不同的值（否则"抖动"是死代码）', () => {
    const lo = nextBackoffMs(2, DEFAULT_BACKOFF, () => 0)
    const hi = nextBackoffMs(2, DEFAULT_BACKOFF, () => 1)
    expect(hi).toBeGreaterThan(lo)
  })

  it('有上限：attempt 很大时不超过 maxMs 的抖动上界（不退避到宇宙热寂）', () => {
    const v = nextBackoffMs(50, DEFAULT_BACKOFF, () => 1)
    expect(v).toBeLessThanOrEqual(Math.ceil(DEFAULT_BACKOFF.maxMs * (1 + DEFAULT_BACKOFF.jitterRatio)))
  })

  it('attempt < 1 → 0（防御非法入参，而不是算出负数）', () => {
    expect(nextBackoffMs(0)).toBe(0)
    expect(nextBackoffMs(-3)).toBe(0)
  })

  it('jitterRatio=0 → 退化为纯指数（无抖动路径可被显式关闭）', () => {
    const policy = { ...DEFAULT_BACKOFF, jitterRatio: 0 }
    expect(nextBackoffMs(3, policy, () => 0)).toBe(120_000)
  })
})

// ═══════════════════════════════════════════════════════════════
// AC-17 · 租约与可领取性
// ═══════════════════════════════════════════════════════════════

describe('T06 · 租约与可领取性（AC-17 崩溃恢复）', () => {
  const now = T('2026-10-12T00:00:00.000Z')

  it('leaseExpiry 在 now 之上加 leaseMs', () => {
    expect(leaseExpiry(now, 60_000).getTime()).toBe(now.getTime() + 60_000)
    expect(leaseExpiry(now).getTime()).toBe(now.getTime() + DEFAULT_LEASE_MS)
  })

  it('isLeaseAlive：只有 RUNNING 且有未过期 lockedUntil 才算"有主"', () => {
    expect(isLeaseAlive({ status: 'RUNNING', lockedUntil: leaseExpiry(now, 60_000) }, now)).toBe(true)
    expect(
      isLeaseAlive({ status: 'RUNNING', lockedUntil: new Date(now.getTime() - 1) }, now)
    ).toBe(false)
    expect(isLeaseAlive({ status: 'RUNNING', lockedUntil: null }, now)).toBe(false)
    // 非 RUNNING 一律不"有主" —— 即便还留着 lockedUntil 的残值
    expect(isLeaseAlive({ status: 'PENDING', lockedUntil: leaseExpiry(now, 60_000) }, now)).toBe(false)
  })

  it('PENDING 且已到 nextAttemptAt → 可领取', () => {
    expect(isClaimable({ status: 'PENDING', nextAttemptAt: now, lockedUntil: null }, now)).toBe(true)
    expect(
      isClaimable({ status: 'PENDING', nextAttemptAt: new Date(now.getTime() - 1), lockedUntil: null }, now)
    ).toBe(true)
  })

  it('PENDING 但未到 nextAttemptAt → 不可领取（延迟任务要等）', () => {
    expect(
      isClaimable({ status: 'PENDING', nextAttemptAt: new Date(now.getTime() + 1000), lockedUntil: null }, now)
    ).toBe(false)
  })

  it('★ 租约未过期的 RUNNING → 不可被他人领取（否则会重复投递）', () => {
    expect(
      isClaimable({ status: 'RUNNING', nextAttemptAt: now, lockedUntil: leaseExpiry(now, 60_000) }, now)
    ).toBe(false)
  })

  it('★AC-17 租约**已过期**的 RUNNING → 可被领取（上一个执行者崩了）', () => {
    expect(
      isClaimable({ status: 'RUNNING', nextAttemptAt: now, lockedUntil: new Date(now.getTime() - 1) }, now)
    ).toBe(true)
  })

  it('🔒 所有终态一律不可领取 —— 尤其是 DEAD 不会自动复活', () => {
    for (const s of TERMINAL_JOB_STATUSES) {
      expect(
        isClaimable({ status: s as WorkflowJobStatus, nextAttemptAt: now, lockedUntil: null }, now)
      ).toBe(false)
    }
  })
})

// ═══════════════════════════════════════════════════════════════
// 失败三分法
// ═══════════════════════════════════════════════════════════════

describe('T06 · 失败分类与决策', () => {
  it('JobFailure 携带 kind 与 detail，可被 isJobFailure 认出', () => {
    const err = new JobFailure('permanent', 'boom', { blockers: ['x'] })
    expect(isJobFailure(err)).toBe(true)
    expect(err.kind).toBe('permanent')
    expect(err.detail).toEqual({ blockers: ['x'] })
    expect(err).toBeInstanceOf(Error)
  })

  it('未知错误默认 retryable（网络抖动能自愈，且 maxAttempts 兜底）', () => {
    expect(failureKindOf(new Error('ECONNRESET'))).toBe('retryable')
    expect(failureKindOf('a string')).toBe('retryable')
    expect(failureKindOf(undefined)).toBe('retryable')
  })

  it('显式 JobFailure 保留其 kind', () => {
    expect(failureKindOf(new JobFailure('permanent', 'x'))).toBe('permanent')
    expect(failureKindOf(new JobFailure('superseded', 'x'))).toBe('superseded')
  })

  it('★ 三分法不是两分法：superseded 有独立归宿，不被塞进 permanent', () => {
    expect(decideAfterFailure({ attempts: 1, maxAttempts: 5, kind: 'superseded' })).toBe('SUPERSEDE')
    expect(decideAfterFailure({ attempts: 1, maxAttempts: 5, kind: 'permanent' })).toBe('FAIL')
  })

  it('retryable：还有预算就重试', () => {
    expect(decideAfterFailure({ attempts: 1, maxAttempts: 5, kind: 'retryable' })).toBe('RETRY')
    expect(decideAfterFailure({ attempts: 4, maxAttempts: 5, kind: 'retryable' })).toBe('RETRY')
  })

  it('retryable 且预算用尽 → 进死信（DEAD，等人接管，而不是永久放弃）', () => {
    expect(decideAfterFailure({ attempts: 5, maxAttempts: 5, kind: 'retryable' })).toBe('DEAD')
    expect(decideAfterFailure({ attempts: 9, maxAttempts: 5, kind: 'retryable' })).toBe('DEAD')
  })

  it('permanent 不因为 attempts 多而变成 DEAD —— 它永远 FAIL', () => {
    expect(decideAfterFailure({ attempts: 99, maxAttempts: 5, kind: 'permanent' })).toBe('FAIL')
  })
})

// ═══════════════════════════════════════════════════════════════
// 阶段超时
// ═══════════════════════════════════════════════════════════════

describe('T06 · 阶段超时', () => {
  const now = T('2026-10-12T00:00:00.000Z')

  it('刚进入 → 未超时；超过阈值 → 超时', () => {
    expect(isStageTimedOut(now, now)).toBe(false)
    expect(isStageTimedOut(new Date(now.getTime() - DEFAULT_STAGE_TIMEOUT_MS - 1), now)).toBe(true)
  })

  it('边界：恰好等于阈值 → 判定为超时（>= 而非 >）', () => {
    expect(isStageTimedOut(new Date(now.getTime() - DEFAULT_STAGE_TIMEOUT_MS), now)).toBe(true)
  })

  it('timeoutMs<=0 → 永不超时（可用于临时关闭告警）', () => {
    expect(isStageTimedOut(new Date(0), now, 0)).toBe(false)
    expect(isStageTimedOut(new Date(0), now, -1)).toBe(false)
  })

  it('超时标签含阶段名，便于运营视图分组', () => {
    expect(stageTimeoutLabel('COORDINATING')).toBe('stage-stalled:COORDINATING')
  })
})

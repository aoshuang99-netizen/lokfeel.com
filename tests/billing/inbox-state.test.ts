/**
 * V25.5 P0.1 · R-15 Durable Inbox 状态机确定性测试（RED → GREEN）
 *
 * 为什么是纯函数测试：状态机是整个最终结算正确性的核心，必须能穷举；
 * 真实 DB / Provider 集成另由 inbox-store 与真实脚本覆盖。这里钉死判决表。
 *
 * 18+ 场景，覆盖：正常结算、幂等回放、R-15 failed→succeeded（Provider 三态）、
 * 成功→失败冲突、金额/币种差异、退款后成功、无 payment_id、无 plan、
 * 非钱事件、重试耗尽、终态不可推进等。
 */
import {
  decideSettlement,
  isProcessable,
  shouldDeadLetter,
  PROVIDER_UNAVAILABLE,
  INBOX_STATUSES,
  type DecideInput,
  type InboxEvent,
  type LedgerFacts,
  type PaymentTruth,
  type ChargeFacts,
} from '@/lib/billing/inbox-state'

const ORG = 'org_e2e'
const PAID: PaymentTruth = { status: 'paid', verified: true, amountCents: 14900, currency: 'USD' }
const UNPAID: PaymentTruth = { status: 'unpaid', verified: true, amountCents: null, currency: null }
const UNKNOWN: PaymentTruth = { status: 'unknown', verified: true, amountCents: null, currency: null, reason: 'provider timeout' }

function event(overrides: Partial<InboxEvent> = {}): InboxEvent {
  return {
    deliveryId: 'del_1',
    eventId: 'evt_1',
    type: 'payment.succeeded',
    organizationId: ORG,
    paymentId: 'pay_1',
    subscriptionId: 'sub_1',
    amountCents: 14900,
    currency: 'USD',
    payloadHash: 'sha256:abc',
    receivedAt: '2026-11-20T00:00:00.000Z',
    ...overrides,
  }
}

function charge(overrides: Partial<ChargeFacts> = {}): ChargeFacts {
  return { chargeId: 'pay_1', status: 'PENDING', amountCents: 14900, currency: 'USD', ...overrides }
}

function ledger(charges: ChargeFacts[], status: LedgerFacts['status'] = 'ACTIVE'): LedgerFacts {
  return { organizationId: ORG, status, charges }
}

function input(overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    event: event(),
    ledger: ledger([]),
    providerTruth: PROVIDER_UNAVAILABLE,
    alreadyApplied: false,
    plan: 'GROWTH',
    ...overrides,
  }
}

describe('P0.1 Inbox 状态机 · 正常与幂等', () => {
  it('① 新款项成功：APPLIED，交给翻译层常规结算，无冲突命令', () => {
    const d = decideSettlement(input({ ledger: ledger([]) }))
    expect(d.status).toBe('APPLIED')
    expect(d.commands).toHaveLength(0)
  })

  it('② PENDING 款项成功：APPLIED 常规结算', () => {
    const d = decideSettlement(input({ ledger: ledger([charge({ status: 'PENDING' })]) }))
    expect(d.status).toBe('APPLIED')
    expect(d.commands).toHaveLength(0)
  })

  it('③ 已 SUCCEEDED 款项再收成功：幂等 APPLIED，不重复入账', () => {
    const d = decideSettlement(input({ ledger: ledger([charge({ status: 'SUCCEEDED' })]) }))
    expect(d.status).toBe('APPLIED')
    expect(d.commands).toHaveLength(0)
    expect(d.note).toContain('ALREADY_SETTLED')
  })

  it('④ 同一 delivery 已处理：幂等回放，零命令', () => {
    const d = decideSettlement(input({ alreadyApplied: true, ledger: ledger([charge({ status: 'FAILED' })]) }))
    expect(d.status).toBe('APPLIED')
    expect(d.commands).toHaveLength(0)
    expect(d.note).toContain('IDEMPOTENT_REPLAY')
  })

  it('⑤ 非钱事件（subscription.updated）：APPLIED，不产生钱命令', () => {
    const d = decideSettlement(input({ event: event({ type: 'subscription.updated' }) }))
    expect(d.status).toBe('APPLIED')
    expect(d.commands).toHaveLength(0)
  })

  it('⑥ 钱事件缺 payment_id：DEAD_LETTER（可追踪，不静默）', () => {
    const d = decideSettlement(input({ event: event({ paymentId: null }) }))
    expect(d.status).toBe('DEAD_LETTER')
  })
})

describe('P0.1 R-15 核心 · FAILED → SUCCEEDED 冲突', () => {
  const failedLedger = () => ledger([charge({ status: 'FAILED' })], 'PAST_DUE')

  it('⑦ Provider 确认已付：派生新 chargeId 补偿结算 → SETTLED，两条命令', () => {
    const d = decideSettlement(input({ ledger: failedLedger(), providerTruth: PAID }))
    expect(d.status).toBe('SETTLED')
    expect(d.commands).toHaveLength(2)
    expect(d.commands.map((c) => c.type)).toEqual(['CHARGE_CREATED', 'CHARGE_SUCCEEDED'])
    expect(d.commands[0].chargeId).not.toBe('pay_1')
    expect(d.commands[0].chargeId).toContain('recovered')
    expect(d.commands.every((c) => c.recovery)).toBe(true)
  })

  it('⑧ 补偿命令 dedupeKey 唯一且两条不同（幂等结算）', () => {
    const d = decideSettlement(input({ ledger: failedLedger(), providerTruth: PAID }))
    const keys = d.commands.map((c) => c.dedupeKey)
    expect(new Set(keys).size).toBe(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('⑨ Provider 确认未付：DEAD_LETTER，绝不授予权益', () => {
    const d = decideSettlement(input({ ledger: failedLedger(), providerTruth: UNPAID }))
    expect(d.status).toBe('DEAD_LETTER')
    expect(d.commands).toHaveLength(0)
  })

  it('⑩ Provider 未知（verified=true 但 status=unknown）：需核验', () => {
    const d = decideSettlement(input({ ledger: failedLedger(), providerTruth: UNKNOWN }))
    expect(d.status).toBe('NEEDS_PROVIDER_RECONCILIATION')
    expect(d.commands).toHaveLength(0)
  })

  it('⑪ Provider 不可用（无凭据 PROVIDER_NOT_TESTED）：需核验，绝不擅自结算', () => {
    const d = decideSettlement(input({ ledger: failedLedger(), providerTruth: PROVIDER_UNAVAILABLE }))
    expect(d.status).toBe('NEEDS_PROVIDER_RECONCILIATION')
    expect(d.commands).toHaveLength(0)
  })

  it('⑫ 金额不一致：REQUIRES_REVIEW（防串单/伪造）', () => {
    const d = decideSettlement(input({
      ledger: failedLedger(),
      providerTruth: PAID,
      event: event({ amountCents: 999 }),
    }))
    expect(d.status).toBe('REQUIRES_REVIEW')
    expect(d.commands).toHaveLength(0)
  })

  it('⑬ 币种不一致：REQUIRES_REVIEW', () => {
    const d = decideSettlement(input({
      ledger: failedLedger(),
      providerTruth: PAID,
      event: event({ currency: 'CNY' }),
    }))
    expect(d.status).toBe('REQUIRES_REVIEW')
  })

  it('⑭ 无 plan 无法结算：REQUIRES_REVIEW（不猜档位）', () => {
    const d = decideSettlement(input({ ledger: failedLedger(), providerTruth: PAID, plan: null }))
    expect(d.status).toBe('REQUIRES_REVIEW')
  })
})

describe('P0.1 冲突反向 · 成功 → 失败 与退款', () => {
  it('⑮ 成功后收到失败 + Provider 未核实：需核验，绝不撤销已确认权益', () => {
    const d = decideSettlement(input({
      event: event({ type: 'payment.failed' }),
      ledger: ledger([charge({ status: 'SUCCEEDED' })]),
      providerTruth: PROVIDER_UNAVAILABLE,
    }))
    expect(d.status).toBe('NEEDS_PROVIDER_RECONCILIATION')
    expect(d.commands).toHaveLength(0)
  })

  it('⑯ 成功后收到失败 + Provider 确认已付：REQUIRES_REVIEW（不撤销权益）', () => {
    const d = decideSettlement(input({
      event: event({ type: 'payment.failed' }),
      ledger: ledger([charge({ status: 'SUCCEEDED' })]),
      providerTruth: PAID,
    }))
    expect(d.status).toBe('REQUIRES_REVIEW')
  })

  it('⑰ 退款后收到成功：REQUIRES_REVIEW', () => {
    const d = decideSettlement(input({ ledger: ledger([charge({ status: 'REFUNDED' })]) }))
    expect(d.status).toBe('REQUIRES_REVIEW')
  })

  it('⑱ 常规失败（PENDING→failed）：APPLIED 交账本内核', () => {
    const d = decideSettlement(input({
      event: event({ type: 'payment.failed' }),
      ledger: ledger([charge({ status: 'PENDING' })]),
    }))
    expect(d.status).toBe('APPLIED')
  })

  it('⑲ 无对应款项的失败事件：APPLIED 但忽略（不凭空造款）', () => {
    const d = decideSettlement(input({
      event: event({ type: 'payment.failed' }),
      ledger: ledger([]),
    }))
    expect(d.status).toBe('APPLIED')
    expect(d.note).toContain('FAILED_WITHOUT_CHARGE')
  })
})

describe('P0.1 状态机可推进性', () => {
  it('⑳ 仅 RECEIVED / RETRYABLE / NEEDS_PROVIDER 可推进；终态不可', () => {
    expect(isProcessable('RECEIVED')).toBe(true)
    expect(isProcessable('RETRYABLE')).toBe(true)
    expect(isProcessable('NEEDS_PROVIDER_RECONCILIATION')).toBe(true)
    expect(isProcessable('APPLIED')).toBe(false)
    expect(isProcessable('SETTLED')).toBe(false)
    expect(isProcessable('REQUIRES_REVIEW')).toBe(false)
    expect(isProcessable('DEAD_LETTER')).toBe(false)
  })

  it('㉑ 重试耗尽 → DEAD_LETTER；非可推进态不触发', () => {
    expect(shouldDeadLetter(3, 3, 'RETRYABLE')).toBe(true)
    expect(shouldDeadLetter(2, 3, 'RETRYABLE')).toBe(false)
    expect(shouldDeadLetter(9, 3, 'APPLIED')).toBe(false)
  })

  it('㉒ 状态枚举完整且无重复', () => {
    expect(new Set(INBOX_STATUSES).size).toBe(INBOX_STATUSES.length)
    expect(INBOX_STATUSES).toContain('SETTLED')
    expect(INBOX_STATUSES).toContain('REQUIRES_REVIEW')
  })
})

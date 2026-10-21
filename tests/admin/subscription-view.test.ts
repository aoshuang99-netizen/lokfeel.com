/**
 * V16 · T01 回归：Admin 订阅列表归一化
 *
 * 这些用例针对的是**真实发生过的崩溃**：
 *   修复前页面渲染 `{sub.amount} {sub.currency.toUpperCase()}`，
 *   而 API 从不返回这两个字段 —— 打开页面就 TypeError 白屏。
 * 因此下面第一条用例就是"缺字段不得抛错"，变异回旧写法必红。
 */
import {
  formatDay,
  formatPeriod,
  formatPlanAmount,
  normalizeStatus,
  statusLabel,
  toSubscriptionRow,
  toSubscriptionRows,
} from '@/lib/admin/subscription-view'

describe('normalizeStatus', () => {
  it('把 DB 的大写枚举归一化为小写 key', () => {
    expect(normalizeStatus('ACTIVE')).toBe('active')
    expect(normalizeStatus('CANCELLED')).toBe('cancelled')
    expect(normalizeStatus('PAST_DUE')).toBe('past_due')
    expect(normalizeStatus('TRIALING')).toBe('trialing')
    expect(normalizeStatus('EXPIRED')).toBe('expired')
  })

  it('接受连字符与大小写混写', () => {
    expect(normalizeStatus('past-due')).toBe('past_due')
    expect(normalizeStatus('Past_Due')).toBe('past_due')
  })

  it('未知状态降级为 unknown，而不是冒充 active', () => {
    expect(normalizeStatus('SOMETHING_NEW')).toBe('unknown')
    expect(normalizeStatus(undefined)).toBe('unknown')
    expect(normalizeStatus(null)).toBe('unknown')
    expect(normalizeStatus(42)).toBe('unknown')
    expect(statusLabel('unknown')).toBe('未知')
  })
})

describe('formatPlanAmount', () => {
  it('从单一配置源派生月付与年付价格', () => {
    expect(formatPlanAmount('PREMIUM_MONTHLY')).toBe('$19.99 / 月')
    expect(formatPlanAmount('PREMIUM_YEARLY')).toBe('$149.99 / 年')
  })

  it('不在售或未知档显示占位符，不编造 $0.00', () => {
    expect(formatPlanAmount('FREE')).toBe('—')
    expect(formatPlanAmount('LADY_FREE')).toBe('—')
    expect(formatPlanAmount('LIFETIME')).toBe('—')
    expect(formatPlanAmount('NOT_A_PLAN')).toBe('—')
    expect(formatPlanAmount(undefined)).toBe('—')
  })
})

describe('formatDay / formatPeriod', () => {
  it('无效或缺失日期返回空串（绝不产生 Invalid Date）', () => {
    expect(formatDay(null)).toBe('')
    expect(formatDay(undefined)).toBe('')
    expect(formatDay('')).toBe('')
    expect(formatDay('not-a-date')).toBe('')
  })

  it('合法 ISO 取日期部分', () => {
    expect(formatDay('2026-10-01T12:34:56.000Z')).toBe('2026-10-01')
  })

  it('endsAt 缺失时退回 stripeCurrentPeriodEnd', () => {
    expect(
      formatPeriod({
        startsAt: '2026-10-01T00:00:00.000Z',
        stripeCurrentPeriodEnd: '2026-11-01T00:00:00.000Z',
      }),
    ).toBe('2026-10-01 → 2026-11-01')
  })

  it('两端都缺失返回破折号', () => {
    expect(formatPeriod({})).toBe('—')
    expect(formatPeriod({ endsAt: 'garbage' })).toBe('—')
  })
})

describe('toSubscriptionRow — 崩溃回归', () => {
  it('API 不返回 amount/currency 时不抛错（旧写法在此崩）', () => {
    const apiRow = {
      id: 'sub_1',
      userId: 'u_1',
      userName: 'Alice',
      plan: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      startsAt: '2026-10-01T00:00:00.000Z',
      stripeCurrentPeriodEnd: '2026-11-01T00:00:00.000Z',
    }

    expect(() => toSubscriptionRow(apiRow)).not.toThrow()

    const row = toSubscriptionRow(apiRow)
    expect(row.userLabel).toBe('Alice')
    expect(row.planLabel).toBe('Premium Monthly')
    expect(row.status).toBe('active')
    expect(row.amountLabel).toBe('$19.99 / 月')
    expect(row.periodLabel).toBe('2026-10-01 → 2026-11-01')
    expect(row.refundable).toBe(true)
  })

  it('全空对象也只是降级，不崩', () => {
    const row = toSubscriptionRow({})
    expect(row.userLabel).toBe('—')
    expect(row.planLabel).toBe('—')
    expect(row.status).toBe('unknown')
    expect(row.amountLabel).toBe('—')
    expect(row.periodLabel).toBe('—')
    expect(row.refundable).toBe(false)
  })

  it('非活跃状态不可退款（避免对已取消订阅发起退款）', () => {
    expect(toSubscriptionRow({ id: 's', status: 'CANCELLED' }).refundable).toBe(false)
    expect(toSubscriptionRow({ id: 's', status: 'EXPIRED' }).refundable).toBe(false)
    expect(toSubscriptionRow({ id: 's', status: 'TRIALING' }).refundable).toBe(false)
    expect(toSubscriptionRow({ id: 's', status: 'PAST_DUE' }).refundable).toBe(true)
  })
})

describe('toSubscriptionRows — 列表容错', () => {
  it('非数组返回空数组', () => {
    expect(toSubscriptionRows(null)).toEqual([])
    expect(toSubscriptionRows(undefined)).toEqual([])
    expect(toSubscriptionRows({ subscriptions: [] })).toEqual([])
    expect(toSubscriptionRows('oops')).toEqual([])
  })

  it('过滤掉非对象和缺 id 的项', () => {
    const rows = toSubscriptionRows([
      null,
      'x',
      42,
      { id: '', userName: 'no-id' },
      { id: 'ok', userName: 'Bob' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].userLabel).toBe('Bob')
  })

  it('前置非空：确认样本确实产出了行（防空集恒真）', () => {
    const rows = toSubscriptionRows([{ id: 'a' }, { id: 'b' }])
    expect(rows.length).toBe(2)
  })
})

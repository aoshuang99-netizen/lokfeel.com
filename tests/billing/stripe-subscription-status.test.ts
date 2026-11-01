/**
 * B-14 · Stripe 订阅状态映射必须 fail closed
 * ═══════════════════════════════════════════════════════════════════════
 * 钉住三件事：
 *
 *   1. **8 个 Stripe 状态全覆盖**。原实现只映射 5 个，`|| "ACTIVE"` 兜底把
 *      `incomplete` / `incomplete_expired` / `paused` 当成了生效订阅。
 *      这不是显示问题 —— `user/limits`、`message-guards`、`matches/request`
 *      三处门禁都只认 `status === 'ACTIVE'`，ACTIVE 即等于「无限私信」。
 *
 *   2. **未知状态不得发放权益**。Stripe 将来新增状态时，宁可少发一次权益
 *      （下一条事件会纠正），也不能白送（`incomplete_expired` 是终态，永不纠正）。
 *
 *   3. **无权事件不得抹掉 `cancelledAt`**。原实现 `cancel_at_period_end ? now : null`
 *      会在未付款的新订阅到达时把历史取消记录清成 null。
 */
import {
  KNOWN_STRIPE_STATUSES,
  isEntitledStatus,
  nextCancelledAt,
  periodEndOf,
  translateStripeStatus,
} from '@/lib/stripe/subscription-status';

describe('translateStripeStatus — 全集覆盖', () => {
  // 断言集合完整性：Stripe API 2023-10-16 的 Subscription.Status 就是这 8 个。
  // 若上游新增状态，这里必须先失败一次，逼人回去改映射，而不是被兜底吞掉。
  const EXPECTED: Record<string, string> = {
    active: 'ACTIVE',
    trialing: 'TRIALING',
    past_due: 'PAST_DUE',
    canceled: 'CANCELLED',
    unpaid: 'EXPIRED',
    incomplete: 'PAST_DUE',
    incomplete_expired: 'EXPIRED',
    paused: 'PAST_DUE',
  };

  it.each(Object.entries(EXPECTED))('%s → %s', (raw, expected) => {
    const t = translateStripeStatus(raw);
    expect(t.status).toBe(expected);
    expect(t.raw).toBe(raw);
    expect(t.unknown).toBe(false);
  });

  it('已知状态数量与 Stripe 官方一致（8 个）', () => {
    expect([...KNOWN_STRIPE_STATUSES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('只有 active / trialing 发放权益', () => {
    const entitled = KNOWN_STRIPE_STATUSES.filter((s) => translateStripeStatus(s).entitled);
    expect(entitled.sort()).toEqual(['active', 'trialing']);
  });

  it.each(['incomplete', 'incomplete_expired', 'paused'])(
    '回归：%s 绝不能翻译成 ACTIVE（原实现的 || "ACTIVE" 兜底）',
    (raw) => {
      expect(translateStripeStatus(raw).status).not.toBe('ACTIVE');
      expect(translateStripeStatus(raw).entitled).toBe(false);
    },
  );

  it('不需要授权费（一毛钱都没收到）的状态一律关闭权益', () => {
    for (const raw of ['incomplete', 'incomplete_expired', 'paused', 'unpaid', 'canceled']) {
      expect(translateStripeStatus(raw).entitled).toBe(false);
    }
  });
});

describe('translateStripeStatus — 未知状态 fail closed', () => {
  it.each(['some_future_status', '', 'ACTIVE', null, undefined, 42])(
    '%p 不抛错、不发权益、标记 unknown',
    (raw) => {
      const t = translateStripeStatus(raw);
      expect(t.unknown).toBe(true);
      expect(t.entitled).toBe(false);
      expect(t.status).not.toBe('ACTIVE');
    },
  );

  it('未知状态落到非终态 PAST_DUE（可被下一条正常事件纠正）', () => {
    expect(translateStripeStatus('brand_new_status').status).toBe('PAST_DUE');
  });
});

describe('isEntitledStatus', () => {
  it('ACTIVE / TRIALING 为真，其余为假', () => {
    expect(isEntitledStatus('ACTIVE')).toBe(true);
    expect(isEntitledStatus('TRIALING')).toBe(true);
    expect(isEntitledStatus('PAST_DUE')).toBe(false);
    expect(isEntitledStatus('CANCELLED')).toBe(false);
    expect(isEntitledStatus('EXPIRED')).toBe(false);
  });
});

describe('nextCancelledAt', () => {
  const now = new Date('2026-11-01T00:00:00.000Z');
  const previous = new Date('2026-10-01T00:00:00.000Z');

  it('排定期末取消 → 记 now', () => {
    expect(nextCancelledAt(null, { entitled: true }, true, now)).toEqual(now);
    expect(nextCancelledAt(previous, { entitled: true }, true, now)).toEqual(now);
  });

  it('恢复且仍有权 → 清空（否则取消端点永远回「已排定」）', () => {
    expect(nextCancelledAt(previous, { entitled: true }, false, now)).toBeNull();
  });

  it('回归：无权事件（未付款/暂停）不得抹掉历史取消记录', () => {
    expect(nextCancelledAt(previous, { entitled: false }, false, now)).toEqual(previous);
  });
});

describe('periodEndOf', () => {
  it('读顶层 current_period_end（秒 → Date）', () => {
    const d = periodEndOf({ current_period_end: 1767225600 });
    expect(d?.toISOString()).toBe(new Date(1767225600 * 1000).toISOString());
  });

  it('兼容 items.data[0] 上的 current_period_end', () => {
    const d = periodEndOf({ items: { data: [{ current_period_end: 1767225600 }] } });
    expect(d?.toISOString()).toBe(new Date(1767225600 * 1000).toISOString());
  });

  it('读不到返回 null —— 由调用点「不写」，不许猜 now+30d（B-12 同类错误）', () => {
    expect(periodEndOf({})).toBeNull();
    expect(periodEndOf({ current_period_end: null })).toBeNull();
    expect(periodEndOf(null)).toBeNull();
    expect(periodEndOf({ items: { data: [] } })).toBeNull();
  });
});

/**
 * 取消订阅的核心断言（V18-04）
 * ═══════════════════════════════════════════════════════════════════════
 * 这个文件里最值钱的不是"成功路径"，而是这几条**反例**：
 *
 *   · 凭据没配 ⇒ 返回 503，并且**数据库一个字节都没动**；
 *   · 服务商抛异常 ⇒ 返回 502，数据库仍然没动；
 *   · 服务商回 `cancelAtPeriodEnd: false` ⇒ 也当失败，不写库。
 *
 * 之所以要这么较真：取消订阅最容易出的错不是"取消不了"，而是
 * **"页面显示已取消，实际还在扣款"**。那类 bug 用户几个月后才发现，
 * 退款都不一定救得回来。所以这里把「先让服务商确认、再写库」的顺序钉死：
 * 任何"未确认"的分支，`markCancelScheduled` 的调用次数必须是 0。
 */

import {
  CANCEL_CODES,
  cancelSubscriptionForUser,
  type CancelDeps,
} from '@/lib/payments/cancel-subscription';

type Fakes = {
  deps: CancelDeps;
  calls: {
    load: number;
    provider: number;
    mark: Array<{ id: string; at: Date }>;
  };
};

function makeDeps(overrides: Partial<CancelDeps> = {}): Fakes {
  const calls: Fakes['calls'] = { load: 0, provider: 0, mark: [] };

  const deps: CancelDeps = {
    loadActive: async () => {
      calls.load += 1;
      return { id: 'sub_1', stripeSubscriptionId: 'stripe_sub_1', cancelledAt: null };
    },
    isStripeReady: () => true,
    cancelAtPeriodEnd: async () => {
      calls.provider += 1;
      return { cancelAtPeriodEnd: true, currentPeriodEnd: 1_767_225_600 };
    },
    markCancelScheduled: async (id, at) => {
      calls.mark.push({ id, at });
    },
    now: () => new Date('2026-10-22T00:00:00.000Z'),
    ...overrides,
  };

  return { deps, calls };
}

describe('取消订阅 · 前置与幂等', () => {
  it('没有有效订阅 ⇒ 404，且完全不碰服务商与数据库', async () => {
    const { deps, calls } = makeDeps({ loadActive: async () => null });
    const r = await cancelSubscriptionForUser('u1', deps);

    expect(r).toMatchObject({ ok: false, status: 404, code: CANCEL_CODES.NO_ACTIVE_SUBSCRIPTION });
    expect(calls.provider).toBe(0);
    expect(calls.mark).toHaveLength(0);
  });

  it('本地有订阅但服务商无 id ⇒ 409（不假装取消成功）', async () => {
    const { deps, calls } = makeDeps({
      loadActive: async () => ({ id: 'sub_1', stripeSubscriptionId: null, cancelledAt: null }),
    });
    const r = await cancelSubscriptionForUser('u1', deps);

    expect(r).toMatchObject({ ok: false, status: 409, code: CANCEL_CODES.NO_REMOTE_SUBSCRIPTION });
    expect(calls.provider).toBe(0);
    expect(calls.mark).toHaveLength(0);
  });

  it('已经排过期末取消 ⇒ 幂等返回，不再打服务商（避免重复调用）', async () => {
    const { deps, calls } = makeDeps({
      loadActive: async () => ({
        id: 'sub_1',
        stripeSubscriptionId: 'stripe_sub_1',
        cancelledAt: new Date('2026-10-20T00:00:00.000Z'),
      }),
    });
    const r = await cancelSubscriptionForUser('u1', deps);

    expect(r).toMatchObject({ ok: true, alreadyScheduled: true });
    expect(calls.provider).toBe(0);
    expect(calls.mark).toHaveLength(0);
  });
});

describe('取消订阅 · 不许假成功（每一条都必须无副作用）', () => {
  it('凭据未配 ⇒ 503 PAYMENT_NOT_CONFIGURED，且数据库没动', async () => {
    const { deps, calls } = makeDeps({ isStripeReady: () => false });
    const r = await cancelSubscriptionForUser('u1', deps);

    expect(r).toMatchObject({ ok: false, status: 503, code: CANCEL_CODES.PAYMENT_NOT_CONFIGURED });
    expect(calls.provider).toBe(0);
    expect(calls.mark).toHaveLength(0);
  });

  it('服务商抛异常 ⇒ 502，且数据库没动', async () => {
    const { deps, calls } = makeDeps({
      cancelAtPeriodEnd: async () => {
        calls.provider += 1;
        throw new Error('network down');
      },
    });
    const r = await cancelSubscriptionForUser('u1', deps);

    expect(r).toMatchObject({ ok: false, status: 502, code: CANCEL_CODES.UPSTREAM_ERROR });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('network down');
    expect(calls.mark).toHaveLength(0);
  });

  it('服务商回「没排上取消」⇒ 也算失败，不写库（最阴的一种）', async () => {
    const { deps, calls } = makeDeps({
      cancelAtPeriodEnd: async () => {
        calls.provider += 1;
        return { cancelAtPeriodEnd: false, currentPeriodEnd: null };
      },
    });
    const r = await cancelSubscriptionForUser('u1', deps);

    expect(r).toMatchObject({ ok: false, status: 502, code: CANCEL_CODES.UPSTREAM_ERROR });
    expect(calls.mark).toHaveLength(0);
  });

  it('负向对照：不能因为「库写失败」就把成功报给用户', async () => {
    const { deps } = makeDeps({
      markCancelScheduled: async () => {
        throw new Error('db write failed');
      },
    });
    // 写库失败会冒泡 —— 这里断言"不会静默吞掉"，宁可 500 也不许假装成功
    await expect(cancelSubscriptionForUser('u1', deps)).rejects.toThrow('db write failed');
  });
});

describe('取消订阅 · 成功路径', () => {
  it('服务商确认后才写库，且只写一次 cancelledAt', async () => {
    const { deps, calls } = makeDeps();
    const r = await cancelSubscriptionForUser('u1', deps);

    expect(r).toMatchObject({ ok: true, alreadyScheduled: false, cancelAtPeriodEnd: true });
    expect(calls.provider).toBe(1);
    expect(calls.mark).toHaveLength(1);
    expect(calls.mark[0].id).toBe('sub_1');
    expect(calls.mark[0].at.toISOString()).toBe('2026-10-22T00:00:00.000Z');
  });

  it('回传的 currentPeriodEnd 是 ISO（秒 → 毫秒换算正确）', async () => {
    const { deps } = makeDeps();
    const r = await cancelSubscriptionForUser('u1', deps);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.currentPeriodEnd).toBe(new Date(1_767_225_600 * 1000).toISOString());
    }
  });

  it('服务商没给 currentPeriodEnd ⇒ 回 null，而不是编一个时间', async () => {
    const { deps } = makeDeps({
      cancelAtPeriodEnd: async () => ({ cancelAtPeriodEnd: true, currentPeriodEnd: null }),
    });
    const r = await cancelSubscriptionForUser('u1', deps);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.currentPeriodEnd).toBeNull();
  });
});

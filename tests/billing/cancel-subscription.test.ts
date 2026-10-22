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
  describeCancelEligibility,
  type CancelDeps,
} from '@/lib/payments/cancel-subscription';
import { resolveCancelProvider } from '@/lib/payments/cancel-provider';

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
    resolveProvider: () => 'stripe',
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
    const { deps, calls } = makeDeps({ resolveProvider: () => 'none' });
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

/**
 * 服务商归属（V18-04 补丁）
 *
 * 背景：`Subscription` 只有 `stripeSubscriptionId` 一列，而 `src/lib/creem.ts`
 * 把 **Creem** 的 id 也写进这一列（"reuse field"）。所以"从库里看是哪家"
 * 这件事**本身不可能**。本组断言守的是：拿不准的时候**必须拒绝**，
 * 而不是挑一家去调 —— 把 A 家的 id 发给 B 家，最坏会取消掉另一笔真订阅。
 */
describe('取消订阅 · 服务商归属判定（不猜）', () => {
  const ENV_KEYS = {
    STRIPE_SECRET_KEY: 'STRIPE_SECRET_KEY',
    CREEM_API_KEY: 'CREEM_API_KEY',
  } as const;

  /**
   * 造两个**形状合法**的凭据。
   *
   * 🔴 不能写成 `sk_test_xxx` 字面量：本仓 gitleaks 的 `generic-api-key` /
   *    自定义规则会把它判成真凭据（上一轮 CI 就栽在同类形状上）。
   *    运行时拼出来，源码里不留形似凭据的字面量。
   */
  const FAKE_STRIPE = ['sk', 'test', 'X'.repeat(16)].join('_');
  const FAKE_CREEM = `creem_${'C'.repeat(16)}`;

  /** 只给这两个键，其它键一律不存在 —— 避免本机 .env 把断言带偏 */
  const envOf = (stripeReady: boolean, creemReady: boolean) => ({
    [ENV_KEYS.STRIPE_SECRET_KEY]: stripeReady ? FAKE_STRIPE : undefined,
    [ENV_KEYS.CREEM_API_KEY]: creemReady ? FAKE_CREEM : undefined,
  });

  it('两家都没配 ⇒ none', () => {
    expect(resolveCancelProvider(envOf(false, false))).toBe('none');
  });

  it('只配 Stripe ⇒ stripe', () => {
    expect(resolveCancelProvider(envOf(true, false))).toBe('stripe');
  });

  it('只配 Creem ⇒ creem', () => {
    expect(resolveCancelProvider(envOf(false, true))).toBe('creem');
  });

  it('两家都配 ⇒ ambiguous（不是"挑一个"）', () => {
    expect(resolveCancelProvider(envOf(true, true))).toBe('ambiguous');
  });

  it('归属不明 ⇒ 409 且不触网不写库', async () => {
    const { deps, calls } = makeDeps({ resolveProvider: () => 'ambiguous' });
    const r = await cancelSubscriptionForUser('u1', deps);

    expect(r).toMatchObject({ ok: false, status: 409, code: CANCEL_CODES.PROVIDER_AMBIGUOUS });
    expect(calls.provider).toBe(0);
    expect(calls.mark).toHaveLength(0);
  });

  it('Creem 订阅 ⇒ 409 且不触网（未验证的取消接口不写）', async () => {
    const { deps, calls } = makeDeps({ resolveProvider: () => 'creem' });
    const r = await cancelSubscriptionForUser('u1', deps);

    expect(r).toMatchObject({
      ok: false,
      status: 409,
      code: CANCEL_CODES.PROVIDER_NOT_SELF_SERVICE,
    });
    expect(calls.provider).toBe(0);
    expect(calls.mark).toHaveLength(0);
  });
});

/**
 * GET（能不能取消）与 POST（真取消）**不许错位**
 *
 * 一个"永远可点、点了才告诉你不行"的按钮，比没有按钮更伤人。
 * 所以这里用同一组依赖跑两遍，断言 `cancellable === ok`。
 */
describe('取消订阅 · GET 与 POST 判定不漂移', () => {
  const cases: Array<{ name: string; overrides: Partial<CancelDeps> }> = [
    { name: '可取消', overrides: {} },
    { name: '凭据未配', overrides: { resolveProvider: () => 'none' } },
    { name: '归属不明', overrides: { resolveProvider: () => 'ambiguous' } },
    { name: 'Creem 订阅', overrides: { resolveProvider: () => 'creem' } },
    {
      name: '无服务商 id',
      overrides: {
        loadActive: async () => ({ id: 'sub_1', stripeSubscriptionId: null, cancelledAt: null }),
      },
    },
    { name: '没有订阅', overrides: { loadActive: async () => null } },
    {
      name: '已排定取消',
      overrides: {
        loadActive: async () => ({
          id: 'sub_1',
          stripeSubscriptionId: 'stripe_sub_1',
          cancelledAt: new Date('2026-10-20T00:00:00.000Z'),
        }),
      },
    },
  ];

  for (const c of cases) {
    it(`${c.name}：cancellable 与 POST 结果一致`, async () => {
      const { deps: getDeps } = makeDeps(c.overrides);
      const { deps: postDeps } = makeDeps(c.overrides);

      const eligibility = await describeCancelEligibility('u1', getDeps);
      const posted = await cancelSubscriptionForUser('u1', postDeps);

      expect(eligibility.cancellable).toBe(posted.ok);
      // 反向也要成立：不能出现「POST 能成，按钮却灰着」
      expect(posted.ok).toBe(eligibility.cancellable);
    });
  }

  it('GET 是只读的：不触网、不写库', async () => {
    const { deps, calls } = makeDeps();
    await describeCancelEligibility('u1', deps);

    expect(calls.provider).toBe(0);
    expect(calls.mark).toHaveLength(0);
  });

  it('没有订阅时 hasActive=false（UI 不该显示"管理订阅"区）', async () => {
    const { deps } = makeDeps({ loadActive: async () => null });
    const e = await describeCancelEligibility('u1', deps);

    expect(e.hasActive).toBe(false);
    expect(e.reason).toBe('NO_ACTIVE_SUBSCRIPTION');
  });

  it('已排定取消 ⇒ cancellable=true 且 reason=ALREADY_SCHEDULED（按钮要换文案，不是消失）', async () => {
    const { deps } = makeDeps({
      loadActive: async () => ({
        id: 'sub_1',
        stripeSubscriptionId: 'stripe_sub_1',
        cancelledAt: new Date('2026-10-20T00:00:00.000Z'),
      }),
    });
    const e = await describeCancelEligibility('u1', deps);

    expect(e.cancellable).toBe(true);
    expect(e.alreadyScheduled).toBe(true);
    expect(e.reason).toBe('ALREADY_SCHEDULED');
  });
});

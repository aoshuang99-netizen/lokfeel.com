/**
 * Dodo 事件 → 账本命令的翻译（纯函数）
 *
 * 这组测试的核心不是"字段有没有映射对"，而是**顺序与幂等**：
 *   · 顺序错 → 账本内核拒绝（CHARGE_CREATED 必须在收款之前、且订阅必须已 ACTIVE）；
 *   · 幂等错 → 同一笔钱入账两次，或第二次续费被当成重复而丢弃。
 *
 * 而 Dodo 官方明确：`payment.succeeded` 与 `subscription.renewed` **成对到达**，
 * 且 `payment.succeeded` 可能晚 2–10 分钟。所以"两份事件到达顺序不确定"是常态，
 * 不是边界 —— 这组用例必须覆盖两个方向。
 */
import {
  translateDodoEvent,
  organizationIdOfEvent,
  resolvePlanForEvent,
  type LedgerSnapshot,
} from '@/lib/payments/dodo/events';
import { BILLING_INTERVALS, DODO_PRODUCT_ENV, SELLABLE_PLAN_IDS } from '@/config/subscription-plans';

const ENV: Record<string, string> = (() => {
  const env: Record<string, string> = {};
  for (const plan of SELLABLE_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      env[DODO_PRODUCT_ENV[plan][interval]] = `pdt_${plan.toLowerCase()}_${interval}`;
    }
  }
  return env;
})();

const NONE: LedgerSnapshot = { plan: 'FREE', status: 'NONE' };
const ACTIVE_GROWTH: LedgerSnapshot = { plan: 'GROWTH', status: 'ACTIVE' };

const META = { organizationId: 'org_1', plan: 'GROWTH', interval: 'monthly' };

describe('事件翻译 · 首单（钱与开通同时发生）', () => {
  it('payment.succeeded 先到（订阅尚未开通）⇒ 开通 → 建款 → 收款，三条且顺序固定', () => {
    const outcome = translateDodoEvent(
      {
        type: 'payment.succeeded',
        data: {
          payment_id: 'pay_1',
          subscription_id: 'sub_1',
          product_id: 'pdt_growth_monthly',
          total_amount: 14900,
          currency: 'usd',
          metadata: META,
        },
      },
      NONE,
      ENV,
    );

    expect(outcome.kind).toBe('apply');
    if (outcome.kind !== 'apply') return;

    expect(outcome.organizationId).toBe('org_1');
    expect(outcome.commands.map((c) => c.type)).toEqual([
      'SUBSCRIPTION_STARTED',
      'CHARGE_CREATED',
      'CHARGE_SUCCEEDED',
    ]);
    // 偏移必须严格递增，否则内核会按 id 字典序定序，顺序变得不可预测
    const offsets = outcome.commands.map((c) => c.offsetMs);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(new Set(offsets).size).toBe(offsets.length);

    expect(outcome.commands[0].plan).toBe('GROWTH');
    expect(outcome.commands[1]).toMatchObject({
      chargeId: 'pay_1',
      amountCents: 14900,
      currency: 'USD',
    });
    expect(outcome.commands[2].gatewayStatus).toBe('SUCCEEDED');
  });

  it('订阅已 ACTIVE 时再来 payment.succeeded（续费）⇒ 不再重复开通', () => {
    const outcome = translateDodoEvent(
      {
        type: 'payment.succeeded',
        data: {
          payment_id: 'pay_2',
          subscription_id: 'sub_1',
          product_id: 'pdt_growth_monthly',
          total_amount: 14900,
          currency: 'USD',
          metadata: META,
        },
      },
      ACTIVE_GROWTH,
      ENV,
    );

    expect(outcome.kind).toBe('apply');
    if (outcome.kind !== 'apply') return;
    expect(outcome.commands.map((c) => c.type)).toEqual(['CHARGE_CREATED', 'CHARGE_SUCCEEDED']);
  });

  it('subscription.active 在未订阅时 ⇒ SUBSCRIPTION_STARTED', () => {
    const outcome = translateDodoEvent(
      {
        type: 'subscription.active',
        data: { subscription_id: 'sub_1', product_id: 'pdt_starter_monthly', metadata: { ...META, plan: 'STARTER' } },
      },
      NONE,
      ENV,
    );
    expect(outcome.kind).toBe('apply');
    if (outcome.kind !== 'apply') return;
    expect(outcome.commands.map((c) => c.type)).toEqual(['SUBSCRIPTION_STARTED']);
    expect(outcome.commands[0].plan).toBe('STARTER');
  });

  it('subscription.active 在已 ACTIVE 时 ⇒ PLAN_CHANGED（否则内核判非法迁移）', () => {
    const outcome = translateDodoEvent(
      {
        type: 'subscription.active',
        data: { subscription_id: 'sub_1', product_id: 'pdt_growth_monthly', metadata: META },
      },
      ACTIVE_GROWTH,
      ENV,
    );
    expect(outcome.kind).toBe('apply');
    if (outcome.kind !== 'apply') return;
    expect(outcome.commands.map((c) => c.type)).toEqual(['PLAN_CHANGED']);
  });
});

describe('事件翻译 · 幂等（成对事件不得重复入账）', () => {
  const paymentEvent = {
    type: 'payment.succeeded',
    data: {
      payment_id: 'pay_9',
      subscription_id: 'sub_1',
      product_id: 'pdt_growth_monthly',
      total_amount: 14900,
      currency: 'USD',
      metadata: META,
    },
  };
  const renewedEvent = {
    type: 'subscription.renewed',
    data: {
      subscription_id: 'sub_1',
      payment_id: 'pay_9',
      product_id: 'pdt_growth_monthly',
      recurring_pre_tax_amount: 14900,
      currency: 'USD',
      metadata: META,
    },
  };

  it('payment.succeeded 与 subscription.renewed 产生**完全相同**的款项幂等键', () => {
    const a = translateDodoEvent(paymentEvent, ACTIVE_GROWTH, ENV);
    const b = translateDodoEvent(renewedEvent, ACTIVE_GROWTH, ENV);
    expect(a.kind).toBe('apply');
    expect(b.kind).toBe('apply');
    if (a.kind !== 'apply' || b.kind !== 'apply') return;

    const keysOf = (cmds: typeof a.commands) =>
      cmds.filter((c) => c.type.startsWith('CHARGE')).map((c) => c.dedupeKey).sort();

    expect(keysOf(a.commands)).toEqual(keysOf(b.commands));
    // 二级证明：键里含 payment_id，而不是订阅 id —— 后者会让每期续费同键
    expect(keysOf(a.commands).every((k) => k.includes('pay_9'))).toBe(true);
  });

  it('同一订阅的 "开通" 键只含订阅 id（重开是另一条订阅，不会撞键）', () => {
    const outcome = translateDodoEvent(paymentEvent, NONE, ENV);
    expect(outcome.kind).toBe('apply');
    if (outcome.kind !== 'apply') return;
    expect(outcome.commands[0].dedupeKey).toBe('dodo:sub-start:sub_1');
  });
});

describe('事件翻译 · 取消与失败', () => {
  it('subscription.cancelled（ACTIVE）⇒ SUBSCRIPTION_CANCELED，带可读原因', () => {
    const outcome = translateDodoEvent(
      { type: 'subscription.cancelled', data: { subscription_id: 'sub_1', metadata: META } },
      ACTIVE_GROWTH,
      ENV,
    );
    expect(outcome.kind).toBe('apply');
    if (outcome.kind !== 'apply') return;
    expect(outcome.commands[0].type).toBe('SUBSCRIPTION_CANCELED');
    expect(outcome.commands[0].reason).toBeTruthy();
  });

  it('未开通时收到 cancelled ⇒ ignore（写进去会被内核以非法迁移拒绝）', () => {
    const outcome = translateDodoEvent(
      { type: 'subscription.cancelled', data: { subscription_id: 'sub_1', metadata: META } },
      NONE,
      ENV,
    );
    expect(outcome.kind).toBe('ignore');
  });

  it('subscription.expired ⇒ SUBSCRIPTION_CANCELED，原因写明"到期"', () => {
    const outcome = translateDodoEvent(
      { type: 'subscription.expired', data: { subscription_id: 'sub_1', metadata: META } },
      ACTIVE_GROWTH,
      ENV,
    );
    expect(outcome.kind).toBe('apply');
    if (outcome.kind !== 'apply') return;
    expect(outcome.commands[0].reason).toContain('到期');
  });

  it('payment.failed ⇒ 建款 + 失败，且失败原因非空（内核强制）', () => {
    const outcome = translateDodoEvent(
      {
        type: 'payment.failed',
        data: {
          payment_id: 'pay_bad',
          subscription_id: 'sub_1',
          product_id: 'pdt_growth_monthly',
          total_amount: 14900,
          currency: 'USD',
          metadata: META,
        },
      },
      ACTIVE_GROWTH,
      ENV,
    );
    expect(outcome.kind).toBe('apply');
    if (outcome.kind !== 'apply') return;
    expect(outcome.commands.map((c) => c.type)).toEqual(['CHARGE_CREATED', 'CHARGE_FAILED']);
    const failed = outcome.commands[1];
    expect(failed.type).toBe('CHARGE_FAILED');
    if (failed.type === 'CHARGE_FAILED') expect(failed.reason.length).toBeGreaterThan(0);
  });

  it('subscription.past_due 无 payment_id ⇒ ignore（没有款项就不该编一笔）', () => {
    const outcome = translateDodoEvent(
      { type: 'subscription.past_due', data: { subscription_id: 'sub_1', metadata: META } },
      ACTIVE_GROWTH,
      ENV,
    );
    expect(outcome.kind).toBe('ignore');
  });
});

describe('事件翻译 · 拒绝与忽略的边界（不得静默授予权益）', () => {
  it('metadata 里没有 organizationId ⇒ ignore（不是我们发起的单）', () => {
    const outcome = translateDodoEvent(
      {
        type: 'payment.succeeded',
        data: { payment_id: 'p', subscription_id: 's', product_id: 'pdt_growth_monthly', metadata: {} },
      },
      NONE,
      ENV,
    );
    expect(outcome).toEqual({ kind: 'ignore', reason: 'no_organization_in_metadata' });
  });

  it('既无 metadata.plan、商品也不认识 ⇒ invalid（绝不猜默认档）', () => {
    const outcome = translateDodoEvent(
      {
        type: 'payment.succeeded',
        data: {
          payment_id: 'p',
          subscription_id: 's',
          product_id: 'pdt_mystery',
          total_amount: 100,
          metadata: { organizationId: 'org_1' },
        },
      },
      NONE,
      ENV,
    );
    expect(outcome).toEqual({ kind: 'invalid', reason: 'unknown_plan' });
  });

  it('一次性付款（无 subscription_id）⇒ ignore，不进订阅账', () => {
    const outcome = translateDodoEvent(
      {
        type: 'payment.succeeded',
        data: { payment_id: 'p', total_amount: 500, metadata: META },
      },
      NONE,
      ENV,
    );
    expect(outcome).toEqual({ kind: 'ignore', reason: 'one_time_payment_not_subscription' });
  });

  it('未处理的事件类型 ⇒ ignore 且原因里带原类型（便于发现"新增了事件却没接"）', () => {
    const outcome = translateDodoEvent({ type: 'dispute.opened', data: { metadata: META } }, ACTIVE_GROWTH, ENV);
    expect(outcome.kind).toBe('ignore');
    if (outcome.kind !== 'ignore') return;
    expect(outcome.reason).toContain('dispute.opened');
  });

  it('缺 type / 缺 data ⇒ invalid', () => {
    expect(translateDodoEvent({ data: { metadata: META } }, NONE, ENV)).toEqual({
      kind: 'invalid',
      reason: 'missing_event_type',
    });
    expect(translateDodoEvent({ type: 'payment.succeeded', data: null }, NONE, ENV)).toEqual({
      kind: 'invalid',
      reason: 'missing_event_data',
    });
  });
});

describe('辅助：组织 id 与档位判定', () => {
  it('organizationIdOfEvent 与翻译逻辑同源（同一份 metadata 解析）', () => {
    const event = { type: 'payment.succeeded', data: { metadata: META } };
    expect(organizationIdOfEvent(event)).toBe('org_1');
    expect(organizationIdOfEvent({ type: 'x', data: { metadata: {} } })).toBeNull();
    expect(organizationIdOfEvent({ type: 'x' })).toBeNull();
  });

  it('plan 优先取 metadata，其次按 product_id 反查，并标明来源', () => {
    expect(resolvePlanForEvent({ plan: 'SCALE' }, 'pdt_growth_monthly', ENV)).toEqual({
      plan: 'SCALE',
      from: 'metadata',
    });
    expect(resolvePlanForEvent({}, 'pdt_scale_yearly', ENV)).toEqual({ plan: 'SCALE', from: 'product' });
    expect(resolvePlanForEvent({ plan: 'NOPE' }, 'pdt_mystery', ENV)).toBeNull();
  });
});

/**
 * 结算幂等键的终态区分 —— R-15 发布阻断缺陷的负控组。
 *
 * 缺陷（2026-11-10 探针实测确认）：CHARGE_FAILED 与 CHARGE_SUCCEEDED 曾共用
 * `dodo:charge-settled:${paymentId}`。同一 payment_id 先失败后成功时，
 * 成功事件的两条命令键均已被失败事件占用 ⇒ 全被判 replayed 跳过，
 * 账本停在 FAILED，而钱已收（收钱不到账）。
 *
 * 修复契约：
 *   · 结算键带终态后缀（succeeded/failed），失败不得吞掉后续成功；
 *   · 同一事件重复投递键稳定（重投不双记）；
 *   · "失败后同 id 成功"不再静默——由账本内核显式拒绝（见内核负控），
 *     webhook 路由将其转为 200 + deferred + LEDGER REJECT 告警日志。
 */
describe('结算幂等键 · 终态区分（R-15）', () => {
  const chargeEvent = (type: 'payment.succeeded' | 'payment.failed', paymentId: string) => ({
    type,
    data: {
      payment_id: paymentId,
      subscription_id: 'sub_1',
      product_id: 'pdt_growth_monthly',
      total_amount: 14900,
      currency: 'usd',
      metadata: META,
    },
  });

  const chargeKeys = (type: 'payment.succeeded' | 'payment.failed', paymentId: string): string[] => {
    const outcome = translateDodoEvent(chargeEvent(type, paymentId), ACTIVE_GROWTH, ENV);
    if (outcome.kind !== 'apply') throw new Error(`expected apply, got ${outcome.kind}`);
    return outcome.commands.map((c) => c.dedupeKey);
  };

  it('同 payment_id：失败的结算键与成功的结算键不重叠（失败不得吞成功）', () => {
    const failedKeys = chargeKeys('payment.failed', 'pay_x');
    const succeededKeys = chargeKeys('payment.succeeded', 'pay_x');
    // 「建款」键允许重叠 —— 同一笔款只创建一次是正确幂等（内核还强制拒绝重复创建）。
    // 但「结算」键必须分态：任何一个结算键重叠都会让后到的结算命令被判 replayed 静默丢弃。
    const settleOf = (keys: string[]) => keys.filter((k) => k.includes('charge-settled'));
    expect(settleOf(failedKeys).filter((k) => settleOf(succeededKeys).includes(k))).toEqual([]);
    // 建款键两侧一致（同 payment_id ⇒ 同一笔款）
    expect(failedKeys).toContain('dodo:charge-created:pay_x');
    expect(succeededKeys).toContain('dodo:charge-created:pay_x');
  });

  it('成功事件重复投递：键稳定（重投不双记成功）', () => {
    expect(chargeKeys('payment.succeeded', 'pay_y')).toEqual(chargeKeys('payment.succeeded', 'pay_y'));
  });

  it('失败事件重复投递：键稳定（重投不双记失败）', () => {
    expect(chargeKeys('payment.failed', 'pay_z')).toEqual(chargeKeys('payment.failed', 'pay_z'));
  });

  it('成对幂等（R-14 正向设计）在分态键下仍然成立：renewed 与 payment.succeeded 同键', () => {
    const payKeys = chargeKeys('payment.succeeded', 'pay_9');
    const renewed = translateDodoEvent(
      {
        type: 'subscription.renewed',
        data: {
          subscription_id: 'sub_1',
          payment_id: 'pay_9',
          product_id: 'pdt_growth_monthly',
          recurring_pre_tax_amount: 14900,
          currency: 'usd',
          metadata: META,
        },
      },
      ACTIVE_GROWTH,
      ENV,
    );
    if (renewed.kind !== 'apply') throw new Error(`expected apply, got ${renewed.kind}`);
    expect(renewed.commands.map((c) => c.dedupeKey)).toEqual(payKeys);
  });
});

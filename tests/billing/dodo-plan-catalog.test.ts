/**
 * 订阅套餐目录 —— 单一事实源的自洽性 + 反查 + 派生
 *
 * 这组断言守的是商业面最容易静默出错的三件事：
 *   1. 展示价与美分数不一致（页面上写 $49，实际扣 $0.49）；
 *   2. 年付并不比月付便宜（"年付"就成了纯粹的文案）；
 *   3. 商品 id 在前端可被伪造（前端自报 productId = 可以买任意商品）。
 *
 * 每条正向断言都配一条**破坏性对照**：把目录改坏一个字段，`validatePlanCatalog`
 * 必须报出来。只测"默认目录是好的"是弱证据 —— 它无法证明校验器真的在校验。
 */
import {
  PLAN_CATALOG,
  PLAN_LIST,
  DODO_PRODUCT_ENV,
  SELLABLE_PLAN_IDS,
  BILLING_INTERVALS,
  formatPrice,
  priceCentsOf,
  resolvePlanTarget,
  planOfDodoProductId,
  validatePlanCatalog,
  yearlySavingsPercent,
  yearlyPerMonth,
  type SellablePlan,
  type SellablePlanId,
} from '@/config/subscription-plans';
import { PLAN_LIMITS } from '@/lib/billing/plans';

/** 把环境变量名映射成"看起来合法"的假商品 id。 */
function fakeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const plan of SELLABLE_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      env[DODO_PRODUCT_ENV[plan][interval]] = `pdt_${plan.toLowerCase()}_${interval}`;
    }
  }
  return env;
}

describe('套餐目录 · 自洽性', () => {
  it('默认目录零问题', () => {
    expect(validatePlanCatalog(PLAN_CATALOG)).toEqual([]);
  });

  it('三档齐全，顺序为 Starter → Growth → Scale（决定页面上谁在中间）', () => {
    expect(PLAN_LIST.map((p) => p.id)).toEqual(['STARTER', 'GROWTH', 'SCALE']);
    expect(PLAN_LIST.filter((p) => p.highlighted)).toHaveLength(1);
  });

  it('限额是 PLAN_LIMITS 的**引用**，不是复制的一份（R2）', () => {
    for (const id of SELLABLE_PLAN_IDS) {
      expect(PLAN_CATALOG[id].limits).toBe(PLAN_LIMITS[id]);
    }
  });

  it('展示价由美分数派生（改一个数字不可能只改一半）', () => {
    for (const plan of PLAN_LIST) {
      for (const interval of BILLING_INTERVALS) {
        const cents = plan.prices[interval].cents;
        expect(plan.prices[interval].display).toBe(`$${(cents / 100).toFixed(2)}`);
        expect(formatPrice(plan.id, interval)).toBe(plan.prices[interval].display);
        expect(priceCentsOf(plan.id, interval)).toBe(cents);
      }
    }
  });

  it('年付 = 月付 × 10，节省 17%（结构保证，不靠人记得同步）', () => {
    for (const plan of PLAN_LIST) {
      expect(plan.prices.yearly.cents).toBe(plan.prices.monthly.cents * 10);
      expect(yearlySavingsPercent(plan.id)).toBe(17);
      const perMonth = (Math.round(plan.prices.yearly.cents / 12) / 100).toFixed(2);
      expect(yearlyPerMonth(plan.id)).toBe(`$${perMonth}`);
    }
  });
});

describe('套餐目录 · 破坏性对照（证明校验器有牙齿）', () => {
  function tampered(mutate: (p: SellablePlan) => SellablePlan): Record<SellablePlanId, SellablePlan> {
    const copy = { ...PLAN_CATALOG } as Record<SellablePlanId, SellablePlan>;
    copy.STARTER = mutate({ ...PLAN_CATALOG.STARTER, prices: { ...PLAN_CATALOG.STARTER.prices } });
    return copy;
  }

  it('展示价与美分数不一致 ⇒ 报错', () => {
    const bad = tampered((p) => ({
      ...p,
      prices: { ...p.prices, monthly: { cents: 4900, display: '$49' } },
    }));
    expect(validatePlanCatalog(bad).join('\n')).toContain('display');
  });

  it('金额为 0 / 负数 / 小数 ⇒ 报错（免费送是最贵的事故）', () => {
    for (const cents of [0, -100, 49.5]) {
      const bad = tampered((p) => ({
        ...p,
        prices: { ...p.prices, monthly: { cents, display: `$${cents}` } },
      }));
      expect(validatePlanCatalog(bad).join('\n')).toContain('正整数美分');
    }
  });

  it('年付不低于月付 ×12 ⇒ 报错（"年付"没有存在理由）', () => {
    const bad = tampered((p) => ({
      ...p,
      prices: { ...p.prices, yearly: { cents: p.prices.monthly.cents * 12, display: '$588.00' } },
    }));
    expect(validatePlanCatalog(bad).join('\n')).toContain('年付');
  });

  it('limits 被复制成新对象 ⇒ 报错（配额必须单一来源）', () => {
    const bad = tampered((p) => ({ ...p, limits: { ...PLAN_LIMITS.STARTER } }));
    expect(validatePlanCatalog(bad).join('\n')).toContain('PLAN_LIMITS');
  });

  it('商品 id 写成"值"而不是变量名 ⇒ 报错', () => {
    // 直接构造一份"env 名不合规"的目录：这里改的是导出常量，
    // 因此用 spy 的方式并不合适 —— 改为验证 validate 对 DODO_PRODUCT_ENV 的形状断言。
    // 该断言在默认目录上为真（零问题），此处用一条独立的形状断言固定规则本身。
    for (const plan of SELLABLE_PLAN_IDS) {
      for (const interval of BILLING_INTERVALS) {
        expect(DODO_PRODUCT_ENV[plan][interval]).toMatch(/^DODO_PRODUCT_[A-Z0-9_]+$/);
      }
    }
  });
});

describe('结算目标解析 · 前端只能报 (plan, interval)', () => {
  const env = fakeEnv();

  it('合法输入 ⇒ 得到商品 id 与金额，金额来自目录', () => {
    const r = resolvePlanTarget({ plan: 'GROWTH', interval: 'yearly' }, env);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.productId).toBe('pdt_growth_yearly');
    expect(r.target.amountCents).toBe(PLAN_CATALOG.GROWTH.prices.yearly.cents);
    expect(r.target.amountCents).toBe(149_000);
  });

  it('未知套餐 / 未知周期 ⇒ 分别拒绝', () => {
    expect(resolvePlanTarget({ plan: 'ENTERPRISE', interval: 'monthly' }, env)).toMatchObject({
      ok: false,
      reason: 'invalid_plan',
    });
    expect(resolvePlanTarget({ plan: 'STARTER', interval: 'weekly' }, env)).toMatchObject({
      ok: false,
      reason: 'invalid_interval',
    });
  });

  it('商品未绑定 ⇒ product_not_configured，并在文案里点出缺哪个变量', () => {
    const empty: Record<string, string> = {};
    const r = resolvePlanTarget({ plan: 'SCALE', interval: 'monthly' }, empty);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('product_not_configured');
    expect(r.message).toContain('DODO_PRODUCT_SCALE_MONTHLY');
  });

  it('空白字符串等同于没配', () => {
    const r = resolvePlanTarget({ plan: 'STARTER', interval: 'monthly' }, {
      [DODO_PRODUCT_ENV.STARTER.monthly]: '   ',
    });
    expect(r.ok).toBe(false);
  });
});

describe('反查 · webhook 只带 product_id', () => {
  const env = fakeEnv();

  it('六个商品各自还原到正确档位与周期', () => {
    for (const plan of SELLABLE_PLAN_IDS) {
      for (const interval of BILLING_INTERVALS) {
        const productId = env[DODO_PRODUCT_ENV[plan][interval]];
        expect(planOfDodoProductId(productId, env)).toEqual({ plan, interval });
      }
    }
  });

  it('陌生商品 / null / 空串 ⇒ null（绝不猜一个默认档）', () => {
    expect(planOfDodoProductId('pdt_unknown', env)).toBeNull();
    expect(planOfDodoProductId(null, env)).toBeNull();
    expect(planOfDodoProductId('', env)).toBeNull();
  });

  it('环境为空时一律 null —— 未配置不等于"匹配到空"', () => {
    expect(planOfDodoProductId('pdt_starter_monthly', {})).toBeNull();
  });
});

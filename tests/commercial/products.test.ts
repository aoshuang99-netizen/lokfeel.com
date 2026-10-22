/**
 * 商业契约 · 产品目录的单元断言（V18-02）
 * ═══════════════════════════════════════════════════════════════════
 * 静态门禁（`npm run check:products`）只看源码文本；这里测**行为**：
 * `displayPrice()` 在未获批时到底返不返 null、`isPurchasable()` 会不会漏掉
 * 状态检查。两者都要有 —— 只测文本，改个变量名就绕过了。
 *
 * 这些断言的价值在"反例"：一个 `status: 'APPROVED'` 但没写审批依据的产品，
 * 必须被 `validateCatalog()` 拒绝。因为"自己给自己批"是这类系统里最省事、
 * 也最难被发现的作弊方式。
 */

import {
  PRODUCTS,
  getProduct,
  displayPrice,
  isPurchasable,
  validateCatalog,
  type Product,
} from '@/config/products';

describe('产品目录 · 现状', () => {
  it('目录自检通过（三条产品线都合规）', () => {
    expect(validateCatalog(PRODUCTS)).toEqual([]);
  });

  it('存在三条产品线，且 id 唯一', () => {
    const ids = PRODUCTS.map((p) => p.id).sort();
    expect(ids).toEqual(['connection-os', 'hlua-pass', 'legacy-membership']);
  });

  it('Connection OS 的定价是「未获批」：不显示价格、不可购买', () => {
    const p = getProduct('connection-os');
    expect(p.pricing.status).toBe('PENDING_APPROVAL');
    expect(displayPrice(p)).toBeNull();
    expect(isPurchasable(p)).toBe(false);
    expect(p.checkout.kind).toBe('none');
  });

  it('Hlua 的结账只在它自己的页面上，且被标成外部产品', () => {
    const p = getProduct('hlua-pass');
    // 🔴 relation 是"谁在卖"的唯一标记：Hlua 不归本目录销售，只引用
    expect(p.relation).toBe('REFERENCED_ONLY');
    expect(p.checkout.kind).toBe('external');
    expect(p.checkout.href).toBe('/pay.html');
    // 它是「不可购买」的吗？—— 不，它是另一条业务，允许有外部结账
    // 但 status 为 NOT_FOR_SALE 时 isPurchasable() 仍必须为 false（本目录不代售）
    expect(isPurchasable(p)).toBe(false);
    // 而且即便有人把它的 status 改成 APPROVED，isPurchasable 也必须仍然 false
    // （外来产品永远不经过本目录结账）—— 这条由 relation 挡住，不由 status 挡住
    expect(isPurchasable({ ...p, pricing: { status: 'APPROVED', displayPrice: '$12.99' } })).toBe(false);
  });

  it('退款承诺各自可溯源：旧会员 14 天（/refunds）、Hlua 7 天（pay.html）', () => {
    expect(getProduct('legacy-membership').refund).toMatchObject({ days: 14, source: '/refunds' });
    expect(getProduct('hlua-pass').refund).toMatchObject({ days: 7, source: 'public/pay.html' });
    // Connection OS 从未销售 ⇒ 没有已生效承诺
    expect(getProduct('connection-os').refund.days).toBeNull();
  });

  it('每一条退款承诺都带出处（不允许无主文案）', () => {
    for (const p of PRODUCTS) {
      expect(p.refund.source.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('产品目录 · 反例（证明规则在承重）', () => {
  const clone = (patch: Partial<Product>): Product => ({
    ...getProduct('connection-os'),
    ...patch,
  });

  it('「已批准」但没有审批依据 ⇒ 判红（不许自己给自己批）', () => {
    const bad = clone({
      pricing: { status: 'APPROVED', displayPrice: '$19.99' },
      checkout: { kind: 'external', href: '/checkout/abc', label: 'Buy' },
    });
    const problems = validateCatalog([bad]);
    expect(problems.join('\n')).toContain('approvalRef');
  });

  it('「已批准」但没填价格 ⇒ 判红', () => {
    const bad = clone({
      pricing: { status: 'APPROVED', displayPrice: null, approvalRef: 'D-02 2026-11-01' },
    });
    expect(validateCatalog([bad]).join('\n')).toContain('displayPrice');
  });

  it('未获批却填了价格 ⇒ 判红（这就是"卖未批准的价格"）', () => {
    const bad = clone({ pricing: { status: 'PENDING_APPROVAL', displayPrice: '$19.99' } });
    expect(validateCatalog([bad]).join('\n')).toContain('未获批');
  });

  it('未获批却挂了外部结账 ⇒ 判红（就是本次要修的错配形状）', () => {
    const bad = clone({
      pricing: { status: 'PENDING_APPROVAL', displayPrice: null },
      checkout: { kind: 'external', href: '/pay.html', label: 'Buy' },
    });
    expect(validateCatalog([bad]).join('\n')).toContain('外部结账入口');
  });

  it('退款天数为 0 或负数 ⇒ 判红', () => {
    const bad = clone({ refund: { days: 0, source: '/refunds' } });
    expect(validateCatalog([bad]).join('\n')).toContain('refund.days');
  });

  it('已批准 + 有依据 + 有价格 + 有结账 ⇒ 通过（正对照）', () => {
    const good = clone({
      pricing: { status: 'APPROVED', displayPrice: '$19.99/mo', approvalRef: 'D-02 2026-11-01' },
      checkout: { kind: 'external', href: '/checkout/abc', label: 'Buy' },
    });
    expect(validateCatalog([good])).toEqual([]);
    expect(isPurchasable(good)).toBe(true);
    expect(displayPrice(good)).toBe('$19.99/mo');
  });

  it('产品 id 重复 ⇒ 判红', () => {
    const problems = validateCatalog([getProduct('connection-os'), getProduct('connection-os')]);
    expect(problems.join('\n')).toContain('重复');
  });

  it('外来产品被标成 APPROVED ⇒ 判红（我们不替别家的价格背书）', () => {
    const problems = validateCatalog([
      {
        ...getProduct('hlua-pass'),
        pricing: {
          status: 'APPROVED',
          displayPrice: '$12.99',
          approvalRef: 'D-02 2026-11-01',
        },
      },
    ]);
    expect(problems.join('\n')).toContain('外来产品不得是 APPROVED');
  });

  it('外来产品挂外部结账 ⇒ 不判红（这是它与"卖错产品"的区别所在）', () => {
    // 正对照：如果这条也红，说明 R2 被写成"一律禁止外部结账"，
    // 那 Hlua 的入口就只能靠删除来"合规" —— 用户反而找不到它。
    expect(validateCatalog([getProduct('hlua-pass')])).toEqual([]);
  });
});

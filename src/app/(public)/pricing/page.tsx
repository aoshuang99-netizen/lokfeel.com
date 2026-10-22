import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, Layers, ShieldCheck, Workflow, Scale } from 'lucide-react';

import { PRODUCTS, displayPrice, isPurchasable } from '@/config/products';

export const metadata: Metadata = {
  title: 'Pricing · LokFeel Connection OS',
  description:
    'LokFeel Connection OS 的定价与权益。定价尚未公布前不展示金额、不提供结账入口 —— 你可以申请试用或联系销售。',
};

/**
 * Connection OS 的定价页（V18-02）
 * ═══════════════════════════════════════════════════════════════════════
 * 这一页此前**不存在** —— `/pricing` 直接 302 到 `public/pay.html`，
 * 而 pay.html 卖的是 Hlua Pass（streaming / H-Points）。
 *
 * 于是"点定价 → 买到另一个产品"这件事，连页面都没有，用户无从察觉。
 *
 * 本页有三条自我约束：
 *   1. **不显示未获批的价格。** Connection OS 的定价状态是 `PENDING_APPROVAL`，
 *      所以页面上一个金额都没有 —— 不是忘了写，是刻意不写。
 *   2. **不给结账入口。** 没有定价就没有可买的东西；放一个"立即购买"按钮
 *      指到 Hlua 的付款页，是这次要修的 bug 本身。
 *   3. **说清它不是什么。** 页面底部明确区分旧会员与 Hlua Pass，
 *      并给出去处，而不是让用户自己猜。
 *
 * 定价获批后，把 `src/config/products.ts` 里的 `status` 改成 `APPROVED`、
 * 填 `displayPrice` 与 `approvalRef`，这一页会自动开始显示金额与购买入口
 * （`check:pricing` 会拦住"没有 approvalRef 的已批准"）。
 */
export default function PricingPage() {
  const product = PRODUCTS.find((p) => p.id === 'connection-os');
  if (!product) {
    // 目录被改坏时宁可 404，也不要渲染一个空白定价页
    throw new Error('products.ts 里缺少 connection-os');
  }

  const price = displayPrice(product);
  const purchasable = isPurchasable(product);

  return (
    <div className="pt-24 pb-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-14">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <Layers className="w-8 h-8 text-primary" />
          </div>
          <p className="text-sm uppercase tracking-widest text-foreground-muted mb-3">
            {product.brand}
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">{product.name}</h1>
          <p className="text-foreground-muted max-w-2xl mx-auto leading-relaxed">
            {product.oneLiner}
          </p>
        </div>

        {/* 定价状态：未获批就明说，不装作"即将公布" */}
        <div className="glass-card p-8 lg:p-10 mb-10">
          <div className="flex flex-col sm:flex-row sm:items-start gap-6">
            <div className="flex-1">
              <h2 className="text-xl font-bold text-foreground mb-3">
                {price ? `价格：${price}` : '定价尚未公布'}
              </h2>
              <p className="text-foreground leading-relaxed">
                {price
                  ? '该价格已获批，可按下方向我们申请开通。'
                  : 'Connection OS 目前处于受控试用阶段，定价尚未获批。在此之前我们不会展示金额，也不会给你一个指向别处的结账按钮 —— 那正是这个页面此前的问题。'}
              </p>
              <p className="text-foreground-muted text-sm mt-4">
                面向：{product.audience}
              </p>
            </div>
            <div className="sm:w-64 shrink-0">
              <Link
                href="/contact?topic=connection-os-access"
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-white hover:opacity-90 transition"
              >
                {product.checkout.label}
                <ArrowRight className="w-4 h-4" />
              </Link>
              {!purchasable && (
                <p className="text-xs text-foreground-muted mt-3 leading-relaxed">
                  暂无在线结账：未公布定价的产品不提供购买入口。
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 权益（与价格无关） */}
        <div className="grid gap-6 md:grid-cols-2 mb-10">
          <div className="glass-card p-8">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Workflow className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-xl font-bold text-foreground">你能拿到什么</h2>
            </div>
            <ul className="space-y-3">
              {product.capabilities.map((c) => (
                <li key={c} className="flex items-start gap-3 text-foreground leading-relaxed">
                  <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="glass-card p-8">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-xl font-bold text-foreground">承诺与边界</h2>
            </div>
            <ul className="space-y-3 text-foreground leading-relaxed">
              <li className="flex items-start gap-3">
                <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <span>Consent 先于动作：对外披露必须先有依据，且可撤回。</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <span>Verified Outcome：结果要能被验证，不接受「跑完就算」。</span>
              </li>
              <li className="flex items-start gap-3">
                <Scale className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <span>
                  退款条款：
                  {product.refund.days === null
                    ? '尚未对外销售，因此没有已生效的退款承诺；正式条款随首份报价书面确认。'
                    : `按 ${product.refund.source} 承诺 ${product.refund.days} 天。`}
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* 说清"这不是什么" —— 避免下一个人又把两条产品线接在一起 */}
        <div className="glass-card p-8">
          <h2 className="text-lg font-bold text-foreground mb-4">这里不卖什么</h2>
          <p className="text-foreground leading-relaxed mb-4">
            LokFeel 站上还有两条<strong>独立</strong>的产品线，它们不属于 Connection OS，也不共享本页的定价与权益：
          </p>
          <ul className="space-y-3 text-foreground">
            <li>
              <strong>LokFeel 旧会员（B2C）</strong> —— 交友产品线的订阅，权益是每周匹配数、隐身、保险箱等。
            </li>
            <li>
              <strong>Hlua Pass</strong> —— streaming 与 H-Points 会员，是另一条业务。{' '}
              <Link href="/hlua" className="text-primary hover:underline">
                了解 Hlua Pass
              </Link>
            </li>
          </ul>
          <p className="text-foreground-muted text-sm mt-5">
            如果你是从旧链接（`/plans`、`/subscribe`、`/membership`、`/pass`）过来的：
            前两个已指向本页，后两个指向 Hlua Pass 的说明页。
          </p>
        </div>
      </div>
    </div>
  );
}

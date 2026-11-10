import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, Layers, Scale, ShieldCheck, Workflow } from 'lucide-react';

import { PRODUCTS, displayPrice, isPurchasable } from '@/config/products';
import { readCheckoutGate } from '@/lib/payments/commercial-gate';
import { readSkuBindings } from '@/lib/payments/dodo/config';
import { PlanCards } from '@/components/billing/plan-cards';

export const metadata: Metadata = {
  title: 'Pricing · LokFeel Connection OS',
  description:
    'LokFeel Connection OS 的订阅套餐与价格：Starter / Growth / Scale，月付或年付，14 天试用。',
};

/**
 * Connection OS 的定价页（V20.5 起为**真实收银台入口**）
 * ═══════════════════════════════════════════════════════════════════════
 * 历史（V18-02）：这一页此前不存在，`/pricing` 直接 302 到 `public/pay.html`，
 * 而 pay.html 卖的是 Hlua Pass —— "点定价 → 买到另一个产品"。
 * 之后它一度是**没有金额**的占位页（定价未获批的合法状态）。
 *
 * V20.5 起定价获批，本页承担三件事，且顺序不可颠倒：
 *   1. 说清这是什么产品（第 1 屏）；
 *   2. 给出**真实可购买**的套餐与金额（`PlanCards`，金额唯一来源是
 *      `src/config/subscription-plans.ts`）；
 *   3. 说清它不是什么（底部三条产品线边界，防止下一个人又把它们接错）。
 *
 * 🔴 页面自己不判"能不能买"。`readStoreReadiness()` 是服务端唯一判据：
 *    凭据缺失或商品未绑定 ⇒ `checkoutReady=false` ⇒ 按钮 disabled 并改文案。
 *    这样"未接入"不会表现成"用户点了没反应 / 报错"。
 */
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const params = await searchParams;
  const cancelled = params?.checkout === 'cancelled';

  const product = PRODUCTS.find((p) => p.id === 'connection-os');
  if (!product) {
    // 目录被改坏时宁可 404，也不要渲染一个空白定价页
    throw new Error('products.ts 里缺少 connection-os');
  }

  const price = displayPrice(product);
  const purchasable = isPurchasable(product);
  /**
   * 🔴 G12：页面自己不判"能不能买"，服务端唯一判据是 commercial-gate：
   *   开放 = 技术就绪（Dodo 凭据 + SKU 绑定）AND 人工定价批准（products.ts APPROVED + approvalRef）。
   * 当前 products.ts 处于 PENDING_APPROVAL（代填审批已按总令回退），
   * 所以按钮 disabled，文案为"定价审批中" —— 不会出现"点了报错"或"悄悄能绕过"。
   */
  const gate = readCheckoutGate();
  /**
   * 逐格可用性。凭据齐备只是"能建会话"；某一格能不能卖要看这里 ——
   * 例如 Scale 年付因 Dodo 单笔金额上限（$3,000）暂时建不出商品，
   * 不该连累另外 5 个套餐。
   */
  const bound = readSkuBindings();

  return (
    // 无障碍：本页无自带 nav/footer，整页即主内容区 ⇒ 用 <main> 作根元素补 landmark
    <main className="pt-24 pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* ── 1. 这是什么 ───────────────────────────────────── */}
        <div className="text-center mb-14">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <Layers className="w-8 h-8 text-primary" aria-hidden="true" />
          </div>
          <p className="text-sm uppercase tracking-widest text-foreground-muted mb-3">{product.brand}</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">{product.name}</h1>
          <p className="text-foreground-muted max-w-2xl mx-auto leading-relaxed">{product.oneLiner}</p>
          {price && (
            <p className="text-sm text-foreground-muted mt-4">
              订阅起价 <span className="text-foreground font-semibold">{price}</span>
              {purchasable ? ' · 支持在线开通' : ' · 在线开通即将开放'}
            </p>
          )}
        </div>

        {/* ── 2. 套餐与收银台 ───────────────────────────────── */}
        <div className="mb-16">
          {cancelled && (
            <div
              role="status"
              className="mb-6 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground-muted"
            >
              已取消本次结账，未产生任何费用。你可以随时重新选择套餐。
            </div>
          )}
          <PlanCards checkoutReady={gate.enabled} bound={bound} callbackUrl="/pricing" />
        </div>

        {/* ── 3. 权益与边界（与价格无关，但决定"值不值"）────── */}
        <div className="grid gap-6 md:grid-cols-2 mb-10">
          <div className="glass-card p-8">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Workflow className="w-5 h-5 text-primary" aria-hidden="true" />
              </div>
              <h2 className="text-xl font-bold text-foreground">你能拿到什么</h2>
            </div>
            <ul className="space-y-3">
              {product.capabilities.map((c) => (
                <li key={c} className="flex items-start gap-3 text-foreground leading-relaxed">
                  <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="glass-card p-8">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-primary" aria-hidden="true" />
              </div>
              <h2 className="text-xl font-bold text-foreground">承诺与边界</h2>
            </div>
            <ul className="space-y-3 text-foreground leading-relaxed">
              <li className="flex items-start gap-3">
                <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                <span>Consent 先于动作：对外披露必须先有依据，且可撤回。</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                <span>Verified Outcome：结果要能被验证，不接受「跑完就算」。</span>
              </li>
              <li className="flex items-start gap-3">
                <Scale className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  退款条款：{product.refund.days === null
                    ? '尚无可对外承诺的天数；正式条款随报价书面确认。'
                    : `按 ${product.refund.source} 承诺 ${product.refund.days} 天（首次订阅冷静期）。`}
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* ── 3b. 说清"这不是什么" ───────────────────────────── */}
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
            如果你是从旧链接（`/plans`、`/subscribe`、`/membership`、`/pass`）过来的：前两个已指向本页，后两个指向
            Hlua Pass 的说明页。
          </p>
          <div className="mt-6">
            <Link
              href="/contact?topic=connection-os-access"
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            >
              需要采购/发票/年度合同？联系我们
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

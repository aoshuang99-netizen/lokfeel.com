import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ArrowLeft, Info, Clock } from 'lucide-react';

import { getProduct } from '@/config/products';

export const metadata: Metadata = {
  title: 'Hlua Pass（另一条产品线）· LokFeel',
  description:
    'Hlua Pass 是 streaming 与 H-Points 会员，与 LokFeel Connection OS 是两条独立的产品线。本页说明两者的边界与各自的退款承诺。',
};

/**
 * Hlua Pass 的说明页（V18-02）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么需要它：`/membership` 与 `/pass` 此前 302 到 `public/pay.html`，
 * 而用户此时可能正在找 Connection OS 的定价。中间加一页说明，
 * 让"你要买的到底是哪个产品"变成一个被明确回答的问题，而不是一个陷阱。
 *
 * 本页**不卖东西**：它只交代事实、给出处、把选择权交回用户。
 * 真正的结账仍在 `public/pay.html`（Hlua 自己的页面，已有客户在使用）。
 */
export default function HluaPage() {
  const product = getProduct('hlua-pass');

  return (
    <div className="pt-24 pb-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <Info className="w-8 h-8 text-primary" />
          </div>
          <p className="text-sm uppercase tracking-widest text-foreground-muted mb-3">
            {product.brand}
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">{product.name}</h1>
          <p className="text-foreground-muted leading-relaxed">{product.oneLiner}</p>
        </div>

        <div className="glass-card p-8 lg:p-10 space-y-8">
          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">它是什么</h2>
            <ul className="space-y-2 text-foreground leading-relaxed list-disc list-inside ml-2">
              {product.capabilities.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">它不是什么</h2>
            <p className="text-foreground leading-relaxed">
              它不是 <strong>LokFeel Connection OS</strong>（目标 → WorkspaceSpec → Mission →
              Agent → Consent → Outcome 的协作系统），也不包含 Workspace、Mission、Agent 或组织功能。
              如果你要找的是那个产品，
              <Link href="/pricing" className="text-primary hover:underline mx-1">
                请看 Connection OS 的定价页
              </Link>
              。
            </p>
          </section>

          <section>
            <div className="flex items-center gap-3 mb-3">
              <Clock className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-bold text-foreground">退款承诺</h2>
            </div>
            <p className="text-foreground leading-relaxed">
              Hlua Pass 的退款承诺是{' '}
              <strong>{product.refund.days} 天</strong>
              （出处：<code className="text-sm">{product.refund.source}</code>）。
              LokFeel 站点上另有 14 天的退款条款，那适用于 <strong>LokFeel 旧会员</strong>，
              两条承诺不是同一条 —— 此前它们被当成同一个产品，才显得自相矛盾。
            </p>
            <p className="text-foreground-muted text-sm mt-3">{product.refund.note}</p>
          </section>

          <section className="border-t border-white/10 pt-6">
            <p className="text-foreground-muted text-sm mb-4">
              确认要买的是 Hlua Pass？结账在它自己的页面上完成，我们不在这里代收。
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href={product.checkout.href}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-white hover:opacity-90 transition"
              >
                {product.checkout.label}
                <ArrowRight className="w-4 h-4" />
              </a>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 px-5 py-3 font-semibold text-foreground hover:bg-white/5 transition"
              >
                <ArrowLeft className="w-4 h-4" />
                回到 Connection OS 定价
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

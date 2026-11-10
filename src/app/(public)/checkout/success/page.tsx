import { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, Clock, Mail } from 'lucide-react';

export const metadata: Metadata = {
  title: '订阅确认 · LokFeel',
  description: '支付完成后的确认页：权益由支付网关的签名回调确认，通常在 2–10 分钟内生效。',
  robots: { index: false, follow: false },
};

/**
 * 支付成功回跳页（Dodo `return_url`）
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 本页**不代表**"已开通"。它只代表"浏览器回来了"。
 *
 * 两者不是同一件事，差异在两个方向上都真实存在：
 *   · 用户付完款直接关掉标签页 → 没有回跳，但钱确实付了；
 *   · 有人手输 `/checkout/success` → 没有任何付款，却也看到这一页。
 *
 * 所以这一页的职责是：**如实说明"正在确认"**，并把用户送到能看见真实状态的地方
 * （Console → 设置 → 计费，那里读的是签名 webhook 写的账本）。
 * 任何"恭喜开通"的措辞都必须由账本状态支撑，不能由这个 URL 支撑。
 */
export default function CheckoutSuccessPage() {
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4 py-24">
      <div className="glass-card max-w-xl w-full p-8 sm:p-10 text-center">
        <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-7 h-7 text-primary" aria-hidden="true" />
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-3">支付已完成</h1>
        <p className="text-foreground leading-relaxed">
          我们已收到支付网关的回跳。订阅权益由网关的<strong>签名回调</strong>确认，
          通常在 <strong>2–10 分钟</strong>内生效。
        </p>

        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-left">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-foreground-muted leading-relaxed">
              若 10 分钟后权益仍未生效，请刷新 Console 页面；仍未生效请邮件联系，并附上付款邮箱与时间。
              我们以网关账单为准核对，不会要求你重复付款。
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/console/settings"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-white hover:opacity-90 transition"
          >
            查看订阅状态
          </Link>
          <a
            href="mailto:support@lokfeel.com"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-5 py-3 font-semibold text-foreground hover:bg-white/5 transition"
          >
            <Mail className="w-4 h-4" aria-hidden="true" />
            联系支持
          </a>
        </div>

        <p className="text-xs text-foreground-muted mt-8 leading-relaxed">
          付款由 Dodo Payments 作为 Merchant of Record 处理，发票与账单会发送到你结账时填写的邮箱。
          首次订阅享 14 天冷静期，规则见{' '}
          <Link href="/refunds" className="text-primary hover:underline">
            退款政策
          </Link>
          。
        </p>
      </div>
    </main>
  );
}

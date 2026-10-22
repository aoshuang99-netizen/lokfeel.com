/**
 * 取消订阅 · 服务商归属判定（V18-04 补丁）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么需要单独一层
 * ------------
 * `Subscription` 表里只有 `stripeCustomerId` / `stripeSubscriptionId` 两列，
 * 而 `src/lib/creem.ts` 把 **Creem** 的订阅 id 也写进这两列（源码注释写着
 * "reuse field"）。于是：
 *
 *   · 只看库，**无法判断**这笔订阅是哪家服务商的；
 *   · 若拿一个 Creem 的 id 去调 Stripe 的 `subscriptions.update`，
 *     最好的结果是 404 报错，最坏的结果是取消掉**另一笔真实订阅**。
 *
 * 在支付系统里，"猜服务商"和"猜金额"是同一级别的错误。所以这里**不猜**：
 * 只用当前环境里**恰好配置了一家**凭据这一事实来判定归属；
 * 两家都配（迁移期、灰度期都可能是这种形状）就判 `ambiguous` 并拒绝自助取消。
 *
 * 为什么不做成数据库列
 * ------------
 * 加一列 `provider` 是更长久的解法，但那是**不可逆迁移**（生产库在 Turso，
 * 需要 snapshot → plan → apply → verify 一整套动作才能上线），
 * 而本轮的约束是"不为一次性便利改 schema"。
 * 因此本轮选择：**能从环境唯一确定才执行，否则 fail-closed**。
 * 待 `D-11`（见 RISK_AND_DECISIONS）批准后再落成列。
 *
 * 判定表（无状态的纯函数，可被单测穷举）
 * ------------
 * | Stripe 就绪 | Creem 就绪 | 结果 | 处置 |
 * |---|---|---|---|
 * | 否 | 否 | `none` | 503 PAYMENT_NOT_CONFIGURED |
 * | 是 | 否 | `stripe` | 走自助取消 |
 * | 否 | 是 | `creem` | 409 PROVIDER_NOT_SELF_SERVICE（Creem 自助取消未实现） |
 * | 是 | 是 | `ambiguous` | 409 PROVIDER_AMBIGUOUS（不知道该退给谁，宁可不动） |
 */

import { isPaymentChannelReady, type EnvLike } from './availability';

export type CancelProvider = 'stripe' | 'creem' | 'none' | 'ambiguous';

/**
 * 判定"这笔订阅大概率属于哪家服务商"。
 *
 * 🔴 注意它回答的是**环境层面**的问题（"当前只接了一家吗"），
 *    不是"这笔订阅一定属于那家"。正因为如此，返回值必须是
 *    `ambiguous` 这种显式的"不知道"，而不是随便挑一个。
 */
export function resolveCancelProvider(env: EnvLike = process.env): CancelProvider {
  const stripe = isPaymentChannelReady('stripe.card', env);
  const creem = isPaymentChannelReady('creem.checkout', env);

  if (stripe && creem) return 'ambiguous';
  if (stripe) return 'stripe';
  if (creem) return 'creem';
  return 'none';
}

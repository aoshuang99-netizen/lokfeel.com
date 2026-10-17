/**
 * Stripe API 版本 —— 单点定义。
 *
 * 为什么必须显式钉版：
 *   1. `stripe` SDK 的 `new Stripe(key)` 在缺省 `apiVersion` 时会跟随**包内置的默认版本**。
 *      升级 SDK 主版本（22.6.2 → 23.0.0）会把默认值从 `2026-08-26.dahlia`
 *      静默切到 `2026-09-30.endive`，等于在没改一行业务代码的情况下换了 API 语义。
 *   2. Webhook 事件的 payload 形状由**账号的 API 版本**决定，不由 SDK 决定。
 *      只要有一处客户端漂到新版本，同一份事件在不同 handler 里就会解析出不同字段
 *      （例如 dahlia 起 `Invoice.payment_intent` 已被移除，只剩 `payments`）。
 *
 * 因此：**所有** Stripe 客户端都必须显式传入本常量，禁止裸 `new Stripe(key)`。
 *
 * 迁移到 `2026-09-30.endive` 是一次独立的、需要真实 Stripe 环境验证的变更
 * （支付/退款/订阅/Webhook 全链路），不与依赖升级混在一起做。
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

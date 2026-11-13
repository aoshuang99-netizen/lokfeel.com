'use client';

/**
 * 订阅套餐选择器（定价页与 Console 计费页共用）
 * ═══════════════════════════════════════════════════════════════════════
 * 三条自我约束：
 *
 *  1. **金额只从 `PLAN_CATALOG` 读，组件里不出现任何价格字面量。**
 *     定价页与结账页显示不同价格是这类系统最典型的商业事故，
 *     而它的成因永远是"某处手写了一个数字"。
 *
 *  2. **未就绪时不假装能买。** `checkoutReady === false` 时按钮 disabled，
 *     并说明"在线开通即将开放 / 可联系开通"。给一个点了必 503 的按钮，
 *     是把部署缺失伪装成用户操作失败。
 *
 *  3. **错误就地展示，不用 `alert()`。** `alert` 无法被样式化、无法被读屏软件
 *     正确播报，也无法带"下一步做什么"的链接 —— 而支付失败恰恰需要下一步。
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  PLAN_LIST,
  formatPrice,
  yearlyPerMonth,
  yearlySavingsPercent,
  type BillingInterval,
  type SellablePlanId,
} from '@/config/subscription-plans';

export interface PlanCardsProps {
  /** 服务端判定的"能否创建结账会话"（凭据是否齐备）。 */
  checkoutReady: boolean;
  /**
   * 是否展示金额（GA T2）。
   *
   * 金额是**商业声明**：定价未获人工批准时展示 `$49.00`，等于对外报价。
   * 缺省 `true` 保持既有调用方（Console 内部计费页）行为不变；
   * 公开定价页显式传 `gate.commercialApproved`。
   */
  showPrices?: boolean;
  /**
   * 逐 SKU 的商品绑定状态。缺省 = 全部已绑定。
   *
   * 为什么需要它：Dodo 有商户级单笔金额上限，某个高价 SKU 可能暂时
   * 建不出来。此时**只禁那一格**，其余套餐照常可买 —— 否则 1 个 SKU
   * 的缺失会让整页定价变成"即将开放"。
   */
  bound?: Record<SellablePlanId, Record<BillingInterval, boolean>>;
  /** 已订阅时的当前档位（用于把按钮改成"当前套餐"）。 */
  currentPlan?: string | null;
  /** 从定价页跳登录时的回跳地址。 */
  callbackUrl?: string;
}

interface CheckoutError {
  message: string;
  hint?: string;
}

export function PlanCards({
  checkoutReady,
  showPrices = true,
  bound,
  currentPlan,
  callbackUrl = '/pricing',
}: PlanCardsProps) {
  const router = useRouter();
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const [pending, setPending] = useState<SellablePlanId | null>(null);
  const [error, setError] = useState<CheckoutError | null>(null);

  async function startCheckout(plan: SellablePlanId) {
    setError(null);
    setPending(plan);
    try {
      const res = await fetch('/api/payments/dodo/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        checkoutUrl?: string;
        error?: string;
        message?: string;
        code?: string;
      };

      if (res.status === 401) {
        // 未登录：先去登录，回来仍落在本页（不让用户重新找入口）
        router.push(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
        return;
      }

      if (!res.ok || !data.checkoutUrl) {
        // 按**错误码**分支，而不是按文案正则（文案会改，码不会）
        if (data.code === 'PAYMENT_NOT_CONFIGURED' || res.status === 503) {
          setError({
            message: '在线开通暂时不可用。',
            hint: '订阅通道尚未完成配置；你可以联系 support@lokfeel.com 由我们手工开通，权益与价格不变。',
          });
        } else if (res.status === 409) {
          setError({
            message: data.message ?? '当前组织已有生效中的订阅。',
            hint: '请到 Console → 设置 → 计费 变更套餐，而不是重复购买。',
          });
        } else if (res.status === 403) {
          setError({
            message: data.message ?? '当前角色无权开通订阅。',
            hint: '请让组织的所有者或管理员来完成这一步。',
          });
        } else {
          setError({ message: data.error ?? '创建支付会话失败，请稍后重试。' });
        }
        return;
      }

      // 跳转到 Dodo 托管收银台。用 location.assign 而不是 router.push：
      // 这是**外部**地址，Next 的客户端路由不负责它。
      window.location.assign(data.checkoutUrl);
    } catch (err) {
      setError({
        message: '网络异常，未能创建支付会话。',
        hint: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-labelledby="plans-heading">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h2 id="plans-heading" className="text-2xl font-bold text-foreground">
            订阅套餐
          </h2>
          <p className="text-foreground-muted text-sm mt-2">
            按组织订阅 · 随时升降档 · 年付送两个月 · 全部套餐含 14 天试用
          </p>
        </div>

        {/* 计费周期切换：两个按钮比一个开关更有可访问性（读屏能听到"已选中"） */}
        <div
          role="group"
          aria-label="计费周期"
          className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1"
        >
          <button
            type="button"
            aria-pressed={interval === 'monthly'}
            onClick={() => setInterval('monthly')}
            className={`px-4 py-2 text-sm rounded-lg transition ${
              interval === 'monthly' ? 'bg-primary text-[#0b0e11] font-semibold' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            月付
          </button>
          <button
            type="button"
            aria-pressed={interval === 'yearly'}
            onClick={() => setInterval('yearly')}
            className={`px-4 py-2 text-sm rounded-lg transition ${
              interval === 'yearly' ? 'bg-primary text-[#0b0e11] font-semibold' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            年付
            <span className="ml-1 text-xs opacity-80">省 {yearlySavingsPercent('GROWTH')}%</span>
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground"
        >
          <p className="font-semibold">{error.message}</p>
          {error.hint && <p className="text-foreground-muted mt-1">{error.hint}</p>}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {PLAN_LIST.map((plan) => {
          const isCurrent = currentPlan === plan.id;
          const isPending = pending === plan.id;
          const price = formatPrice(plan.id, interval);
          /** 该档该周期是否已绑商品。缺省视为已绑定（调用方未传 = 不细分）。 */
          const skuBound = bound?.[plan.id]?.[interval] !== false;
          const sellable = checkoutReady && skuBound;

          return (
            <div
              key={plan.id}
              className={`glass-card p-6 flex flex-col relative ${
                plan.highlighted ? 'ring-2 ring-primary/60' : ''
              }`}
            >
              {plan.highlighted && (
                <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-[#0b0e11]">
                  <Sparkles className="w-3 h-3" aria-hidden="true" />
                  最受欢迎
                </span>
              )}

              <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
              <p className="text-sm text-foreground-muted mt-1">{plan.tagline}</p>

              <div className="mt-5" aria-live="polite">
                {showPrices ? (
                  <>
                    <span className="text-3xl font-bold text-foreground">{price}</span>
                    <span className="text-foreground-muted text-sm">
                      {interval === 'monthly' ? ' / 月' : ' / 年'}
                    </span>
                    {interval === 'yearly' && (
                      <p className="text-xs text-foreground-muted mt-1">
                        折合 {yearlyPerMonth(plan.id)}/月 · 比月付省 {yearlySavingsPercent(plan.id)}%
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-xl font-bold text-foreground">定价尚未公布</span>
                    <p className="text-xs text-foreground-muted mt-1">
                      定价审批完成后会在这里公布金额
                    </p>
                  </>
                )}
              </div>

              <p className="text-xs text-foreground-muted mt-3">面向：{plan.audience}</p>

              <ul className="mt-5 space-y-2 flex-1">
                {plan.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2 text-sm text-foreground">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              {!skuBound && (
                <p
                  id={`sku-unavailable-${plan.id}`}
                  className="mt-5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground-muted leading-relaxed"
                >
                  {interval === 'monthly' ? '月付' : '年付'}这一档暂未开放在线开通（受支付通道单笔金额上限限制）。
                  可改选{interval === 'monthly' ? '年付' : '月付'}，或
                  <a href="mailto:support@lokfeel.com" className="inline-flex min-h-6 items-center text-primary hover:underline">
                    联系我们
                  </a>
                  走对公/年度合同开通，价格与权益不变。
                </p>
              )}

              <Button
                type="button"
                className="mt-6 w-full"
                variant={plan.highlighted ? 'default' : 'outline'}
                disabled={!sellable || isPending || isCurrent}
                onClick={() => startCheckout(plan.id)}
                aria-describedby={
                  !checkoutReady ? 'checkout-unavailable' : !skuBound ? `sku-unavailable-${plan.id}` : undefined
                }
              >
                {isCurrent ? (
                  '当前套餐'
                ) : isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    正在创建会话…
                  </>
                ) : !checkoutReady ? (
                  '在线开通即将开放'
                ) : !skuBound ? (
                  `${interval === 'monthly' ? '月付' : '年付'}暂不可用`
                ) : (
                  `订阅 ${plan.name}`
                )}
              </Button>
            </div>
          );
        })}
      </div>

      {!checkoutReady && (
        <p id="checkout-unavailable" className="text-sm text-foreground-muted mt-4">
          订阅通道正在完成最后一步配置。在此之前可以直接联系{' '}
          <a href="mailto:support@lokfeel.com" className="inline-flex min-h-6 items-center text-primary hover:underline">
            support@lokfeel.com
          </a>{' '}
          开通，权益与价格与页面一致。
        </p>
      )}

      <p className="text-xs text-foreground-muted mt-6 leading-relaxed">
        试用期内可随时取消，不产生费用。首次订阅享 14 天冷静期（见{' '}
        <a href="/refunds" className="text-primary hover:underline">
          退款政策
        </a>
        ）。价格与权益以本页为准；付款由 Dodo Payments 作为 Merchant of Record 处理。
      </p>
    </section>
  );
}

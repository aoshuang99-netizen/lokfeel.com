export const dynamic = 'force-dynamic';

/**
 * GET /api/payments/dodo/plans —— 对外套餐目录（**公开只读**）
 * ═══════════════════════════════════════════════════════════════════════
 * 前端拿它渲染定价卡片，服务端拿它做对账。**金额只有一个来源**
 * （`src/config/subscription-plans.ts`），本端点只做投影，不算价。
 *
 * 响应里带 `configured` 与 `missing`（**变量名**，不含值）：
 *   · 未接入时页面可以明确说"暂不可在线购买"，而不是给一个点了就 503 的按钮；
 *   · 运维扫一眼就知道还差哪几个变量 —— 这是把"最后一步"变成可查输出。
 *
 * 🔴 缓存策略：`no-store`。价格是商业信息，被 CDN 缓存住会让"改价后前台不生效"
 *    变成一个需要清缓存才能解释的现象。
 */

import { NextResponse } from 'next/server';

import { missingForChannel } from '@/lib/payments/availability';
import { readCheckoutGate } from '@/lib/payments/commercial-gate';
import { readDodoConfig } from '@/lib/payments/dodo/config';
import {
  DODO_PRODUCT_ENV,
  PRICING_APPROVAL,
  PLAN_LIST,
  yearlyPerMonth,
  yearlySavingsPercent,
} from '@/config/subscription-plans';

export async function GET() {
  const config = readDodoConfig();
  // 🔴 G12：checkoutReady 是「对公众可售」＝ 技术就绪 AND 人工定价批准（commercial-gate）。
  // 凭据未配（本地/CI）时 gate.enabled=false —— 与旧 isPaymentChannelReady 语义一致；
  // 凭据齐了但 products.ts 未批准（如当前 PENDING_APPROVAL）也必须 false。
  const gate = readCheckoutGate();
  const checkoutReady = gate.enabled;

  const plans = PLAN_LIST.map((plan) => ({
    id: plan.id,
    name: plan.name,
    tagline: plan.tagline,
    audience: plan.audience,
    highlighted: plan.highlighted ?? false,
    trialDays: plan.trialDays,
    currency: 'USD',
    highlights: plan.highlights,
    limits: plan.limits,
    intervals: {
      monthly: {
        amountCents: plan.prices.monthly.cents,
        display: plan.prices.monthly.display,
        // 只是"是否已绑定商品"，**不是**商品 id —— 商品 id 不下发到客户端
        configured: Boolean(process.env[DODO_PRODUCT_ENV[plan.id].monthly]?.trim()),
      },
      yearly: {
        amountCents: plan.prices.yearly.cents,
        display: plan.prices.yearly.display,
        perMonthDisplay: yearlyPerMonth(plan.id),
        savingsPercent: yearlySavingsPercent(plan.id),
        configured: Boolean(process.env[DODO_PRODUCT_ENV[plan.id].yearly]?.trim()),
      },
    },
  }));

  return NextResponse.json(
    {
      ok: true,
      provider: 'dodo',
      currency: 'USD',
      catalogVersion: PRICING_APPROVAL.version,
      approvedAt: PRICING_APPROVAL.approvedAt,
      /** 是否可以走在线结账（技术就绪 + 人工定价批准） */
      checkoutReady,
      /** 商业门的当前状态（供前端区分"未配置"与"审批中"两种不可售原因） */
      commercialApproval: gate.approval,
      /** 只回变量名 */
      missing: gate.credentialsReady ? [] : missingForChannel('dodo.checkout'),
      environment: config.ok ? config.config.environment : null,
      plans,
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}

/** 套餐目录不接写入 —— 改价格只能改代码并走评审，不能有 API 后门。 */
export function POST() {
  return NextResponse.json(
    { ok: false, error: 'Method Not Allowed', hint: '定价是代码变更，不支持运行时修改' },
    { status: 405, headers: { Allow: 'GET' } },
  );
}

/** 供测试直接引用目录（避免测试里重复写一份价格）。 */

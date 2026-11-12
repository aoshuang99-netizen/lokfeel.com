export const dynamic = 'force-dynamic';

/**
 * POST /api/payments/dodo/checkout —— 创建 Dodo 结账会话（收银台入口）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 请求体：`{ plan: 'STARTER'|'GROWTH'|'SCALE', interval: 'monthly'|'yearly' }`
 * 响应：`{ ok, checkoutUrl, sessionId, plan, interval, amountCents, currency }`
 *
 * ── 为什么前端不传 `productId` / 不传金额 ──────────────────────────────
 * 与 `creem/checkout` 的 B-16 结论一致：前端自报商品 id 等于允许它买任意商品
 * （包括已下架的旧价商品），而 webhook 只看到一个陌生 id，无从判断该授予哪档权益。
 * 金额同理 —— 让客户端报金额是最经典的篡改点。
 * 本路由只接受 **(plan, interval)** 两个语义参数，其余全部由服务端目录派生。
 *
 * ── 状态码约定 ────────────────────────────────────────────────────────
 *   401 未登录
 *   403 无 `billing.manage`（成员不能替组织开订阅）
 *   400 参数非法
 *   409 组织已有生效订阅（应走「变更套餐 / 管理订阅」，而不是再买一份）
 *   503 通道未接入（`PAYMENT_NOT_CONFIGURED` + 缺少的**变量名**）
 *   502 上游 Dodo 拒绝/超时（不是 500 —— 我们的代码没坏，是外部依赖失败）
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/auth/auth';
import { db } from '@/lib/db';
import { can } from '@/lib/tenancy/capabilities';
import { resolveActiveTenant } from '@/lib/tenancy/resolve';
import { hasCapability } from '@/lib/tenancy/guard';
import { isPaymentChannelReady } from '@/lib/payments/availability';
import { readCheckoutGate } from '@/lib/payments/commercial-gate';
import { paymentNotConfigured } from '@/lib/payments/not-configured';
import { publicOriginOf } from '@/lib/http/public-origin';
import { readDodoConfig } from '@/lib/payments/dodo/config';
import { createCheckoutSession, DodoApiError } from '@/lib/payments/dodo/client';
import { readOrgSubscription } from '@/lib/payments/dodo/store';
import {
  BILLING_INTERVALS,
  SELLABLE_PLAN_IDS,
  isBillingInterval,
  isSellablePlanId,
  resolvePlanTarget,
} from '@/config/subscription-plans';

const checkoutSchema = z.object({
  plan: z.enum(SELLABLE_PLAN_IDS),
  interval: z.enum(BILLING_INTERVALS as unknown as [string, ...string[]]),
});

/**
 * 幂等键按 15 分钟窗口分桶。
 *
 * 与 `creem/checkout` 的 B-17 同一处理：窗口内双击/重试复用同一会话
 * （Dodo 侧返回同一个 `session_id`），跨窗口可新建（用户放弃支付后仍能重试）。
 * 裸 `Date.now()` 会让判重永远失效。
 */
export function checkoutIdempotencyKey(
  organizationId: string,
  plan: string,
  interval: string,
  nowMs: number,
): string {
  const bucket = Math.floor(nowMs / (15 * 60 * 1000));
  return `lf-dodo-${organizationId}-${plan}-${interval}-${bucket}`;
}

export async function POST(request: NextRequest) {
  // ── 1. 身份 ───────────────────────────────────────────────
  let user: { id: string };
  try {
    ({ user } = await requireAuth());
  } catch {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. 参数 ───────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Invalid request body',
        details: parsed.error.issues,
        allowedPlans: SELLABLE_PLAN_IDS,
        allowedIntervals: BILLING_INTERVALS,
      },
      { status: 400 },
    );
  }
  const { plan, interval } = parsed.data;
  // zod 的 enum 已保证取值，这里的收窄是为了让下游拿到字面量类型
  if (!isSellablePlanId(plan) || !isBillingInterval(interval)) {
    return NextResponse.json({ ok: false, error: 'Invalid plan or interval' }, { status: 400 });
  }

  // ── 3. 租户 + 权限 ────────────────────────────────────────
  // 订阅是**组织的**资产：用活跃租户（含 cookie 软偏好）而不是"最早加入的那个"，
  // 否则多社群用户在 B 社群点升级，扣的却是 A 社群的账。
  let tenant;
  try {
    tenant = await resolveActiveTenant(user.id);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'NO_ORGANIZATION', message: '当前账号不属于任何组织，无法开通订阅' },
      { status: 409 },
    );
  }

  if (!hasCapability(tenant, 'billing.manage')) {
    // `can()` 的结论与 `hasCapability()` 同源；这里显式再判一次角色，
    // 是为了在日志里能说清"是角色不够"而不是"组织不存在"。
    const roleAllowed = can(tenant.role, 'billing.manage');
    console.warn(
      `[Dodo Checkout] 403 billing.manage denied (org=${tenant.organizationId} role=${tenant.role} can=${roleAllowed})`,
    );
    return NextResponse.json(
      {
        ok: false,
        error: 'FORBIDDEN',
        message: '只有组织的所有者或管理员可以开通/变更订阅',
      },
      { status: 403 },
    );
  }

  // ── 4. 已有生效订阅 → 409（不重复买）──────────────────────
  try {
    const view = await readOrgSubscription(tenant.organizationId);
    if (view.status === 'ACTIVE' || view.status === 'PAST_DUE') {
      return NextResponse.json(
        {
          ok: false,
          error: 'ALREADY_SUBSCRIBED',
          message:
            view.status === 'PAST_DUE'
              ? '当前订阅处于欠费宽限期，请先在「管理订阅」更新支付方式'
              : '当前组织已有生效中的订阅，请使用「管理订阅」变更套餐',
          currentPlan: view.plan,
          status: view.status,
        },
        { status: 409 },
      );
    }
  } catch (err) {
    // 账本读不出来不应阻止"还没订阅过"的组织首次付款 —— 但必须留痕
    console.error('[Dodo Checkout] readOrgSubscription failed:', err instanceof Error ? err.message : String(err));
  }

  // ── 5. 通道就绪（单一判定来源）────────────────────────────
  if (!isPaymentChannelReady('dodo.checkout')) {
    console.error('[Dodo Checkout] dodo.checkout channel is not configured');
    return paymentNotConfigured('dodo.checkout', {
      error: 'Payment system is not configured. Please try again later.',
    });
  }

  const configResult = readDodoConfig();
  if (!configResult.ok) {
    // 理论上与上一步等价；保留双保险是因为 availability 是"变量名视角"，
    // 这里是"解析视角"，两者曾出现过判定口径不一致的历史问题。
    console.error('[Dodo Checkout] config unresolved:', configResult.missing.join(','));
    return paymentNotConfigured('dodo.checkout');
  }

  // ── 5.5 商业门（G12）：定价未获产品所有者批准 ⇒ 一律拒发结账会话。
  // 这道门挡的是**实现者自己**：技术凭据齐备也不能绕过人工批准开卖。
  const gate = readCheckoutGate();
  if (!gate.commercialApproved) {
    console.error(
      `[Dodo Checkout] commercial gate CLOSED (pricing.status=${gate.approval.status}) — 定价未经产品所有者批准`,
    );
    return NextResponse.json(
      {
        ok: false,
        code: 'PRICING_NOT_APPROVED',
        approvalStatus: gate.approval.status,
        error: 'Online checkout is not available yet. Please try again later.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // ── 6. 解析结算目标（商品 id 只能由服务端决定）────────────
  const target = resolvePlanTarget({ plan, interval });
  if (!target.ok) {
    if (target.reason === 'product_not_configured') {
      // 这不是用户的错，是部署没配完 ⇒ 503，而不是 400
      console.error(`[Dodo Checkout] plan not bound: ${target.message}`);
      return NextResponse.json(
        {
          ok: false,
          code: 'PAYMENT_NOT_CONFIGURED',
          channel: 'dodo.checkout',
          missing: target.message.match(/DODO_PRODUCT_[A-Z_]+/g) ?? [],
          error: 'This plan is not available yet. Please try again later.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      );
    }
    return NextResponse.json({ ok: false, error: target.message }, { status: 400 });
  }

  // ── 7. 客户信息 + 回跳地址 ────────────────────────────────
  const userRecord = await db.user.findUnique({
    where: { id: user.id },
    select: { email: true, name: true },
  });
  if (!userRecord?.email) {
    return NextResponse.json({ ok: false, error: '账号缺少邮箱，无法创建结账会话' }, { status: 400 });
  }

  const origin = publicOriginOf(request);
  const returnUrl = `${origin}/checkout/success`;
  const cancelUrl = `${origin}/pricing?checkout=cancelled`;

  // ── 8. 创建会话 ───────────────────────────────────────────
  try {
    const session = await createCheckoutSession(configResult.config, {
      productId: target.target.productId,
      customer: { email: userRecord.email, name: userRecord.name },
      returnUrl,
      cancelUrl,
      trialPeriodDays: 14,
      // 🔴 metadata 是 webhook 侧**唯一**可信的业务上下文载体：
      // Dodo 会原样回传它，而我们不依赖任何"猜"的字段来决定授予哪档。
      metadata: {
        organizationId: tenant.organizationId,
        userId: user.id,
        plan: target.target.plan,
        interval: target.target.interval,
        catalogVersion: '2026-11-10.1',
      },
      idempotencyKey: checkoutIdempotencyKey(tenant.organizationId, plan, interval, Date.now()),
    });

    if (!session.checkout_url) {
      console.error('[Dodo Checkout] session created without checkout_url', session.session_id);
      return NextResponse.json(
        { ok: false, error: 'Payment provider did not return a checkout URL' },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        checkoutUrl: session.checkout_url,
        sessionId: session.session_id,
        plan: target.target.plan,
        interval: target.target.interval,
        amountCents: target.target.amountCents,
        currency: 'USD',
        organizationId: tenant.organizationId,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (err) {
    if (err instanceof DodoApiError) {
      // 502：外部依赖失败。**不回显**上游响应体（可能含请求回显）
      console.error(`[Dodo Checkout] upstream error status=${err.status} code=${err.upstreamCode ?? '-'} msg=${err.message}`);
      return NextResponse.json(
        { ok: false, error: 'Payment provider is temporarily unavailable. Please try again.' },
        { status: 502 },
      );
    }
    console.error('[Dodo Checkout] unexpected error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'Checkout failed' }, { status: 500 });
  }
}

/** GET 不提供能力 —— 显式 405，避免被当成"查询某个会话"的开放端点。 */
export function GET() {
  return NextResponse.json(
    { ok: false, error: 'Method Not Allowed', hint: 'POST { plan, interval }' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}

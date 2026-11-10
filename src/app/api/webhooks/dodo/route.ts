export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/dodo —— Dodo Payments 事件入口
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 注册地址（Dodo 控制台 → Developer → Webhooks）：
 *   https://app.lokfeel.com/api/webhooks/dodo
 *   test 与 live 是**两个独立端点、两个独立密钥**，不要混用。
 *
 * 订阅事件：payment.succeeded · payment.failed · subscription.active ·
 *          subscription.renewed · subscription.plan_changed ·
 *          subscription.cancelled · subscription.expired ·
 *          subscription.on_hold · subscription.past_due
 *
 * ── 四条不可妥协的纪律 ────────────────────────────────────────────────
 *  1. **验签先于解析。** 用 `await request.text()` 拿原始字节再验，
 *     绝不先 `json()`：重新序列化会改键序与空白，哈希必然对不上，
 *     而错误表现是"密钥错了"，会把人带到完全错误的排查方向。
 *  2. **先回 2xx 再谈业务。** Dodo 对非 2xx 会重投；一次永久性的业务拒绝
 *     （比如商品没绑定）若返回 4xx，会让这条事件被无限重试，
 *     在同一具尸体上反复报警。故：**签名错误 → 401**（让对方重试是合理的，
 *     可能是密钥轮换中）；**业务无法处理 → 200 + ignored**（重试没有意义）。
 *  3. **幂等靠账本键，不靠内存。** `dedupeKey` 唯一约束在库里，
 *     多实例/冷启动/并发重投都拦得住。
 *  4. **只记原因，不回显。** 日志里只出现 `reason` 与事件类型，
 *     绝不打印签名头或整个 payload（payload 含客户邮箱）。
 */

import { NextRequest, NextResponse } from 'next/server';

import { isPaymentChannelReady, missingForChannel } from '@/lib/payments/availability';
import { paymentNotConfigured } from '@/lib/payments/not-configured';
import { readDodoConfig } from '@/lib/payments/dodo/config';
import { signatureHeadersFrom, verifyDodoSignature } from '@/lib/payments/dodo/signature';
import {
  organizationIdOfEvent,
  translateDodoEvent,
  type DodoWebhookEvent,
} from '@/lib/payments/dodo/events';
import { applyCommands, loadLedgerSnapshot } from '@/lib/payments/dodo/store';

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

export async function POST(request: NextRequest) {
  // ── 1. 通道就绪 ───────────────────────────────────────────
  if (!isPaymentChannelReady('dodo.webhook')) {
    console.error(`[Dodo Webhook] not configured (missing: ${missingForChannel('dodo.webhook').join(',')})`);
    return paymentNotConfigured('dodo.webhook', { error: 'Webhook secret not configured' });
  }
  const configResult = readDodoConfig(process.env, { requiresWebhook: true });
  if (!configResult.ok) {
    console.error('[Dodo Webhook] config unresolved');
    return paymentNotConfigured('dodo.webhook');
  }

  // ── 2. 原始字节 + 验签 ────────────────────────────────────
  const rawBody = await request.text();
  const verdict = verifyDodoSignature(
    rawBody,
    signatureHeadersFrom((name) => request.headers.get(name)),
    configResult.config.webhookKey,
  );

  if (!verdict.ok) {
    // 401 而不是 400：签名不对时"重投"是合理行为（可能正在轮换密钥）
    console.error(`[Dodo Webhook] signature rejected: ${verdict.reason}`);
    return json({ ok: false, error: 'Invalid signature', reason: verdict.reason }, 401);
  }

  // ── 3. 解析 ───────────────────────────────────────────────
  let event: DodoWebhookEvent;
  try {
    event = JSON.parse(rawBody) as DodoWebhookEvent;
  } catch {
    // 签名已通过却解析不了 ⇒ 上游确实发了坏 JSON，重投也不会有变化
    console.error(`[Dodo Webhook] unparsable body (webhook-id=${verdict.webhookId})`);
    return json({ ok: true, ignored: 'unparsable_body', webhookId: verdict.webhookId });
  }

  const eventType = typeof event.type === 'string' ? event.type : '(none)';

  // ── 4. 组织上下文 ─────────────────────────────────────────
  const organizationId = organizationIdOfEvent(event);
  if (!organizationId) {
    // 不是本系统发起的结账（例如有人在 Dodo 后台手工建单）
    console.warn(`[Dodo Webhook] ignore ${eventType}: no organizationId in metadata`);
    return json({ ok: true, ignored: 'no_organization_in_metadata', type: eventType });
  }

  try {
    // ── 5. 翻译 ─────────────────────────────────────────────
    const snapshot = await loadLedgerSnapshot(organizationId);
    const outcome = translateDodoEvent(event, snapshot);

    if (outcome.kind !== 'apply') {
      if (outcome.kind === 'invalid') {
        // 永久性业务失败：200 收下，但必须吼一声（否则权益静默丢失）
        console.error(`[Dodo Webhook] INVALID ${eventType} org=${organizationId}: ${outcome.reason}`);
      } else {
        console.log(`[Dodo Webhook] ignore ${eventType} org=${organizationId}: ${outcome.reason}`);
      }
      return json({ ok: true, ignored: outcome.reason, type: eventType });
    }

    // ── 6. 写账 ─────────────────────────────────────────────
    const result = await applyCommands(outcome.organizationId, outcome.commands);
    console.log(
      `[Dodo Webhook] ${eventType} org=${organizationId} applied=${result.applied} replayed=${result.replayed} plan=${result.state.plan} status=${result.state.status}`,
    );

    return json({
      ok: true,
      type: eventType,
      webhookId: verdict.webhookId,
      applied: result.applied,
      replayed: result.replayed,
      plan: result.state.plan,
      status: result.state.status,
    });
  } catch (err) {
    /**
     * 走到这里通常是**账本内核拒绝**（非法迁移 / 缺字段）。
     * 返回 500 会让 Dodo 重投；而重投同一条事件在同一状态下仍会被拒 ——
     * 那只会制造噪声。故返回 200 + `deferred`，把它变成一条**需要人看**的日志，
     * 而不是一个会自动消失的重试。
     *
     * ⚠️ 若将来出现"因为瞬时数据库故障导致写入失败"，这里应改为 500 让上游重投；
     *    届时的判据是错误类型（连接类 vs 语义类），不能靠猜。
     */
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Dodo Webhook] LEDGER REJECT ${eventType} org=${organizationId}: ${message}`);
    return json({ ok: true, deferred: true, type: eventType, reason: 'ledger_rejected' });
  }
}

/** 健康探针/浏览器误访问时的明确回答（不暴露任何配置细节）。 */
export function GET() {
  return json(
    { ok: false, error: 'Method Not Allowed', hint: 'Dodo Payments posts events here' },
    405,
  );
}

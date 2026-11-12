/**
 * Dodo Payments —— 事件 → 账本命令（**纯函数**，无 IO）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 这一层只做一件事：把 Dodo 的 webhook 事件翻译成 `BillingEvent` 事件序列。
 * 不读数据库、不发请求、不看时间 —— 因此可以对着历史事件回放、可以单测边界。
 *
 * ── 为什么必须"序列"而不是"一条事件"──────────────────────────────────
 * 本仓的账本内核（`src/lib/billing/subscription.ts`）**拒绝凭空造钱**：
 *   ① `CHARGE_SUCCEEDED` 必须有同 `chargeId` 的 `CHARGE_CREATED` 在前；
 *   ② `CHARGE_CREATED` 只允许在 `ACTIVE` / `PAST_DUE` 时发生；
 *   ③ `SUBSCRIPTION_STARTED` 只允许从 `NONE` / `CANCELED` / `REFUNDED` 进入。
 *
 * 而支付网关的"首单成功"实际上同时包含三件事：开通 + 建款 + 收款。
 * 所以一条 `payment.succeeded` 必须展开成**三条**命令，且顺序固定。
 * 把三条压成一条，只能在账本里塞一个"特例"，那等于在审计面上开洞。
 *
 * ── 幂等键的设计（本文件最容易写错的地方）────────────────────────────
 * Dodo 的 `payment.succeeded` 与 `subscription.renewed` **成对到达**（官方文档明写）。
 * 若两者各用各的键，同一笔钱会入账两次；若其中一条先到并写了 `CHARGE_CREATED`，
 * 另一条再写就会撞"款项已存在"并被内核抛错。
 *
 * 因此：**款项相关的命令一律以 `payment_id` 为键**，与它由哪个事件触发无关。
 * 两条事件走同一组键 ⇒ 第二条整体回放（`replayed: true`），不会重复也不会报错。
 */

import type { BillingEventType } from '@/lib/billing/subscription';
import { isSellablePlanId, planOfDodoProductId, type SellablePlanId } from '@/config/subscription-plans';

/** 一条待写入的账本命令（字段与 `AppendBillingEventInput` 对齐，但保持纯）。 */
export interface LedgerCommand {
  type: BillingEventType;
  plan?: SellablePlanId;
  chargeId?: string;
  amountCents?: number;
  currency?: string;
  reason?: string;
  gatewayStatus?: 'SUCCEEDED' | 'FAILED' | 'CAPTURED';
  providerRef?: string;
  /** 账本幂等键（作用域 = (organizationId, dedupeKey)）。 */
  dedupeKey: string;
  /**
   * 相对基准时间的**毫秒偏移**。
   *
   * 为什么不是各自带一个绝对时间：内核按 `(occurredAt, createdAt, id)` 全序折叠，
   * 三条命令若共用同一毫秒，「先建款后收款」的顺序会退化成靠 id 字典序决定 ——
   * 而 id 是 `cuid()`，**不保证递增**。显式偏移让顺序成为数据本身的一部分。
   */
  offsetMs: number;
}

export type TranslateOutcome =
  | { kind: 'apply'; organizationId: string; commands: LedgerCommand[]; subscriptionId: string | null }
  | { kind: 'ignore'; reason: string }
  | { kind: 'invalid'; reason: string };

/** 账本当前状态（翻译时需要，用于决定"开通"还是"改档"）。 */
export interface LedgerSnapshot {
  plan: 'FREE' | SellablePlanId | string;
  status: 'NONE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'REFUNDED' | string;
}

export interface DodoWebhookEvent {
  type?: string;
  timestamp?: string;
  data?: Record<string, unknown> | null;
}

// ═══════════════════════════════════════════════════════════════
// 取值助手（Dodo 的字段有时在 data 上，有时包在 data.payment 里）
// ═══════════════════════════════════════════════════════════════

function str(source: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = source?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function num(source: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = source?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Math.round(Number(v));
  return null;
}

function record(source: unknown): Record<string, unknown> | null {
  return source && typeof source === 'object' && !Array.isArray(source) ? (source as Record<string, unknown>) : null;
}

/** metadata 可能在 data.metadata，也可能在 data.payment.metadata。 */
function metadataOf(data: Record<string, unknown> | null): Record<string, string> {
  const candidates = [record(data?.metadata), record(record(data?.payment)?.metadata), record(record(data?.subscription)?.metadata)];
  for (const c of candidates) {
    if (!c) continue;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(c)) if (typeof v === 'string') out[k] = v;
    if (Object.keys(out).length > 0) return out;
  }
  return {};
}

/**
 * 判定这一单属于哪一档。
 *
 * 优先级：`metadata.plan`（我们自己在创建会话时写下的） → `product_id` 反查。
 *
 * 🔴 两条都不成立时返回 `null` 并**拒绝入账**，绝不猜一个默认档。
 *    猜错的后果是"客户付 SCALE 的钱、拿到 STARTER 的额度"，而系统不报错。
 */
export function resolvePlanForEvent(
  metadata: Record<string, string>,
  productId: string | null,
  env: Readonly<Record<string, string | undefined>> = process.env,
): { plan: SellablePlanId; from: 'metadata' | 'product' } | null {
  const fromMeta = metadata.plan;
  if (isSellablePlanId(fromMeta)) return { plan: fromMeta, from: 'metadata' };
  const byProduct = planOfDodoProductId(productId, env);
  if (byProduct) return { plan: byProduct.plan, from: 'product' };
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 命令构造
// ═══════════════════════════════════════════════════════════════

function startCommand(plan: SellablePlanId, subscriptionId: string, offsetMs: number): LedgerCommand {
  return {
    type: 'SUBSCRIPTION_STARTED',
    plan,
    // 键里带订阅 id 而不带时间：同一订阅只可能"开通"一次（重开是另一条订阅）
    dedupeKey: `dodo:sub-start:${subscriptionId}`,
    providerRef: subscriptionId,
    offsetMs,
  };
}

function moneyCommands(input: {
  subscriptionId: string;
  paymentId: string;
  amountCents: number;
  currency: string;
  succeeded: boolean;
  reason?: string;
  baseOffsetMs: number;
}): LedgerCommand[] {
  const { subscriptionId, paymentId, amountCents, currency, succeeded, baseOffsetMs } = input;
  return [
    // 若这一单是"先收到钱、后收到开通事件"，开通命令会由调用方前置插入
    {
      type: 'CHARGE_CREATED',
      chargeId: paymentId,
      amountCents,
      currency,
      providerRef: subscriptionId,
      dedupeKey: `dodo:charge-created:${paymentId}`,
      offsetMs: baseOffsetMs,
    },
    succeeded
      ? {
          type: 'CHARGE_SUCCEEDED' as const,
          chargeId: paymentId,
          amountCents,
          currency,
          gatewayStatus: 'SUCCEEDED' as const,
          providerRef: subscriptionId,
          // 🔴 R-15（发布阻断）：结算键必须带终态。曾与 CHARGE_FAILED 共用
          // `dodo:charge-settled:${paymentId}`，导致同一 payment_id 先失败后成功时，
          // 成功事件整条被判 replayed 吞掉——账本停在 FAILED，钱已收（收钱不到账）。
          // 分态后：失败不再吞成功；"失败后同 id 成功"由账本内核显式拒绝
          // （CHARGE_TRANSITIONS.FAILED = []，不可改判），webhook 层转为
          // 200 + deferred + LEDGER REJECT 告警，绝不静默。
          dedupeKey: `dodo:charge-settled:${paymentId}:succeeded`,
          offsetMs: baseOffsetMs + 1,
        }
      : {
          type: 'CHARGE_FAILED' as const,
          chargeId: paymentId,
          amountCents,
          currency,
          // 失败原因是要给人看的（内核强制非空）
          reason: input.reason?.trim() || 'Dodo 报告支付失败（未返回具体原因）',
          gatewayStatus: 'FAILED' as const,
          providerRef: subscriptionId,
          dedupeKey: `dodo:charge-settled:${paymentId}:failed`,
          offsetMs: baseOffsetMs + 1,
        },
  ];
}

/** 是否处于"可以继续收钱/改档"的状态（决定要不要前置开通命令）。 */
function isLiveStatus(status: string): boolean {
  return status === 'ACTIVE' || status === 'PAST_DUE';
}

/**
 * 从事件里取出组织 id。
 *
 * 路由必须**先**知道组织、才能读到账本当前状态、才能翻译事件
 * （"开通"还是"改档"取决于当前状态）。因此这个取值逻辑必须与
 * `translateDodoEvent` 内部用的完全一致 —— 两处各写一份就会出现
 * "路由说属于 A、翻译说属于 B"的诡异错账。故统一在这里导出。
 */
export function organizationIdOfEvent(event: DodoWebhookEvent): string | null {
  const data = record(event?.data);
  if (!data) return null;
  const id = (metadataOf(data).organizationId ?? '').trim();
  return id || null;
}

// ═══════════════════════════════════════════════════════════════
// 主翻译函数
// ═══════════════════════════════════════════════════════════════

/**
 * 把一条 Dodo 事件翻译成账本命令。
 *
 * @param event   验签通过的原始事件（`JSON.parse` 后的对象）
 * @param current 该组织的账本当前状态（用于区分"开通"与"改档"）
 */
export function translateDodoEvent(
  event: DodoWebhookEvent,
  current: LedgerSnapshot,
  env: Readonly<Record<string, string | undefined>> = process.env,
): TranslateOutcome {
  const type = typeof event.type === 'string' ? event.type.trim() : '';
  if (!type) return { kind: 'invalid', reason: 'missing_event_type' };

  const data = record(event.data);
  if (!data) return { kind: 'invalid', reason: 'missing_event_data' };

  const metadata = metadataOf(data);
  const organizationId = (metadata.organizationId ?? '').trim();
  if (!organizationId) {
    // 没有组织上下文 = 不是我们发起的结账（或有人手工在 Dodo 后台建了单）。
    // 这不是错误，是"不归本系统管" ⇒ 200 + ignored，避免 Dodo 无限重投。
    return { kind: 'ignore', reason: 'no_organization_in_metadata' };
  }

  const subscriptionId = str(data, 'subscription_id') ?? str(record(data.subscription), 'subscription_id');
  const productId = str(data, 'product_id') ?? str(record(data.subscription), 'product_id');
  const resolved = resolvePlanForEvent(metadata, productId, env);

  switch (type) {
    // ── 订阅生命周期 ────────────────────────────────────────────
    case 'subscription.active': {
      if (!subscriptionId) return { kind: 'invalid', reason: 'subscription.active 缺少 subscription_id' };
      if (!resolved) return { kind: 'invalid', reason: 'unknown_plan' };

      // 已在使用中的订阅再收到 active（重投 / 试用转正）→ 改档而非"重新开通"，
      // 否则内核会以 ILLEGAL_TRANSITION 拒绝（ACTIVE 不能 STARTED）。
      if (isLiveStatus(current.status)) {
        return {
          kind: 'apply',
          organizationId,
          subscriptionId,
          commands: [
            {
              type: 'PLAN_CHANGED',
              plan: resolved.plan,
              providerRef: subscriptionId,
              dedupeKey: `dodo:sub-plan:${subscriptionId}:${resolved.plan}`,
              offsetMs: 0,
            },
          ],
        };
      }
      return {
        kind: 'apply',
        organizationId,
        subscriptionId,
        commands: [startCommand(resolved.plan, subscriptionId, 0)],
      };
    }

    case 'subscription.plan_changed': {
      if (!subscriptionId) return { kind: 'invalid', reason: 'plan_changed 缺少 subscription_id' };
      if (!resolved) return { kind: 'invalid', reason: 'unknown_plan' };
      return {
        kind: 'apply',
        organizationId,
        subscriptionId,
        commands: [
          {
            type: 'PLAN_CHANGED',
            plan: resolved.plan,
            providerRef: subscriptionId,
            dedupeKey: `dodo:sub-plan:${subscriptionId}:${resolved.plan}`,
            offsetMs: 0,
          },
        ],
      };
    }

    case 'subscription.cancelled':
    case 'subscription.expired': {
      if (!subscriptionId) return { kind: 'invalid', reason: `${type} 缺少 subscription_id` };
      if (!isLiveStatus(current.status)) {
        // 已取消/未开通时再取消：幂等，不写新事件（写了会被内核拒）
        return { kind: 'ignore', reason: `subscription_not_live(${current.status})` };
      }
      return {
        kind: 'apply',
        organizationId,
        subscriptionId,
        commands: [
          {
            type: 'SUBSCRIPTION_CANCELED',
            reason: type === 'subscription.expired' ? '订阅到期（Dodo subscription.expired）' : '用户/商户取消订阅（Dodo subscription.cancelled）',
            providerRef: subscriptionId,
            dedupeKey: `dodo:sub-canceled:${subscriptionId}`,
            offsetMs: 0,
          },
        ],
      };
    }

    case 'subscription.renewed': {
      // 续费：与 payment.succeeded 成对到达，键相同 ⇒ 后到的那条整体回放
      const paymentId = str(data, 'payment_id');
      if (!subscriptionId || !paymentId) return { kind: 'ignore', reason: 'renewed_without_payment_id' };
      if (!resolved) return { kind: 'invalid', reason: 'unknown_plan' };
      const amount = num(data, 'recurring_pre_tax_amount') ?? num(data, 'amount') ?? 0;
      const currency = (str(data, 'currency') ?? 'USD').toUpperCase();
      return {
        kind: 'apply',
        organizationId,
        subscriptionId,
        commands: moneyCommands({
          subscriptionId,
          paymentId,
          amountCents: amount,
          currency,
          succeeded: true,
          baseOffsetMs: 0,
        }),
      };
    }

    // ── 钱 ──────────────────────────────────────────────────────
    case 'payment.succeeded': {
      const paymentId = str(data, 'payment_id');
      if (!paymentId) return { kind: 'invalid', reason: 'payment.succeeded 缺少 payment_id' };
      // 一次性商品（charge_type = null）不在本目录的销售范围
      if (!subscriptionId) return { kind: 'ignore', reason: 'one_time_payment_not_subscription' };
      if (!resolved) return { kind: 'invalid', reason: 'unknown_plan' };

      const amount = num(data, 'total_amount') ?? num(data, 'amount') ?? 0;
      const currency = (str(data, 'currency') ?? 'USD').toUpperCase();

      const commands: LedgerCommand[] = [];
      let offset = 0;
      // 钱比开通事件先到（官方时序里 payment.succeeded 可能晚 2–10 分钟，
      // 但网络与重投不保证顺序）⇒ 先补齐开通，否则 CHARGE_CREATED 会被内核拒绝。
      if (!isLiveStatus(current.status)) {
        commands.push(startCommand(resolved.plan, subscriptionId, offset));
        offset += 1;
      }
      commands.push(
        ...moneyCommands({
          subscriptionId,
          paymentId,
          amountCents: amount,
          currency,
          succeeded: true,
          baseOffsetMs: offset,
        }),
      );
      return { kind: 'apply', organizationId, subscriptionId, commands };
    }

    case 'payment.failed': {
      const paymentId = str(data, 'payment_id');
      if (!paymentId) return { kind: 'invalid', reason: 'payment.failed 缺少 payment_id' };
      if (!subscriptionId) return { kind: 'ignore', reason: 'one_time_payment_not_subscription' };
      if (!resolved) return { kind: 'invalid', reason: 'unknown_plan' };
      if (!isLiveStatus(current.status)) return { kind: 'ignore', reason: `payment_failed_without_subscription(${current.status})` };

      const amount = num(data, 'total_amount') ?? num(data, 'amount') ?? 0;
      const currency = (str(data, 'currency') ?? 'USD').toUpperCase();
      const reason = str(data, 'error_message') ?? str(record(data.error), 'message');
      return {
        kind: 'apply',
        organizationId,
        subscriptionId,
        commands: moneyCommands({
          subscriptionId,
          paymentId,
          amountCents: amount,
          currency,
          succeeded: false,
          reason: reason ?? undefined,
          baseOffsetMs: 0,
        }),
      };
    }

    // ── 失败/挂起类：只在带 payment_id 时记一笔失败，否则仅同步状态 ──
    case 'subscription.on_hold':
    case 'subscription.past_due': {
      const paymentId = str(data, 'payment_id');
      if (!subscriptionId || !paymentId) return { kind: 'ignore', reason: `${type}_without_payment_id` };
      if (!resolved) return { kind: 'invalid', reason: 'unknown_plan' };
      if (!isLiveStatus(current.status)) return { kind: 'ignore', reason: `subscription_not_live(${current.status})` };
      const amount = num(data, 'recurring_pre_tax_amount') ?? 0;
      const currency = (str(data, 'currency') ?? 'USD').toUpperCase();
      return {
        kind: 'apply',
        organizationId,
        subscriptionId,
        commands: moneyCommands({
          subscriptionId,
          paymentId,
          amountCents: amount,
          currency,
          succeeded: false,
          reason: type === 'subscription.on_hold' ? '续费失败，订阅被挂起' : '续费失败，进入宽限期',
          baseOffsetMs: 0,
        }),
      };
    }

    // ── 明确不同步到账本的事件（幂等键仍会记录，避免重复处理）──────
    case 'subscription.updated':
    case 'subscription.paused':
    case 'subscription.unpaused':
    case 'subscription.update_payment_method':
      return { kind: 'ignore', reason: 'state_only_event' };

    case 'subscription.failed':
      return { kind: 'ignore', reason: 'subscription_creation_failed_no_money' };

    default:
      return { kind: 'ignore', reason: `unhandled_event_type(${type})` };
  }
}

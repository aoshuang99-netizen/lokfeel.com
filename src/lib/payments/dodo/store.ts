/**
 * Dodo Payments —— 账本读写（唯一有 IO 的一层）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 存储选型：**复用 `BillingEvent` 事件账本**，不新增表、不改 schema。
 *
 * 为什么不是新表 / 不是给 `Subscription` 加列
 * -------------------------------------------
 *   · `Subscription` 是**个人 B2C** 会员模型（`userId` + `stripe*Id` 是 `@unique`），
 *     往里塞 Dodo 的订阅 id 会制造三个问题：语义污染、网关污染、回滚污染
 *     （详见 `prisma/schema/billing.prisma` 文件头，那段结论对本文件同样成立）。
 *   · `BillingEvent` 本来就是为"组织级订阅 + 款项事件溯源"设计的：
 *     `type` 有 SUBSCRIPTION_STARTED / PLAN_CHANGED / CANCELED / CHARGE_*，
 *     `providerRef` 就是给网关回执用的，`dedupeKey` 唯一约束天然是 webhook 幂等键。
 *     用它意味着**零迁移**，也就没有"先迁移后发版"的窗口期风险。
 *
 * 🔴 关于"系统写账"的身份
 * ----------------------
 * `appendBillingEvent()` 的签名要求一个 `TenantContext`（含 `userId` / `role` /
 * `membershipId`）。webhook 没有会话，也没有"某个成员"在操作。
 * 通读 `src/lib/billing/service.ts:535` 的实现可以确认：它**只读取
 * `ctx.organizationId`**，其余字段不参与任何判定。
 * 因此这里构造一个显式的 **system 上下文**，并把 `membershipId` 写成
 * `system:dodo` —— 让审计面上能一眼看出"这条账不是人写的"。
 *
 * 若将来有人给 `appendBillingEvent` 加了基于 `ctx.role` 的判定，这里会**立刻**
 * 因为 system 上下文而暴露出来（而不是悄悄降权），这正是把身份写成显式标记的用意。
 */

import { appendBillingEvent } from '@/lib/billing/service';
import { reduceBillingEvents, type BillingLedgerState } from '@/lib/billing/subscription';
import { db } from '@/lib/db';
import type { TenantContext } from '@/lib/tenancy/resolve';
import type { LedgerCommand, LedgerSnapshot } from './events';

/** 系统写入者的租户上下文。见文件头「关于系统写账的身份」。 */
function systemTenantContext(organizationId: string): TenantContext {
  return {
    organizationId,
    userId: 'system:dodo',
    // 仅作类型占位：`appendBillingEvent` 不读 role。
    role: 'OWNER',
    membershipId: 'system:dodo',
  };
}

/** 账本当前状态（供事件翻译判断"开通"还是"改档"）。 */
export async function loadLedgerSnapshot(organizationId: string): Promise<LedgerSnapshot> {
  const state = await loadState(organizationId);
  return { plan: state.plan, status: state.status };
}

const EVENT_SELECT = {
  id: true,
  type: true,
  plan: true,
  chargeId: true,
  amountCents: true,
  currency: true,
  gatewayStatus: true,
  reason: true,
  occurredAt: true,
  createdAt: true,
} as const;

async function loadState(organizationId: string): Promise<BillingLedgerState> {
  const rows = await db.billingEvent.findMany({
    where: { organizationId },
    select: EVENT_SELECT,
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
  });
  return reduceBillingEvents(
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      plan: r.plan,
      chargeId: r.chargeId,
      amountCents: r.amountCents,
      currency: r.currency,
      gatewayStatus: r.gatewayStatus,
      reason: r.reason,
      occurredAt: r.occurredAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })),
  );
}

export interface ApplyResult {
  applied: number;
  replayed: number;
  state: BillingLedgerState;
}

/**
 * 按顺序写入一批命令。
 *
 * 顺序是**语义的一部分**（开通 → 建款 → 收款），所以这里串行 await，
 * 绝不 `Promise.all`：并行会让"收款"先落库，内核随即以"款项不存在"拒绝，
 * 而那次拒绝看起来像代码 bug，其实是并发写导致的顺序丢失。
 *
 * 时间戳按 `offsetMs` 递增，保证 `(occurredAt, createdAt)` 全序与命令顺序一致。
 */
export async function applyCommands(
  organizationId: string,
  commands: readonly LedgerCommand[],
  baseTime: Date = new Date(),
): Promise<ApplyResult> {
  const ctx = systemTenantContext(organizationId);
  let applied = 0;
  let replayed = 0;
  let state: BillingLedgerState | null = null;

  for (const cmd of commands) {
    const occurredAt = new Date(baseTime.getTime() + cmd.offsetMs);
    const result = await appendBillingEvent(
      ctx,
      {
        type: cmd.type,
        plan: cmd.plan ?? null,
        chargeId: cmd.chargeId ?? null,
        amountCents: cmd.amountCents ?? null,
        currency: cmd.currency ?? 'USD',
        reason: cmd.reason ?? null,
        gatewayStatus: cmd.gatewayStatus ?? null,
        providerRef: cmd.providerRef ?? null,
        dedupeKey: cmd.dedupeKey,
        actorId: null,
      },
      occurredAt,
    );
    if (result.replayed) replayed += 1;
    else applied += 1;
    state = result.state;
  }

  return { applied, replayed, state: state ?? (await loadState(organizationId)) };
}

export interface OrgSubscriptionView {
  organizationId: string;
  plan: string;
  status: string;
  paidTotalCents: number;
  netPaidCents: number;
  startedAt: string | null;
  canceledAt: string | null;
  lastEventAt: string | null;
  /** 最近一次成功的款项（用于"上次付款"展示）。 */
  lastCharge: { chargeId: string; amountCents: number; currency: string; status: string; at: string | null } | null;
  /** Dodo 侧订阅 id（来自 `providerRef`），用于自助管理入口。 */
  providerSubscriptionId: string | null;
}

/** 组织当前订阅视图（供 `/console/settings` 与 `/api/payments/dodo/subscription`）。 */
export async function readOrgSubscription(organizationId: string): Promise<OrgSubscriptionView> {
  const state = await loadState(organizationId);
  const charges = [...state.charges].sort((a, b) =>
    (b.settledAt ?? b.createdAt).localeCompare(a.settledAt ?? a.createdAt),
  );
  const last = charges[0] ?? null;

  const refRow = await db.billingEvent.findFirst({
    where: { organizationId, providerRef: { not: null } },
    select: { providerRef: true },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
  });

  return {
    organizationId,
    plan: state.plan,
    status: state.status,
    paidTotalCents: state.paidTotalCents,
    netPaidCents: state.netPaidCents,
    startedAt: state.startedAt,
    canceledAt: state.canceledAt,
    lastEventAt: state.lastEventAt,
    lastCharge: last
      ? {
          chargeId: last.chargeId,
          amountCents: last.amountCents,
          currency: last.currency,
          status: last.status,
          at: last.settledAt ?? last.createdAt,
        }
      : null,
    providerSubscriptionId: refRow?.providerRef ?? null,
  };
}

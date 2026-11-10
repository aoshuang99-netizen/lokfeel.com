export const dynamic = 'force-dynamic';

/**
 * GET /api/payments/dodo/subscription —— 当前组织的订阅状态（只读）
 * ═══════════════════════════════════════════════════════════════════════
 * 数据来自**事件账本派生**（`BillingEvent` → `reduceBillingEvents`），
 * 不是某个 `status` 列。因此它与 webhook 写入路径永远同源，
 * 不存在"表里写着 ACTIVE 但账上一笔钱都没收到"这种自相矛盾的状态。
 *
 * 权限：`billing.read`（成员可看，只有 OWNER/ADMIN 可动钱）。
 */

import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/auth';
import { hasCapability } from '@/lib/tenancy/guard';
import { resolveActiveTenant } from '@/lib/tenancy/resolve';
import { readOrgSubscription } from '@/lib/payments/dodo/store';
import { PLAN_CATALOG, isSellablePlanId } from '@/config/subscription-plans';

export async function GET() {
  let user: { id: string };
  try {
    ({ user } = await requireAuth());
  } catch {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let tenant;
  try {
    tenant = await resolveActiveTenant(user.id);
  } catch {
    return NextResponse.json({ ok: true, status: 'NO_ORGANIZATION', plan: 'FREE' });
  }

  if (!hasCapability(tenant, 'billing.read')) {
    return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });
  }

  const view = await readOrgSubscription(tenant.organizationId);
  const planDetail = isSellablePlanId(view.plan) ? PLAN_CATALOG[view.plan] : null;

  return NextResponse.json(
    {
      ok: true,
      organizationId: view.organizationId,
      plan: view.plan,
      planName: planDetail?.name ?? 'Free',
      status: view.status,
      currency: 'USD',
      paidTotalCents: view.paidTotalCents,
      netPaidCents: view.netPaidCents,
      startedAt: view.startedAt,
      canceledAt: view.canceledAt,
      lastEventAt: view.lastEventAt,
      lastCharge: view.lastCharge,
      limits: planDetail?.limits ?? null,
      canManage: hasCapability(tenant, 'billing.manage'),
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}

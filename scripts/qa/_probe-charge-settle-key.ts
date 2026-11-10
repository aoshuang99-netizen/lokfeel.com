/**
 * 临时探针（不提交）：验证 R-15 断言
 * 场景：同一 payment_id 先 payment.failed、后 payment.succeeded
 * 问题：成功事件是否因共用 dedupeKey 被跳过
 */
import { translateDodoEvent, type LedgerSnapshot } from '@/lib/payments/dodo/events';
import { BILLING_INTERVALS, DODO_PRODUCT_ENV, SELLABLE_PLAN_IDS } from '@/config/subscription-plans';

const ENV: Record<string, string> = (() => {
  const env: Record<string, string> = {};
  for (const plan of SELLABLE_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      env[DODO_PRODUCT_ENV[plan][interval]] = `pdt_${plan.toLowerCase()}_${interval}`;
    }
  }
  return env;
})();

const ACTIVE: LedgerSnapshot = { plan: 'GROWTH', status: 'ACTIVE' };
const META = { organizationId: 'org_1', plan: 'GROWTH', interval: 'monthly' };

function translate(type: string, data: Record<string, unknown>) {
  return translateDodoEvent({ type, data: { ...data, metadata: META } }, ACTIVE, ENV);
}

const failed = translate('payment.failed', {
  payment_id: 'pay_same',
  subscription_id: 'sub_1',
  product_id: 'pdt_growth_monthly',
  total_amount: 14900,
  currency: 'usd',
});
const succeeded = translate('payment.succeeded', {
  payment_id: 'pay_same',
  subscription_id: 'sub_1',
  product_id: 'pdt_growth_monthly',
  total_amount: 14900,
  currency: 'usd',
});

function keys(o: ReturnType<typeof translate>) {
  if (o.kind !== 'apply') return { kind: o.kind, reason: (o as { reason?: string }).reason };
  return { kind: 'apply', commands: o.commands.map((c) => `${c.type} :: ${(c as { dedupeKey: string }).dedupeKey}`) };
}

console.log('--- payment.failed ---');
console.log(JSON.stringify(keys(failed), null, 2));
console.log('--- payment.succeeded (same payment_id) ---');
console.log(JSON.stringify(keys(succeeded), null, 2));

// 结论判定（2026-11-10 R-15 修复后语义）：
// · 「建款」键重叠是正确幂等（同一笔款只创建一次，内核还强制拒绝重复创建）
// · 「结算」键重叠才是缺陷（会让后到的结算命令被判 replayed 静默丢弃）
const fk = failed.kind === 'apply' ? failed.commands.map((c) => (c as { dedupeKey: string }).dedupeKey) : [];
const sk = succeeded.kind === 'apply' ? succeeded.commands.map((c) => (c as { dedupeKey: string }).dedupeKey) : [];
const overlap = fk.filter((k) => sk.includes(k));
const settleOverlap = overlap.filter((k) => k.includes('charge-settled'));
console.log('\n建款键重叠（正确幂等） =', JSON.stringify(overlap.filter((k) => k.includes('charge-created'))));
console.log('结算键重叠（必须是空） =', JSON.stringify(settleOverlap));
console.log(
  settleOverlap.length === 0
    ? '=> R-15 已修复：结算键分态，失败不再吞成功；"失败后同 id 成功"由内核显式拒绝并告警'
    : '=> R-15 仍存在：结算键重叠会让成功被静默吞掉',
);

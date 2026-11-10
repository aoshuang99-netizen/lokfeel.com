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

// 结论判定：共用键 ⇒ 成功那次的 settle 键与失败那次相同
const fk = failed.kind === 'apply' ? failed.commands.map((c) => (c as { dedupeKey: string }).dedupeKey) : [];
const sk = succeeded.kind === 'apply' ? succeeded.commands.map((c) => (c as { dedupeKey: string }).dedupeKey) : [];
const overlap = fk.filter((k) => sk.includes(k));
console.log('\n重叠的 dedupeKey =', JSON.stringify(overlap, null, 2));
console.log(overlap.length > 0
  ? '=> 冲突成立：后到的成功事件中，重叠键对应的命令会被判 replayed 跳过'
  : '=> 无冲突：成功与失败使用互不相同的键');

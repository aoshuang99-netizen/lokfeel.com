/**
 * 订阅计划单一配置源 —— 独立校验脚本（无测试框架依赖）
 *
 * 用途：在不便运行 Jest 的环境（CI 之外的快速自检、本地排查）中，
 *      验证 src/config/plans.ts 与 prisma enum、兼容层的一致性。
 *
 * 运行：npx tsx scripts/verify-plans.ts
 * 退出码：0 = 全部通过；1 = 存在不一致
 */
import fs from 'fs';
import path from 'path';

import {
  PLANS,
  PLAN_IDS,
  RECURRING_PLAN_IDS,
  SELLABLE_PLAN_IDS,
  formatPlanPrice,
  getPlanPriceCents,
  getPlanPriceDollars,
  getYearlySavingsPercent,
  isPlanId,
} from '../src/config/plans';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

console.log('\n订阅计划单一配置源校验 (P0-7)\n');

// ── 1. 与 prisma enum 对齐 ────────────────────────────────────────────────
console.log('[1] 与 prisma enum SubscriptionPlan 对齐');
{
  const schema = read('prisma/schema.prisma');
  const matched = schema.match(/enum\s+SubscriptionPlan\s*\{([\s\S]*?)\}/);
  if (!matched) {
    check('能在 schema.prisma 中找到 enum SubscriptionPlan', false);
  } else {
    const dbValues = matched[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
      .sort();
    const planIds = [...PLAN_IDS].sort();
    check(
      `PLAN_IDS 与数据库枚举一致（DB: ${dbValues.join(', ')}）`,
      JSON.stringify(dbValues) === JSON.stringify(planIds),
      `PLAN_IDS: ${planIds.join(', ')}`,
    );
  }
}

// ── 2. 价格权威性 ─────────────────────────────────────────────────────────
console.log('\n[2] 价格与配额');
{
  check('PRO: 月付权威美分 = 1999', getPlanPriceCents('PREMIUM_MONTHLY', 'monthly') === 1999);
  check('PRO: 年付权威美分 = 14999', getPlanPriceCents('PREMIUM_YEARLY', 'yearly') === 14999);
  check('FREE 价格为 0', getPlanPriceCents('FREE', 'monthly') === 0);
  check(
    '所有价格均为整数分（无浮点）',
    PLAN_IDS.every((id) =>
      Object.values(PLANS[id].priceCents).every((c) => Number.isInteger(c) && c >= 0),
    ),
  );
  check('年付节省比例约 37%', getYearlySavingsPercent('PREMIUM_MONTHLY') === 37);
  check(
    '美元派生值与美分值一致',
    PLAN_IDS.every((id) => {
      const d = getPlanPriceDollars(id);
      return (
        Math.abs(d.monthly - PLANS[id].priceCents.monthly / 100) < 1e-9 &&
        Math.abs(d.yearly - PLANS[id].priceCents.yearly / 100) < 1e-9
      );
    }),
  );
}

// ── 3. 展示格式化 ─────────────────────────────────────────────────────────
console.log('\n[3] 展示价格格式化');
{
  const cases: Array<[string, string]> = [
    [formatPlanPrice('FREE', 'monthly'), '$0'],
    [formatPlanPrice('PREMIUM_MONTHLY', 'monthly'), '$19.99/mo'],
    [formatPlanPrice('PREMIUM_YEARLY', 'yearly'), '$149.99/yr'],
  ];
  for (const [actual, expected] of cases) {
    check(`formatPlanPrice → ${expected}`, actual === expected, `实际得到: ${actual}`);
  }
}

// ── 4. 售卖边界 ───────────────────────────────────────────────────────────
console.log('\n[4] 可售档位边界');
{
  check('周期扣款档仅含 2 个订阅档', JSON.stringify([...RECURRING_PLAN_IDS].sort()) === JSON.stringify(['PREMIUM_MONTHLY', 'PREMIUM_YEARLY']));
  check('免费档不进售卖列表', !SELLABLE_PLAN_IDS.includes('FREE'));
  check('LADY_FREE 不进售卖列表', !SELLABLE_PLAN_IDS.includes('LADY_FREE'));
  check('未定价的 LIFETIME 不进售卖列表', !SELLABLE_PLAN_IDS.includes('LIFETIME'));
  check('isPlanId 正确鉴权', isPlanId('PREMIUM_MONTHLY') && !isPlanId('PLUS') && !isPlanId('FOUNDER') && !isPlanId('__proto__'));
}

// ── 5. 反回归：不得再有散落的硬编码价格 ────────────────────────────────────
console.log('\n[5] 反回归守卫');
{
  const files = [
    'src/constants/index.ts',
    'src/lib/creem.ts',
    'src/components/subscription/paywall.tsx',
  ];
  const forbidden = ['19.99', '39.90', '149.99', '9.99', '1999', '14999'];
  for (const rel of files) {
    let text: string;
    try {
      text = read(rel);
    } catch {
      check(`${rel} 可读取`, false);
      continue;
    }
    check(`${rel} 引用了单一配置源`, text.includes('@/config/plans'));
    const hit = forbidden.find((v) => text.includes(v));
    check(`${rel} 无硬编码价格字面量`, hit === undefined, hit ? `发现禁用字面量: ${hit}` : '');
  }
  const canonical = read('src/config/plans.ts');
  check('权威价格仅存在于 plans.ts', canonical.includes('1999') && canonical.includes('14999'));
}

// ── 汇总 ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(56)}`);
if (failures === 0) {
  console.log(`\x1b[32m全部通过\x1b[0m（${checks} 项检查）\n`);
  process.exit(0);
} else {
  console.log(`\x1b[31m失败 ${failures} 项\x1b[0m / 共 ${checks} 项检查\n`);
  process.exit(1);
}

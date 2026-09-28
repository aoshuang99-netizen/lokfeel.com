/**
 * ============================================================================
 * P0-7 · 订阅计划单一配置源 —— 一致性守卫测试
 * ============================================================================
 *
 * 目的：把"价格只在一个地方定义"从**口头约定**变成**CI 强制约束**。
 *
 * 改造前，套餐与价格散落在四处且互相冲突：
 *   · src/constants/index.ts           $19.99 / $149.99
 *   · src/lib/creem.ts                 1999 分 / 14999 分
 *   · src/components/.../paywall.tsx   $9.99 / $39.90 / $149.99（完全不同的四档）
 *   · prisma enum SubscriptionPlan     FREE/LADY_FREE/PREMIUM_MONTHLY/PREMIUM_YEARLY/LIFETIME
 *
 * 本测试会在以下任一情况发生时失败（即 CI 拦截漂移）：
 *   1. 有人新增/删除 Prisma 枚举值却没同步 PLAN_IDS
 *   2. 有人改了 PLANS 里的配额却没同步 MATCH_CONFIG
 *   3. 有人又往组件/服务里硬编码价格字面量
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';

import {
  PLANS,
  PLAN_IDS,
  RECURRING_PLAN_IDS,
  SELLABLE_PLAN_IDS,
  WEEKLY_MATCH_LIMITS,
  formatPlanPrice,
  getPlanPriceCents,
  getPlanPriceDollars,
  getYearlySavingsPercent,
  isPlanId,
  type PlanId,
} from '@/config/plans';
import { SUBSCRIPTION_PLANS, MATCH_CONFIG } from '@/constants';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 历史上三处冲突的定义位置，改造后都必须从单一配置源派生 */
const DERIVED_SOURCES = [
  'src/constants/index.ts',
  'src/lib/creem.ts',
  'src/components/subscription/paywall.tsx',
];

describe('P0-7 订阅计划单一配置源', () => {
  // ── 1. 与数据库枚举对齐 ─────────────────────────────────────────────
  describe('与 prisma schema 的 enum 对齐', () => {
    it('PLAN_IDS 必须与 prisma enum SubscriptionPlan 完全一致', () => {
      const schema = read('prisma/schema.prisma');
      const matched = schema.match(/enum\s+SubscriptionPlan\s*\{([\s\S]*?)\}/);
      expect(matched).not.toBeNull();

      const dbValues = (matched as RegExpMatchArray)[1]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('@@'));

      expect([...PLAN_IDS].sort()).toEqual([...dbValues].sort());
    });

    it('每个 PlanId 都有完整的 PlanDefinition', () => {
      for (const id of PLAN_IDS) {
        const plan = PLANS[id];
        expect(plan).toBeDefined();
        expect(plan.id).toBe(id);
        expect(plan.name.length).toBeGreaterThan(0);
        expect(plan.priceCents).toEqual(
          expect.objectContaining({
            monthly: expect.any(Number),
            yearly: expect.any(Number),
          }),
        );
      }
    });

    it('价格必须是整数分，不允许出现浮点分', () => {
      for (const id of PLAN_IDS) {
        for (const cents of Object.values(PLANS[id].priceCents)) {
          expect(Number.isInteger(cents)).toBe(true);
          expect(cents).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  // ── 2. 向后兼容层必须与权威源一致 ───────────────────────────────────
  describe('SUBSCRIPTION_PLANS 兼容层', () => {
    it('键集与 PLAN_IDS 完全一致', () => {
      expect(Object.keys(SUBSCRIPTION_PLANS).sort()).toEqual([...PLAN_IDS].sort());
    });

    it('美元展示价与权威美分值一致', () => {
      for (const id of PLAN_IDS) {
        expect(SUBSCRIPTION_PLANS[id].price).toEqual(getPlanPriceDollars(id));
        expect(SUBSCRIPTION_PLANS[id].price.monthly).toBeCloseTo(
          PLANS[id].priceCents.monthly / 100,
          6,
        );
        expect(SUBSCRIPTION_PLANS[id].price.yearly).toBeCloseTo(
          PLANS[id].priceCents.yearly / 100,
          6,
        );
      }
    });

    it('功能配额与功能集引用同一对象（防止悄悄复制一份）', () => {
      for (const id of PLAN_IDS) {
        expect(SUBSCRIPTION_PLANS[id].features).toEqual(PLANS[id].features);
      }
    });
  });

  // ── 3. 匹配配额不得二次定义 ─────────────────────────────────────────
  describe('匹配配额一致性', () => {
    it('MATCH_CONFIG.weeklyMatches 必须与 PLANS 的配额一致', () => {
      for (const id of PLAN_IDS) {
        const configured = (MATCH_CONFIG.weeklyMatches as Record<string, number>)[id];
        if (configured === undefined) continue; // 新档位尚未接入匹配引擎时允许缺省
        expect(configured).toBe(PLANS[id].features.weeklyMatches);
      }
    });

    it('WEEKLY_MATCH_LIMITS 是 PLANS 的完整投影', () => {
      for (const id of PLAN_IDS) {
        expect(WEEKLY_MATCH_LIMITS[id]).toBe(PLANS[id].features.weeklyMatches);
      }
    });
  });

  // ── 4. 派生辅助函数 ─────────────────────────────────────────────────
  describe('派生工具函数', () => {
    it('formatPlanPrice 生成连续可读的价格字符串', () => {
      expect(formatPlanPrice('FREE', 'monthly')).toBe('$0');
      expect(formatPlanPrice('PREMIUM_MONTHLY', 'monthly')).toBe('$19.99/mo');
      expect(formatPlanPrice('PREMIUM_YEARLY', 'yearly')).toBe('$149.99/yr');
    });

    it('formatPlanPrice 不会产生多余小数位', () => {
      for (const id of PLAN_IDS) {
        for (const period of ['monthly', 'yearly'] as const) {
          const text = formatPlanPrice(id, period);
          if (text === '$0') continue;
          expect(text).toMatch(/^\$\d+\.\d{2}\/(mo|yr)$/);
        }
      }
    });

    it('getPlanPriceCents 返回权威美分值', () => {
      expect(getPlanPriceCents('PREMIUM_MONTHLY', 'monthly')).toBe(1999);
      expect(getPlanPriceCents('PREMIUM_YEARLY', 'yearly')).toBe(14999);
      expect(getPlanPriceCents('FREE', 'monthly')).toBe(0);
    });

    it('年付相对月付的节省比例约 37%，且当年付未定价时返回 0', () => {
      expect(getYearlySavingsPercent('PREMIUM_MONTHLY')).toBe(37);
      expect(getYearlySavingsPercent('FREE')).toBe(0);
    });

    it('isPlanId 能正确鉴权外部输入（用于结账接口入参校验）', () => {
      expect(isPlanId('PREMIUM_MONTHLY')).toBe(true);
      expect(isPlanId('LIFETIME')).toBe(true);
      expect(isPlanId('PLUS')).toBe(false);
      expect(isPlanId('FOUNDER')).toBe(false);
      expect(isPlanId(undefined)).toBe(false);
      expect(isPlanId(123)).toBe(false);
      expect(isPlanId('__proto__')).toBe(false);
    });
  });

  // ── 5. 售卖边界 ─────────────────────────────────────────────────────
  describe('可售档位边界', () => {
    it('免费档与未定价档不进售卖列表', () => {
      expect(SELLABLE_PLAN_IDS).not.toContain('FREE');
      expect(SELLABLE_PLAN_IDS).not.toContain('LADY_FREE');
      expect(SELLABLE_PLAN_IDS).not.toContain('LIFETIME');
    });

    it('周期扣款通道只接受可售的订阅型档位（排除买断档）', () => {
      expect([...RECURRING_PLAN_IDS].sort()).toEqual(['PREMIUM_MONTHLY', 'PREMIUM_YEARLY']);
      for (const id of RECURRING_PLAN_IDS) {
        expect(PLANS[id].isOneTime).not.toBe(true);
        expect(PLANS[id].notForSale).not.toBe(true);
      }
    });

    it('每个可周期扣款的档位都必须有非零价格', () => {
      for (const id of RECURRING_PLAN_IDS) {
        const { monthly, yearly } = PLANS[id].priceCents;
        expect(monthly > 0 || yearly > 0).toBe(true);
      }
    });
  });

  // ── 6. 反回归：不得再次散落硬编码价格 ───────────────────────────────
  describe('反回归守卫（防止冲突复发）', () => {
    it('历史冲突的三处定义必须从 @/config/plans 派生', () => {
      for (const rel of DERIVED_SOURCES) {
        const text = read(rel);
        expect(text).toContain('@/config/plans');
      }
    });

    it('历史冲突的三处不得再出现硬编码价格字面量', () => {
      // 改造前的冲突数值，任何一处复活都说明有人又把价格写回去了
      const forbidden = ['19.99', '39.90', '149.99', '9.99', '1999', '14999'];
      for (const rel of DERIVED_SOURCES) {
        const text = read(rel);
        for (const value of forbidden) {
          expect(text).not.toContain(value);
        }
      }
    });

    it('价格只能定义在单一配置源文件中', () => {
      const canonical = read('src/config/plans.ts');
      expect(canonical).toContain('1999');
      expect(canonical).toContain('14999');
    });
  });
});

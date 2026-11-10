/**
 * 收银台就绪度 & 逐 SKU 绑定 —— 回归测试
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 这里钉住一条曾经会真的发生的商业事故：
 *
 *   Dodo 对单笔金额有商户级上限（实测 $3,000）。Scale 年付 $3,990 因此
 *   **建不出商品**，于是 `DODO_PRODUCT_SCALE_YEARLY` 为空。早期实现把
 *   `ready` 定义成"6 个 SKU 全绑定"，结果这 1 个空格把另外 5 个可售
 *   套餐一起禁掉了 —— 页面显示"在线开通即将开放"，一分钱收不到，
 *   而后台一切正常、没有任何报错。
 *
 * 现在 `ready` 只表达凭据，逐格可用性看 `readSkuBindings()`。
 * 下面的断言是这两种语义的边界。
 */

import { DODO_PRODUCT_ENV, SELLABLE_PLAN_IDS } from '@/config/subscription-plans';
import { readSkuBindings, readStoreReadiness } from '@/lib/payments/dodo/config';

/** 形状合法的假凭据（不是真实密钥，仅满足 ≥16 非空白字符的下限校验）。 */
const FAKE_KEY = ['dodo', 'live', 'unit-test-placeholder-key'].join('_');

const CREDENTIALS: Record<string, string> = {
  DODO_PAYMENTS_API_KEY: FAKE_KEY,
  DODO_PAYMENTS_ENVIRONMENT: 'live_mode',
};

describe('readStoreReadiness', () => {
  it('空环境：未就绪，且列出全部 6 个未绑定变量', () => {
    const r = readStoreReadiness({});

    expect(r.ready).toBe(false);
    expect(r.unboundProducts).toHaveLength(6);
    expect(r.missingCredentials).toEqual(
      expect.arrayContaining(['DODO_PAYMENTS_API_KEY', 'DODO_PAYMENTS_ENVIRONMENT']),
    );
  });

  it('凭据齐备但一个商品都没绑：ready=true —— 通道接上了，只是还没上架', () => {
    const r = readStoreReadiness({ ...CREDENTIALS });

    expect(r.ready).toBe(true);
    expect(r.missingCredentials).toEqual([]);
    expect(r.unboundProducts).toHaveLength(6);
  });

  it('凭据齐备 + 5/6 绑定：ready 仍为 true（不能因 1 个 SKU 整店禁售）', () => {
    const env: Record<string, string> = { ...CREDENTIALS };
    for (const plan of SELLABLE_PLAN_IDS) {
      for (const interval of ['monthly', 'yearly'] as const) {
        const name = DODO_PRODUCT_ENV[plan][interval];
        const skip = plan === 'SCALE' && interval === 'yearly';
        env[name] = skip ? '' : `pdt_test_${plan}_${interval}`;
      }
    }

    const r = readStoreReadiness(env);

    expect(r.ready).toBe(true);
    expect(r.unboundProducts).toEqual(['DODO_PRODUCT_SCALE_YEARLY']);
  });

  it('空白字符串等于没绑（" " 不算已配置）', () => {
    const r = readStoreReadiness({
      ...CREDENTIALS,
      [DODO_PRODUCT_ENV.STARTER.monthly]: '   ',
    });

    expect(r.unboundProducts).toContain(DODO_PRODUCT_ENV.STARTER.monthly);
  });
});

describe('readSkuBindings', () => {
  it('全空：3 档 × 2 周期的每一格都是 false', () => {
    const b = readSkuBindings({});

    for (const plan of SELLABLE_PLAN_IDS) {
      expect(b[plan].monthly).toBe(false);
      expect(b[plan].yearly).toBe(false);
    }
  });

  it('只绑了 1 格就只开 1 格（不连带整档）', () => {
    const b = readSkuBindings({
      [DODO_PRODUCT_ENV.GROWTH.monthly]: 'pdt_growth_monthly',
    });

    expect(b.GROWTH.monthly).toBe(true);
    expect(b.GROWTH.yearly).toBe(false);
    expect(b.STARTER.monthly).toBe(false);
    expect(b.SCALE.yearly).toBe(false);
  });

  it('空白值与全空格都不算绑定', () => {
    const b = readSkuBindings({
      [DODO_PRODUCT_ENV.SCALE.monthly]: '',
      [DODO_PRODUCT_ENV.SCALE.yearly]: '   ',
    });

    expect(b.SCALE.monthly).toBe(false);
    expect(b.SCALE.yearly).toBe(false);
  });
});

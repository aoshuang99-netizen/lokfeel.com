/**
 * 商业门禁（G12 / V23 R03）—— 防止"实现者自我授权开卖"的机制测试
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 背景（2026-11-10 正式上线总令）：`products.ts` 里 connection-os 的
 * `APPROVED + approvalRef` 曾由实现者自填。`readCheckoutGate()` 的意义在于
 * 把"人工定价批准"变成**代码层必要条件**：凭据齐备（实现者可修）
 * **AND** 商业批准（只有产品所有者能给）。
 *
 * V23 · R03（2026-11-16）：商业批准升级为**三重合取** ——
 *   `PRICING_APPROVED`（Owner 显式书面开关，pricing-gate.ts）
 *   AND 目录 `status === 'APPROVED'`
 *   AND 真实 `approvalRef`。
 * 生产 b50e53e 曾只凭目录自设 APPROVED 把 $89/$199/$449 与 checkoutReady=true
 * 暴露到公网（docs/v23/LIVE_RISK_AUDIT.md），本套件钉住这条因果链。
 */

import type { Product } from '@/config/products';
import { readCheckoutGate } from '@/lib/payments/commercial-gate';
import { readStoreReadiness } from '@/lib/payments/dodo/config';

// PRICING_APPROVED 是静态 Owner 开关；正向路径只能通过 mock 打开，
// 源码里没有任何 env / 配置可以把实现者自己抬到批准位。
let pricingApprovedSwitch = false;
jest.mock('@/config/pricing-gate', () => ({
  get PRICING_APPROVED() {
    return pricingApprovedSwitch;
  },
}));

/** 形状合法的假凭据（非真实密钥）。 */
const FAKE_KEY = ['dodo', 'live', 'unit-test-placeholder-key'].join('_');

const CREDENTIALS: Record<string, string> = {
  DODO_PAYMENTS_API_KEY: FAKE_KEY,
  DODO_PAYMENTS_ENVIRONMENT: 'live_mode',
};

/** 构造指定审批状态的 connection-os（绕过真实目录，测试门禁语义本身）。 */
function fakeProduct(status: 'PENDING_APPROVAL' | 'APPROVED', approvalRef?: string): Product {
  return {
    id: 'connection-os',
    relation: 'SOLD_HERE',
    brand: 'LokFeel',
    name: 'LokFeel Connection OS',
    oneLiner: 'x',
    audience: 'x',
    capabilities: [],
    pricing: { status, displayPrice: status === 'APPROVED' ? 'From $49/mo' : null, ...(approvalRef ? { approvalRef } : {}) },
    checkout: { kind: status === 'APPROVED' ? 'internal' : 'none', label: 'x' },
    refund: { days: null, source: '/refunds', note: 'x' },
    docsRef: 'x',
  } as unknown as Product;
}

// 只替换 getProduct：commercial-gate 的商业门输入；技术门走真实 readStoreReadiness(env 注入)。
jest.mock('@/config/products', () => {
  const actual = jest.requireActual('@/config/products');
  let product: unknown = actual.getProduct('connection-os');
  return {
    ...actual,
    __setProduct(p: unknown) {
      product = p;
    },
    getProduct: (id: string) => (id === 'connection-os' ? product : actual.getProduct(id)),
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __setProduct } = jest.requireMock('@/config/products') as any;

describe('readCheckoutGate · G12 商业门禁', () => {
  it('无凭据 + 审批中（当前生产状态）：enabled=false，技术/商业两门都不过', () => {
    __setProduct(fakeProduct('PENDING_APPROVAL'));
    const gate = readCheckoutGate({});

    expect(gate.enabled).toBe(false);
    expect(gate.credentialsReady).toBe(false);
    expect(gate.commercialApproved).toBe(false);
    expect(gate.approval.status).toBe('PENDING_APPROVAL');
  });

  it('凭据齐备 + 审批中：技术门过、商业门挡 —— enabled 必须 false', () => {
    __setProduct(fakeProduct('PENDING_APPROVAL'));
    const gate = readCheckoutGate({ ...CREDENTIALS });

    expect(gate.credentialsReady).toBe(true);
    expect(gate.commercialApproved).toBe(false);
    expect(gate.enabled).toBe(false);
  });

  it('凭据齐备 + APPROVED 但 approvalRef 为空：仍不可开（批准必须可溯源）', () => {
    __setProduct(fakeProduct('APPROVED', ''));
    const gate = readCheckoutGate({ ...CREDENTIALS });

    expect(gate.commercialApproved).toBe(false);
    expect(gate.enabled).toBe(false);
  });

  it('V23 R03 负控：目录 APPROVED + approvalRef + 凭据齐备，但 Owner 开关未签 ⇒ 门仍关', () => {
    pricingApprovedSwitch = false;
    __setProduct(fakeProduct('APPROVED', 'PRICING_APPROVAL 由产品所有者于工单 #TBD 亲批'));
    const gate = readCheckoutGate({ ...CREDENTIALS });

    // 这正是生产 b50e53e 泄价的老路：目录自设 APPROVED 不能等于批准。
    expect(gate.credentialsReady).toBe(true);
    expect(gate.commercialApproved).toBe(false);
    expect(gate.enabled).toBe(false);
  });

  it('凭据齐备 + Owner 开关 + APPROVED + approvalRef：三门全过，enabled=true（唯一开卖形态）', () => {
    pricingApprovedSwitch = true;
    __setProduct(fakeProduct('APPROVED', 'PRICING_APPROVAL 由产品所有者于工单 #TBD 亲批'));
    const gate = readCheckoutGate({ ...CREDENTIALS });

    expect(gate.credentialsReady).toBe(true);
    expect(gate.commercialApproved).toBe(true);
    expect(gate.enabled).toBe(true);
    expect(gate.approval.ref).toMatch(/PRICING_APPROVAL/);
  });

  it('技术门与 readStoreReadiness 同源：不复制就绪逻辑（防止两处口径漂移）', () => {
    const store = readStoreReadiness({ ...CREDENTIALS });
    const gate = readCheckoutGate({ ...CREDENTIALS });
    expect(gate.credentialsReady).toBe(store.ready);
    expect(gate.unboundProducts).toEqual(store.unboundProducts);
  });
});

afterEach(() => {
  // 还原真实目录与 Owner 开关，避免泄漏到其他测试文件的 module registry
  pricingApprovedSwitch = false;
  jest.clearAllMocks();
});

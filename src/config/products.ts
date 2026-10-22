/**
 * 商业契约的**唯一产品目录**（V18-02）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么要有这个文件
 * ------------------
 * 2026-10-22 实测发现，这个站上其实有 **三条产品线**，而它们此前混在一起：
 *
 *   1. `LokFeel Connection OS` —— 主产品（目标 → WorkspaceSpec → Mission → Agent →
 *      Consent → Outcome）。**没有任何已获批的定价模型。**
 *   2. `LokFeel 旧会员`（`src/config/plans.ts`：PREMIUM_MONTHLY 等）——
 *      权益是每周匹配数 / 隐身 / 保险箱 / 已读回执，属于**交友 B2C 线**。
 *   3. `Hlua Pass`（`public/pay.html`）—— streaming + H-Points，CTA 指向 Gumroad，
 *      是**另一家/另一条业务**，退款写 7 天。
 *
 * 而 `/pricing` 此前 302 到 `/pay.html`。于是出现最坏的一种错配：
 * **用户点"定价"，看到的是第 3 条产品线，付的钱也不进第 1 条的产品。**
 *
 * 本文件的作用不是"展示价格"，而是把 **品牌 → 产品 → 定价状态 → 结账 → 权益 →
 * 退款政策** 钉成一张可被门禁检查的表，让"卖错东西"这件事在代码层面不可能悄悄发生。
 *
 * ── 三条硬规则（由 `npm run check:pricing` 强制）──────────────────────
 *
 *   R1. **未获批定价不得显示价格，也不得给结账入口。**
 *       `PENDING_APPROVAL` 的产品，`displayPrice()` 返回 null、`isPurchasable()` 返回 false。
 *       想改成 `APPROVED`，必须同时填 `approvalRef`（谁、何时、依据）——
 *       没有审批编号的"已批准"等于自己给自己批。
 *
 *   R2. **结账入口必须属于本产品的服务商。**
 *       Connection OS 现在**没有**结账入口（kind: 'none'）。这不是"待办"，是"当前事实"；
 *       把 `pay.html` 挂上来就是 R1 的反面教材。
 *
 *   R3. **退款政策必须可溯源到一条公开承诺。**
 *       每条 policy 都带 `source`（公开页路径）。三个产品可以有不同的天数，
 *       但**不许有无法归属的承诺** —— 这正是 7 天 / 14 天并存的成因：
 *       它们其实属于不同产品，只是此前被当成同一个。
 *
 * ── 不做什么 ────────────────────────────────────────────────────────
 *   · 不定价。定价是人的决策（`RISK_AND_DECISIONS.md` D-02），代码只表达"尚未获批"。
 *   · 不引用 `src/config/plans.ts`。那是旧 B2C 的价格源，把它接进 SaaS 目录
 *     正是 V18 明令禁止的"将旧 B2C 套餐直接定义为 SaaS 价格"。
 */

export type ProductId = 'connection-os' | 'legacy-membership' | 'hlua-pass';

/** 定价状态：只有 APPROVED 才允许对外显示金额 */
export type PricingStatus = 'APPROVED' | 'PENDING_APPROVAL' | 'NOT_FOR_SALE';

/** 结账方式：none = 无结账入口（未接入 / 未获批） */
export type CheckoutKind = 'none' | 'external';

export interface RefundPolicy {
  /** 天数；null = 尚无对外承诺（不得对外宣称具体天数） */
  days: number | null;
  /** 该承诺的公开出处（页路径或文件），不允许空 */
  source: string;
  note?: string;
}

export interface ProductPricing {
  status: PricingStatus;
  /** 仅供已获批产品填展示价；未获批必须为 null */
  displayPrice: string | null;
  /** APPROVED 时必填：谁在何时依据什么批的（决策记录 ID / 邮件日期） */
  approvalRef?: string;
}

export interface ProductCheckout {
  kind: CheckoutKind;
  /** kind='external' 时的跳转地址；kind='none' 必须为空 */
  href?: string;
  label: string;
}

export interface Product {
  id: ProductId;
  brand: string;
  name: string;
  /** 一句话说清"它是什么"，用于定价页首屏 */
  oneLiner: string;
  audience: string;
  /** 对外可见的能力/权益清单（不是价格表） */
  capabilities: string[];
  pricing: ProductPricing;
  checkout: ProductCheckout;
  refund: RefundPolicy;
  /** 该产品的技术/事实出处，便于审计 */
  docsRef: string;
}

export const PRODUCTS: readonly Product[] = [
  {
    id: 'connection-os',
    brand: 'LokFeel',
    name: 'LokFeel Connection OS',
    oneLiner:
      '把你的目标编译成一个可运行的工作区：目标 → WorkspaceSpec → Mission → Agent → Consent → Verified Outcome。',
    audience: '社群、专业团队、需要跨组织协作的小型机构',
    capabilities: [
      'Living Workspace 六屏：Now / Studio / Field / Consent / Outcomes / Agents',
      '组织态 Console 七屏：任务、成员、权限、用量、审计、桥接、设置',
      'Consent 先于动作：每一次对外披露都有依据与可撤回记录',
      'Verified Outcome：结果要能被验证，不是"跑完就算"',
      '机器面：MCP（5 工具）与 A2A 任务端点，与 REST 共用同一套租户守卫',
    ],
    pricing: {
      status: 'PENDING_APPROVAL',
      displayPrice: null,
    },
    checkout: {
      kind: 'none',
      label: '申请试用 / Request access',
    },
    refund: {
      days: null,
      source: '/refunds',
      note: '尚未对外销售，因此没有已生效的退款承诺；正式条款随首份报价一并书面确认',
    },
    docsRef: 'docs/implementation/FEATURE_INVENTORY.md',
  },
  {
    id: 'legacy-membership',
    brand: 'LokFeel',
    name: 'LokFeel 旧会员（B2C）',
    oneLiner: '交友产品线的订阅会员：每周匹配数、隐身、保险箱、已读回执等。',
    audience: '既有 B2C 用户（不是 Connection OS 的客户）',
    capabilities: [
      '每周匹配数 / 每匹配可发消息数',
      '隐身模式、已读回执、保险箱控制',
      '高级筛选、优先匹配、旅行模式',
    ],
    pricing: {
      status: 'NOT_FOR_SALE',
      displayPrice: null,
    },
    checkout: {
      kind: 'none',
      label: '由旧会员流程处理（不在本页销售）',
    },
    refund: {
      days: 14,
      source: '/refunds',
      note: '沿用站点现行 14 天政策；与 Hlua Pass 的 7 天不是同一条承诺',
    },
    docsRef: 'src/config/plans.ts',
  },
  {
    id: 'hlua-pass',
    brand: 'Hlua',
    name: 'Hlua Pass',
    oneLiner: '另一条产品线：streaming 与 H-Points 会员（不是 Connection OS）。',
    audience: 'Hlua 的既有用户',
    capabilities: ['Streaming', 'H-Points', 'Hlua 会员权益'],
    pricing: {
      status: 'NOT_FOR_SALE',
      displayPrice: null,
    },
    checkout: {
      kind: 'external',
      href: '/pay.html',
      label: '前往 Hlua Pass',
    },
    refund: {
      days: 7,
      source: 'public/pay.html',
      note: '该页第 167 行写 7 天 —— 属于 Hlua，不适用于 Connection OS',
    },
    docsRef: 'public/pay.html',
  },
];

export function getProduct(id: ProductId): Product {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) throw new Error(`未知产品：${id}`);
  return p;
}

/**
 * 对外可见的价格。
 * **未获批一律返回 null** —— R1 的唯一落点。调用方拿到 null 就不许渲染金额。
 */
export function displayPrice(product: Product): string | null {
  if (product.pricing.status !== 'APPROVED') return null;
  return product.pricing.displayPrice;
}

/** 是否允许给结账入口：必须同时满足"已获批"与"有服务商" */
export function isPurchasable(product: Product): boolean {
  if (product.pricing.status !== 'APPROVED') return false;
  if (product.checkout.kind === 'none') return false;
  return Boolean(product.checkout.href);
}

/**
 * 目录自检。`check:pricing` 与单测共用，避免两处规则漂移。
 * 返回问题列表（空数组 = 通过）。
 */
export function validateCatalog(products: readonly Product[] = PRODUCTS): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();

  for (const p of products) {
    if (ids.has(p.id)) problems.push(`${p.id}：产品 id 重复`);
    ids.add(p.id);

    // R1：已批准必须有审批依据；未获批必须没有价格
    if (p.pricing.status === 'APPROVED') {
      if (!p.pricing.approvalRef?.trim()) {
        problems.push(`${p.id}：状态 APPROVED 但没有 approvalRef（谁批的、何时、依据什么）`);
      }
      if (!p.pricing.displayPrice?.trim()) {
        problems.push(`${p.id}：状态 APPROVED 但没有 displayPrice`);
      }
    } else {
      if (p.pricing.displayPrice !== null) {
        problems.push(`${p.id}：状态 ${p.pricing.status} 却填了 displayPrice（未获批不得显示价格）`);
      }
      if (p.pricing.approvalRef) {
        problems.push(`${p.id}：未获批却填了 approvalRef，状态与依据不一致`);
      }
    }

    // R2：结账入口与状态必须相容
    if (p.pricing.status !== 'APPROVED' && p.checkout.kind === 'external') {
      problems.push(
        `${p.id}：未获批定价却挂了外部结账入口 ${p.checkout.href} —— 这正是"卖错产品"的形状`,
      );
    }
    if (p.checkout.kind === 'none' && p.checkout.href) {
      problems.push(`${p.id}：checkout.kind='none' 但填了 href`);
    }
    if (p.checkout.kind === 'external' && !p.checkout.href) {
      problems.push(`${p.id}：checkout.kind='external' 但没有 href`);
    }

    // R3：退款承诺必须可溯源
    if (!p.refund.source?.trim()) {
      problems.push(`${p.id}：refund.source 为空（承诺没有出处）`);
    }
    if (p.refund.days !== null && (!Number.isInteger(p.refund.days) || p.refund.days <= 0)) {
      problems.push(`${p.id}：refund.days 必须是正整数或 null，当前 ${String(p.refund.days)}`);
    }
  }

  return problems;
}

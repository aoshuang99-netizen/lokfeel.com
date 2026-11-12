/**
 * 商业门禁（G12）：收银台对公众开放的**必要条件**之一是「人工定价批准」。
 *
 * 背景（2026-11-10 正式上线总令 §2/§12）：
 *   `products.ts` 里 `connection-os` 的 `APPROVED` 曾由实现者自填 ——
 *   实现者可以解锁收款，等于没有门禁。本模块把"商业批准"做成**代码层机制**：
 *
 *     checkout 开放 = 技术就绪（凭据 + 6 SKU 绑定）AND 商业批准（APPROVED + approvalRef）
 *
 *   实现者可以修任何技术问题，但**改不动这个开关的语义** ——
 *   要开卖，`products.ts` 的 pricing.status 必须是 APPROVED 且带 approvalRef，
 *   而按总令，approvalRef 只能引用产品所有者的真实书面批准。
 */
import { getProduct } from '@/config/products';
import { readStoreReadiness, type EnvLike } from '@/lib/payments/dodo/config';

export interface CheckoutGate {
  /** 收银台是否对公众开放（技术 + 商业两道门全过）。 */
  enabled: boolean;
  /** 技术门：Dodo 凭据齐备 + 全部 SKU 已绑定商品。 */
  credentialsReady: boolean;
  /** 商业门：定价已获产品所有者批准。 */
  commercialApproved: boolean;
  /** 商业门的当前状态与（若已批准）批准引用。 */
  approval: { status: string; ref: string | null };
  /** 技术门未完成绑定的环境变量名（仅变量名，不含值）。 */
  unboundProducts: string[];
}

export function readCheckoutGate(env: EnvLike = process.env): CheckoutGate {
  const store = readStoreReadiness(env);
  const product = getProduct('connection-os');
  const pricing = product.pricing;
  const approved = pricing.status === 'APPROVED' && Boolean(pricing.approvalRef);
  return {
    enabled: store.ready && approved,
    credentialsReady: store.ready,
    commercialApproved: approved,
    approval: {
      status: pricing.status,
      ref: approved ? (pricing.approvalRef as string) : null,
    },
    unboundProducts: store.unboundProducts,
  };
}

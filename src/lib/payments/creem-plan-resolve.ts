/**
 * Creem 结算参数解析（B-16 / B-17 / B-18）
 *
 * 修复前的三个缺陷：
 *   1. **B-16 套餐可被前端伪造**：`/api/payments/creem/checkout` 允许 `productId` 与 `plan`
 *      任意组合，且只传 `productId` 时 `metadata.plan` 被写死字符串 `"dynamic"`。
 *      而 webhook 侧用 `SUPPORTED_PLAN_VALUES` 白名单校验 `metadata.plan`，
 *      `"dynamic"` 不成立 ⇒ 落到 `existing?.plan ?? "PREMIUM_MONTHLY"`。
 *      后果：**买年付被记成月付**（少 11 个月权益），且用户可自行拼 `productId` 得到任意商品。
 *   2. **B-17 幂等键含时间戳**：`requestId: order_${userId}_${Date.now()}`
 *      ⇒ 双击 / 前端重试 / 网络重发都会创建两笔独立 checkout，Creem 侧判重永远失效。
 *   3. **B-18（本轮新登记）schema 的 refine 无效**：
 *      `if (!data.plan && !data.productId) return { message: ... }` —— refine 回调返回**真值对象**
 *      即被 zod 视为“通过”，该校验从未生效（兜底靠下游 `else badRequest`，错误信息也丢了）。
 *
 * 本模块保持**纯函数**（env 由调用方注入），因此可以用最便宜的方式穷举组合。
 */

/** 可结算的付费套餐。`FREE` / `LADY_FREE` / `LIFETIME` 不进结算流程。 */
export type CreemCheckoutPlan = 'PREMIUM_MONTHLY' | 'PREMIUM_YEARLY'

/** Webhook 侧可能写进 `Subscription.plan` 的全部取值（与 Prisma 枚举逐字一致）。 */
export type CreemResolvedPlan =
  | CreemCheckoutPlan
  | 'LIFETIME'
  | 'FREE'
  | 'LADY_FREE'

const RESOLVED_PLAN_VALUES: readonly string[] = [
  'PREMIUM_MONTHLY',
  'PREMIUM_YEARLY',
  'LIFETIME',
  'FREE',
  'LADY_FREE',
]

function isCreemResolvedPlan(v: string): v is CreemResolvedPlan {
  return RESOLVED_PLAN_VALUES.includes(v)
}

export interface CreemProductEnv {
  CREEM_MONTHLY_PRODUCT_ID?: string | undefined
  CREEM_YEARLY_PRODUCT_ID?: string | undefined
}

function norm(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/** productId → 套餐。仅认环境变量里登记过的商品，未知商品返回 null（调用方必须拒绝）。 */
export function planFromProductId(
  productId: unknown,
  env: CreemProductEnv,
): CreemCheckoutPlan | null {
  const id = norm(productId)
  if (!id) return null
  const monthly = norm(env.CREEM_MONTHLY_PRODUCT_ID)
  const yearly = norm(env.CREEM_YEARLY_PRODUCT_ID)
  // 先比年付：万一两个 env 配成同一个商品，宁可多给权益也不要少给。
  if (yearly && id === yearly) return 'PREMIUM_YEARLY'
  if (monthly && id === monthly) return 'PREMIUM_MONTHLY'
  return null
}

/** 套餐 → 环境变量里登记的商品 id。 */
export function productIdForPlan(plan: CreemCheckoutPlan, env: CreemProductEnv): string | null {
  return plan === 'PREMIUM_MONTHLY'
    ? norm(env.CREEM_MONTHLY_PRODUCT_ID)
    : norm(env.CREEM_YEARLY_PRODUCT_ID)
}

export type CheckoutRejectReason = 'missing_input' | 'unknown_product' | 'plan_mismatch'

export type CheckoutResolution =
  | { ok: true; plan: CreemCheckoutPlan; productId: string }
  | { ok: false; reason: CheckoutRejectReason; message: string }

/**
 * 结算入口的唯一判定点。
 *
 * 规则（全部 fail closed）：
 *   - 两者都没给 ⇒ missing_input
 *   - 只给 productId ⇒ 必须能在 env 里反查到套餐，否则 unknown_product（不再透传任意商品）
 *   - 只给 plan ⇒ 取该套餐对应 env 商品；env 未配 ⇒ unknown_product
 *   - 两者都给 ⇒ 必须互相印证，否则 plan_mismatch（防止前端用月付 plan 配年付商品或反之）
 */
export function resolveCheckoutTarget(
  input: { plan?: unknown; productId?: unknown },
  env: CreemProductEnv,
): CheckoutResolution {
  const rawPlan = norm(input.plan)
  const rawProductId = norm(input.productId)

  if (!rawPlan && !rawProductId) {
    return {
      ok: false,
      reason: 'missing_input',
      message: "Must provide either 'plan' or 'productId'",
    }
  }

  // 前端自报的 plan 只允许是这两个；其它值（含 FREE / LIFETIME / 乱写）一律拒绝。
  const declaredPlan: CreemCheckoutPlan | null =
    rawPlan === 'PREMIUM_MONTHLY' || rawPlan === 'PREMIUM_YEARLY' ? rawPlan : null
  if (rawPlan && !declaredPlan) {
    return {
      ok: false,
      reason: 'unknown_product',
      message: `Unsupported plan: ${rawPlan}`,
    }
  }

  if (rawProductId) {
    const mapped = planFromProductId(rawProductId, env)
    if (!mapped) {
      return {
        ok: false,
        reason: 'unknown_product',
        message: 'Unknown productId for this deployment',
      }
    }
    if (declaredPlan && declaredPlan !== mapped) {
      return {
        ok: false,
        reason: 'plan_mismatch',
        message: `plan ${declaredPlan} does not match productId (${mapped})`,
      }
    }
    return { ok: true, plan: mapped, productId: rawProductId }
  }

  // 只给 plan
  const productId = productIdForPlan(declaredPlan!, env)
  if (!productId) {
    return {
      ok: false,
      reason: 'unknown_product',
      message: `CREEM_${declaredPlan === 'PREMIUM_MONTHLY' ? 'MONTHLY' : 'YEARLY'}_PRODUCT_ID is not configured`,
    }
  }
  return { ok: true, plan: declaredPlan!, productId }
}

/** 幂等窗口：15 分钟。同一用户 + 同一套餐在此窗口内重复点击复用同一 checkout。 */
export const CHECKOUT_IDEMPOTENCY_WINDOW_MS = 15 * 60 * 1000

/**
 * 结算幂等键（B-17）。
 *
 * 不能用 `Date.now()` 裸时间戳 —— 那样每次调用都是新键，判重形同虚设；
 * 也不能用「用户+套餐」的永久固定键 —— 用户放弃支付后想重试会被 Creem 判成重复请求拿不回链接。
 * 因此按固定窗口分桶：窗口内幂等，跨窗口可新建。
 */
export function checkoutRequestId(
  userId: string,
  plan: CreemCheckoutPlan,
  nowMs: number,
  windowMs: number = CHECKOUT_IDEMPOTENCY_WINDOW_MS,
): string {
  const safeWindow = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : CHECKOUT_IDEMPOTENCY_WINDOW_MS
  const bucket = Math.floor(nowMs / safeWindow)
  return `order_${userId}_${plan}_${bucket}`
}

/**
 * Webhook 侧套餐判定。
 *
 * 顺序：合法 metadata.plan → 按 productId 反查 → 已有记录的套餐 → 月付兜底。
 * 兜底时返回 `degraded: true`，调用方必须打日志 —— 这类“静默降级”正是 B-16 的成因。
 */
export function resolveWebhookPlan(params: {
  rawPlan: unknown
  productId: unknown
  env: CreemProductEnv
  fallbackPlan?: string | null
}): {
  plan: CreemResolvedPlan
  degraded: boolean
  source: 'metadata' | 'product' | 'existing' | 'default'
} {
  const rawPlan = norm(params.rawPlan)
  if (rawPlan === 'PREMIUM_MONTHLY' || rawPlan === 'PREMIUM_YEARLY') {
    return { plan: rawPlan, degraded: false, source: 'metadata' }
  }
  // LIFETIME / FREE / LADY_FREE 在白名单内但不在结算映射里，沿用原值即可。
  if (rawPlan === 'LIFETIME' || rawPlan === 'FREE' || rawPlan === 'LADY_FREE') {
    return { plan: rawPlan, degraded: false, source: 'metadata' }
  }

  const fromProduct = planFromProductId(params.productId, params.env)
  if (fromProduct) return { plan: fromProduct, degraded: false, source: 'product' }

  const existing = norm(params.fallbackPlan)
  if (existing && isCreemResolvedPlan(existing)) {
    return { plan: existing, degraded: true, source: 'existing' }
  }

  return { plan: 'PREMIUM_MONTHLY', degraded: true, source: 'default' }
}

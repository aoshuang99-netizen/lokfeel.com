/**
 * Dodo Payments —— 最小 REST 客户端（零 SDK 依赖）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 只封装本项目**真正用到**的四个调用：
 *
 *   POST /checkouts                     创建结账会话（收银台主链路）
 *   GET  /products                      读取商品目录（用于「后台改了价、前台跟着变」）
 *   GET  /subscriptions/{subscription_id} 对账 / 回填（webhook 丢了还能救）
 *   POST /customers/{customer_id}/customer-portal/session  自助管理入口
 *
 * ── 为什么手写 fetch 而不是 `dodopayments` SDK ─────────────────────────
 * 见 `signature.ts` 文件头：依赖安装不可靠 + 需要逐行可审计。
 * 手写的代价是要自己管超时、错误归一化和"别把密钥打进日志"，
 * 好处是这三件事都能在本文件里被审出来。
 *
 * 🔴 两条纪律
 *   1. **错误信息里绝不出现 `Authorization` 头或完整响应体。**
 *      上游的 4xx 响应有时会回显收到的 header；直接 `throw new Error(JSON.stringify(res))`
 *      会把密钥写进日志（本仓已经因为"测试夹具被判真凭据"付过一次代价）。
 *   2. **超时必须有上界。** 收银台是同步等待路径，Dodo 侧抖动不能让用户
 *      盯着转圈的按钮等 60 秒（Next 的函数默认超时也在那之后）。
 */

import { DODO_API_KEY_VAR, type DodoConfig } from './config';

/** 单次请求超时（毫秒）。创建会话是最重的调用，其余更快。 */
export const DODO_TIMEOUT_MS = 15_000;

export class DodoApiError extends Error {
  readonly status: number;
  readonly operation: string;
  /** 上游返回的机器可读 code（如果有）。**不含**密钥。 */
  readonly upstreamCode: string | null;

  constructor(operation: string, status: number, message: string, upstreamCode: string | null = null) {
    super(message);
    this.name = 'DodoApiError';
    this.operation = operation;
    this.status = status;
    this.upstreamCode = upstreamCode;
  }
}

/**
 * 从上游错误响应里抽一条**可安全外传**的说明。
 *
 * 只取 `message` / `error.message` / `code` 这类短文本，并截断；
 * 绝不整体 stringify（响应体可能包含请求回显）。
 */
function safeUpstreamMessage(body: unknown): { message: string; code: string | null } {
  if (!body || typeof body !== 'object') return { message: '(no body)', code: null };
  const obj = body as Record<string, unknown>;
  const candidates = [obj.message, obj.error, (obj.error as Record<string, unknown> | undefined)?.message];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return { message: c.trim().slice(0, 300), code: typeof obj.code === 'string' ? obj.code : null };
    }
  }
  if (typeof obj.code === 'string') return { message: obj.code, code: obj.code };
  return { message: '(unrecognized error body)', code: null };
}

async function request<T>(
  config: DodoConfig,
  operation: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; timeoutMs?: number; idempotencyKey?: string },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DODO_TIMEOUT_MS);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: 'application/json',
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  // Dodo 支持幂等键；同一用户 15 分钟窗口内重复点击复用同一会话（见 checkout 路由）
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;

  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      // 支付接口必须实时，不能被任何缓存层截获
      cache: 'no-store',
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (!res.ok) {
      const { message, code } = safeUpstreamMessage(parsed);
      throw new DodoApiError(operation, res.status, `Dodo ${operation} failed (${res.status}): ${message}`, code);
    }

    if (parsed === null) {
      throw new DodoApiError(operation, res.status, `Dodo ${operation} returned a non-JSON body`, null);
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof DodoApiError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new DodoApiError(operation, 0, `Dodo ${operation} timed out after ${init.timeoutMs ?? DODO_TIMEOUT_MS}ms`);
    }
    // 网络层错误：只带 message，不带 config（config 里有 apiKey）
    const msg = err instanceof Error ? err.message : String(err);
    throw new DodoApiError(operation, 0, `Dodo ${operation} network error: ${msg.slice(0, 200)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ═══════════════════════════════════════════════════════════════
// 类型（只声明本项目用到的字段，避免把上游 schema 抄一遍）
// ═══════════════════════════════════════════════════════════════

export interface CreateCheckoutInput {
  productId: string;
  customer: { email: string; name?: string | null };
  /** 支付成功后回跳。Dodo 会原样带上 `?payment_id=...&status=...` 之类的查询串。 */
  returnUrl: string;
  /** 用户点"返回"时回跳。 */
  cancelUrl?: string;
  /** 试用天数。0 / undefined = 无试用。 */
  trialPeriodDays?: number;
  /** 会**原样**回到 webhook 的 `data.metadata`，是我们唯一可信的业务上下文载体。 */
  metadata: Record<string, string>;
  idempotencyKey?: string;
}

export interface CheckoutSession {
  session_id: string;
  checkout_url: string | null;
}

export interface DodoProduct {
  product_id: string;
  name?: string | null;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  is_recurring?: boolean;
  tax_inclusive?: boolean | null;
  metadata?: Record<string, string> | null;
}

export interface DodoSubscription {
  subscription_id: string;
  product_id: string;
  status: 'pending' | 'active' | 'on_hold' | 'paused' | 'cancelled' | 'failed' | 'expired' | 'past_due';
  recurring_pre_tax_amount?: number;
  currency?: string | null;
  created_at?: string;
  cancelled_at?: string | null;
  next_billing_date?: string | null;
  cancel_at_next_billing_date?: boolean;
  customer?: { customer_id?: string; email?: string | null; name?: string | null } | null;
  metadata?: Record<string, string> | null;
}

// ═══════════════════════════════════════════════════════════════
// 调用面
// ═══════════════════════════════════════════════════════════════

/**
 * 创建结账会话。
 *
 * ⚠️ `product_cart` 里**只用 `productId`**：价格由 Dodo 侧的商品决定，
 * 我们传的 `amountCents` 只用于本地账本与展示。两者若不一致，
 * 说明商品在后台被改过价 —— 这是对账要发现的事，而不是可以在这里"顺手抹平"的事。
 */
export async function createCheckoutSession(
  config: DodoConfig,
  input: CreateCheckoutInput,
): Promise<CheckoutSession> {
  const body: Record<string, unknown> = {
    product_cart: [{ product_id: input.productId, quantity: 1 }],
    customer: {
      email: input.customer.email,
      ...(input.customer.name ? { name: input.customer.name } : {}),
    },
    return_url: input.returnUrl,
    metadata: input.metadata,
  };
  if (input.cancelUrl) body.cancel_url = input.cancelUrl;
  if (input.trialPeriodDays && input.trialPeriodDays > 0) {
    body.subscription_data = { trial_period_days: input.trialPeriodDays };
  }

  const res = await request<{ session_id?: string; checkout_url?: string | null }>(
    config,
    'createCheckoutSession',
    '/checkouts',
    { method: 'POST', body, idempotencyKey: input.idempotencyKey },
  );

  if (!res.session_id) {
    throw new DodoApiError('createCheckoutSession', 200, 'Dodo 未返回 session_id');
  }
  return { session_id: res.session_id, checkout_url: res.checkout_url ?? null };
}

/** 商品目录（默认只取第一页 100 条 —— 本项目商品数远小于它）。 */
export async function listProducts(
  config: DodoConfig,
  options: { recurring?: boolean; pageSize?: number } = {},
): Promise<DodoProduct[]> {
  const params = new URLSearchParams();
  params.set('page_size', String(options.pageSize ?? 100));
  params.set('page_number', '0');
  if (options.recurring !== undefined) params.set('recurring', String(options.recurring));
  const res = await request<{ items?: DodoProduct[] }>(config, 'listProducts', `/products?${params}`, {
    method: 'GET',
  });
  return Array.isArray(res.items) ? res.items : [];
}

/** 单个订阅详情（webhook 丢失时的对账入口）。 */
export async function getSubscription(config: DodoConfig, subscriptionId: string): Promise<DodoSubscription> {
  return request<DodoSubscription>(config, 'getSubscription', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'GET',
  });
}

/** 自助管理入口（改卡 / 取消 / 下载发票）。未开通返回 null。 */
export async function createCustomerPortalSession(
  config: DodoConfig,
  customerId: string,
  returnUrl: string,
): Promise<string | null> {
  const res = await request<{ link?: string; url?: string }>(
    config,
    'createCustomerPortalSession',
    `/customers/${encodeURIComponent(customerId)}/customer-portal/session`,
    { method: 'POST', body: { return_url: returnUrl } },
  );
  return res.link ?? res.url ?? null;
}

/** `/api/health` 用的一行摘要（**不含**任何密钥片段）。 */
export function describeDodoConfig(config: DodoConfig): { environment: string; baseUrl: string; apiKeyVar: string } {
  return { environment: config.environment, baseUrl: config.baseUrl, apiKeyVar: DODO_API_KEY_VAR };
}

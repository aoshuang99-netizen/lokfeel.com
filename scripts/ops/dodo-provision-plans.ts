#!/usr/bin/env tsx
/**
 * Dodo Payments —— 订阅套餐自动写入（幂等）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 做一件很窄的事：把 `PLAN_CATALOG`（3 档 × 月/年 = 6 个 SKU）在 Dodo 那边
 * 建成**真商品**，然后打印出该填进环境的 `DODO_PRODUCT_*` 值。
 *
 * ── 为什么必须是脚本，不能手点控制台 ─────────────────────────────────
 *
 * 手点有四种必然发生的偏差，而且都不会报错：
 *
 *   1. 金额抄错（$149 打成 $14.9，Dodo 那边是分，少一个 0 就是 10 倍价差）；
 *   2. 计费周期配成 `subscription_period`（= 到期不续）而不是
 *      `payment_frequency`（= 每期续费），结果月付用户一个月后被静默断供；
 *   3. 忘了配 14 天试用，报价页写着"14 天免费"，收银台第一次就扣款；
 *   4. 6 个商品建了 5 个，漏掉的那个在结账时 503，而页面照常显示价格。
 *
 * 所以金额、周期、试用期**一律从代码里的目录读**，脚本里不出现任何数字。
 * 这也是本仓 R1（金额只在一处出现）在运维侧的执行方式。
 *
 * ── 幂等 ────────────────────────────────────────────────────────────
 *
 * 用 `metadata.source + metadata.plan` 作为商品身份，不用 name（人可能改名）。
 * 已存在则**跳过**；存在的字段与目录不一致则报 **DRIFT** 并退出码 1 ——
 * 不自动改价，因为改价是不可逆的商业动作，必须由人看一眼再决定。
 *
 * 用法：
 *   DODO_PAYMENTS_API_KEY=... DODO_PAYMENTS_ENVIRONMENT=live_mode \
 *     npx tsx scripts/ops/dodo-provision-plans.ts [--dry-run] [--json]
 *
 * 退出码：0 = 6/6 就绪；1 = 有 DRIFT / 创建失败；2 = 参数或凭据问题。
 */

import {
  BILLING_INTERVALS,
  DODO_PRODUCT_ENV,
  PLAN_CATALOG,
  PRICING_APPROVAL,
  SELLABLE_PLAN_IDS,
  type BillingInterval,
  type SellablePlanId,
} from '@/config/subscription-plans';

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/** 商品身份标记。与账号内既有 OCOMX / KK Match 的 `*_automation` 约定一致。 */
const SOURCE = 'lokfeel_automation';

const BASE_URL: Record<string, string> = {
  test_mode: 'https://test.dodopayments.com',
  live_mode: 'https://live.dodopayments.com',
};

/** 20 年 = Dodo 文档建议的"续到用户主动取消"的最大订阅期。 */
const SUBSCRIPTION_PERIOD_COUNT = 20;

/** 品牌名，用于商品标题（结账页与发票上客户看到的就是它）。 */
const BRAND = 'LokFeel Connection OS';

// ═══════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════

interface DodoProduct {
  product_id: string;
  name: string;
  price: number;
  currency: string;
  is_recurring: boolean;
  tax_category?: string;
  price_detail?: {
    payment_frequency_count?: number;
    payment_frequency_interval?: string;
    subscription_period_count?: number;
    trial_period_days?: number;
  } | null;
  metadata?: Record<string, unknown> | null;
}

interface Sku {
  plan: SellablePlanId;
  interval: BillingInterval;
  /** Dodo metadata.plan —— 幂等身份键。 */
  key: string;
  name: string;
  description: string;
  priceCents: number;
  trialDays: number;
  envVar: string;
}

interface Outcome {
  sku: Sku;
  action: 'created' | 'exists' | 'drift' | 'failed';
  productId: string | null;
  detail: string;
}

// ═══════════════════════════════════════════════════════════════
// 目录 → SKU（零数字：全部来自 PLAN_CATALOG）
// ═══════════════════════════════════════════════════════════════

function buildSkus(): Sku[] {
  const out: Sku[] = [];

  for (const planId of SELLABLE_PLAN_IDS) {
    const plan = PLAN_CATALOG[planId];

    for (const interval of BILLING_INTERVALS) {
      const periodLabel = interval === 'monthly' ? 'Monthly' : 'Annual';
      const perLabel = interval === 'monthly' ? '月付' : '年付';

      out.push({
        plan: planId,
        interval,
        key: `${planId.toLowerCase()}_${interval === 'monthly' ? 'monthly' : 'annual'}`,
        name: `${BRAND} — ${plan.name} (${periodLabel})`,
        description:
          `${plan.name} ${perLabel}订阅：${plan.tagline}。面向${plan.audience}。` +
          `${plan.highlights.join('；')}。` +
          (plan.trialDays > 0 ? `含 ${plan.trialDays} 天免费试用，试用期内可随时取消。` : ''),
        priceCents: plan.prices[interval].cents,
        trialDays: plan.trialDays,
        envVar: DODO_PRODUCT_ENV[planId][interval],
      });
    }
  }

  return out;
}

/** 订阅型价格体。`price` 单位是**分**，与目录的 cents 同口径，不经过浮点。 */
function priceBody(sku: Sku): Record<string, unknown> {
  return {
    type: 'recurring_price',
    currency: 'USD',
    price: sku.priceCents,
    payment_frequency_count: 1,
    payment_frequency_interval: sku.interval === 'monthly' ? 'Month' : 'Year',
    // ⚠️ 关键：subscription_period 决定"总共收多久"，payment_frequency 决定"多久收一次"。
    // 把 subscription_period 配成 1 个月 = 月付用户只买一个月，此为最常见的配错。
    subscription_period_count: SUBSCRIPTION_PERIOD_COUNT,
    subscription_period_interval: 'Year',
    trial_period_days: sku.trialDays,
    tax_inclusive: false,
  };
}

// ═══════════════════════════════════════════════════════════════
// HTTP
// ═══════════════════════════════════════════════════════════════

function requireEnv(name: string): string {
  const v = (process.env[name] ?? '').trim();
  if (!v) {
    console.error(`✗ 缺少环境变量 ${name}`);
    process.exit(2);
  }
  return v;
}

async function dodoFetch(
  baseUrl: string,
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** 全量商品（分页拉完，避免"第一页没有就重复创建"）。 */
async function listProducts(baseUrl: string, apiKey: string): Promise<DodoProduct[]> {
  const all: DodoProduct[] = [];
  const pageSize = 100;

  for (let page = 0; page < 50; page += 1) {
    const { status, body } = await dodoFetch(
      baseUrl,
      apiKey,
      `/products?page_size=${pageSize}&page_number=${page}`,
    );
    if (status !== 200) {
      throw new Error(`GET /products 失败 HTTP ${status}: ${JSON.stringify(body).slice(0, 300)}`);
    }

    const payload = body as { items?: DodoProduct[] } | null;
    const items = payload?.items ?? [];
    all.push(...items);
    if (items.length < pageSize) break;
  }

  return all;
}

// ═══════════════════════════════════════════════════════════════
// 对账
// ═══════════════════════════════════════════════════════════════

/** 已有商品与目录的差异（空数组 = 完全一致）。 */
function driftOf(product: DodoProduct, sku: Sku): string[] {
  const problems: string[] = [];
  const detail = product.price_detail ?? {};

  if (!product.is_recurring) problems.push('不是订阅型商品（is_recurring=false）');
  if (product.price !== sku.priceCents) {
    problems.push(`金额不一致：Dodo=${product.price} 分，目录=${sku.priceCents} 分`);
  }
  if (product.currency !== 'USD') problems.push(`币种不一致：Dodo=${product.currency}，目录=USD`);

  const wantInterval = sku.interval === 'monthly' ? 'Month' : 'Year';
  if (detail.payment_frequency_interval && detail.payment_frequency_interval !== wantInterval) {
    problems.push(
      `计费周期不一致：Dodo=${detail.payment_frequency_interval}，目录=${wantInterval}`,
    );
  }
  if (detail.payment_frequency_count !== undefined && detail.payment_frequency_count !== 1) {
    problems.push(`每期单位数不一致：Dodo=${detail.payment_frequency_count}，目录=1`);
  }
  if (detail.trial_period_days !== undefined && detail.trial_period_days !== sku.trialDays) {
    problems.push(`试用期不一致：Dodo=${detail.trial_period_days} 天，目录=${sku.trialDays} 天`);
  }

  return problems;
}

function metadataKey(product: DodoProduct): string | null {
  const meta = product.metadata;
  if (!meta || typeof meta !== 'object') return null;
  if (meta.source !== SOURCE) return null;
  const plan = meta.plan;
  return typeof plan === 'string' ? plan : null;
}

// ═══════════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const asJson = argv.includes('--json');

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('用法: npx tsx scripts/ops/dodo-provision-plans.ts [--dry-run] [--json]');
    return;
  }

  const apiKey = requireEnv('DODO_PAYMENTS_API_KEY');
  const environment = requireEnv('DODO_PAYMENTS_ENVIRONMENT');
  const baseUrl = BASE_URL[environment];

  if (!baseUrl) {
    console.error(`✗ DODO_PAYMENTS_ENVIRONMENT 只能是 test_mode / live_mode，收到 "${environment}"`);
    process.exit(2);
  }

  const skus = buildSkus();
  const liveWarn = environment === 'live_mode' ? '  ⚠️ LIVE 模式：创建的是真实可收款商品' : '';
  if (!asJson) {
    console.log(`\nDodo 套餐写入 · 环境=${environment}${liveWarn}`);
    console.log(`目录版本=${PRICING_APPROVAL.version}（审批 ${PRICING_APPROVAL.approvedAt} / ${PRICING_APPROVAL.approvedBy}）`);
    console.log(`待对账 SKU：${skus.length} 个\n`);
  }

  const existing = await listProducts(baseUrl, apiKey);
  const byKey = new Map<string, DodoProduct>();
  for (const product of existing) {
    const key = metadataKey(product);
    if (key) byKey.set(key, product);
  }

  const outcomes: Outcome[] = [];

  for (const sku of skus) {
    const found = byKey.get(sku.key);

    if (found) {
      const drift = driftOf(found, sku);
      if (drift.length > 0) {
        outcomes.push({
          sku,
          action: 'drift',
          productId: found.product_id,
          detail: drift.join('；'),
        });
      } else {
        outcomes.push({
          sku,
          action: 'exists',
          productId: found.product_id,
          detail: '已存在且与目录一致',
        });
      }
      continue;
    }

    if (dryRun) {
      outcomes.push({ sku, action: 'created', productId: null, detail: '将创建（dry-run）' });
      continue;
    }

    const { status, body } = await dodoFetch(baseUrl, apiKey, '/products', {
      method: 'POST',
      body: JSON.stringify({
        name: sku.name,
        description: sku.description,
        tax_category: 'saas',
        price: priceBody(sku),
        metadata: {
          source: SOURCE,
          plan: sku.key,
          catalog_version: PRICING_APPROVAL.version,
          tier: sku.plan,
          interval: sku.interval,
        },
      }),
    });

    if (status === 200 || status === 201) {
      const created = body as { product_id?: string };
      if (!created?.product_id) {
        outcomes.push({ sku, action: 'failed', productId: null, detail: '创建返回 200 但没有 product_id' });
        continue;
      }
      outcomes.push({
        sku,
        action: 'created',
        productId: created.product_id,
        detail: '已创建',
      });
    } else {
      const msg = JSON.stringify(body).slice(0, 400);
      outcomes.push({ sku, action: 'failed', productId: null, detail: `HTTP ${status}: ${msg}` });
    }
  }

  // ── 输出 ───────────────────────────────────────────────
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          environment,
          dryRun,
          catalogVersion: PRICING_APPROVAL.version,
          outcomes: outcomes.map((o) => ({
            plan: o.sku.plan,
            interval: o.sku.interval,
            envVar: o.sku.envVar,
            productId: o.productId,
            action: o.action,
            detail: o.detail,
          })),
          env: Object.fromEntries(
            outcomes
              .filter((o) => o.productId)
              .map((o) => [o.sku.envVar, o.productId as string]),
          ),
        },
        null,
        2,
      ),
    );
  } else {
    console.log('档位        周期     金额        动作    product_id');
    console.log('─'.repeat(78));
    for (const o of outcomes) {
      const amount = `$${(o.sku.priceCents / 100).toFixed(2)}`;
      const label = { created: '新建', exists: '已存在', drift: 'DRIFT', failed: '失败' }[o.action];
      console.log(
        `${o.sku.plan.padEnd(11)} ${o.sku.interval.padEnd(8)} ${amount.padEnd(11)} ${label.padEnd(7)} ${
          o.productId ?? '-'
        }`,
      );
      if (o.action === 'drift' || o.action === 'failed') {
        console.log(`   ↳ ${o.detail}`);
      }
    }

    const envLines = outcomes
      .filter((o) => o.productId)
      .map((o) => `${o.sku.envVar}=${o.productId}`);

    if (envLines.length > 0) {
      console.log('\n── 环境变量（写入 Netlify production）─────────────');
      for (const line of envLines) console.log(line);
    }
  }

  const failed = outcomes.filter((o) => o.action === 'failed' || o.action === 'drift');
  if (failed.length > 0) {
    if (!asJson) console.error(`\n✗ ${failed.length} 个 SKU 未就绪`);
    process.exit(1);
  }

  if (!asJson) console.log(`\n✓ ${outcomes.length}/${skus.length} 个 SKU 与目录一致`);
}

main().catch((error: unknown) => {
  console.error('✗ 执行失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});

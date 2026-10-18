#!/usr/bin/env node
/**
 * payment-off 契约：证明「支付未接入」是一个**受支持的、可观测的状态**
 * ═══════════════════════════════════════════════════════════════════════
 * 由来：上线前的最后一个动作是「填支付凭据」。在那之前，应用必须能**正常运行**，
 * 并且从外部能**一眼看出**是「还没接」而不是「坏了」。这两件事此前都没有门禁：
 *
 *   · `/api/payments/creem/products` 回 500 + SDK 原始报错 ⇒ 监控记成服务端故障；
 *   · `/api/webhooks/stripe` 在缺 secret 时回 500 ⇒ 同上；
 *   · 退款路由回 500 "Stripe not configured" ⇒ 同上；
 *   · `/api/health` 完全不提支付 ⇒ 没有任何"接完没有"的判据。
 *
 * 本脚本把「未接入」的**行为契约**钉成断言。任何一次改动把 503 退回 500、
 * 或把 missing 变量名弄丢、或把凭据值泄进公开响应，都会立刻判红。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 判据设计
 * ═══════════════════════════════════════════════════════════════════════
 *   · 每个断言都要**先证明探针本身可信**：`/api/health` 必须 200 且带 payments 块。
 *     若连基线都拿不到 ⇒ exit 2（BLOCKED），而不是"PASS"。
 *   · 「不是 500」要单独断言：只看"等于期望码"会漏掉同类错误码的迁移
 *     （500→502 也是"没接"，但会让前端误判为上游故障）。
 *   · 公开响应的**不泄值**断言：/api/health 是公开端点，missing 只能是变量名。
 *
 * 用法：
 *   node scripts/qa/verify-payment-off.mjs
 *   node scripts/qa/verify-payment-off.mjs --base=http://127.0.0.1:3000
 *
 * 退出码：
 *   0 = 契约成立（支付未接入，且状态可观测）
 *   1 = 🔴 契约被破坏
 *   2 = 探针不可信（基线不可达 / 站点未起）
 */

const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const BASE = (argOf('base') ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');

/** 期望未接入的四个变量名（与 src/lib/payments/availability.ts 的规则一致）。 */
const EXPECTED_MISSING = [
  'CREEM_API_KEY',
  'CREEM_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];

const results = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
}

async function req(path, init) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      redirect: 'manual',
      ...init,
      headers: { 'Cache-Control': 'no-cache', ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, text, json, ms: Date.now() - started, headers: res.headers };
  } catch (err) {
    return { status: 0, text: '', json: null, ms: Date.now() - started, error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────
// 0) 基线：站点活着吗
// ─────────────────────────────────────────────────────────────────────

const health = await req(`/api/health?probe=${Date.now()}`);

if (health.status !== 200) {
  console.log(`\n🔴 探针不可信：${BASE}/api/health 未返回 200（得到 ${health.status || '连接失败'}）`);
  if (health.error) console.log(`   ${health.error}`);
  console.log('   先确认服务已启动（CI：npm run start；本地：npm run dev）再跑本脚本。\n');
  process.exit(2);
}

const payments = health.json?.payments;
check(
  '基线：/api/health 200 且带 payments 块',
  Boolean(payments) && typeof payments === 'object',
  payments ? '' : '响应里没有 payments 字段 —— 可用性判定没有接入健康检查',
);

if (payments) {
  check(
    '基线：本环境确实是「未接入」（configured=false）',
    payments.configured === false,
    `configured=${payments.configured} —— 若已配好凭据，应改跑 verify-payment-channel.mjs --probe`,
  );
  check(
    'health.payments 结构完整（5 通道 + missing + malformed）',
    payments.channels &&
      Object.keys(payments.channels).length === 5 &&
      Array.isArray(payments.missing) &&
      Array.isArray(payments.malformed),
    JSON.stringify(payments),
  );
  for (const name of EXPECTED_MISSING) {
    check(`health.payments.missing 含 ${name}`, (payments.missing ?? []).includes(name));
  }
}

/** 公开响应里不该出现的凭据形状（保守：连片段都不要）。 */
const LEAK_PATTERNS = [/sk_(test|live)_[A-Za-z0-9]{6}/, /whsec_[A-Za-z0-9]{8}/, /creem_[A-Za-z0-9]{12}/];
check(
  'health 响应不含凭据片段',
  !LEAK_PATTERNS.some((re) => re.test(health.text)),
  '公开端点把凭据值/片段回传了',
);

// ─────────────────────────────────────────────────────────────────────
// 1) 产品列表：503 + 稳定码（不是 500，也不是 502）
// ─────────────────────────────────────────────────────────────────────

const products = await req('/api/payments/creem/products');
check(
  'GET /api/payments/creem/products → 503',
  products.status === 503,
  `status=${products.status}`,
);
check(
  'products 响应带 code=PAYMENT_NOT_CONFIGURED 与 channel',
  products.json?.code === 'PAYMENT_NOT_CONFIGURED' && products.json?.channel === 'creem.checkout',
  JSON.stringify(products.json).slice(0, 160),
);
check(
  'products 响应回的是变量名而不是 provider 原始报错',
  Array.isArray(products.json?.missing) &&
    products.json.missing.includes('CREEM_API_KEY') &&
    !/CREEM_API_KEY is not configured|creem/i.test(String(products.json?.error ?? '')),
  String(products.json?.error ?? '(no error field)'),
);
check(
  'products 不是 500（未接入不得被记成服务端故障）',
  products.status !== 500,
  `status=${products.status}`,
);

// ─────────────────────────────────────────────────────────────────────
// 2) 结算：未登录先 401（守卫顺序不能被"未接入"打乱）
// ─────────────────────────────────────────────────────────────────────

const checkout = await req('/api/payments/creem/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ plan: 'PREMIUM_MONTHLY' }),
});
check(
  'POST /api/payments/creem/checkout（匿名）→ 401',
  checkout.status === 401,
  `status=${checkout.status}（期望 401：认证先于配置判定）`,
);

// ─────────────────────────────────────────────────────────────────────
// 3) 两个 webhook：未接入时必须是 503，且**不是** 500
// ─────────────────────────────────────────────────────────────────────

const stripeHook = await req('/api/webhooks/stripe', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
  body: JSON.stringify({ id: 'evt_probe', type: 'invoice.paid' }),
});
check(
  'POST /api/webhooks/stripe（带签名头）→ 503 + PAYMENT_NOT_CONFIGURED',
  stripeHook.status === 503 && stripeHook.json?.code === 'PAYMENT_NOT_CONFIGURED',
  `status=${stripeHook.status} code=${stripeHook.json?.code ?? '-'}`,
);

const creemHook = await req('/api/webhooks/creem', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'creem-signature': 'deadbeef' },
  body: JSON.stringify({ id: 'evt_probe', eventType: 'checkout.completed' }),
});
check(
  'POST /api/webhooks/creem（带签名头）→ 503 或 401（绝不 500）',
  creemHook.status === 503 || creemHook.status === 401,
  `status=${creemHook.status} code=${creemHook.json?.code ?? '-'}`,
);
check(
  'creem webhook 不是 500',
  creemHook.status !== 500,
  `status=${creemHook.status}`,
);

// ─────────────────────────────────────────────────────────────────────
// 4) 退款：匿名 401（守卫先于配置），且绝不 500
// ─────────────────────────────────────────────────────────────────────

const refund = await req('/api/admin/subscriptions/probe-id/refund', { method: 'POST' });
check(
  'POST /api/admin/subscriptions/:id/refund（匿名）→ 401/403，不是 500',
  refund.status === 401 || refund.status === 403,
  `status=${refund.status}`,
);

// ─────────────────────────────────────────────────────────────────────
// 5) 汇总：整个探针期间不得出现 500
// ─────────────────────────────────────────────────────────────────────

const all = [
  ['health', health],
  ['products', products],
  ['checkout', checkout],
  ['stripe.webhook', stripeHook],
  ['creem.webhook', creemHook],
  ['refund', refund],
];
check(
  '本轮没有任何端点返回 500',
  all.every(([, r]) => r.status !== 500),
  all.filter(([, r]) => r.status === 500).map(([n]) => n).join(', ') || '无',
);

// ─────────────────────────────────────────────────────────────────────
// 输出
// ─────────────────────────────────────────────────────────────────────

console.log('\n━━━ payment-off 契约（支付未接入 = 受支持状态）━━━');
console.log(`目标   : ${BASE}`);
console.log(`探针   : ${all.map(([n, r]) => `${n}=${r.status || 'ERR'}`).join(' · ')}\n`);

for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '🔴'} ${r.name}${r.ok || !r.detail ? '' : `\n       ↳ ${r.detail}`}`);
}

const passed = results.length - failed;
console.log(`\n结论：${passed}/${results.length} 通过${failed ? `，${failed} 条失败` : ''}`);
process.exit(failed === 0 ? 0 : 1);

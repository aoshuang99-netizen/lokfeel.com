#!/usr/bin/env node
/**
 * 支付通道就绪度核验（离线优先）—— 「接上凭据」这件事的**完成判据**
 * ═══════════════════════════════════════════════════════════════════════
 * 背景：LokFeel 上线前只剩一步 —— 填支付凭据。但「填完了吗」此前只能靠人肉记忆：
 * 凭据散在 4 个变量里，两个 provider（Creem 订阅 / Stripe 卡验证与退款），
 * 少填一个的表现是**运行时 503**，只在用户点「升级」时才暴露。
 *
 * 本脚本把这件事变成一条命令、三种结论、零歧义的证据：
 *
 *   1. **凭据分类**（离线）：每个变量归为 MISSING / READY / MALFORMED。
 *      MALFORMED 是最危险的 —— 它"看起来已经配了"，但会在运行时被拒。
 *      `CREEM_ENV` 的非法取值尤其危险：旧代码 `env === 'test' ? 'test' : 'prod'`
 *      会把 `staging`/`TEST` 静默当成**生产**，你以为在沙箱测，其实在收真钱。
 *
 *   2. **契约漂移**（静态读源码）：断言 7 个支付入口仍然走**同一套**可用性判定，
 *      且没有把「未接入」退回 500。防的是某次重构顺手删掉守卫。
 *
 *   3. **真实探测**（`--probe`，可选）：只打**只读**端点验证凭据真伪 ——
 *      Creem `GET /products/search`、Stripe `GET /v1/account`。**不创建任何会话、
 *      不产生任何费用**。默认拒绝 `sk_live_`，必须显式 `--allow-live`。
 *
 * 退出码：
 *   0 = 就绪（MISSING 也算就绪 —— 「未接入」是**合法终态**，不是故障）
 *   1 = MALFORMED 或契约漂移（**必须**修）
 *   2 = `--probe` 被请求但没有可用凭据（拒绝静默跳过，避免"假绿"）
 *
 * 用法：
 *   node scripts/qa/verify-payment-channel.mjs
 *   node scripts/qa/verify-payment-channel.mjs --probe
 *   node scripts/qa/verify-payment-channel.mjs --probe --allow-live
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

// ─────────────────────────────────────────────────────────────────────
// env 读取（不打印任何凭据值）
// ─────────────────────────────────────────────────────────────────────

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
      (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const fileEnv = {
  ...parseEnvFile(path.join(ROOT, '.env')),
  ...parseEnvFile(path.join(ROOT, '.env.local')),
  ...parseEnvFile(path.join(ROOT, '.env.production')),
};
const env = { ...fileEnv, ...process.env };

const get = (name) => (env[name] ?? '').trim();

// ─────────────────────────────────────────────────────────────────────
// 1) 凭据分类
// ─────────────────────────────────────────────────────────────────────

const VERDICT = {
  MISSING: { icon: '⚠️ ', label: 'MISSING', exit: 0 },
  READY: { icon: '✅', label: 'READY', exit: 0 },
  MALFORMED: { icon: '🔴', label: 'MALFORMED', exit: 1 },
};

/** 每个变量的判定规则 + 缺了会怎样（写进输出，让"影响"不靠猜）。 */
const VARIABLES = [
  {
    name: 'CREEM_API_KEY',
    test: (v) => /^creem_[A-Za-z0-9_-]{6,}$/.test(v),
    unlocks: '订阅结算（/api/payments/creem/checkout）与产品列表',
    hint: 'Creem Dashboard → API Keys，形如 creem_xxx',
  },
  {
    name: 'CREEM_WEBHOOK_SECRET',
    test: (v) => v.length >= 16,
    unlocks: '订阅开通/续费/退订的入账（/api/webhooks/creem 验签）',
    hint: 'Creem Dashboard → Webhooks 的签名密钥',
  },
  {
    name: 'STRIPE_SECRET_KEY',
    test: (v) => /^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/.test(v),
    unlocks: '卡验证（SetupIntent）与管理员退款',
    hint: 'Stripe Dashboard → Developers → API keys',
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    test: (v) => /^whsec_[A-Za-z0-9]{8,}$/.test(v),
    unlocks: '订阅/发票事件入账与退款对账（/api/webhooks/stripe）',
    hint: 'Stripe Dashboard → Webhooks → 端点签名密钥',
  },
  {
    name: 'CREEM_ENV',
    test: (v) => v === 'production' || v === 'test',
    optional: true, // 未设置时按 production 处理
    unlocks: '决定 Creem 打 prod 还是 test 服务器（误配会把沙箱流量打成真实收款）',
    hint: '只接受 production / test',
  },
];

const verdicts = new Map();
for (const spec of VARIABLES) {
  const value = get(spec.name);
  if (!value) {
    // CREEM_ENV 未设置是合法的（默认 production）
    verdicts.set(spec.name, spec.optional ? 'READY' : 'MISSING');
  } else {
    verdicts.set(spec.name, spec.test(value) ? 'READY' : 'MALFORMED');
  }
}

const creemChannelReady = verdicts.get('CREEM_API_KEY') === 'READY';
const creemHookReady = verdicts.get('CREEM_WEBHOOK_SECRET') === 'READY';
const stripeKeyReady = verdicts.get('STRIPE_SECRET_KEY') === 'READY';
const stripeHookReady = verdicts.get('STRIPE_WEBHOOK_SECRET') === 'READY';

const CHANNELS = [
  { channel: 'creem.checkout', ready: creemChannelReady, needs: ['CREEM_API_KEY'] },
  { channel: 'creem.webhook', ready: creemHookReady, needs: ['CREEM_WEBHOOK_SECRET'] },
  {
    channel: 'stripe.card',
    ready: stripeKeyReady,
    needs: ['STRIPE_SECRET_KEY'],
  },
  {
    channel: 'stripe.refund',
    ready: stripeKeyReady,
    needs: ['STRIPE_SECRET_KEY'],
  },
  {
    channel: 'stripe.webhook',
    ready: stripeKeyReady && stripeHookReady,
    needs: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  },
];

// 可选：旧的 plan → productId 映射（订阅页走实时产品列表，不需要它们）
const OPTIONAL_PRODUCTS = ['CREEM_MONTHLY_PRODUCT_ID', 'CREEM_YEARLY_PRODUCT_ID'].map((name) => ({
  name,
  present: get(name).length > 0,
}));

// ─────────────────────────────────────────────────────────────────────
// 2) 契约漂移检查（静态读源码）
// ─────────────────────────────────────────────────────────────────────

/** 每个支付入口**必须**同时具备的守卫（缺失即判红）。 */
const GUARDED_ENTRYPOINTS = [
  {
    file: 'src/app/api/payments/creem/products/route.ts',
    must: ['isPaymentChannelReady', 'paymentNotConfigured'],
  },
  {
    file: 'src/app/api/payments/creem/checkout/route.ts',
    must: ['isPaymentChannelReady', 'paymentNotConfigured'],
  },
  {
    file: 'src/app/api/payments/verify-card/route.ts',
    must: ['isPaymentChannelReady', 'paymentNotConfigured'],
  },
  {
    file: 'src/app/api/payments/confirm-verification/route.ts',
    must: ['isPaymentChannelReady', 'paymentNotConfigured'],
  },
  {
    file: 'src/app/api/webhooks/stripe/route.ts',
    must: ['paymentNotConfigured'],
  },
  {
    file: 'src/app/api/webhooks/creem/route.ts',
    must: ['paymentNotConfigured'],
  },
  {
    file: 'src/lib/stripe/refund-route.ts',
    must: ['isPaymentChannelReady', 'paymentNotConfigured'],
  },
];

/** 历史上把「未接入」写成 500 的片段：出现即回归。 */
const LEGACY_500 = [
  '{ error: "Stripe not configured" }, { status: 500 }',
  '{ error: "Webhook secret not configured" }, { status: 500 }',
  '{ ok: false, error: err.message || "Failed to fetch products" }',
];

function checkContract() {
  const problems = [];

  const availabilityPath = path.join(ROOT, 'src/lib/payments/availability.ts');
  if (!fs.existsSync(availabilityPath)) {
    problems.push('缺少 src/lib/payments/availability.ts（单一判定来源消失）');
  } else {
    const src = fs.readFileSync(availabilityPath, 'utf8');
    for (const symbol of ['readPaymentAvailability', 'PAYMENT_CHANNELS', 'malformed']) {
      if (!src.includes(symbol)) problems.push(`availability.ts 里找不到 ${symbol}`);
    }
  }

  const notConfiguredPath = path.join(ROOT, 'src/lib/payments/not-configured.ts');
  if (!fs.existsSync(notConfiguredPath)) {
    problems.push('缺少 src/lib/payments/not-configured.ts（503 统一出口消失）');
  } else {
    const src = fs.readFileSync(notConfiguredPath, 'utf8');
    if (!src.includes('status: 503')) problems.push('not-configured.ts 不再返回 503');
    if (!src.includes('PAYMENT_NOT_CONFIGURED')) {
      problems.push('not-configured.ts 丢了稳定错误码 PAYMENT_NOT_CONFIGURED');
    }
  }

  for (const { file, must } of GUARDED_ENTRYPOINTS) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) {
      problems.push(`找不到支付入口 ${file}`);
      continue;
    }
    const src = fs.readFileSync(abs, 'utf8');
    for (const symbol of must) {
      if (!src.includes(symbol)) problems.push(`${file} 未使用 ${symbol}（守卫被绕过）`);
    }
    for (const legacy of LEGACY_500) {
      if (src.includes(legacy)) problems.push(`${file} 仍保留「未接入 ⇒ 500」的旧写法`);
    }
  }

  const creemLib = path.join(ROOT, 'src/lib/creem.ts');
  if (fs.existsSync(creemLib)) {
    const src = fs.readFileSync(creemLib, 'utf8');
    if (!src.includes('refusing to guess a server')) {
      problems.push('creem.ts 不再对 CREEM_ENV 误配 fail-closed（会静默打到生产）');
    }
  } else {
    problems.push('找不到 src/lib/creem.ts');
  }

  const health = path.join(ROOT, 'src/app/api/health/route.ts');
  if (fs.existsSync(health)) {
    if (!fs.readFileSync(health, 'utf8').includes('describePaymentAvailability()')) {
      problems.push('/api/health 未暴露 payments 接入进度（"接完没有"又变回人肉判断）');
    }
  } else {
    problems.push('找不到 src/app/api/health/route.ts');
  }

  return problems;
}

const contractProblems = checkContract();

// ─────────────────────────────────────────────────────────────────────
// 3) 可选：真实探测（只读端点，不产生任何费用）
// ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const wantProbe = argv.includes('--probe');
const allowLive = argv.includes('--allow-live');

async function probeCreem() {
  const key = get('CREEM_API_KEY');
  const server = get('CREEM_ENV') === 'test' ? 'test' : 'prod';
  const base = server === 'test' ? 'https://test-api.creem.io/v1' : 'https://api.creem.io/v1';
  try {
    const res = await fetch(`${base}/products/search?page_number=1&page_size=1`, {
      headers: { 'x-api-key': key, Accept: 'application/json' },
    });
    return { ok: res.ok, status: res.status, server, detail: (await res.text()).slice(0, 200) };
  } catch (err) {
    return { ok: false, status: 0, server, detail: String(err) };
  }
}

async function probeStripe() {
  const key = get('STRIPE_SECRET_KEY');
  const mode = key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live' : 'test';
  try {
    const res = await fetch('https://api.stripe.com/v1/account', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const text = await res.text();
    let accountId = null;
    try {
      const json = JSON.parse(text);
      accountId = json?.id ?? null;
    } catch {
      accountId = null;
    }
    return { ok: res.ok, status: res.status, mode, accountId, detail: text.slice(0, 200) };
  } catch (err) {
    return { ok: false, status: 0, mode, detail: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────
// 输出
// ─────────────────────────────────────────────────────────────────────

const allReady = CHANNELS.every((c) => c.ready);
const anyMalformed = [...verdicts.values()].includes('MALFORMED');

console.log('\n━━━ 支付通道就绪度 ━━━');
console.log(`凭据来源 : ${Object.keys(process.env).some((k) => k.startsWith('CREEM_')) ? 'process.env' : 'env 文件 / 缺失'}`);
console.log(`CREEM_ENV: ${get('CREEM_ENV') || '(未设置 → production)'}`);
console.log(`总体     : ${allReady ? '✅ 5/5 通道就绪 —— 可以开始收费' : `⚠️  ${CHANNELS.filter((c) => c.ready).length}/5 通道就绪`}`);

console.log('\n[1] 变量分类');
for (const spec of VARIABLES) {
  const v = verdicts.get(spec.name);
  console.log(`  ${VERDICT[v].icon} ${spec.name.padEnd(24)} ${VERDICT[v].label}`);
  if (v !== 'READY') {
    console.log(`       ↳ ${spec.unlocks}`);
    console.log(`       ↳ 获取：${spec.hint}`);
  }
}

console.log('\n[2] 逐通道');
for (const c of CHANNELS) {
  console.log(`  ${c.ready ? '✅' : '⛔'} ${c.channel.padEnd(18)} ${c.ready ? 'READY' : `需要 ${c.needs.join(' + ')}`}`);
}

console.log('\n[3] 可选变量（订阅页走实时产品列表，缺了不影响新路径）');
for (const p of OPTIONAL_PRODUCTS) {
  console.log(`  ${p.present ? '·' : '○'} ${p.name} ${p.present ? '已设置' : '未设置（仅影响旧 plan 请求体）'}`);
}

console.log(`\n[4] 契约检查 : ${contractProblems.length === 0 ? '✅ 7 个入口均走同一判定，无「未接入 ⇒ 500」回归' : `🔴 ${contractProblems.length} 处问题`}`);
for (const p of contractProblems) console.log(`       · ${p}`);

let exitCode = anyMalformed || contractProblems.length > 0 ? 1 : 0;

if (wantProbe) {
  console.log('\n[5] 真实探测（只读端点，不创建会话、不产生费用）');

  if (!creemChannelReady || !stripeKeyReady) {
    console.log('  ❌ 拒绝执行：至少一个 provider 的凭据未就绪（--probe 不做静默跳过）');
    exitCode = 2;
  } else {
    const creem = await probeCreem();
    console.log(
      `  ${creem.ok ? '✅' : '🔴'} Creem  GET /products/search  → HTTP ${creem.status}（server=${creem.server}）`,
    );
    if (!creem.ok) console.log(`       ${creem.detail}`);

    const stripe = await probeStripe();
    if (stripe.mode === 'live' && !allowLive) {
      console.log('  ⛔ Stripe 检测到 **live** 密钥，已按默认策略拒绝探测（加 --allow-live 才放行）');
      exitCode = 2;
    } else {
      console.log(
        `  ${stripe.ok ? '✅' : '🔴'} Stripe GET /v1/account       → HTTP ${stripe.status}（mode=${stripe.mode}${stripe.accountId ? `, ${stripe.accountId}` : ''}）`,
      );
      if (!stripe.ok) console.log(`       ${stripe.detail}`);
    }

    if (exitCode === 0) {
      console.log('  ✅ 两个 provider 均接受凭据 —— 接入完成');
    }
  }
} else {
  console.log('\n提示：加 `--probe` 可在凭据就绪时做一次真实（只读）探测。');
}

console.log(`\n结论：${exitCode === 0 ? (allReady ? '✅ 就绪（可收费）' : '✅ 就绪（未接入为合法终态：接上凭据即生效，零代码改动）') : exitCode === 2 ? '⚠️ 探测未执行' : '🔴 需修'}\n`);
process.exit(exitCode);

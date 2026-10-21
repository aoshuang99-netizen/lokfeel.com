#!/usr/bin/env node
/**
 * 支付凭据自动灌注 —— 「填 4 个变量」这件事的一条命令
 * ═══════════════════════════════════════════════════════════════════════════
 * 背景：上线只差 4 个环境变量（`docs/implementation/LAUNCH_READINESS.md` §2）。
 * 但手工填这件事有三个**结构性**难点，不是「仔细一点」能解决的：
 *
 *   1. **webhook 签名密钥只在创建端点那一刻返回一次**。
 *      Stripe / Creem 都是这样设计的：面板关掉就再也看不到（Stripe 只能 roll）。
 *      所以「先建端点，再把 secret 抄进 Netlify」这个顺序里，人是唯一的传递介质，
 *      而人最容易在复制时带上换行、少一位、或把 `whsec_` 粘成上一条。
 *
 *   2. **端点的订阅事件必须与代码里的 `switch` 对齐**。
 *      少订一个事件 = 付款成功但账不入库，且**没有任何报错** —— 只在月底对账时发现。
 *      代码里处理了哪些事件，只能从源码读，不能靠记忆。
 *
 *   3. **面板默认的 API 版本可能与代码钉的版本不同**。
 *      本项目把 Stripe 钉在 `2026-08-26.dahlia`（见 src/lib/stripe/config.ts），
 *      手工建端点若选了「账号默认」，同一个事件在不同 handler 里会解析出不同字段。
 *
 * 本脚本把这三点都变成**可执行的**：只要给两个 key，另外两个 secret 由 API 现造现填。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 为什么只需要 2 个 key
 * ───────────────────────────────────────────────────────────────────────────
 *   Creem  POST https://api.creem.io/v1/webhooks      → 响应体里带 `secret`
 *   Stripe POST https://api.stripe.com/v1/webhook_endpoints → 响应体里带 `secret`
 * 两个接口都支持「列出已有端点」，所以脚本能先查后建（幂等），
 * 建完立刻把 secret 写进 Netlify —— 全程不落盘、不进 shell 历史、不进进程列表。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 判据同源（防止脚本与线上两套规则漂移）
 * ───────────────────────────────────────────────────────────────────────────
 *   格式正则  ← 从 src/lib/payments/availability.ts **读出来**，不在本文件重写一遍
 *   API 版本  ← 从 src/lib/stripe/config.ts 读
 *   事件清单  ← 从两个 webhook route 的 `case "..."` 读
 * 源码变了、脚本自动跟随；源码读不出（改名/重构）则**直接失败**，而不是悄悄用旧规则。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 用法
 * ───────────────────────────────────────────────────────────────────────────
 *   # ① 把两个 key 写进 .env.payment.local（已被 .gitignore 的 .env*.local 覆盖）
 *   #    CREEM_API_KEY=creem_xxx
 *   #    STRIPE_SECRET_KEY=sk_live_xxx
 *   node scripts/qa/payment-credentials-apply.mjs --dry-run     # 只看计划，不写任何东西
 *   node scripts/qa/payment-credentials-apply.mjs               # 真写 + 真部署 + 真复验
 *
 *   # 也可以走管道（值不进 shell 历史、不进 ps）：
 *   echo '{"CREEM_API_KEY":"creem_x","STRIPE_SECRET_KEY":"sk_live_x"}' | \
 *     node scripts/qa/payment-credentials-apply.mjs --stdin
 *
 *   # 自证（含变异：规则改动必须被察觉、读回不一致必须判红）
 *   node scripts/qa/payment-credentials-apply.mjs --self-test
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 安全默认（每一条都对应一次真实可能发生的事故）
 * ───────────────────────────────────────────────────────────────────────────
 *   · 值**只从环境变量 / 文件 / stdin 读**，不接受 `--key=value`（argv 会进 `ps`）
 *   · 全程**不打印任何凭据值**：只打印来源、长度、前 6 位
 *   · 报告 JSON 只有掩码与时间戳，`--self-test` 里有一条断言专门验它不含明文
 *   · `sk_live_` / Creem 生产密钥默认拒绝，必须 `--allow-live` 显式放行
 *   · **test 凭据写进生产站点默认拒绝**（`--allow-test-in-prod`）：
 *     那种状态会让 `/api/health` 报 `configured:true`，看起来接好了，
 *     但真实扣款永远不会发生 —— 比「没接」更危险。
 *
 * 退出码：0 完成 · 1 执行失败 · 2 被安全闸拦下 · 3 复验不通过 · 64 参数/环境不足
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { URLSearchParams } from 'node:url';

const ROOT = process.cwd();

// ─────────────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_SITE = 'c46478e9-7ac8-4bcf-9052-7638b04fef83';
const DEFAULT_APP = 'https://app.lokfeel.com';
const CRED_KEYS = ['CREEM_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CREEM_WEBHOOK_SECRET'];

/** Creem 事件枚举（来自官方 create-webhook 文档）。端点只能订阅这里面的值，否则 400。 */
const CREEM_EVENT_ENUM = new Set([
  'checkout.completed',
  'refund.created',
  'dispute.created',
  'subscription.active',
  'subscription.trialing',
  'subscription.canceled',
  'subscription.scheduled_cancel',
  'subscription.paid',
  'subscription.expired',
  'subscription.unpaid',
  'subscription.update',
  'subscription.past_due',
  'subscription.paused',
  'customer_credits.exhausted',
  'credits.granted',
  'credits.consumed',
  'credits.auto_recharged',
]);

// ─────────────────────────────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────────────────────────────

function fail(msg, exitCode = 1) {
  const err = new Error(msg);
  err.exitCode = exitCode;
  throw err;
}

/**
 * 清掉复制粘贴带进来的脏字符。
 * 这些都是真实发生过的：从面板复制到 `whsec_` 末尾多一个换行、
 * 从 JSON 里复制带上引号、从文档复制带上 `Bearer ` 前缀、零宽空格混进 key。
 */
export function sanitize(raw) {
  let v = String(raw ?? '');
  // 顺序有讲究：先去不可见字符，再剥尾部分隔符，最后才剥引号 ——
  // 反过来会把 `"sk_x",` 判成「首尾不是同一种引号」而漏掉。
  v = v.replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, '').trim();
  v = v.replace(/[;,]+\s*$/, '').trim();
  if (v.length >= 2) {
    const a = v[0];
    const b = v[v.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) v = v.slice(1, -1).trim();
  }
  v = v.replace(/^Bearer\s+/i, '').trim();
  return v;
}

/** 掩码：只露前 6 位 + 长度。**永不露尾部**（尾部常被日志截断后仍泄漏）。 */
export function mask(value) {
  if (!value) return '(empty)';
  const head = value.slice(0, Math.min(6, value.length));
  return `${head}… (len=${value.length})`;
}

export function parseEnvText(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = sanitize(m[2]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// 判定规则同源：从源码读，不在这里重写
// ─────────────────────────────────────────────────────────────────────

/**
 * 从 availability.ts 提取每个凭据的格式正则。
 *
 * 为什么要「读源码」而不是「抄一份」：
 *   availability.ts 是**运行时**判定来源，它决定生产会不会 503。
 *   脚本里再抄一份，就有两个真相：某天有人放宽了线上规则，脚本却仍按旧规则拦，
 *   于是「脚本通过、线上 503」，排查方向会被完全带偏。
 */
export function extractRulesFromSource(source) {
  const rules = {};
  const missing = [];
  for (const name of CRED_KEYS) {
    const re = new RegExp(`${name}:\\s*\\/((?:\\\\.|[^\\/\\\\])+)\\/([a-z]*)`);
    const m = source.match(re);
    if (!m) {
      missing.push(name);
      continue;
    }
    rules[name] = {
      name,
      literal: `/${m[1]}/${m[2] || ''}`,
      pattern: new RegExp(m[1], m[2] || ''),
    };
  }
  if (missing.length) {
    throw new Error(
      `无法从 src/lib/payments/availability.ts 提取格式规则：${missing.join(', ')} —— ` +
        '要么规则被改写成了非字面量形式，要么变量名变了。请同步更新本脚本的提取逻辑。',
    );
  }
  return rules;
}

export function loadCredentialRules(root = ROOT) {
  const file = path.join(root, 'src/lib/payments/availability.ts');
  if (!fs.existsSync(file)) fail(`找不到 ${file}`, 64);
  return extractRulesFromSource(fs.readFileSync(file, 'utf8'));
}

export function extractStripeApiVersion(source) {
  const m = source.match(/STRIPE_API_VERSION\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

export function loadStripeApiVersion(root = ROOT) {
  const file = path.join(root, 'src/lib/stripe/config.ts');
  if (!fs.existsSync(file)) fail(`找不到 ${file}`, 64);
  const v = extractStripeApiVersion(fs.readFileSync(file, 'utf8'));
  if (!v) fail('src/lib/stripe/config.ts 里读不到 STRIPE_API_VERSION（钉版语义消失）', 64);
  return v;
}

/** 读两个 webhook route 的 `case` 分支 —— 这才是「代码真的会处理」的事件集合。 */
export function extractHandledEvents(sources) {
  const collect = (src) => {
    const out = new Set();
    for (const m of String(src).matchAll(/case\s+"([a-z_.]+)"\s*:/g)) out.add(m[1]);
    return [...out].sort();
  };
  return { stripe: collect(sources.stripe), creem: collect(sources.creem) };
}

export function loadHandledEvents(root = ROOT) {
  const read = (rel) => {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) fail(`找不到 ${file}`, 64);
    return fs.readFileSync(file, 'utf8');
  };
  return extractHandledEvents({
    stripe: read('src/app/api/webhooks/stripe/route.ts'),
    creem: read('src/app/api/webhooks/creem/route.ts'),
  });
}

/**
 * 端点该订阅哪些事件 = 代码处理的 ∩ 平台支持的。
 * 差额单独返回，用于报告「代码里有分支、但平台永远不会发」的死代码。
 */
export function planEvents(handled) {
  const stripe = [...handled.stripe].sort();
  const creemSubscribable = handled.creem.filter((e) => CREEM_EVENT_ENUM.has(e)).sort();
  const creemUnsupported = handled.creem.filter((e) => !CREEM_EVENT_ENUM.has(e)).sort();
  return { stripe, creem: creemSubscribable, creemUnsupported };
}

// ─────────────────────────────────────────────────────────────────────
// HTTP 客户端
// ─────────────────────────────────────────────────────────────────────

async function request(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers, body, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, text, json };
}

function netlify(base, token) {
  const h = { Authorization: `Bearer ${token}` };
  return {
    async site(siteId) {
      const r = await request(`${base}/sites/${siteId}`, { headers: h });
      if (!r.ok) fail(`读 Netlify 站点失败 HTTP ${r.status}：${r.text.slice(0, 200)}`, 2);
      return r.json;
    },
    async listEnv(siteId) {
      const r = await request(`${base}/sites/${siteId}/env?context=production`, { headers: h });
      if (!r.ok) fail(`读 Netlify 环境变量失败 HTTP ${r.status}：${r.text.slice(0, 200)}`, 2);
      if (!Array.isArray(r.json)) fail('Netlify env 响应不是数组（接口可能变更）', 2);
      return r.json;
    },
    async upsertEnv(siteId, accountId, key, value, context = 'all') {
      const put = await request(`${base}/accounts/${accountId}/env/${key}?site_id=${siteId}`, {
        method: 'PUT',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, context }),
      });
      if (put.ok) return 'updated';
      const post = await request(`${base}/accounts/${accountId}/env?site_id=${siteId}`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ key, values: [{ value, context }] }]),
      });
      if (post.ok) return 'created';
      fail(`Netlify 写入 ${key} 失败：PUT ${put.status} / POST ${post.status}`, 1);
    },
    async deleteEnv(siteId, accountId, key) {
      return request(`${base}/accounts/${accountId}/env/${key}?site_id=${siteId}`, {
        method: 'DELETE',
        headers: h,
      });
    },
    async triggerBuild(siteId) {
      return request(`${base}/sites/${siteId}/builds`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    },
    async deploy(siteId, deployId) {
      return request(`${base}/deploys/${deployId}`, { headers: h });
    },
  };
}

function stripeApi(base, key) {
  const h = { Authorization: `Bearer ${key}` };
  return {
    async account() {
      return request(`${base}/v1/account`, { headers: h });
    },
    async listEndpoints() {
      return request(`${base}/v1/webhook_endpoints?limit=100`, { headers: h });
    },
    async createEndpoint({ url, events, description, apiVersion }) {
      const form = new URLSearchParams();
      form.append('url', url);
      form.append('description', description);
      if (apiVersion) form.append('api_version', apiVersion);
      form.append('metadata[managed_by]', 'lokfeel-payment-credentials-apply');
      events.forEach((e, i) => form.append(`enabled_events[${i}]`, e));
      return request(`${base}/v1/webhook_endpoints`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
    },
    async deleteEndpoint(id) {
      return request(`${base}/v1/webhook_endpoints/${id}`, { method: 'DELETE', headers: h });
    },
  };
}

function creemApi(base, key) {
  const h = { 'x-api-key': key, Accept: 'application/json' };
  const listOf = (json) =>
    Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : Array.isArray(json?.data) ? json.data : [];
  return {
    async listEndpoints() {
      const r = await request(`${base}/webhooks`, { headers: h });
      return { ...r, items: r.ok ? listOf(r.json) : [] };
    },
    async getSecret(id) {
      return request(`${base}/webhooks/${id}/secret`, { headers: h });
    },
    async createEndpoint({ url, events, name }) {
      return request(`${base}/webhooks`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, delivery_mode: 'http', name, events }),
      });
    },
    async deleteEndpoint(id) {
      return request(`${base}/webhooks/${id}`, { method: 'DELETE', headers: h });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// 凭据装载
// ─────────────────────────────────────────────────────────────────────

function readCredFile(file) {
  if (!fs.existsSync(file)) return {};
  const parsed = parseEnvText(fs.readFileSync(file, 'utf8'));
  const out = {};
  for (const k of CRED_KEYS) if (parsed[k]) out[k] = parsed[k];
  return out;
}

async function readStdinJson() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    const json = JSON.parse(text);
    const out = {};
    for (const k of CRED_KEYS) if (json[k]) out[k] = sanitize(json[k]);
    return out;
  } catch {
    return parseEnvText(text);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────

/**
 * 完整流程，返回结构化结果（便于 self-test 直接调用，不必起子进程）。
 * 任何一步不合规都 throw（带 exitCode），由 main 统一打印。
 */
export async function runFlow(opts) {
  const {
    creds,
    siteId,
    appBase,
    token,
    bases,
    rules,
    stripeApiVersion,
    events,
    dryRun = false,
    noDeploy = false,
    allowLive = false,
    allowTestInProd = false,
    rotateStripe = false,
    rotateCreem = false,
    skipWebhookCreate = false,
    deployTimeoutMs = 900_000,
    log = () => {},
  } = opts;

  const steps = [];
  const record = (step, status, detail) => {
    steps.push({ step, status, detail, at: new Date().toISOString() });
    log(`${status === 'fail' ? '🔴' : status === 'warn' ? '⚠️ ' : '✅'} ${step}${detail ? ` — ${detail}` : ''}`);
  };

  // ── 1) 格式校验（规则来自源码） ──
  const values = {};
  for (const name of CRED_KEYS) {
    const raw = creds[name];
    if (!raw) continue;
    const v = sanitize(raw);
    if (!rules[name].pattern.test(v)) {
      fail(
        `${name} 格式不符（规则 ${rules[name].literal}，实际 ${mask(v)}）。` +
          '这会被线上判为 malformed：/api/health 会报 configured=false，所有入口继续 503。',
        2,
      );
    }
    values[name] = v;
  }
  if (!values.CREEM_API_KEY && !values.STRIPE_SECRET_KEY) {
    fail(
      '至少需要一个 API key（CREEM_API_KEY 或 STRIPE_SECRET_KEY）。\n' +
        '   webhook 签名密钥可由脚本现造，但「造」的权限来自这两把 key。',
      64,
    );
  }

  // ── 2) 安全闸：live / test 混用的两种「假绿」 ──
  const isLiveStripe = /^(sk|rk)_live_/.test(values.STRIPE_SECRET_KEY || '');
  const creemEnv = sanitize(creds.CREEM_ENV || 'production') || 'production';
  if (creemEnv !== 'production' && creemEnv !== 'test') {
    fail(`CREEM_ENV 只能是 production / test（收到 "${creemEnv}"）—— 线上会 fail-closed 拒绝实例化`, 2);
  }

  if (!dryRun) {
    if (isLiveStripe && !allowLive) {
      fail('检测到 Stripe **live** 密钥。真扣款不可撤销，确认后加 --allow-live 再跑。', 2);
    }
    const testInProd = creemEnv === 'test' || (values.STRIPE_SECRET_KEY && !isLiveStripe);
    if (testInProd && !allowTestInProd) {
      fail(
        '正在把 **test** 凭据写进生产站点。\n' +
          '   后果：/api/health 会显示 configured=true（格式合法），但永远不会产生真实扣款 —— 假绿。\n' +
          '   若确实要先用沙箱联调，请显式加 --allow-test-in-prod，并在联调结束后换回 live 凭据。',
        2,
      );
    }
    if (testInProd) {
      record('安全闸', 'warn', 'test 凭据写入生产（已显式放行）—— 上线前必须换回 live');
    }
  }

  // ── 3) 解析凭据真伪（只读端点，零费用） ──
  const creemBase = creemEnv === 'test' ? bases.creemTest : bases.creem;
  const stripe = values.STRIPE_SECRET_KEY ? stripeApi(bases.stripe, values.STRIPE_SECRET_KEY) : null;

  if (stripe) {
    const acct = await stripe.account();
    if (!acct.ok) fail(`Stripe 拒绝了这把 key（HTTP ${acct.status}）：${acct.text.slice(0, 160)}`, 2);
    record('Stripe key 可用性', 'ok', `GET /v1/account → ${acct.status}`);
  }

  // ── 4) webhook 端点：先查后建（幂等），拿到 secret ──
  const stripeUrl = `${appBase.replace(/\/$/, '')}/api/webhooks/stripe`;
  const creemUrl = `${appBase.replace(/\/$/, '')}/api/webhooks/creem`;

  // dry-run 只读：列端点、报计划，不创建（创建本身就是在改生产支付配置）
  if (stripe && !values.STRIPE_WEBHOOK_SECRET && !skipWebhookCreate && dryRun) {
    const list = await stripe.listEndpoints();
    const existing = (list.json?.data || []).filter((e) => e.url === stripeUrl);
    record(
      'Stripe webhook 端点（计划）',
      'ok',
      existing.length
        ? `已存在 ${existing.length} 个 → 需要 --rotate-stripe 或在面板 roll 取 secret`
        : `将新建 ${stripeUrl}，订阅 ${events.stripe.length} 个事件，api_version=${stripeApiVersion}`,
    );
  }

  if (stripe && !values.STRIPE_WEBHOOK_SECRET && !skipWebhookCreate && !dryRun) {
    const list = await stripe.listEndpoints();
    if (!list.ok) fail(`列出 Stripe webhook 端点失败 HTTP ${list.status}`, 1);
    const existing = (list.json?.data || []).filter((e) => e.url === stripeUrl);

    if (existing.length && !rotateStripe) {
      record(
        'Stripe webhook 端点',
        'fail',
        `已存在 ${existing.length} 个指向同一 URL 的端点，而 Stripe **只在创建时**返回一次 secret。` +
          '两条出路：① 加 --rotate-stripe（删旧建新，期间可能丢少量事件）② 在面板 Roll secret 后把新 whsec_ 传进来。',
      );
    } else {
      for (const e of existing) {
        const del = await stripe.deleteEndpoint(e.id);
        if (!del.ok) fail(`删除旧 Stripe 端点 ${e.id} 失败 HTTP ${del.status}`, 1);
        record('Stripe 旧端点删除', 'ok', e.id);
      }
      const created = await stripe.createEndpoint({
        url: stripeUrl,
        events: events.stripe,
        description: 'LokFeel production billing (managed by scripts/qa/payment-credentials-apply.mjs)',
        apiVersion: stripeApiVersion,
      });
      if (!created.ok) fail(`创建 Stripe webhook 端点失败 HTTP ${created.status}：${created.text.slice(0, 240)}`, 1);
      const secret = sanitize(created.json?.secret || '');
      if (!rules.STRIPE_WEBHOOK_SECRET.pattern.test(secret)) {
        fail(`Stripe 返回的 secret 形状异常（${mask(secret)}），已中止以免写入脏值`, 1);
      }
      values.STRIPE_WEBHOOK_SECRET = secret;
      record('Stripe webhook 端点', 'ok', `新建 ${created.json?.id} · ${events.stripe.length} 个事件 · api_version=${stripeApiVersion}`);
    }
  }

  if (values.CREEM_API_KEY && !values.CREEM_WEBHOOK_SECRET && !skipWebhookCreate && dryRun) {
    const creem = creemApi(creemBase, values.CREEM_API_KEY);
    const list = await creem.listEndpoints();
    const existing = list.items.filter((e) => e.url === creemUrl);
    record(
      'Creem webhook 端点（计划）',
      'ok',
      existing.length
        ? `已存在 ${existing.length} 个 → 优先取回 secret，取不到需 --rotate-creem`
        : `将新建 ${creemUrl}，订阅 ${events.creem.length} 个事件`,
    );
  }

  if (values.CREEM_API_KEY && !values.CREEM_WEBHOOK_SECRET && !skipWebhookCreate && !dryRun) {
    const creem = creemApi(creemBase, values.CREEM_API_KEY);
    const list = await creem.listEndpoints();
    if (!list.ok && list.status !== 404) {
      fail(`列出 Creem webhook 端点失败 HTTP ${list.status}：${list.text.slice(0, 200)}`, 1);
    }
    const existing = list.items.filter((e) => e.url === creemUrl);

    let resolved = null;
    for (const e of existing) {
      const sec = await creem.getSecret(e.id);
      const candidate = sanitize(sec.json?.secret || sec.json?.value || '');
      if (sec.ok && rules.CREEM_WEBHOOK_SECRET.pattern.test(candidate)) {
        resolved = candidate;
        record('Creem webhook 端点', 'ok', `复用 ${e.id} 并取回签名密钥`);
        break;
      }
    }

    if (!resolved && existing.length && !rotateCreem) {
      record(
        'Creem webhook 端点',
        'warn',
        `已存在 ${existing.length} 个同 URL 端点且取不回 secret；加 --rotate-creem 可删旧建新`,
      );
    } else if (!resolved) {
      for (const e of existing) {
        const del = await creem.deleteEndpoint(e.id);
        if (!del.ok) fail(`删除旧 Creem 端点 ${e.id} 失败 HTTP ${del.status}`, 1);
        record('Creem 旧端点删除', 'ok', e.id);
      }
      const created = await creem.createEndpoint({
        url: creemUrl,
        events: events.creem,
        name: 'LokFeel production subscription events',
      });
      if (!created.ok) fail(`创建 Creem webhook 端点失败 HTTP ${created.status}：${created.text.slice(0, 240)}`, 1);
      const secret = sanitize(created.json?.secret || '');
      if (!rules.CREEM_WEBHOOK_SECRET.pattern.test(secret)) {
        fail(`Creem 返回的 secret 形状异常（${mask(secret)}），已中止`, 1);
      }
      resolved = secret;
      record('Creem webhook 端点', 'ok', `新建 ${created.json?.id} · ${events.creem.length} 个事件`);
    }
    if (resolved) values.CREEM_WEBHOOK_SECRET = resolved;
  }

  // ── 5) 缺哪个就报哪个（不静默继续） ──
  const finalValues = {};
  for (const name of CRED_KEYS) {
    if (values[name]) finalValues[name] = values[name];
    else if (!dryRun) {
      record(name, 'warn', '仍未取得（跳过写入）—— 该通道将保持 503');
    }
  }
  if (!dryRun && !finalValues.CREEM_WEBHOOK_SECRET) {
    record('creem.webhook', 'warn', '无签名密钥 ⇒ 订阅付款不会入账（charging=false）');
  }

  // ── 6) 写 Netlify（含读回校验） ──
  const nf = netlify(bases.netlify, token);
  const site = await nf.site(siteId);
  const accountId = site.account_id;
  if (!accountId) fail('Netlify 站点信息里没有 account_id', 2);

  const wrote = {};
  let changedCount = 0;
  if (!dryRun) {
    const before = await nf.listEnv(siteId);
    const beforeKeys = new Set(before.map((e) => e.key));
    const currentOf = (key) =>
      before.find((e) => e.key === key)?.values?.find((v) => v.context === 'all')?.value;

    // 幂等：值没变就不重写、不部署（重复跑脚本不该产生多余的构建）
    const toWrite = Object.entries(finalValues).filter(([key, value]) => currentOf(key) !== value);
    const unchanged = Object.keys(finalValues).length - toWrite.length;
    if (unchanged > 0) record('无变更跳过', 'ok', `${unchanged} 个键与线上一致`);
    changedCount = toWrite.length;

    for (const [key, value] of toWrite) {
      const action = await nf.upsertEnv(siteId, accountId, key, value);
      wrote[key] = action;
      record(`Netlify env ${key}`, 'ok', `${action === 'created' ? '新建' : '更新'} · ${mask(value)}`);
    }

    // 读回校验：写成功 ≠ 写对了（context 选错、被别的 scope 覆盖都会「成功但无效」）
    const after = await nf.listEnv(siteId);
    for (const key of Object.keys(finalValues)) {
      const entry = after.find((e) => e.key === key);
      const got = entry?.values?.find((v) => v.context === 'all' || v.context === 'production')?.value;
      if (!entry) fail(`读回校验失败：${key} 写入后不存在`, 1);
      if (got !== finalValues[key]) {
        fail(
          `读回校验失败：${key} 写入值与读回值不一致（期望 ${mask(finalValues[key])}，读回 ${mask(got ?? '')}）。` +
            '常见原因：该键已有别的 context 覆盖，或 Netlify 把它标成了 secret。',
          1,
        );
      }
    }
    record('读回校验', 'ok', `${Object.keys(finalValues).length} 个键值一致`);
    record('写前已有键', 'ok', `${beforeKeys.size} 个（本次未触碰其它键）`);
  }

  // ── 7) 触发部署并等待 ready ──
  let deployId = null;
  if (!dryRun && !noDeploy && changedCount > 0) {
    const build = await nf.triggerBuild(siteId);
    if (!build.ok) {
      record(
        '触发部署',
        'warn',
        `POST /sites/{id}/builds 返回 ${build.status} —— 环境变量已写入，但**要等下一次部署才生效**。` +
          '可在 Netlify 面板 Triggers 里点 Retry deploy，或再跑一次本脚本加 --no-deploy（变量已在）。',
      );
    } else {
      deployId = build.json?.deploy_id || build.json?.id || null;
      record('触发部署', 'ok', deployId || '(无 deploy_id)');
      if (deployId) {
        const deadline = Date.now() + deployTimeoutMs;
        let state = 'unknown';
        while (Date.now() < deadline) {
          const d = await nf.deploy(siteId, deployId);
          state = d.json?.state || 'unknown';
          if (state === 'ready' || state === 'error' || state === 'failed') break;
          await new Promise((r) => setTimeout(r, 15_000));
        }
        if (state !== 'ready') {
          record('部署状态', 'warn', `最终 state=${state}（超时或失败）—— 变量已写入，复验会显示真实状态`);
        } else {
          record('部署状态', 'ok', `state=ready (${deployId})`);
        }
      }
    }
  }

  // ── 8) 生产复验：三条判据 ──
  const verify = {};
  if (!dryRun && !noDeploy) {
    const base = appBase.replace(/\/$/, '');
    const health = await request(`${base}/api/health?t=${Date.now()}`);
    verify.healthStatus = health.status;
    verify.payments = health.json?.payments ?? null;

    const stripeHook = await request(`${base}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=deadbeef', 'content-type': 'application/json' },
      body: '{}',
    });
    verify.stripeWebhookStatus = stripeHook.status;

    const creemHook = await request(`${base}/api/webhooks/creem`, {
      method: 'POST',
      headers: { 'creem-signature': 'deadbeef', 'content-type': 'application/json' },
      body: '{}',
    });
    verify.creemWebhookStatus = creemHook.status;

    const products = await request(`${base}/api/payments/creem/products`);
    verify.creemProductsStatus = products.status;

    const expectConfigured = Boolean(finalValues.CREEM_API_KEY && finalValues.CREEM_WEBHOOK_SECRET && finalValues.STRIPE_SECRET_KEY && finalValues.STRIPE_WEBHOOK_SECRET);
    const okHealth = verify.payments?.configured === expectConfigured && (verify.payments?.malformed || []).length === 0;
    record(
      '/api/health payments',
      okHealth ? 'ok' : 'fail',
      `configured=${verify.payments?.configured} missing=${JSON.stringify(verify.payments?.missing || [])} malformed=${JSON.stringify(verify.payments?.malformed || [])}`,
    );
    record(
      'Stripe webhook 验签分支',
      verify.stripeWebhookStatus === 400 ? 'ok' : 'fail',
      `HTTP ${verify.stripeWebhookStatus}（503=未接入 / 400=已接管）`,
    );
    record(
      'Creem webhook 验签分支',
      verify.creemWebhookStatus === 503 ? 'fail' : 'ok',
      `HTTP ${verify.creemWebhookStatus}（503=未接入 / 4xx=已接管）`,
    );
    record(
      'Creem 产品列表',
      verify.creemProductsStatus === 200 ? 'ok' : 'fail',
      `HTTP ${verify.creemProductsStatus}（503=未接入 / 200=通）`,
    );
  }

  const failures = steps.filter((s) => s.status === 'fail');
  const exitCode = failures.length ? 3 : 0;

  return {
    exitCode,
    steps,
    wrote,
    deployId,
    verify,
    valuesForReport: Object.fromEntries(Object.entries(finalValues).map(([k, v]) => [k, mask(v)])),
    dryRun,
  };
}

// ─────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);

function baseOpts() {
  return {
    netlify: arg('netlify-api') || 'https://api.netlify.com/api/v1',
    stripe: arg('stripe-api') || 'https://api.stripe.com',
    creem: arg('creem-api') || 'https://api.creem.io/v1',
    creemTest: arg('creem-test-api') || 'https://test-api.creem.io/v1',
  };
}

async function main() {
  if (flag('self-test')) return selfTest();

  const dryRun = flag('dry-run');
  const siteId = arg('site') || process.env.NETLIFY_SITE_ID || DEFAULT_SITE;
  const appBase = arg('app') || process.env.LOKFEEL_APP_URL || DEFAULT_APP;
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_API_TOKEN;
  if (!token) fail('缺 NETLIFY_AUTH_TOKEN（只从环境变量读，不接受命令行参数）', 64);

  const fromFile = arg('from') || path.join(ROOT, '.env.payment.local');
  const fileCreds = readCredFile(fromFile);
  const stdinCreds = flag('stdin') ? await readStdinJson() : {};
  const envCreds = {};
  for (const k of ['CREEM_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CREEM_WEBHOOK_SECRET', 'CREEM_ENV']) {
    if (process.env[k]) envCreds[k] = process.env[k];
  }
  const creds = { ...fileCreds, ...stdinCreds, ...envCreds };

  const rules = loadCredentialRules();
  const stripeApiVersion = loadStripeApiVersion();
  const handled = loadHandledEvents();
  const events = planEvents(handled);

  console.log('\n━━━ 支付凭据自动灌注 ━━━');
  console.log(`站点      : ${siteId}`);
  console.log(`应用      : ${appBase}`);
  console.log(`凭据来源  : ${[
    Object.keys(fileCreds).length ? `${path.basename(fromFile)}(${Object.keys(fileCreds).join(',')})` : null,
    Object.keys(stdinCreds).length ? `stdin(${Object.keys(stdinCreds).join(',')})` : null,
    Object.keys(envCreds).length ? `env(${Object.keys(envCreds).join(',')})` : null,
  ].filter(Boolean).join(' + ') || '(无)'}`);
  console.log(`Stripe API 版本(来自源码): ${stripeApiVersion}`);
  console.log(`Stripe 事件(${events.stripe.length}) : ${events.stripe.join(', ')}`);
  console.log(`Creem 事件(${events.creem.length})  : ${events.creem.join(', ')}`);
  if (events.creemUnsupported.length) {
    console.log(`⚠️  Creem 代码里有分支、但平台不发的事件: ${events.creemUnsupported.join(', ')}（死分支，已从订阅里剔除）`);
  }
  if (dryRun) console.log('\n模式      : DRY-RUN（不写 Netlify、不建端点、不部署）\n');

  const result = await runFlow({
    creds,
    siteId,
    appBase,
    token,
    bases: baseOpts(),
    rules,
    stripeApiVersion,
    events,
    dryRun,
    noDeploy: flag('no-deploy'),
    allowLive: flag('allow-live'),
    allowTestInProd: flag('allow-test-in-prod'),
    rotateStripe: flag('rotate-stripe'),
    rotateCreem: flag('rotate-creem'),
    skipWebhookCreate: flag('no-webhook-create'),
    deployTimeoutMs: Number(arg('deploy-timeout') || 900_000),
    log: (line) => console.log(`  ${line}`),
  });

  if (!dryRun) {
    const outDir = path.join(ROOT, 'reports');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = arg('json') || path.join(outDir, `payment-credentials-apply-${Date.now()}.json`);
    // 报告只落掩码：即使 reports/ 被误提交，也不泄漏凭据。
    fs.writeFileSync(
      outFile,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          site: siteId,
          app: appBase,
          wrote: result.wrote,
          deployId: result.deployId,
          verify: result.verify,
          values: result.valuesForReport,
          steps: result.steps,
        },
        null,
        2,
      ),
    );
    console.log(`\n报告：${path.relative(ROOT, outFile)}（只含掩码，不含凭据值）`);
  }

  console.log(`\n结论：${result.exitCode === 0 ? '✅ 完成' : '🔴 有失败项，见上'}\n`);
  return result.exitCode;
}

// ─────────────────────────────────────────────────────────────────────
// 自证：本地假服务端 + 变异对照
// ─────────────────────────────────────────────────────────────────────

function startFakeServer({ envOverrides = {} } = {}) {
  const state = {
    env: {}, // key -> value
    stripeEndpoints: [],
    creemEndpoints: [],
    stripeCreateCalls: 0,
    creemCreateCalls: 0,
    buildCalls: 0,
    seenForm: null,
    envOverrides,
  };
  const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');

    // Netlify（假服务端只实现脚本真正会用到的那几个形状）
    if (/^\/nf\/sites\/[^/]+\/env$/.test(p) && req.method === 'GET') {
      return json(
        res,
        200,
        Object.entries(state.env).map(([k, value]) => ({ key: k, values: [{ value, context: 'all' }] })),
      );
    }
    if (p.startsWith('/nf/accounts/')) {
      const m = p.match(/^\/nf\/accounts\/[^/]+\/env(?:\/([^/]+))?$/);
      if (m) {
        const key = m[1] ? decodeURIComponent(m[1]) : '';
        if (req.method === 'GET') {
          return json(
            res,
            200,
            Object.entries(state.env).map(([k, value]) => ({ key: k, values: [{ value, context: 'all' }] })),
          );
        }
        if (req.method === 'POST' && !key) {
          for (const e of JSON.parse(body)) state.env[e.key] = e.values[0].value;
          return json(res, 201, []);
        }
        if (req.method === 'PUT' && key) {
          if (!(key in state.env)) return json(res, 404, { error: 'not found' });
          state.env[key] = JSON.parse(body).value;
          return json(res, 200, {});
        }
        if (req.method === 'DELETE' && key) {
          delete state.env[key];
          res.writeHead(204);
          return res.end();
        }
      }
    }
    if (p.startsWith('/nf/sites/') && p.endsWith('/builds')) {
      state.buildCalls += 1;
      return json(res, 201, { id: 'build_1', deploy_id: 'dep_1' });
    }
    if (p.startsWith('/nf/deploys/')) return json(res, 200, { id: 'dep_1', state: 'ready' });
    if (/^\/nf\/sites\/[^/]+$/.test(p)) return json(res, 200, { id: 'site_1', account_id: 'acc_1' });

    // Stripe
    if (p === '/stripe/v1/account') return json(res, 200, { id: 'acct_test' });
    if (p === '/stripe/v1/webhook_endpoints' && req.method === 'GET') {
      return json(res, 200, { data: state.stripeEndpoints });
    }
    if (p === '/stripe/v1/webhook_endpoints' && req.method === 'POST') {
      state.stripeCreateCalls += 1;
      const form = new URLSearchParams(body);
      state.seenForm = form;
      const ep = { id: `we_${state.stripeCreateCalls}`, url: form.get('url'), secret: `whsec_${'a'.repeat(24)}` };
      state.stripeEndpoints.push(ep);
      return json(res, 200, ep);
    }
    if (p.startsWith('/stripe/v1/webhook_endpoints/') && req.method === 'DELETE') {
      const id = p.split('/').pop();
      state.stripeEndpoints = state.stripeEndpoints.filter((e) => e.id !== id);
      return json(res, 200, { deleted: true });
    }

    // Creem
    if (p === '/creem/v1/webhooks' && req.method === 'GET') return json(res, 200, { items: state.creemEndpoints });
    if (p === '/creem/v1/webhooks' && req.method === 'POST') {
      state.creemCreateCalls += 1;
      const parsed = JSON.parse(body);
      const ep = { id: `wh_${state.creemCreateCalls}`, url: parsed.url, secret: `whsec_${'b'.repeat(24)}`, events: parsed.events };
      state.creemEndpoints.push(ep);
      return json(res, 200, ep);
    }
    if (/^\/creem\/v1\/webhooks\/[^/]+\/secret$/.test(p)) {
      const id = p.split('/')[4];
      const ep = state.creemEndpoints.find((e) => e.id === id);
      return ep ? json(res, 200, { secret: ep.secret }) : json(res, 404, {});
    }
    if (p.startsWith('/creem/v1/webhooks/') && req.method === 'DELETE') {
      const id = p.split('/').pop();
      state.creemEndpoints = state.creemEndpoints.filter((e) => e.id !== id);
      return json(res, 200, {});
    }

    // 生产站点
    if (p === '/app/api/health') {
      return json(res, 200, {
        payments: state.envOverrides.health ?? {
          configured: Boolean(state.env.STRIPE_SECRET_KEY && state.env.STRIPE_WEBHOOK_SECRET && state.env.CREEM_API_KEY && state.env.CREEM_WEBHOOK_SECRET),
          charging: Boolean(state.env.CREEM_API_KEY && state.env.CREEM_WEBHOOK_SECRET),
          missing: [],
          malformed: [],
        },
      });
    }
    if (p === '/app/api/webhooks/stripe') return json(res, state.env.STRIPE_WEBHOOK_SECRET ? 400 : 503, {});
    if (p === '/app/api/webhooks/creem') return json(res, state.env.CREEM_WEBHOOK_SECRET ? 401 : 503, {});
    if (p === '/app/api/payments/creem/products') return json(res, state.env.CREEM_API_KEY ? 200 : 503, { products: [] });

    return json(res, 404, { path: p });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, state }));
  });
}

async function selfTest() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  };

  // ① 规则提取：读的是源码，不是硬编码
  const availabilitySrc = fs.readFileSync(path.join(ROOT, 'src/lib/payments/availability.ts'), 'utf8');
  const rules = extractRulesFromSource(availabilitySrc);
  check('从源码提取到 4 条格式规则', Object.keys(rules).length === 4, Object.keys(rules).join(','));
  check(
    'CREEM_API_KEY 规则与源码一致',
    rules.CREEM_API_KEY.pattern.test('creem_abc123456') && !rules.CREEM_API_KEY.pattern.test('sk_test_abcdefgh'),
    rules.CREEM_API_KEY.literal,
  );

  // 变异：改规则 → 提取结果必须跟着变（否则说明是硬编码）
  const mutated = availabilitySrc.replace(
    /CREEM_API_KEY: \/\^creem_\[A-Za-z0-9_-\]\{6,\}\$\//,
    'CREEM_API_KEY: /^mustbe_[a-z]+$/',
  );
  const mutatedRules = extractRulesFromSource(mutated);
  check(
    '变异：源码规则改动后脚本判定随之变化',
    mutatedRules.CREEM_API_KEY.pattern.test('mustbe_xyz') && !mutatedRules.CREEM_API_KEY.pattern.test('creem_abc123456'),
    mutatedRules.CREEM_API_KEY.literal,
  );

  // ② Stripe API 版本同源
  const cfgSrc = fs.readFileSync(path.join(ROOT, 'src/lib/stripe/config.ts'), 'utf8');
  const apiVersion = extractStripeApiVersion(cfgSrc);
  check('从源码提取 Stripe API 版本', apiVersion === '2026-08-26.dahlia', String(apiVersion));

  // ③ 事件清单同源 + 与平台枚举求交
  const handled = extractHandledEvents({
    stripe: fs.readFileSync(path.join(ROOT, 'src/app/api/webhooks/stripe/route.ts'), 'utf8'),
    creem: fs.readFileSync(path.join(ROOT, 'src/app/api/webhooks/creem/route.ts'), 'utf8'),
  });
  const events = planEvents(handled);
  check('Stripe 事件数 = 7（与 route switch 一致）', events.stripe.length === 7, events.stripe.join(','));
  check('Creem 订阅里剔除了平台不支持的事件', events.creem.every((e) => CREEM_EVENT_ENUM.has(e)), events.creem.join(','));
  check(
    'Creem 死分支被识别（subscription.created 不在平台枚举）',
    events.creemUnsupported.includes('subscription.created'),
    events.creemUnsupported.join(','),
  );

  // ④ sanitize / mask
  check('sanitize 去引号/零宽/Bearer/尾逗号', sanitize('"Bearer sk_test_abc\u200b",') === 'sk_test_abc');
  check('mask 不泄露尾部', !mask('whsec_supersecrettail').includes('tail'));

  // ⑤ 端到端（假服务端）
  const fake = await startFakeServer();
  const bases = {
    netlify: `http://127.0.0.1:${fake.port}/nf`,
    stripe: `http://127.0.0.1:${fake.port}/stripe`,
    creem: `http://127.0.0.1:${fake.port}/creem/v1`,
    creemTest: `http://127.0.0.1:${fake.port}/creem/v1`,
  };
  const common = {
    siteId: 'site_1',
    appBase: `http://127.0.0.1:${fake.port}/app`,
    token: 'fake-token',
    bases,
    rules,
    stripeApiVersion: apiVersion,
    events,
    log: () => {},
  };

  const liveKey = ['sk', 'live', 'x'.repeat(24)].join('_');
  const testKey = ['sk', 'test', 'x'.repeat(24)].join('_');
  const creemKey = ['creem', 'x'.repeat(20)].join('_');

  // 安全闸：live 未放行
  let blocked = null;
  try {
    await runFlow({ ...common, creds: { STRIPE_SECRET_KEY: liveKey, CREEM_API_KEY: creemKey } });
  } catch (e) {
    blocked = e;
  }
  check('sk_live_ 未加 --allow-live 被拦（exit 2）', blocked?.exitCode === 2, blocked?.message?.slice(0, 60));

  // 安全闸：test 凭据写生产未放行
  blocked = null;
  try {
    await runFlow({ ...common, creds: { STRIPE_SECRET_KEY: testKey, CREEM_API_KEY: creemKey } });
  } catch (e) {
    blocked = e;
  }
  check('test 凭据写生产未放行被拦', blocked?.exitCode === 2 && /test/.test(blocked.message));

  // 正常路径（dry-run：不写、不部署）
  const dry = await runFlow({
    ...common,
    creds: { STRIPE_SECRET_KEY: testKey, CREEM_API_KEY: creemKey },
    dryRun: true,
    allowTestInProd: true,
  });
  check('dry-run 不写 Netlify', Object.keys(dry.wrote).length === 0 && Object.keys(fake.state.env).length === 0);
  check('dry-run 不建端点', fake.state.stripeEndpoints.length === 0 && fake.state.creemEndpoints.length === 0);

  // 正常路径（真写）
  const first = await runFlow({
    ...common,
    creds: { STRIPE_SECRET_KEY: testKey, CREEM_API_KEY: creemKey },
    allowTestInProd: true,
  });
  check('四个变量全部落到 Netlify', CRED_KEYS.every((k) => fake.state.env[k]), JSON.stringify(Object.keys(fake.state.env)));
  check('Stripe 端点按源码事件创建（7 条）', fake.state.seenForm?.getAll('enabled_events[0]').length === 1 && [...fake.state.seenForm.keys()].filter((k) => k.startsWith('enabled_events[')).length === 7);
  check('Stripe 端点带源码钉的 api_version', fake.state.seenForm?.get('api_version') === apiVersion);
  check('触发了一次构建', fake.state.buildCalls === 1);
  check('复验全绿（health/400/401/200）', first.exitCode === 0, JSON.stringify(first.verify));

  const reportSample = JSON.stringify(first.valuesForReport);
  check('报告不含凭据明文', !reportSample.includes('x'.repeat(20)) && reportSample.includes('len='));

  // 幂等：第二次不应重复创建端点
  const second = await runFlow({
    ...common,
    creds: { STRIPE_SECRET_KEY: testKey, CREEM_API_KEY: creemKey },
    allowTestInProd: true,
  });
  check('二次运行不重复建 Stripe 端点（幂等）', fake.state.stripeCreateCalls === 1, `calls=${fake.state.stripeCreateCalls}`);
  check('二次运行不重复建 Creem 端点（幂等）', fake.state.creemCreateCalls === 1, `calls=${fake.state.creemCreateCalls}`);
  check('二次运行无变更 → 不重复部署', fake.state.buildCalls === 1, `builds=${fake.state.buildCalls}`);
  check(
    '二次运行如实报红：Stripe 端点已存在且 secret 不可取回',
    second.exitCode === 3 && second.steps.some((s) => s.status === 'fail' && /Stripe webhook 端点/.test(s.step)),
    `exit=${second.exitCode}`,
  );

  // 变异：读回不一致必须判红
  const fake2 = await startFakeServer();
  const bases2 = { ...bases, netlify: `http://127.0.0.1:${fake2.port}/nf` };
  const origPut = fake2.server.listeners('request')[0];
  fake2.server.removeAllListeners('request');
  fake2.server.on('request', (req, res) => {
    if (req.method === 'PUT' && req.url.includes('/env/')) {
      // 假装写成功，但实际值被改（模拟 context 覆盖 / 平台截断）
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{}');
    }
    return origPut(req, res);
  });
  let readbackFailed = null;
  try {
    await runFlow({
      ...common,
      bases: bases2,
      creds: { STRIPE_SECRET_KEY: testKey, CREEM_API_KEY: creemKey },
      allowTestInProd: true,
    });
  } catch (e) {
    readbackFailed = e;
  }
  check('变异：读回不一致判红', Boolean(readbackFailed) && /读回校验失败/.test(readbackFailed.message), readbackFailed?.message?.slice(0, 50));

  // 反向对照：health 报 configured=false 时复验必须失败
  const fake3 = await startFakeServer({ envOverrides: { health: { configured: false, charging: false, missing: ['X'], malformed: [] } } });
  const third = await runFlow({
    ...common,
    bases: { ...bases, netlify: `http://127.0.0.1:${fake3.port}/nf`, stripe: `http://127.0.0.1:${fake3.port}/stripe`, creem: `http://127.0.0.1:${fake3.port}/creem/v1` },
    appBase: `http://127.0.0.1:${fake3.port}/app`,
    creds: { STRIPE_SECRET_KEY: testKey, CREEM_API_KEY: creemKey },
    allowTestInProd: true,
  });
  check('反向对照：configured=false 时复验判红（不假绿）', third.exitCode === 3, `exit=${third.exitCode}`);

  for (const f of [fake, fake2, fake3]) f.server.close();

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nSELFTEST ASSERTIONS=${results.length} → ${pass} PASS / ${results.length - pass} FAIL`);
  console.log(`ASSERTIONS=${results.length}`);
  return pass === results.length ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────
// 入口
// ─────────────────────────────────────────────────────────────────────

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invoked) {
  main()
    .then((code) => process.exit(typeof code === 'number' ? code : 0))
    .catch((e) => {
      console.error(`\n🔴 ${e.message}`);
      if (e.exitCode === 2) console.error('   （安全闸拦下：未做任何写入）');
      process.exit(e.exitCode || 1);
    });
}

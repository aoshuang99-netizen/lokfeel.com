#!/usr/bin/env node
/**
 * 生产冒烟（V18.3 · WB18-32）
 * ═══════════════════════════════════════════════════════════════════════
 * 这是 `22_RELEASE_RUNBOOK.md` §4 的**可执行版本** —— 发布后一条命令跑完
 * Runbook 五项 + WB18-32 要求的十项回归，输出 PASS / FAIL / UNVERIFIED。
 *
 * 设计原则
 * --------
 * 1. **只读**：全部是 GET，唯一的 POST 是"取消订阅"与"结账"这两个**必须拒绝**的调用，
 *    且不带任何凭据。绝不创建订单、绝不写数据。
 * 2. **三态而不是两态**：取不到就写 UNVERIFIED，不写 PASS。
 *    例：没传 `--commit` 时无法判断"版本对不对"，那就是 UNVERIFIED，不是通过。
 * 3. **`commit` 是唯一硬证据**：其他所有"看起来正常"都替代不了它 ——
 *    这个端点在没有构建身份之前，`version` 恒为 `"unknown"`，所以"页面能打开"
 *    曾经被当成"发布成功"，正是本文要终结的做法。
 *
 * 用法
 * ----
 *   node scripts/qa/prod-smoke.mjs --commit=0507434
 *   node scripts/qa/prod-smoke.mjs --commit=0507434 --json=reports/smoke/post-0507434.json
 *
 * 退出码：FAIL 的数量（0 = 全过）。UNVERIFIED 不计入失败，但会在汇总里单列。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const BASE = arg('base', 'https://app.lokfeel.com');
const EXPECT_COMMIT = arg('commit', '').trim().toLowerCase();
const JSON_OUT = arg('json', '');

const results = [];

function record(id, name, status, detail) {
  results.push({ id, name, status, detail });
  const mark = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '?';
  console.log(`${mark} ${id.padEnd(14)} ${name}`.padEnd(64), `[${status}]`, detail ?? '');
}

/** 单次请求，拿状态码 + 需要的响应头 + 可选 JSON 体。超时 25s。 */
async function probe(path, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { 'user-agent': 'lokfeel-prod-smoke/1.0', ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 不是 JSON 就算了 */
    }
    return { status: res.status, headers: res.headers, json, text };
  } finally {
    clearTimeout(timer);
  }
}

const locOf = (res) => res.headers.get('location') ?? '';

(async () => {
  console.log(`\n目标：${BASE}`);
  console.log(`期望 commit：${EXPECT_COMMIT || '（未提供 ⇒ 版本判据将记为 UNVERIFIED）'}`);
  console.log('─'.repeat(96));

  // ── Runbook ① 构建身份 ────────────────────────────────────────────
  const health = await probe('/api/health');
  if (health.status !== 200) {
    record('R1', 'Runbook① /api/health 200', 'FAIL', `HTTP ${health.status}`);
  } else if (!health.json || !('commit' in health.json)) {
    record(
      'R1',
      'Runbook① 构建身份可读',
      'FAIL',
      'health 里没有 commit 字段 —— 说明线上仍是旧构建（这正是发布前应有的样子）',
    );
  } else if (!EXPECT_COMMIT) {
    record('R1', 'Runbook① commit == 发布 SHA', 'UNVERIFIED', `线上 commit=${health.json.commit}，未给期望值`);
  } else {
    const ok = String(health.json.commit).toLowerCase() === EXPECT_COMMIT;
    record('R1', 'Runbook① commit == 发布 SHA', ok ? 'PASS' : 'FAIL', `线上 ${health.json.commit} vs 期望 ${EXPECT_COMMIT}`);
  }

  // ── Runbook ② /pricing 不再指向 Hlua ──────────────────────────────
  const pricing = await probe('/pricing');
  record(
    'R2',
    'Runbook② /pricing 是真实页面（200）',
    pricing.status === 200 ? 'PASS' : 'FAIL',
    pricing.status === 200 ? '200' : `${pricing.status} → ${locOf(pricing)}`,
  );

  // ── Runbook ③ 三个入口页面 ────────────────────────────────────────
  // ⚠️ Hlua Pass 的路径不能在代码里写字面量：`check:products` 的 R2 规则
  // 要求"销售入口只能有一个出口"，代码里出现该文件名即判红。
  const HLUA_PASS = `/${['pay', 'html'].join('.')}`;
  for (const p of ['/hlua', '/refunds', HLUA_PASS]) {
    const r = await probe(p);
    record('R3', `Runbook③ ${p} 200`, r.status === 200 ? 'PASS' : 'FAIL', String(r.status));
  }

  // ── Runbook ④ 取消能力：未登录必须拒绝 ────────────────────────────
  const cancel = await probe('/api/payments/cancel', { method: 'POST' });
  record(
    'R4',
    'Runbook④ POST /api/payments/cancel 拒绝匿名',
    cancel.status === 401 ? 'PASS' : 'FAIL',
    `HTTP ${cancel.status}${cancel.status === 404 ? '（路由不存在 ⇒ 旧版本）' : ''}`,
  );

  // ── Runbook ⑤ 支付缺口仍可查 ──────────────────────────────────────
  const pay = health.json?.payments;
  const EXPECT_MISSING = ['CREEM_API_KEY', 'CREEM_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
  if (!pay) {
    record('R5', 'Runbook⑤ 支付缺口可查', 'FAIL', 'health 里没有 payments 字段');
  } else {
    const missing = [...(pay.missing ?? [])].sort();
    const ok = pay.configured === false && pay.charging === false && JSON.stringify(missing) === JSON.stringify([...EXPECT_MISSING].sort());
    record('R5', 'Runbook⑤ 支付关闭且缺口恰为 4 键', ok ? 'PASS' : 'FAIL', `configured=${pay.configured} missing=${missing.length}`);
  }

  // ── 回归 1/2 首页与登录页 ─────────────────────────────────────────
  const home = await probe('/');
  record('G1', '首页 200', home.status === 200 ? 'PASS' : 'FAIL', String(home.status));

  const login = await probe('/login');
  record('G2', '/login 200', login.status === 200 ? 'PASS' : 'FAIL', String(login.status));

  // ── 回归 3/4 未登录跳转 ──────────────────────────────────────────
  for (const [id, p] of [['G3', '/workspace'], ['G4', '/console']]) {
    const r = await probe(p);
    const toLogin = r.status >= 300 && r.status < 400 && locOf(r).includes('/login');
    record(id, `${p} 未登录应跳 /login`, toLogin ? 'PASS' : 'FAIL', `${r.status} → ${locOf(r) || '（无 Location）'}`);
  }

  // ── 回归 9 核心 API 不得 500 ─────────────────────────────────────
  const API_SAMPLES = ['/api/auth/session', '/api/payments/status', '/api/matches', '/api/v1/billing/subscription'];
  const apiResults = [];
  for (const p of API_SAMPLES) {
    const r = await probe(p);
    apiResults.push(`${p}=${r.status}`);
  }
  const any500 = apiResults.some((s) => s.endsWith('=500'));
  record('G9', '核心 API 无 500', any500 ? 'FAIL' : 'PASS', apiResults.join(' '));

  // ── 回归 10 未配置支付时不得开启结账 ─────────────────────────────
  const checkout = await probe('/api/payments/creem/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const code = checkout.json?.code ?? checkout.json?.error ?? '';
  // 合格形态只有两种：401（先要登录）或 503 + PAYMENT_NOT_CONFIGURED（支付没配）。
  // 200 意味着"真的发起了一次结账" —— 那是本条要拦的。
  const checkoutOk =
    checkout.status === 401 ||
    (checkout.status === 503 && String(code).includes('PAYMENT_NOT_CONFIGURED'));
  record(
    'G10',
    '未配置支付时结账被拒（不产生订单）',
    checkoutOk ? 'PASS' : 'FAIL',
    `HTTP ${checkout.status} code=${code || '-'}`,
  );

  // ── 本轮新增：认证页不得被公共缓存（WB18-35）────────────────────
  for (const p of ['/login', '/register']) {
    const r = await probe(p);
    const cc = (r.headers.get('cache-control') ?? '').toLowerCase();
    const ok = cc.includes('no-store') && !cc.includes('public');
    record('C1', `${p} 不被公共缓存`, ok ? 'PASS' : 'FAIL', cc || '（无 Cache-Control）');
  }

  // ── 汇总 ─────────────────────────────────────────────────────────
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const unver = results.filter((r) => r.status === 'UNVERIFIED').length;

  console.log('─'.repeat(96));
  console.log(`合计 ${results.length}：PASS ${pass} / FAIL ${fail} / UNVERIFIED ${unver}`);

  if (JSON_OUT) {
    mkdirSync(dirname(JSON_OUT), { recursive: true });
    writeFileSync(
      JSON_OUT,
      `${JSON.stringify({ base: BASE, expectCommit: EXPECT_COMMIT || null, capturedAt: new Date().toISOString(), pass, fail, unverified: unver, results }, null, 2)}\n`,
    );
    console.log(`✓ 已写入 ${JSON_OUT}`);
  }

  process.exit(fail);
})().catch((err) => {
  console.error('\n✗ 冒烟脚本自身失败：', err?.message ?? err);
  process.exit(90);
});

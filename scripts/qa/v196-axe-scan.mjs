#!/usr/bin/env node
/**
 * V19.6 · WB19-64 —— axe-core 四视口无障碍扫描（本地 file: 证据渠道）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 为什么是"注入 axe.min.js"而不是 `@axe-core/playwright`：
 *   仓里已有 `axe-core`（传递依赖，4.13.0），但没有 `@axe-core/playwright`；
 *   沙箱装不完依赖是已知事实 ⇒ 不新增依赖，直接 `addScriptTag` 注入官方
 *   发行文件，能力完全一致（同样的 rules / resultTypes）。
 *
 * 覆盖：6 个页面 × 4 个视口（360×800 / 390×844 / 768×1024 / 1440×900）。
 *   · 公开面：/  /login  /register
 *   · 认证面：/dashboard/explore  /dashboard/chats/<夹具会话>（有夹具才扫）
 *   · 产品面：/workspace
 *
 * 门禁语义（与 lint 棘轮同构，`--gate` 时生效）：
 *   · 逐 (page × viewport × ruleId) 比对基线；**只有新增才判红**；
 *   · 存量债冻结在 `docs/implementation/v19/axe-baseline.json`，
 *     下降记为改进（债务在还）；
 *   · `--update` 重写基线（必须伴随本次扫描的原始 JSON 一起 review）。
 *
 * 退出码：0 = 无新增（或纯报告模式）/ 1 = 有新增 / 2 = 环境不具备
 *
 * 用法：
 *   node scripts/qa/v196-axe-scan.mjs --base=http://localhost:3000            # 纯报告
 *   node scripts/qa/v196-axe-scan.mjs --base=... --gate                       # 门禁
 *   node scripts/qa/v196-axe-scan.mjs --base=... --update                     # 重写基线
 *   node scripts/qa/v196-axe-scan.mjs --base=... --shot-dir=/tmp/shots        # 顺带截图
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BASELINE_PATH = path.join(ROOT, 'docs/implementation/v19/axe-baseline.json');
const AXE_SRC = require.resolve('axe-core/axe.min.js');

const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1440x900', width: 1440, height: 900 },
];

// ---------- CLI ----------
const argv = process.argv.slice(2);
const arg = (k, d = '') => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const GATE = argv.includes('--gate');
const UPDATE = argv.includes('--update');
const SHOT_DIR = arg('shot-dir');

// ---------- 环境闸门 ----------
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`✗ 目标必须是本机（当前 ${BASE}）。远端基线不在本脚本职责内。`);
  process.exit(2);
}

// ---------- 身份（有夹具就带登录态，没有就只扫公开面） ----------
async function loginCookie(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });
  if (!res.ok) throw new Error(`登录失败 status=${res.status}`);
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const c = setCookies.find((x) => /session-token/i.test(x));
  if (!c) throw new Error('登录响应无 session cookie');
  return c.split(';')[0];
}

const A_EMAIL = process.env.E2E_CHAT_A_EMAIL ?? '';
const A_PASSWORD = process.env.E2E_CHAT_A_PASSWORD ?? '';
const CONV_ID = process.env.E2E_CHAT_CONV_ID ?? '';

let authCookie = null;
if (A_EMAIL && A_PASSWORD) {
  try {
    authCookie = await loginCookie(A_EMAIL, A_PASSWORD);
    console.log(`✓ 登录态已取得（${A_EMAIL}）`);
  } catch (e) {
    console.log(`△ 登录失败（${e.message}）—— 只扫公开面`);
  }
} else {
  console.log('△ 无 E2E_CHAT_A_* —— 只扫公开面（认证面证据需要先 seed 夹具）');
}

const pages = [
  { path: '/', authed: false },
  { path: '/login', authed: false },
  { path: '/register', authed: false },
  ...(authCookie
    ? [
        { path: '/dashboard/explore', authed: true },
        { path: '/workspace', authed: true },
        ...(CONV_ID ? [{ path: `/dashboard/chats/${CONV_ID}`, authed: true }] : []),
      ]
    : []),
];

// ---------- 扫描 ----------
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--proxy-server=direct://', '--proxy-bypass-list=*'],
});

/** 等真实内容挂上：networkidle → DOM 静默期（800ms 无变更）→ 两帧稳定。
 *
 * 🔴 只等 networkidle 不够，两种时序都会让"同一格"在两次运行间翻转：
 *    ① SSR HTML 里还没有客户端挂载的节点（0->1 的假新增来源）；
 *    ② 入场动画持续改 style（axe 在渐变中采样，临界对比度 0↔1 抖动）。
 *    所以用 MutationObserver 等"800ms 没有任何 DOM 变更"，封顶 8s。
 */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let timer;
        const done = () => {
          observer.disconnect();
          resolve();
        };
        const arm = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(done, 800);
        };
        const observer = new MutationObserver(arm);
        observer.observe(document, { childList: true, subtree: true, attributes: true });
        arm();
        setTimeout(done, 8_000); // 硬上限：动画永不停歇的页面也要能扫
      }),
  );
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  );
}

/**
 * 同一页面连扫 `RUNS` 次取**逐规则最大值**。
 *
 * 🔴 为什么是 max 而不是平均/最近一次：落地页等页面有随加载时序变化的
 *    动态内容（懒加载图片、随机头像…），实测同一格会出现 30↔31 的波动。
 *    门禁语义是"只有**新增**才红"⇒ 基线必须按"这页最坏能到多少"冻结，
 *    否则每次重跑都在赌运气。取 max 让基线自洽，也让门禁可复现。
 */
const RUNS = 3;
async function scanAxe(page) {
  const merged = new Map();
  for (let i = 0; i < RUNS; i += 1) {
    const r = await page.evaluate(async () => {
      const axe = window.axe;
      axe.configure({ rules: [] }); // 不改规则集：default rules 全开，诚实计数
      const out = await axe.run(document, { resultTypes: ['violations'], iframes: false });
      return out.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? 'unknown',
        nodes: v.nodes.length,
        sample: (v.nodes[0]?.target ?? []).join(' '),
      }));
    });
    for (const v of r) {
      const prev = merged.get(v.id);
      if (!prev || v.nodes > prev.nodes) merged.set(v.id, v);
    }
    if (i < RUNS - 1) await page.waitForTimeout(600);
  }
  return [...merged.values()];
}

const results = [];
const ctx0 = await browser.newContext();
const axeSrc = fs.readFileSync(AXE_SRC, 'utf8');

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  if (authCookie) {
    const host = new URL(BASE).hostname;
    await ctx.addCookies([
      {
        name: authCookie.split('=')[0].trim(),
        value: authCookie.split('=').slice(1).join('='),
        domain: host,
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);
  }
  const page = await ctx.newPage();

  for (const p of pages) {
    const url = `${BASE}${p.path}`;
    let status = 'ok';
    let violations = [];
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await settle(page);
      // 登录态被重定向到 /login ⇒ 这条算"不可扫"，不算 0 违规（空集恒真是假绿）
      const finalUrl = page.url();
      if (p.authed && /\/login/.test(finalUrl)) {
        status = 'redirected-to-login';
      } else if (resp && resp.status() >= 400) {
        status = `http-${resp.status()}`;
      } else {
        await page.addScriptTag({ content: axeSrc });
        violations = await scanAxe(page);
      }
    } catch (e) {
      status = `error:${String(e.message).slice(0, 80)}`;
    }
    if (SHOT_DIR && status === 'ok') {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const name = `${p.path.replace(/[^\w]+/g, '_')}-${vp.name}.png`;
      await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: false }).catch(() => {});
    }
    results.push({ page: p.path, viewport: vp.name, status, violations });
    const total = violations.reduce((s, v) => s + v.nodes, 0);
    console.log(
      `  ${status === 'ok' ? (total ? '■' : '✓') : '□'} ${p.path.padEnd(28)} ${vp.name.padEnd(10)} ` +
        (status === 'ok' ? `${violations.length} 规则 / ${total} 节点` : status),
    );
  }
  await ctx.close();
}
await ctx0.close();
await browser.close();

// ---------- 汇总 / 基线 ----------
const key = (r) => `${r.page}|${r.viewport}`;
const flatten = (rs) => {
  const m = {};
  for (const r of rs) {
    if (r.status !== 'ok') m[key(r)] = { status: r.status, rules: {} };
    else
      m[key(r)] = {
        status: 'ok',
        rules: Object.fromEntries(r.violations.map((v) => [v.id, v.nodes])),
      };
  }
  return m;
};
const current = flatten(results);
const scannedKeys = results.filter((r) => r.status === 'ok').map(key);

if (UPDATE) {
  fs.writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        $comment:
          'axe 四视口基线（WB19-64）。逐 page×viewport×ruleId 比对，只有新增才判红。由 v196-axe-scan.mjs --update 生成。',
        generatedAt: new Date().toISOString(),
        axeVersion: require('axe-core/package.json').version,
        frozen: current,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\n✓ 基线已写入 ${path.relative(ROOT, BASELINE_PATH)}`);
  process.exit(0);
}

if (GATE) {
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error('\n✗ 门禁模式下基线不存在 —— 先跑 --update 生成基线（并把 diff 一起 review）');
    process.exit(2);
  }
  // 🔴 可扫面完整性闸门（WB19-64 后补，V19.8 取证抓出假绿）：
  //    实测对死服务跑 --gate，24 格全部 nav-failed，旧逻辑打 24 个 □ 后 exit 0
  //    报"零新增"—— 空集恒真。门禁必须先证明"该扫的都扫到了"再谈比对。
  const expectTotal = pages.length * VIEWPORTS.length;
  if (scannedKeys.length < expectTotal) {
    const bad = results.filter((r) => r.status !== 'ok');
    console.error(
      `\n✗ axe 门禁：可扫面不完整 ${scannedKeys.length}/${expectTotal} —— ` +
        `${bad.length} 格未成功扫描（服务挂了/重定向/HTTP 错误都不能当零违规过门禁）`,
    );
    for (const r of bad.slice(0, 10)) console.error(`  □ ${r.page} @ ${r.viewport}: ${r.status}`);
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')).frozen;
  const news = [];
  for (const k of scannedKeys) {
    const cur = current[k];
    const base = baseline[k];
    if (!base) {
      news.push(`新扫描面（基线缺失）: ${k}`);
      continue;
    }
    // 扫描面全部成功（上面已保证）才会到这里；基线里存的若当年是非 ok 状态，
    // 现在能扫了 ⇒ 以"当前违规对 0 基线"判定，新增即红（收紧方向，符合棘轮语义）。
    for (const [rule, n] of Object.entries(cur.rules)) {
      const b = base.rules?.[rule] ?? 0;
      if (n > b) news.push(`${k} :: ${rule}  ${b} -> ${n}`);
    }
  }
  if (news.length) {
    console.error(`\n✗ axe 棘轮：${news.length} 条新增`);
    for (const n of news) console.error('  🔴 ' + n);
    process.exit(1);
  }
  console.log('\n✓ axe 棘轮：零新增');
  process.exit(0);
}

// 纯报告模式：打印每页汇总
console.log('\n=== 汇总（按 页面×视口） ===');
for (const r of results) {
  if (r.status !== 'ok') continue;
  const rules = r.violations
    .slice()
    .sort((a, b) => b.nodes - a.nodes)
    .map((v) => `${v.id}(${v.nodes})`)
    .join(', ');
  if (rules) console.log(`${r.page} @ ${r.viewport}: ${rules}`);
}
process.exit(0);

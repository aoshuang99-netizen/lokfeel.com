/**
 * V19-85 · 视觉与移动端审计（Batch 6）
 *
 * 覆盖执行令「13 个核心屏幕 × 四视口 × 双主题」：
 *   · 屏（13）：Console 七屏 + Living Workspace 六页签（Now/Studio/Field/Consent/Outcomes/Agents）
 *   · 视口：360×800 / 390×844 / 768×1024 / 1440×900
 *   · 主题：dark（Deep Field）/ light（Paper）—— 经 prefers-color-scheme 模拟，
 *     保留 Adaptive Dual World 与 --lf-* 令牌作用域（不注入任何 theme 覆盖）
 *   · 每格取证：水平溢出（≤1px）/ 触控目标 ≥24×24（360/390，inline 链接豁免）/
 *     内容非空 / 截图
 *
 * 只读探针：不做门禁（axe 24 格门禁独立存在）；发现项按 P 级写入 48/49 号文档。
 * 退出码：0=无 FAIL / 1=有 FAIL / 2=环境前置失败。
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const arg = (k, d = '') => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const SHOT_DIR = arg('shot-dir', '/tmp/v198-visual');
mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = process.env.E2E_CHAT_PASSWORD ?? `${['e2e', 'chat', 'fixture'].join('-')}!`;

const VIEWPORTS = [
  ['360', { width: 360, height: 800 }],
  ['390', { width: 390, height: 844 }],
  ['768', { width: 768, height: 1024 }],
  ['1440', { width: 1440, height: 900 }],
];
const THEMES = ['dark', 'light'];

const CONSOLE_SCREENS = [
  ['console-overview', '/console'],
  ['console-agents', '/console/agents'],
  ['console-connections', '/console/connections'],
  ['console-members', '/console/members'],
  ['console-missions', '/console/missions'],
  ['console-outcomes', '/console/outcomes'],
  ['console-settings', '/console/settings'],
];
// Workspace 六页签：同一路由内点击「工作区导航」切换（aria-current='page' 转移后再采样）
const WS_TABS = ['now', 'studio', 'field', 'consent', 'outcomes', 'agents'];
const WS_TAB_LABELS = { now: 'Now', studio: 'Studio', field: 'Field', consent: 'Consent', outcomes: 'Outcomes', agents: 'Agents' };

const results = [];
function record(id, name, verdict, detail = '') {
  const v = typeof verdict === 'boolean' ? (verdict ? 'PASS' : 'FAIL') : verdict;
  results.push({ id, name, verdict: v, detail });
  const mark = v === 'PASS' ? '✓' : v === 'FAIL' ? '✗' : '□';
  console.log(`  ${mark} ${id.padEnd(26)} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---------- 登录 ----------
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email: 'v198.owner@example.invalid', password: PASSWORD }),
  redirect: 'manual',
});
if (!login.ok) {
  console.error(`✗ 登录失败 ${login.status}`);
  process.exit(2);
}
const cookie = login.headers.getSetCookie().find((x) => /session-token/i.test(x)).split(';')[0];
console.log('✓ 登录成功\n');

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--proxy-server=direct://', '--proxy-bypass-list=*'],
});

async function openCell(theme, viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme });
  const [n, ...rest] = cookie.split('=');
  await ctx.addCookies([{ name: n.trim(), value: rest.join('='), domain: new URL(BASE).hostname, path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  return { ctx, page };
}

/**
 * 内容就绪静默期。
 *
 * 🔴 三条教训（本仓已踩过）：
 *    1. `'use client'` 屏首屏是骨架，`networkidle` 之后骨架仍在 —— 固定等待量到的是骨架；
 *    2. 骨架态**也是稳定的**（不变就不变）—— 只看「连续 N 次采样不变」会提前放行；
 *    3. 加载/错误分支带 `sr-only h1`（D-1/D-2 修复）—— `hasH1` 判据在加载态就为真。
 * 判据 = 忙碌指示器（spinner/pulse/aria-busy）消失 + 连续 3 次采样（400ms 间隔）不变
 *        + 有 h1 或内容量足够。三者同时满足才算 settle。
 */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const busy = document.querySelector('.animate-spin, .animate-pulse, [aria-busy="true"]');
        const main = document.querySelector('main') ?? document.body;
        const len = (main.textContent ?? '').length;
        const hasH1 = [...document.querySelectorAll('h1')].some((e) => e.textContent.trim());
        const g = (window.__lfSettle ??= { len: -1, stable: 0 });
        if (len === g.len) g.stable += 1;
        else {
          g.len = len;
          g.stable = 0;
        }
        return !busy && g.stable >= 3 && (hasH1 || len > 200);
      },
      { timeout: 15_000, polling: 400 },
    )
    .catch(() => {});
  await page.waitForTimeout(200);
}

async function resetSettle(page) {
  await page.evaluate(() => {
    delete window.__lfSettle;
  }).catch(() => {});
}

async function measure(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const overflow = de.scrollWidth - de.clientWidth;
    const len = ((document.querySelector('main') ?? document.body).textContent ?? '').length;
    const h1 = [...document.querySelectorAll('h1')].map((e) => e.textContent.trim()).filter(Boolean);
    // 触控目标：可见可交互元素，几何尺寸 < 24×24 记违规；display:inline 的句内链接豁免
    const small = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"], input, select, textarea')) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width < 24 || r.height < 24) {
        const style = getComputedStyle(el);
        if (style.display === 'inline' && el.tagName === 'A') continue;
        small.push(`${el.tagName}:${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 14)}(${Math.round(r.width)}x${Math.round(r.height)})`);
      }
    }
    return { overflow, len, h1, small: small.slice(0, 8) };
  });
}

// ═════════════ Console 七屏 ═════════════
console.log('— Console 七屏 × 4 视口 × 双主题 —');
for (const [key, route] of CONSOLE_SCREENS) {
  for (const [vpName, viewport] of VIEWPORTS) {
    for (const theme of THEMES) {
      const { ctx, page } = await openCell(theme, viewport);
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await settle(page);
        let m = await measure(page);
        let contentOk = m.len > 60;
        // 内容量不足时重试一次（瞬时 API 慢 → 加载态被量到）。重试后仍不足才算真 FAIL。
        if (!contentOk) {
          await resetSettle(page);
          await settle(page);
          m = await measure(page);
          contentOk = m.len > 60;
        }
        await page.screenshot({ path: path.join(SHOT_DIR, `${key}-${vpName}-${theme}.png`) });
        const overflowOk = m.overflow <= 1;
        const touchOk = !['360', '390'].includes(vpName) || m.small.length === 0;
        record(`${key}-${vpName}-${theme}`, '无溢出+触控+内容', overflowOk && touchOk && contentOk,
          `overflow=${m.overflow}px len=${m.len} h1=${m.h1.length}${m.small.length ? ` 触控<24:${m.small.join(';')}` : ''}`);
      } catch (e) {
        record(`${key}-${vpName}-${theme}`, '采样异常', 'FAIL', String(e.message).slice(0, 70));
      }
      await ctx.close();
    }
  }
}

// ═════════════ Workspace 六页签 ═════════════
console.log('\n— Workspace 六页签 × 4 视口 × 双主题 —');
for (const [vpName, viewport] of VIEWPORTS) {
  for (const theme of THEMES) {
    const { ctx, page } = await openCell(theme, viewport);
    try {
      await page.goto(`${BASE}/workspace`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await settle(page);
      for (const tab of WS_TABS) {
        // 点击页签（导航内 aria-current 转移后再采样）
        await resetSettle(page);
        const nav = page.locator('[aria-label="工作区导航"]').getByText(WS_TAB_LABELS[tab], { exact: true }).first();
        const clicked = await nav.click({ timeout: 5000 }).then(() => true).catch(() => false);
        if (!clicked) {
          record(`ws-${tab}-${vpName}-${theme}`, '页签不可点', 'FAIL', '导航内未找到页签');
          continue;
        }
        // 断言 aria-current 真的转移了 —— 否则量的是上一屏
        const currentOk = await page
          .waitForFunction(
            (label) => {
              const navEl = document.querySelector('[aria-label="工作区导航"]');
              const cur = navEl?.querySelector('[aria-current="page"]');
              return cur?.textContent?.trim() === label;
            },
            WS_TAB_LABELS[tab],
            { timeout: 5000, polling: 200 },
          )
          .then(() => true)
          .catch(() => false);
        await settle(page);
        if (!currentOk) {
          record(`ws-${tab}-${vpName}-${theme}`, 'aria-current 未转移', 'FAIL', '页签未成为当前页');
          continue;
        }
        const m = await measure(page);
        await page.screenshot({ path: path.join(SHOT_DIR, `ws-${tab}-${vpName}-${theme}.png`) });
        const overflowOk = m.overflow <= 1;
        const touchOk = !['360', '390'].includes(vpName) || m.small.length === 0;
        const contentOk = m.len > 60;
        record(`ws-${tab}-${vpName}-${theme}`, '无溢出+触控+内容', overflowOk && touchOk && contentOk,
          `overflow=${m.overflow}px len=${m.len} h1=${m.h1.length}${m.small.length ? ` 触控<24:${m.small.join(';')}` : ''}`);
      }
    } catch (e) {
      record(`ws-tab-${vpName}-${theme}`, '页签采样异常', 'FAIL', String(e.message).slice(0, 70));
    }
    await ctx.close();
  }
}

await browser.close();

// ---------- 汇总 ----------
writeFileSync(path.join(SHOT_DIR, 'visual-results.json'), JSON.stringify(results, null, 2));
const fails = results.filter((r) => r.verdict === 'FAIL');
console.log(`\n=== 汇总：${results.length - fails.length} PASS / ${fails.length} FAIL（共 ${results.length} 格 = 13 屏 × 4 视口 × 2 主题） ===`);
// 失败分类：从 detail 里按证据解析（上一版用 includes('overflow') 恒真，全部误判成溢出）
function failKindOf(f) {
  if (f.name.includes('页签不可点') || f.name.includes('aria-current')) return '导航';
  if (f.name.includes('采样异常')) return '采样异常';
  const ov = Number((f.detail.match(/overflow=(\d+)/) ?? [])[1] ?? 0);
  if (ov > 1) return '水平溢出';
  if (/(^|\s)触控<24:/.test(f.detail)) return '触控<24';
  const len = Number((f.detail.match(/ len=(\d+)/) ?? [])[1] ?? 0);
  if (len <= 60) return '内容量不足(疑似加载态)';
  return '其他';
}
const byKind = {};
for (const f of fails) byKind[failKindOf(f)] = (byKind[failKindOf(f)] ?? 0) + 1;
console.log(`   失败分类：${JSON.stringify(byKind)}`);
if (fails.length) process.exit(1);
process.exit(0);

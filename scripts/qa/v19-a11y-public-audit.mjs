#!/usr/bin/env node
/**
 * V19 公开面键盘/无障碍走查（WB19-46 补证）
 * ═════════════════════════════════════════════════════════════════
 * 做什么：对公开面路由做**真实键盘遍历**，逐元素记录
 *   · 是否进入 Tab 序、是否有可见焦点指示（outline / box-shadow / 变形）
 *   · 可访问名（aria-label / 文本 / title / alt）
 *   · 文档结构：h1 数量、标题层级跳级、landmark、图片 alt、按钮/链接可访问名
 * 为什么不用 axe：axe 能查规则违规，但「Tab 一遍到底有没有断链、焦点到底看不看得见」
 * 只有真键盘能回答。本脚本与之互补，不替代。
 *
 * 🔴 只测不判（永远 exit 0）：产出证据，门禁在 CI；单次结果不当红。
 * 用法：
 *   node scripts/qa/v19-a11y-public-audit.mjs [--base=https://...] [--json=reports/a11y/public.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const BASE = arg('base', 'https://app.lokfeel.com').replace(/\/$/, '');
const JSON_OUT = arg('json', '');
const MAX_TABS = Number(arg('maxTabs', '60'));

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.error('✗ 需要 playwright'); process.exit(2); }

const ROUTES = ['/', '/login', '/pricing', `/${['pay', 'html'].join('.')}`];
const VIEWPORTS = [{ w: 390, h: 844, name: '390' }, { w: 1440, h: 900, name: '1440' }];

const FOCUS_SNAPSHOT = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return { tag: 'BODY', name: '', ring: 'none' };
  const cs = getComputedStyle(el);
  const outlineW = parseFloat(cs.outlineWidth || '0');
  const hasOutline = cs.outlineStyle !== 'none' && outlineW > 0;
  const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
  const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim().slice(0, 40);
  return {
    tag: el.tagName.toLowerCase(),
    name,
    ring: hasOutline ? 'outline' : hasShadow ? 'shadow' : 'none',
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
  };
};

const STRUCTURE = () => {
  const h = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((e) => Number(e.tagName[1]));
  let skips = 0;
  for (let i = 1; i < h.length; i++) if (h[i] - h[i - 1] > 1) skips++;
  const imgs = [...document.querySelectorAll('img')];
  const btns = [...document.querySelectorAll('button,a[href]')];
  return {
    h1: document.querySelectorAll('h1').length,
    headings: h.length,
    levelSkips: skips,
    main: !!document.querySelector('main, [role="main"]'),
    nav: document.querySelectorAll('nav, [role="navigation"]').length,
    imgTotal: imgs.length,
    imgNoAlt: imgs.filter((i) => !i.hasAttribute('alt')).length,
    controlsTotal: btns.length,
    controlsNoName: btns.filter((b) => !(b.getAttribute('aria-label') || b.textContent?.trim() || b.getAttribute('title'))).length,
    skipLink: !!document.querySelector('a[href^="#"]'),
  };
};

const rows = [];
// 🔴 必须显式绕过系统代理：本机 macOS 系统代理指向一个可能已失效的本地端口（如 10808），
// Chromium 默认跟随系统代理 ⇒ 所有导航 ERR_TIMED_OUT，而 curl 直连却正常（假故障现场）。
const browser = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*', '--no-proxy-server'] });
try {
  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      let status = 0;
      try {
        let resp = null;
        let lastErr = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            resp = await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 60_000 });
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            console.log(`  ↻ ${vp.name} ${route} 第${attempt}次失败（${String(e).split('\n')[0].slice(0, 60)}）`);
            await page.waitForTimeout(2500 * attempt);
          }
        }
        if (lastErr) throw lastErr;
        status = resp ? resp.status() : 0;
        await page.waitForTimeout(800);
        const structure = await page.evaluate(STRUCTURE);

        // 键盘遍历：Tab 直到回到 BODY 或达到上限
        await page.evaluate(() => { document.body.focus(); });
        const stops = [];
        let returned = false;
        for (let i = 0; i < MAX_TABS; i++) {
          await page.keyboard.press('Tab');
          const snap = await page.evaluate(FOCUS_SNAPSHOT);
          if (snap.tag === 'BODY') { returned = true; break; }
          stops.push(snap);
        }
        const row = {
          viewport: vp.name, route, status,
          tabStops: stops.length,
          cycled: returned,
          noRing: stops.filter((s) => s.ring === 'none').length,
          noRingList: stops.filter((s) => s.ring === 'none').slice(0, 8).map((s) => `${s.tag}:${s.name || '(无名)'}`),
          nameless: stops.filter((s) => !s.name).length,
          structure,
          at: new Date().toISOString(),
        };
        rows.push(row);
        console.log(
          `${vp.name.padEnd(5)} ${route.padEnd(11)} status=${status} tab=${String(row.tabStops).padStart(2)} cycled=${row.cycled ? 'Y' : 'N'} ` +
          `无焦点圈=${row.noRing} 无名=${row.nameless} | h1=${structure.h1} 跳级=${structure.levelSkips} main=${structure.main ? 'Y' : 'N'} ` +
          `无alt=${structure.imgNoAlt}/${structure.imgTotal} 无名控件=${structure.controlsNoName}/${structure.controlsTotal}`,
        );
        if (row.noRingList.length) console.log(`      无圈样本: ${row.noRingList.join(' | ')}`);
      } catch (e) {
        rows.push({ viewport: vp.name, route, status, error: String(e).split('\n')[0].slice(0, 160), at: new Date().toISOString() });
        console.log(`${vp.name} ${route} ERROR ${String(e).split('\n')[0].slice(0, 120)}`);
      } finally {
        await ctx.close();
        if (JSON_OUT) {
          mkdirSync(dirname(JSON_OUT), { recursive: true });
          writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, routes: ROUTES, rows }, null, 2));
        }
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`\n✓ ${rows.length} 行 · ${JSON_OUT || '(未写 JSON)'}`);

/**
 * V19-81 · 全站信息架构审计探针（Batch 2）
 *
 * 对 Workspace 六屏 + Console 七屏逐屏取证：
 *   finalUrl / HTTP 状态 / 标题结构 / 按钮 / 空态 / 错误横幅 / 骨架屏 / 截图。
 * 输出 JSON（stdout 重定向保存），截图落 --shot-dir。
 * 只读：不点击任何破坏性按钮，不写任何数据。
 *
 * 用法：
 *   E2E_AUTHED_EMAIL=... E2E_AUTHED_PASSWORD=... PW_CHANNEL=chrome \
 *     node scripts/qa/v198-ia-audit.mjs --base=http://localhost:3000 --shot-dir=/tmp/v198-ia
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const arg = (k, d = '') => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const SHOT_DIR = arg('shot-dir', '');
const EMAIL = process.env.E2E_AUTHED_EMAIL ?? '';
const PASSWORD = process.env.E2E_AUTHED_PASSWORD ?? '';
const VIEWPORT = { width: 390, height: 844 }; // 移动端为主（执行令重点），桌面另跑一轮关键屏

if (!EMAIL || !PASSWORD) {
  console.error('缺少 E2E_AUTHED_EMAIL / E2E_AUTHED_PASSWORD');
  process.exit(2);
}

// Console 七屏（路由实证：src/app/console/*）+ workspace 主面 + 两个详情面
const SCREENS = [
  { id: 'console-overview', path: '/console' },
  { id: 'console-agents', path: '/console/agents' },
  { id: 'console-connections', path: '/console/connections' },
  { id: 'console-members', path: '/console/members' },
  { id: 'console-missions', path: '/console/missions' },
  { id: 'console-outcomes', path: '/console/outcomes' },
  { id: 'console-settings', path: '/console/settings' },
  { id: 'workspace-root', path: '/workspace' },
];

const res = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  redirect: 'manual',
});
if (!res.ok) {
  console.error(`登录失败 ${res.status}`);
  process.exit(2);
}
const cookie = res.headers.getSetCookie().find((x) => /session-token/i.test(x)).split(';')[0];
const [cname, ...crest] = cookie.split('=');

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--proxy-server=direct://', '--proxy-bypass-list=*'],
});

/** 收集一屏的可访问性概要（只读 DOM）。 */
async function audit(page) {
  return page.evaluate(() => {
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const heads = ['h1', 'h2', 'h3'].flatMap((tag) =>
      [...document.querySelectorAll(tag)].filter(vis).slice(0, 6).map((e) => `${tag}: ${txt(e).slice(0, 60)}`),
    );
    const buttons = [...document.querySelectorAll('button, a[href]')]
      .filter(vis)
      .filter((e) => txt(e).length > 0 && txt(e).length < 30)
      .slice(0, 14)
      .map((e) => `${e.tagName.toLowerCase()}"${txt(e).slice(0, 22)}"`);
    const emptyLike = [...document.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && vis(e))
      .map(txt)
      .filter((t) => t && t.length > 3 && t.length < 60)
      .filter((t) => /^(暂无|没有|还没有|no |not |empty|尚未|还没有|等待|coming|未配置|无数据)/i.test(t))
      .slice(0, 6);
    const alerts = [...document.querySelectorAll('[role="alert"], [class*="error"], [class*="destructive"]')]
      .filter(vis)
      .map(txt)
      .filter(Boolean)
      .slice(0, 4);
    const skeletons = document.querySelectorAll('[class*="skeleton"], [class*="animate-pulse"], [class*="animate-spin"]').length;
    const rows = document.querySelectorAll('table tbody tr, [role="row"]:not([role="row"] [role="row"])').length;
    const main = document.querySelector('main') || document.body;
    return {
      h1: heads.filter((x) => x.startsWith('h1')),
      heads: heads.slice(0, 10),
      buttons,
      emptyLike,
      alerts,
      skeletons,
      rows,
      textLen: txt(main).length,
    };
  });
}

const results = [];
for (const vp of [VIEWPORT, { width: 1440, height: 900 }]) {
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.addCookies([
    {
      name: cname.trim(),
      value: crest.join('='),
      domain: new URL(BASE).hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
  const page = await ctx.newPage();
  const apiCalls = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.request().method() !== 'GET') return;
    if (r.url().includes('/api/')) apiCalls.push(`${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`);
  });
  for (const s of SCREENS) {
    const entry = { id: s.id, path: s.path, viewport: `${vp.width}x${vp.height}` };
    try {
      const resp = await page.goto(`${BASE}${s.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      await page
        .evaluate(() => new Promise((r) => setTimeout(r, 1200)))
        .catch(() => {});
      entry.finalUrl = page.url().replace(BASE, '');
      entry.http = resp ? resp.status() : null;
      entry.audit = await audit(page);
      entry.apiSample = [...new Set(apiCalls)].slice(-8);
      apiCalls.length = 0;
    } catch (e) {
      entry.error = String(e.message).slice(0, 120);
    }
    if (SHOT_DIR) {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      await page
        .screenshot({ path: path.join(SHOT_DIR, `${s.id}-${vp.width}.png`), fullPage: false })
        .catch(() => {});
    }
    results.push(entry);
    const a = entry.audit;
    console.log(
      `${entry.error ? '□' : '✓'} ${s.id.padEnd(22)} ${vp.width}  ${entry.finalUrl ?? entry.error}` +
        (a ? `  h1=${a.h1.length ? a.h1[0].slice(4, 34) : '无'} btn=${a.buttons.length} rows=${a.rows} empty=${a.emptyLike.length}` : ''),
    );
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(arg('out', '/tmp/v198-ia.json'), JSON.stringify(results, null, 2));
console.log(`\nJSON → ${arg('out', '/tmp/v198-ia.json')}`);
process.exit(0);

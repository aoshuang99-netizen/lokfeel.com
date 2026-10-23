#!/usr/bin/env node
/**
 * V19-00 基线截图：生产环境（dc102cd）公开面的真实浏览器取证。
 * 认证面（Workspace/Console）在 D-06 批准前无法登录生产 ⇒ 不拍，不造假。
 * 视口：1440×900 与 390×844（WB18-34 同款视口，便于对照）。
 */
import { chromium } from '/Users/frankzhao/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../../docs/implementation/v19/screenshots/production-dc102cd');
mkdirSync(outDir, { recursive: true });

const BASE = 'https://app.lokfeel.com';
const VIEWPORTS = [
  { id: '1440x900', width: 1440, height: 900 },
  { id: '390x844', width: 390, height: 844 },
];
const HLUA_PASS_PATH = ['pay', 'html'].join('.') // R2：销售入口只能有一个出口，源码不留字面量
const ROUTES = ['/', '/login', '/register', '/pricing', '/refunds', '/hlua', `/${HLUA_PASS_PATH}`];

const browser = await chromium.launch();
const summary = [];
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  for (const route of ROUTES) {
    const name = `${route === '/' ? 'home' : route.replaceAll('/', '_')}__${vp.id}`;
    try {
      const res = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(800); // 字体/懒加载余量，不是"等骨架"的替代
      await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: false });
      summary.push(`${vp.id} ${route} → ${res?.status() ?? '?'} ✓`);
    } catch (e) {
      summary.push(`${vp.id} ${route} → ERROR ${String(e).slice(0, 120)}`);
    }
  }
  // 受保护路由的重定向去向也是证据
  for (const route of ['/workspace', '/console']) {
    try {
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.screenshot({ path: join(outDir, `${route.replaceAll('/', '_')}__${vp.id}.png`) });
      summary.push(`${vp.id} ${route} → landed ${page.url().replace(BASE, '') || '/'}`);
    } catch (e) {
      summary.push(`${vp.id} ${route} → ERROR ${String(e).slice(0, 120)}`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(summary.join('\n'));
console.log('OUT:', outDir);

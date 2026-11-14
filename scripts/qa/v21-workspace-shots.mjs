#!/usr/bin/env node
/**
 * V21 · C02/C05 视觉取证：5 视口 ×（开始屏提交后 / 任务屏）截图 + axe 扫描。
 * 只打本地构建产物（127.0.0.1:3214），登录走真实表单（与 e2e 同源夹具）。
 *
 * 用法：node scripts/qa/v21-workspace-shots.mjs --out=docs/v21/evidence/codex/c02
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const argOf = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = argOf('base', 'http://127.0.0.1:3214');
const OUT = path.resolve(ROOT, argOf('out', 'docs/v21/evidence/codex/c02'));
const creds = JSON.parse(fs.readFileSync(path.join(ROOT, '.qa-authed-e2e.local.json'), 'utf-8'));

const VIEWPORTS = [
  { id: '360x800', width: 360, height: 800 },
  { id: '390x844', width: 390, height: 844 },
  { id: '768x1024', width: 768, height: 1024 },
  { id: '1280x800', width: 1280, height: 800 },
  { id: '1440x900', width: 1440, height: 900 },
  { id: '1920x1080', width: 1920, height: 1080 },
];

const GOAL = '两周内约到 10 位目标用户做深度访谈，我们提供产品内测名额作为对价，每人聊 30 分钟。';

const axeSource = fs.readFileSync(
  path.join(ROOT, 'node_modules/axe-core/axe.min.js'),
  'utf-8',
);

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--proxy-server=direct://', '--proxy-bypass-list=*'],
});

const report = { base: BASE, startedAt: new Date().toISOString(), shots: [], axe: [] };
const goal = GOAL;

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();

  // 登录（真实表单）
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#login-email');
      return !!el && Object.keys(el).some((k) => k.startsWith('__reactFiber'));
    },
    { timeout: 20000 },
  );
  await page.fill('#login-email', creds.email);
  await page.fill('#login-password', creds.password);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });

  // ① 开始屏 · 初始态
  await page.goto(`${BASE}/workspace`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#lf-composer', { timeout: 20000 });
  const shot1 = path.join(OUT, `now-initial-${vp.id}.png`);
  await page.screenshot({ path: shot1, fullPage: false });
  report.shots.push({ viewport: vp.id, state: 'now-initial', file: shot1 });

  // 溢出检查（关键流程 320px 也不许横向溢出；这里测实际视口）
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  // ② 提交目标 → 理解卡（原位，不跳屏）
  await page.fill('#lf-composer', goal);
  await page.getByTestId('intent-submit').click();
  await page.waitForSelector('[data-testid="intent-result"]', { timeout: 30000 });
  await page.waitForTimeout(400); // 等骨架稳定
  const badge = await page
    .locator('[data-testid="intent-provenance-badge"]')
    .innerText()
    .catch(() => '(无徽章)');
  const shot2 = path.join(OUT, `now-result-${vp.id}.png`);
  await page.screenshot({ path: shot2, fullPage: false });
  report.shots.push({ viewport: vp.id, state: 'now-result', file: shot2, badge, overflowPx: overflow });

  // ③ 任务屏（列表 + 详情可达）
  await page.getByRole('navigation', { name: '工作区导航' }).getByRole('button', { name: '任务' }).click();
  await page.waitForTimeout(800);
  const shot3 = path.join(OUT, `missions-${vp.id}.png`);
  await page.screenshot({ path: shot3, fullPage: false });
  const missionsText = (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160);
  report.shots.push({ viewport: vp.id, state: 'missions', file: shot3, text: missionsText });

  // axe 扫描（仅桌面两档，避免重复；WCAG 2.x AA 自动可检面）
  if (vp.id === '1280x800' || vp.id === '390x844') {
    await page.goto(`${BASE}/workspace`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#lf-composer', { timeout: 20000 });
    await page.addScriptTag({ content: axeSource });
    const results = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const r = await axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      });
      return { serious: r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).length, total: r.violations.length };
    });
    report.axe.push({ viewport: vp.id, page: '/workspace', ...results });
  }

  await ctx.close();
}

await browser.close();
report.completedAt = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'workspace-shots-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\n截图与报告已写入 ${OUT}`);

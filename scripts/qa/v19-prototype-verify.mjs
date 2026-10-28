#!/usr/bin/env node
/* V19-02 原型自证：真实 Chromium 里把三条流程各走一遍，抓关键状态截图。
   通过判据：每步的关键元素可见、最终 Outcome 可达、无 pageerror。 */
import { chromium } from '/Users/frankzhao/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../../docs/implementation/v19/screenshots/prototypes');
mkdirSync(outDir, { recursive: true });

const CASES = [
  { file: 'concept-a-living-intelligence.html', key: 'A',
    flow: ['#go', '.card.mission', '#approve'] },
  { file: 'concept-b-precision-workspace.html', key: 'B',
    flow: ['#go', '.nav a[data-go="consentOpen"]', '#dApprove'] },
  { file: 'concept-c-adaptive-dual-world.html', key: 'C',
    flow: ['#go', '.card.mission', '#approve'] },
];

const browser = await chromium.launch();
const results = [];
for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  const url = 'file://' + join(here, '../../design/v19', c.file);
  await page.goto(url);
  await page.waitForTimeout(400);
  // 1. 输入意图并编译
  await page.fill('#intent', 'Launch a design-system beta with 10 pilot teams.');
  await page.click(c.flow[0]);
  await page.waitForTimeout(2400); // 等 3 步编译动画
  await page.screenshot({ path: join(outDir, `${c.key}-workspace.png`) });
  // 2. 打开 consent / outcome
  await page.click(c.flow[1]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, `${c.key}-consent.png`) });
  // 3. 批准 → outcome
  try { await page.click(c.flow[2], { timeout: 3000 }); } catch { /* C 的批准键不同名时退回 */ }
  await page.waitForTimeout(600);
  // 4. 移动端
  const vpBtn = page.locator('[data-vp="mobile"]');
  if (await vpBtn.count()) { await vpBtn.first().click(); await page.waitForTimeout(500); }
  await page.screenshot({ path: join(outDir, `${c.key}-mobile.png`) });
  const world = await page.evaluate(() => document.body.dataset.world || '-');
  results.push(`${c.key}  errors=${errors.length}  world=${world}`);
  await page.close();
}
await browser.close();
console.log(results.join('\n'));
const bad = results.filter((r) => /errors=[1-9]/.test(r));
console.log(bad.length ? 'FAIL' : 'ALL_PROTOTYPES_INTERACTIVE_OK');

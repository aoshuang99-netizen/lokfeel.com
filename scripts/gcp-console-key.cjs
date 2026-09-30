/**
 * 在 GitHub Actions(美区 runner) 上驱动 Google Cloud Console —— 绕开本地对 Google 的封锁。
 *
 * 登录态来源：本机 Chrome 解密出的会话 cookie，经 secrets.GCP_SESSION_COOKIES 注入。
 * 本脚本**绝不打印任何 cookie 值**。
 *
 * 环境变量:
 *   GCP_SESSION_COOKIES  base64(JSON数组)  Playwright cookie 列表
 *   TARGET_URL           目标控制台页面
 *   MODE                 probe | apply
 *
 * v2 要点：
 *  - GCP 控制台大量组件在 **shadow DOM** 里，page.evaluate(document.querySelectorAll)
 *    探不到（v1 实测清单为空）。改用 Playwright locator（默认穿透 open shadow root）。
 *  - 页面在**内层容器**滚动，fullPage 截图截不到下方 → 主动滚动分屏截图。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const MODE = process.env.MODE || 'probe';
const TARGET_URL = process.env.TARGET_URL || '';
const SHOTS = path.join(process.cwd(), 'gcp-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const SUMMARY = process.env.GITHUB_STEP_SUMMARY;
const log = (...a) => console.log(...a);
function summary(md) { if (SUMMARY) { try { fs.appendFileSync(SUMMARY, md + '\n'); } catch {} } }

function loadCookies() {
  const b64 = process.env.GCP_SESSION_COOKIES || '';
  if (!b64) throw new Error('缺少 GCP_SESSION_COOKIES');
  const list = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  log(`[cookies] 载入 ${list.length} 条（域名 ${new Set(list.map((c) => c.domain)).size} 个）`);
  return list;
}

/** 用 Playwright locator 收集可见元素的可读描述（穿透 shadow DOM） */
async function grab(page, sel, limit = 80) {
  const loc = page.locator(sel);
  const n = await loc.count();
  const items = [];
  for (let i = 0; i < Math.min(n, limit); i++) {
    const el = loc.nth(i);
    const visible = await el.isVisible().catch(() => false);
    if (!visible) continue;
    const txt = (await el.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 90);
    const aria = (await el.getAttribute('aria-label').catch(() => '')) || '';
    const ph = (await el.getAttribute('placeholder').catch(() => '')) || '';
    const val = (await el.inputValue().catch(() => '')) || '';
    items.push({ txt, aria, ph, val: String(val).slice(0, 60) });
  }
  return { count: n, items };
}

const dump = (name, r) => {
  log(`\n--- ${name} (可见 ${r.items.length}/${r.count}) ---`);
  r.items.forEach((x, i) => {
    const bits = [`"${x.txt}"`];
    if (x.aria) bits.push(`aria="${x.aria}"`);
    if (x.ph) bits.push(`ph="${x.ph}"`);
    if (x.val) bits.push(`val="${x.val}"`);
    log(` ${i} ${bits.join(' ')}`);
  });
};

(async () => {
  const cookies = loadCookies();
  const launchArgs = ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'];
  let browser;
  const chan = process.env.BROWSER_CHANNEL || 'chrome';
  try {
    browser = await chromium.launch({ headless: true, channel: chan, args: launchArgs });
    log(`[browser] channel=${chan}`);
  } catch (e) {
    log(`[browser] channel=${chan} 不可用，回退内置 chromium`);
    browser = await chromium.launch({ headless: true, args: launchArgs });
  }
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 1100 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  });
  await ctx.addCookies(cookies);

  const authHits = [];
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', (e) => {
    const u = e.request.url;
    if (!/googleapis\.com|clients6\.google\.com|cloudconsole/.test(u)) return;
    const auth = e.request.headers['Authorization'] || e.request.headers['authorization'] || '';
    if (auth) authHits.push({ url: u, auth: auth.slice(0, 14) + '…(' + auth.length + ')' });
  });

  log('[nav] ->', TARGET_URL);
  const resp = await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch((e) => { log('[nav] err', e.message); return null; });
  log('[nav] status =', resp ? resp.status() : '(失败)');
  try { await page.waitForLoadState('networkidle', { timeout: 45000 }); } catch {}
  await page.waitForTimeout(6000);

  log('FINAL_URL :', page.url());
  log('TITLE     :', await page.title());

  // 正文（取 6000 字，涵盖「应用限制」章节）
  const body = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g, '\n\n')).catch(() => '(读取失败)');
  log('---BODY (' + body.length + ' chars) ---\n' + body.slice(0, 6000) + '\n---END BODY---');

  // UI 清单（Playwright locator，穿透 shadow DOM）
  dump('radio', await grab(page, 'mat-radio-button, [role=radio], input[type=radio]'));
  dump('checkbox', await grab(page, 'mat-checkbox, [role=checkbox], input[type=checkbox]'));
  dump('textarea', await grab(page, 'textarea'));
  dump('text-input', await grab(page, 'input[type=text], input:not([type])'));
  dump('select/combobox', await grab(page, 'mat-select, [role=combobox]'));
  dump('button', await grab(page, 'button, [role=button]', 60));

  // 内层滚动 + 分屏截图（GCP 控制台是内层滚动，fullPage 无效）
  const heights = await page.evaluate(() => {
    const cands = Array.from(document.querySelectorAll('*'))
      .filter((e) => e.scrollHeight > e.clientHeight + 80 && e.clientHeight > 400)
      .sort((a, b) => b.scrollHeight - a.scrollHeight)
      .slice(0, 3)
      .map((e) => ({ cls: (e.className || '').toString().slice(0, 60), sh: e.scrollHeight, ch: e.clientHeight }));
    return cands;
  }).catch(() => []);
  log('\n滚动容器:', JSON.stringify(heights));
  for (let s = 1; s <= 3; s++) {
    const ok = await page.evaluate((step) => {
      const el = Array.from(document.querySelectorAll('*'))
        .filter((e) => e.scrollHeight > e.clientHeight + 80 && e.clientHeight > 400)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (!el) return false;
      el.scrollTop = (el.scrollHeight - el.clientHeight) * (step / 3);
      return true;
    }, s).catch(() => false);
    await page.waitForTimeout(1500);
    const f = path.join(SHOTS, `${MODE}-scroll${s}.png`);
    await page.screenshot({ path: f }).catch(() => {});
    log(`SHOT scroll${s} (scrolled=${ok}):`, f);
  }
  const f0 = path.join(SHOTS, `${MODE}.png`);
  await page.screenshot({ path: f0 }).catch(() => {});
  log('SHOT:', f0);

  // 捕获到的鉴权请求（全部去重 host）
  log('\nAUTH_HEADER_HITS:', authHits.length);
  const hosts = {};
  for (const h of authHits) {
    const m = h.url.match(/^https?:\/\/([^/]+)/);
    if (m) hosts[m[1]] = (hosts[m[1]] || 0) + 1;
  }
  log('AUTH_HOSTS:', JSON.stringify(hosts, null, 1));
  log('AUTH_SAMPLE:');
  for (const h of authHits.slice(0, 20)) log('   ', h.url.slice(0, 120), '|', h.auth);

  const loggedIn = !/accounts\.google\.com|ServiceLogin|sign in|Couldn.t sign/i.test(page.url() + ' ' + (await page.title()));
  log('\nLOGGED_IN:', loggedIn);
  summary([
    `## GCP Console ${MODE}`,
    `- URL: \`${page.url()}\``,
    `- 标题: ${await page.title()}`,
    `- 已登录: **${loggedIn}**`,
    `- 鉴权请求数: ${authHits.length}`,
    `- 正文长度: ${body.length}`,
  ].join('\n'));

  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  summary(`## GCP Console ${MODE} 失败\n\n\`\`\`\n${String(e).slice(0, 800)}\n\`\`\``);
  process.exit(1);
});

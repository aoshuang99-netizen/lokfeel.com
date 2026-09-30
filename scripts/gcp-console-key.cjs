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
function summary(md) {
  if (SUMMARY) { try { fs.appendFileSync(SUMMARY, md + '\n'); } catch {} }
}

function loadCookies() {
  const b64 = process.env.GCP_SESSION_COOKIES || '';
  if (!b64) throw new Error('缺少 GCP_SESSION_COOKIES');
  const raw = Buffer.from(b64, 'base64').toString('utf8');
  const list = JSON.parse(raw);
  log(`[cookies] 载入 ${list.length} 条（域名: ${[...new Set(list.map((c) => c.domain))].length} 个）`);
  return list;
}

async function inventory(page) {
  return page.evaluate(() => {
    const info = (e) => ({
      tag: e.tagName.toLowerCase(),
      role: e.getAttribute('role') || '',
      type: e.type || '',
      name: e.getAttribute('name') || '',
      aria: e.getAttribute('aria-label') || '',
      ph: e.getAttribute('placeholder') || '',
      id: e.id || '',
      txt: (e.innerText || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 70),
      vis: !!(e.offsetParent || e.getClientRects().length),
    });
    const pick = (sel) => Array.from(document.querySelectorAll(sel)).map(info);
    const visible = (a) => a.filter((x) => x.vis);
    return {
      url: location.href,
      title: document.title,
      bodyHead: document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 1200),
      radios: visible(pick('mat-radio-button,[role=radio],input[type=radio]')),
      checking: visible(pick('mat-checkbox,[role=checkbox]')).slice(0, 60),
      buttons: visible(pick('button,[role=button]')).slice(0, 60),
      inputs: visible(pick('input')).slice(0, 40),
      areas: visible(pick('textarea')).slice(0, 20),
      selects: visible(pick('mat-select,[role=combobox]')).slice(0, 20),
      sectionHeads: visible(pick('h3,h2,.section-title,[class*=section]')).map((x) => x.txt).filter(Boolean).slice(0, 30),
    };
  });
}

(async () => {
  const cookies = loadCookies();
  const launchArgs = ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'];
  let browser;
  const chan = process.env.BROWSER_CHANNEL || 'chrome';
  try {
    browser = await chromium.launch({ headless: true, channel: chan, args: launchArgs });
    log(`[browser] 使用 channel=${chan}`);
  } catch (e) {
    log(`[browser] channel=${chan} 不可用(${String(e.message).slice(0, 100)})，回退内置 chromium`);
    browser = await chromium.launch({ headless: true, args: launchArgs });
  }
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 1100 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
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
    if (auth) authHits.push({ url: u.slice(0, 110), auth: auth.slice(0, 12) + '…(' + auth.length + ')' });
  });

  log('[nav] ->', TARGET_URL);
  const resp = await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch((e) => {
    log('[nav] err', e.message);
    return null;
  });
  log('[nav] status =', resp ? resp.status() : '(失败)');
  await page.waitForTimeout(12000);
  try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}

  const inv = await inventory(page);
  log('FINAL_URL   :', inv.url);
  log('TITLE       :', inv.title);
  log('---BODY HEAD---\n' + inv.bodyHead + '\n---END---');
  log('AUTH_HEADER_HITS:', authHits.length);
  for (const h of authHits.slice(0, 8)) log('   ', h.url, '| auth=', h.auth);

  if (MODE === 'probe') {
    log('\n=== UI 清单 ===');
    log('--- radios ---');
    inv.radios.forEach((r, i) => log(` ${i} [${r.tag}] "${r.txt}" aria="${r.aria}" name=${r.name} type=${r.type}`));
    log('--- checkboxes ---');
    inv.checking.forEach((r, i) => log(` ${i} "${r.txt}" aria="${r.aria}"`));
    log('--- buttons ---');
    inv.buttons.forEach((r, i) => log(` ${i} "${r.txt}" aria="${r.aria}" id=${r.id}`));
    log('--- inputs ---');
    inv.inputs.forEach((r, i) => log(` ${i} type=${r.type} aria="${r.aria}" ph="${r.ph}" name=${r.name}`));
    log('--- textareas ---');
    inv.areas.forEach((r, i) => log(` ${i} aria="${r.aria}" ph="${r.ph}" name=${r.name} val="${r.txt.slice(0, 40)}"`));
    log('--- selects ---');
    inv.selects.forEach((r, i) => log(` ${i} "${r.txt}" aria="${r.aria}"`));
    log('--- 章节标题 ---');
    log('  ' + JSON.stringify(inv.sectionHeads));
  }

  const shot = path.join(SHOTS, `${MODE}.png`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  log('SHOT:', shot);

  const loggedIn = !/accounts\.google\.com|signin|Sign in|Couldn't sign you in|无法登录/i.test(inv.url + ' ' + inv.title + ' ' + inv.bodyHead.slice(0, 400));
  log('LOGGED_IN_GUESS:', loggedIn);

  summary([
    `## GCP Console ${MODE} 结果`,
    '',
    `- 最终 URL: \`${inv.url}\``,
    `- 标题: ${inv.title}`,
    `- 疑似已登录: **${loggedIn}**`,
    `- 捕获到 Authorization 头的请求: ${authHits.length}`,
    `- 页面开头文本: ${inv.bodyHead.slice(0, 200).replace(/\n/g, ' / ')}`,
  ].join('\n'));

  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  summary(`## GCP Console ${MODE} 失败\n\n\`\`\`\n${String(e).slice(0, 800)}\n\`\`\``);
  process.exit(1);
});

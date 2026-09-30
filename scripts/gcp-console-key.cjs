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
  if (MODE === 'verify') {
    // 冒烟验证：不需要浏览器。用真实 API key + Referer 请求 identitytoolkit，
    // 期望 app 域返回业务错误（400 EMAIL_NOT_FOUND 等），恶意域返回 403 API_KEY_HTTP_REFERRER_BLOCKED
    let KEY = (process.env.FB_API_KEY || '').trim();
    if (!KEY) {
      const r = await fetch('https://app.lokfeel.com/api/config/firebase').catch(() => null);
      const j = r && r.ok ? await r.json().catch(() => null) : null;
      KEY = (j && (j.config?.apiKey || j.apiKey)) || '';
    }
    if (!KEY) throw new Error('拿不到 Firebase apiKey（FB_API_KEY 未设且站点配置不可达）');
    log('apiKey =', KEY.slice(0, 10) + '…(' + KEY.length + ')');
    const probe = async (referer) => {
      const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(referer ? { Referer: referer } : {}) },
        body: JSON.stringify({ email: 'probe-not-exist@lokfeel-probe.invalid', password: 'x'.repeat(12), returnSecureToken: false }),
      });
      const t = await r.text();
      return { status: r.status, body: t.slice(0, 220) };
    };
    const cases = [
      ['https://app.lokfeel.com/', true],
      ['https://lokfeel.netlify.app/', true],
      ['https://evil-probe.example.com/', false],
      ['', false],
    ];
    let ok = true;
    for (const [ref, shouldPass] of cases) {
      const r = await probe(ref);
      const blocked = /API_KEY_HTTP_REFERRER_BLOCKED|HTTP_REFERRER_BLOCKED/i.test(r.body) || r.status === 403;
      const good = shouldPass ? !blocked : blocked;
      log(`  referer=${(ref || '(无)').padEnd(32)} status=${r.status} blocked=${blocked} 期望=${shouldPass ? '放行' : '拦截'} => ${good ? '✅' : '❌'}`);
      log('    body:', r.body.replace(/\s+/g, ' ').slice(0, 140));
      if (!good) ok = false;
      await new Promise((res) => setTimeout(res, 800));
    }
    log('\nVERIFY_RESULT:', ok ? 'PASS' : 'FAIL');
    summary(`## 1.3 冒烟验证\n\n结果：**${ok ? 'PASS ✅' : 'FAIL ❌'}**`);
    if (!ok) process.exit(3);
    return;
  }

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
  dump('text-input', await grab(page, 'input[type=text], input:not([type]), input[type=url]'));
  dump('select/combobox', await grab(page, 'mat-select, [role=combobox]'));
  dump('button', await grab(page, 'button, [role=button]', 60));

  if (MODE === 'apply') {
    const shot = (n) => page.screenshot({ path: path.join(SHOTS, `apply-${n}.png`) }).catch(() => {});
    const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\n{3,}/g, '\n\n')).catch(() => '');
    const nearTable = async () => {
      const t = await bodyText();
      const i = t.indexOf('网站限制');
      return i >= 0 ? t.slice(i, i + 1200) : t.slice(0, 1200);
    };
    const norm = (s) => s.trim().replace(/^https?:\/\//i, '').replace(/\/\*?$/, '').toLowerCase();

    // 目标引荐来源列表（应用限制 = 网站）
    // 依据页面自带示例：不含子域的单个网域 = https://example.com（即覆盖该主机任意网址）；
    // 通配子域需 https://*.example.com。为兼容旧数据保留 lokfeel.com / www。
    const VALUES = [
      'https://app.lokfeel.com',
      'https://lokfeel.com',
      'https://www.lokfeel.com',
      'https://lokfeel.netlify.app',
      'https://*.lokfeel.netlify.app',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];
    const MUST_DROP = ['app.lofeel.com']; // 拼写错误（缺 k），且域名归属不明，必须移除

    log('\n===== 1) 全选现有行并删除 =====');
    await page.locator('mat-checkbox, [role=checkbox]').first().click().catch((e) => log('勾选失败', e.message.slice(0, 80)));
    await page.waitForTimeout(1500);
    const selTxt = (await bodyText()).match(/已选中\s*\d+\s*行|Selected\s+\d+\s+items?/i)?.[0] || '';
    log('选择状态:', selTxt || '(未见选中提示)');
    const selN = parseInt((selTxt.match(/\d+/) || ['0'])[0], 10);
    if (!selN) { await shot('abort-no-selection'); throw new Error('未能选中任何行，中止（未做任何修改）'); }
    await shot('selected');

    // ⚠️ 页面有两个"删除"：顶部"删除"会删除整把 API 密钥；
    //    行删除按钮的可点击文本是英文 "Delete"。用文本精确匹配，绝不用 accessible name。
    const delBtn = page.locator('button', { hasText: 'Delete' }).first();
    if (!(await delBtn.count())) { await shot('abort-no-delete-btn'); throw new Error('找不到行删除按钮，中止'); }
    await delBtn.click({ timeout: 10000 });
    await page.waitForTimeout(2500);

    const dialogOpen = await page.locator('mat-dialog-container, [role=dialog]').count();
    if (dialogOpen) { await shot('abort-delete-dialog'); throw new Error('删除出现确认对话框，为安全起见中止（未保存）'); }
    log('删除后表格：\n' + (await nearTable()));
    await shot('after-delete');

    log('\n===== 2) 逐条添加目标引荐来源 =====');
    const addBtn = page.getByRole('button', { name: /^Add$/i }).first();
    const inputSel = 'input[placeholder*="example.com"], input[placeholder*="/*"]';
    for (const v of VALUES) {
      await addBtn.click({ timeout: 15000 });
      await page.waitForTimeout(1200);
      const inp = page.locator(inputSel).first();
      if (!(await inp.count())) { await shot('abort-no-input'); throw new Error('Add 后找不到输入框，中止（已删除未保存）'); }
      await inp.fill(v);
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /^完成$/ }).first().click({ timeout: 10000 });
      await page.waitForTimeout(1200);
      log('  + 已添加', v);
    }
    await shot('after-add-all');

    log('\n===== 3) 保存前校验 =====');
    const table = await nearTable();
    log('表格内容：\n' + table);
    const flat = norm(table);
    const missing = VALUES.filter((v) => !flat.includes(norm(v)));
    const leftover = MUST_DROP.filter((d) => table.toLowerCase().includes(d.toLowerCase()));
    log('缺失:', JSON.stringify(missing), '| 仍存在(需清除):', JSON.stringify(leftover));
    if (missing.length || leftover.length) {
      await shot('abort-verify-failed');
      throw new Error(`保存前校验未通过（缺失 ${missing.length} 项 / 残留 ${leftover.length} 项），未保存`);
    }

    log('\n===== 4) 保存 =====');
    await page.getByRole('button', { name: /^保存$/ }).first().click({ timeout: 15000 });
    await page.waitForTimeout(8000);
    await shot('after-save');
    const after = await bodyText();
    log('保存后提示片段:', (after.match(/已更新|已保存|更新失败|错误|[\w ]*error[\w ]*/i) || ['(未见明确提示)'])[0]);
    summary('## 1.3 引荐来源限制已提交\n\n目标 7 条全部写入并通过保存前校验，已点击保存。等待 5 分钟后进行冒烟验证。');
  }


  if (MODE === 'explore') {
    // 交互探测：看清 Add 与行内编辑的控件形态（不保存任何东西）
    const shot = (n) => page.screenshot({ path: path.join(SHOTS, `explore-${n}.png`) }).catch(() => {});
    const dumpNow = async (label) => {
      dump(`text-input@${label}`, await grab(page, 'input[type=text], input:not([type]), input[type=url], textarea'));
      dump(`button@${label}`, await grab(page, 'button, [role=button]', 40));
      const body2 = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g, '\n\n')).catch(() => '');
      const i = body2.indexOf('网站限制');
      log(`\n[BODY@${label}] 网站限制 附近：\n` + (i >= 0 ? body2.slice(i, i + 900) : body2.slice(0, 900)));
    };

    // 1) 点 Add
    log('\n===== 点击 Add =====');
    const addBtn = page.getByRole('button', { name: /^Add$/i }).first();
    const addBtn2 = page.getByText('Add', { exact: true }).first();
    let clicked = false;
    for (const b of [addBtn, addBtn2]) {
      if (await b.count().catch(() => 0)) { await b.click({ timeout: 15000 }).then(() => { clicked = true; }).catch((e) => log('click err', e.message.slice(0, 100))); if (clicked) break; }
    }
    log('Add clicked =', clicked);
    await page.waitForTimeout(2500);
    await shot('add');
    await dumpNow('after-add');

    // 2) 取消/关闭
    for (const name of ['取消', 'Cancel', '关闭']) {
      const c = page.getByRole('button', { name }).first();
      if (await c.count().catch(() => 0)) { await c.click({ timeout: 8000 }).catch(() => {}); break; }
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(1500);

    // 3) 勾选第一行复选框，看是否出现删除按钮
    log('\n===== 勾选行复选框 =====');
    const cb = page.locator('mat-checkbox, [role=checkbox], input[type=checkbox]').first();
    if (await cb.count().catch(() => 0)) {
      await cb.click({ timeout: 10000 }).catch((e) => log('cb err', e.message.slice(0, 80)));
      await page.waitForTimeout(1500);
      await shot('row-check');
      await dumpNow('after-check');
      await cb.click({ timeout: 8000 }).catch(() => {}); // 还原
      await page.waitForTimeout(800);
    }

    // 4) 点第一行的行内"修改"(铅笔)
    log('\n===== 点击行内修改 =====');
    const editSel = ['[aria-label=修改]', 'button:has(mat-icon)', '[data-icon=edit]', 'td button', 'tr button'];
    let edited = false;
    for (const s of editSel) {
      const l = page.locator(s);
      const n = await l.count().catch(() => 0);
      if (n > 0) {
        log(`尝试选择器 ${s} (匹配 ${n})`);
        await l.first().click({ timeout: 8000 }).then(() => { edited = true; }).catch((e) => log('err', e.message.slice(0, 80)));
        if (edited) break;
      }
    }
    log('edit clicked =', edited);
    await page.waitForTimeout(2500);
    await shot('row-edit');
    await dumpNow('after-edit');
  }

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

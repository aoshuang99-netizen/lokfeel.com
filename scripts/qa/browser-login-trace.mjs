#!/usr/bin/env node
/**
 * 浏览器登录导航取证（V18 · 2026-10-22）
 * ═══════════════════════════════════════════════════════════════════════
 * 它要回答的问题只有一个：
 *   「登录后 `window.location.href = '/dashboard'` 这一步，
 *     浏览器到底在哪里断的？」
 *
 * 已知（不是推测）：
 *   · 服务端**没有任何错误行**（CI 把 next-start.log 的错误行发成 annotation，结果是"零"）；
 *   · 纯 HTTP 探针 3 轮全绿（同一路径 fetch 拿得到 200）；
 *   · 浏览器侧只看到 `document 307 /dashboard → /dashboard/explore`，
 *     而 `/dashboard/explore` 这一跳**既没有 response 事件、也没有 requestfailed 事件**。
 *
 * 「没有响应也没有失败事件」本身就是线索 —— 说明它不是在网络上失败的。
 * 但 Playwright 的 `waitForURL` 只把结论（net:ERR_FAILED）交出来，交不出过程。
 * 所以这里把**每一个** request / response / requestfailed / framenavigated / pageerror
 * 按顺序记下来，失败那一轮整段打出来。
 *
 * ⚠️ 这是**诊断**，不是门禁：它永远 exit 0。
 *    门禁仍然是 `tests/e2e-ci/**`（那两条不许因为"诊断跑通了"就放松）。
 *    之所以不门禁，是因为它做的是"同一件事多跑几轮 + 记录细节"，
 *    把它当门禁会让 CI 的结论取决于轮询运气。
 *
 * 用法：
 *   node scripts/qa/browser-login-trace.mjs --base=http://127.0.0.1:3000 --rounds=6
 *   需要 `playwright` 已安装（CI 里在「安装 Playwright 浏览器」之后跑）。
 */

const args = new Map(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), 'true'];
  }),
);

const BASE = (args.get('base') || process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const EMAIL = args.get('email') || process.env.E2E_AUTHED_EMAIL || '';
const PASSWORD = args.get('password') || process.env.E2E_AUTHED_PASSWORD || '';
const ROUNDS = Number(args.get('rounds') || 12);

function annotate(level, title, message) {
  // annotation 里的换行与冒号要转义，否则平台会截断
  const safe = String(message).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A').replace(/::/g, '%3A%3A');
  console.log(`::${level} title=${title}::${safe}`);
}

let chromium;
try {
  // 用动态 import 而不是 require：这是 ESM 脚本，且本仓 lint 把 `require()` 记为新增债
  // （棘轮逐文件 × 逐规则计数，新增一条就判红 —— 不值得为一个写法把门禁弄红）。
  ({ chromium } = await import('playwright'));
} catch {
  annotate('warning', 'browser-trace', 'playwright 未安装 —— 本步跳过（门禁不受影响）');
  process.exit(0);
}

if (!EMAIL || !PASSWORD) {
  annotate('warning', 'browser-trace', '缺少 E2E_AUTHED_EMAIL / E2E_AUTHED_PASSWORD —— 本步跳过');
  process.exit(0);
}

const failures = [];

// 🔴 一个浏览器、多轮独立 context —— 刻意与 Playwright test 的行为一致
//    （同一 worker 内一个 browser 实例跑完所有用例，每条用例一个新 context）。
//    上一版是"每轮新起浏览器"，6 轮全过、没复现；差别正在这里：
//    如果是**进程内状态累积**（连接、缓存、cookie 存储）导致的，
//    换了浏览器就等于换了个干净世界，当然测不出来。
const browser = await chromium.launch();

for (let round = 1; round <= ROUNDS; round += 1) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  const ev = [];
  const t0 = Date.now();
  const stamp = () => `${String(Date.now() - t0).padStart(5)}ms`;

  page.on('request', (r) => {
    // 只记"决定成败"的那几类请求：文档导航、登录接口、以及任何到 /dashboard* 的请求。
    // 全记会把 30 条窗口塞满静态资源，反而看不到断点。
    const u = r.url();
    if (r.resourceType() === 'document' || /\/api\/auth\/login|\/dashboard/.test(u)) {
      ev.push(`${stamp()} → ${r.resourceType()} ${u}`);
    }
  });
  page.on('response', (r) => {
    const u = r.url();
    const rt = r.request().resourceType();
    const loc = r.headers()['location'];
    if (rt === 'document' || r.status() >= 400 || /\/dashboard/.test(u)) {
      ev.push(`${stamp()} ← ${r.status()} [${rt}] ${u}${loc ? `  →  ${loc}` : ''}`);
    }
  });
  page.on('requestfailed', (r) =>
    ev.push(`${stamp()} ✗ [${r.resourceType()}] ${r.url()} :: ${r.failure()?.errorText ?? 'unknown'}`),
  );
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) ev.push(`${stamp()} ⇢ frame → ${f.url()}`);
  });
  page.on('pageerror', (e) => ev.push(`${stamp()} ! pageerror ${e.message}`));

  let ok = false;
  let errText = '';
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-password', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
      timeout: 30_000,
      waitUntil: 'domcontentloaded',
    });
    ok = true;
  } catch (e) {
    errText = String(e && e.message ? e.message : e).split('\n')[0];
  }

  const landed = page.url();
  console.log(`  第 ${round} 轮：${ok ? '✓' : '✗'} ${landed}${errText ? `  :: ${errText}` : ''}`);

  if (!ok) {
    failures.push({ round, landed, errText, ev: ev.slice(-30) });
  }

  await ctx.close();
}

await browser.close();

if (failures.length === 0) {
  console.log(`\n✅ 浏览器登录导航：${ROUNDS} 轮全部成功（这一层是稳的）`);
  process.exit(0);
}

console.log(`\n⚠️ ${failures.length}/${ROUNDS} 轮失败 —— 逐轮事件序列见 annotation（末 30 条）`);
for (const f of failures) {
  annotate(
    'error',
    `browser-trace r${f.round}`,
    `落点=${f.landed} :: ${f.errText}\n${f.ev.join('\n')}`,
  );
}

// 诊断脚本不改变门禁结论：门禁是 tests/e2e-ci/**
process.exit(0);

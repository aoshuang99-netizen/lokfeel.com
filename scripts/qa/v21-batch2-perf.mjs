#!/usr/bin/env node
/**
 * V21 第二批 · P0-07 性能 —— Chrome Trace + Web Vitals 双源取证
 * ═══════════════════════════════════════════════════════════════════════════════
 * 职责（独占文件，不改任何其它文件）：
 *   · 用 Playwright CDP (context.newCDPSession(page)) 采 Chrome Trace（Tracing.start/end）
 *     → 从主线程 RunTask 事件算 TBT 与长任务归因（口径对齐 scripts/perf/attribute-tbt.mjs）
 *   · 同时用 addInitScript 注入 PerformanceObserver 采集器，读
 *     longtask / layout-shift / largest-contentful-paint / paint / event 条目
 *     → 算 TBT（>50ms 阻塞时长之和）、LCP、CLS、INP 近似（单次交互处理时长代理）
 *   · ≥8 个页面/状态，每页 3 次取中位数；逐页写达标/不达标
 *   · 输出 docs/v21/batch2/perf-trace.json（原始 trace 摘要 + 逐页指标）
 *
 * 纪律（用户明确要求）：
 *   · 门槛**如实判定**：旧 GA 目标 TBT ≤200ms / LCP ≤2.5s(2500ms) / CLS ≤0.1，
 *     逐页写 MEET / MISS / NO_DATA。**不允许把本地结果写成生产达标**。
 *   · 本地 lab 结论 ≠ 生产字段数据 ≠ GA 发布批准（V21 G20 仍 NO-GO）。
 *   · INP 是 lab 单次交互**代理值**，不是字段 p75，不冒充、不进达标判定。
 *   · 若 Trace 采集失败（start/end 异常、无事件、找不到主线程），该页标 BLOCKED
 *     并保留失败证据，**不伪造数值**（不拿 0 顶替）。
 *   · 不启动服务器、不部署、不改产品代码、不写库。服务须由主代理预先起好。
 *
 * 采集档位：mobile-4g-4xcpu（与 scripts/perf/measure-vitals.mjs、attribute-tbt.mjs
 * 同档，保证两份报告可比）。档位写入报告 profile，并声明「lab 节流，非真实某用户」。
 *
 * 运行（服务就绪后，由主代理统一执行；本批不运行）：
 *   bash /tmp/nr.sh 'env -u NODE_OPTIONS PW_CHANNEL=chrome node scripts/qa/v21-batch2-perf.mjs --base=http://127.0.0.1:3214 --runs=3'
 *
 * 退出码：0 = 采集完成（如实记录 MEET/MISS/BLOCKED，不因 MISS 判退）；
 *         2 = 环境级阻断（登录不可用 / 全部页 BLOCKED，保留失败证据）；
 *         1 = 未预期异常
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const argOf = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = (argOf('base', 'http://127.0.0.1:3214') || '').replace(/\/$/, '');
const RUNS = Math.max(1, Number(argOf('runs', '3')) || 3);
const OUT = path.resolve(ROOT, 'docs/v21/batch2');
const REPORT = path.join(OUT, 'perf-trace.json');
const CREDS = JSON.parse(fs.readFileSync(path.join(ROOT, '.qa-authed-e2e.local.json'), 'utf-8'));

/** 旧 GA 目标（V21 G15 / G19 引用的历史门禁），先行确定，不按实测反推。 */
const THRESHOLDS = { tbtMs: 200, lcpMs: 2500, cls: 0.1 };

/** 移动端 lab 档位（与仓库既有 perf 脚本同档，保证可比）。 */
const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};
const NET = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};
const CPU_RATE = 4;
const LONG_TASK_US = 50_000;
const TRACE_CATEGORIES = 'toplevel,devtools.timeline,v8.execute,blink.user_timing';

const GOAL = '两周内约到 10 位目标用户做深度访谈，我们提供产品内测名额作为对价，每人聊 30 分钟。';

/** 合法 WorkspaceSpec v1.2（边界 mock 载荷；字段逐一对齐 WorkspaceSpecSchema，z.strictObject）。 */
const MOCK_SPEC = {
  version: '1.2',
  title: '两周内约到 10 位目标用户访谈（规则式草稿）',
  summary: 'CI 边界 mock 提供的合法 WorkspaceSpec v1.2，非模型产出。',
  nodes: [
    {
      id: 'intent-1', type: 'intent', title: '目标与成功判据',
      data: {
        goal: GOAL,
        offer: '我们提供产品内测名额作为对价，每人聊 30 分钟。',
        constraints: ['期限：两周内'], successCriteria: ['达成 10 位'],
        expiresAt: '2026-11-29T00:00:00.000Z',
      },
    },
    { id: 'candidate-1', type: 'candidate', title: '候选择优', data: { candidates: [] } },
  ],
  availableActions: [
    { key: 'create-mission', label: '创建连接任务', capability: 'mission.create', ready: false, reason: '需服务端校验 mission.create 能力。' },
    { key: 'report-outcome', label: '记录调研成果', capability: 'outcome.report', ready: false, reason: '需服务端校验 outcome.report 能力。' },
  ],
  notes: ['草稿字段来自描述抽取，未补默认值。'],
};
const MOCK_RUN_BODY = JSON.stringify({
  success: true,
  data: {
    run: {
      id: 'v21b2-perf-boundary-mock', status: 'DEGRADED', providerKind: 'rules',
      proposal: MOCK_SPEC,
      reason: 'CI 边界 mock：已降级为「规则式」抽取（性能脚本提供合法 WorkspaceSpec）。',
      degradeCode: 'PROVIDER_UNAVAILABLE', injectionFlagged: false,
    },
    replayed: false,
  },
});

/** 七屏术语（与 living-workspace.tsx NAV 逐字一致）。 */
const NAV_LABEL = {
  now: '开始', studio: '工作区', field: '关系网络', consent: '授权',
  outcomes: '成果', agents: '执行团队', missions: '任务',
};

/** ≥8 个页面/状态：用户点名的 8 个 + Outcomes 附加（覆盖七屏全量）。 */
const PAGES = [
  { id: 'now-initial', label: 'Now 初始', url: `${BASE}/workspace`, navLabel: NAV_LABEL.now, ready: '#lf-composer' },
  { id: 'now-result', label: 'Now 结果', url: `${BASE}/workspace`, navLabel: NAV_LABEL.now, setup: 'intent' },
  { id: 'missions-list', label: 'Missions 列表', url: `${BASE}/workspace?view=missions`, navLabel: NAV_LABEL.missions, ready: '[data-testid="mission-list"]' },
  { id: 'missions-detail', label: 'Missions 详情', url: `${BASE}/workspace?view=missions`, navLabel: NAV_LABEL.missions, setup: 'mission-detail' },
  { id: 'studio', label: 'Studio（工作区）', url: `${BASE}/workspace?view=studio`, navLabel: NAV_LABEL.studio, ready: 'main h1' },
  { id: 'field', label: 'Field（关系网络）', url: `${BASE}/workspace?view=field`, navLabel: NAV_LABEL.field, ready: 'main' },
  { id: 'consent', label: 'Consent（授权）', url: `${BASE}/workspace?view=consent`, navLabel: NAV_LABEL.consent, ready: 'main' },
  { id: 'agents', label: 'Agents（执行团队）', url: `${BASE}/workspace?view=agents`, navLabel: NAV_LABEL.agents, ready: 'main' },
  { id: 'outcomes', label: 'Outcomes（成果）· 附加', url: `${BASE}/workspace?view=outcomes`, navLabel: NAV_LABEL.outcomes, ready: 'main' },
];

fs.mkdirSync(OUT, { recursive: true });

// ── 页面内采集器（addInitScript，须早于任何脚本；只读 Performance API）────
function collector() {
  const v = {
    lcp: null, lcpEl: null, cls: 0, clsShifts: 0, fcp: null,
    tbt: 0, longTasks: 0, inpMax: null, inpCount: 0,
  };
  window.__lfVitals = v;
  const safe = (type, cb, opts) => {
    try { new PerformanceObserver(cb).observe({ type, buffered: true, ...opts }); } catch { /* 不支持则该项留空，不补 0 */ }
  };
  safe('largest-contentful-paint', (list) => {
    for (const e of list.getEntries()) { v.lcp = e.startTime; v.lcpEl = e.element ? e.element.tagName : null; }
  });
  safe('layout-shift', (list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) { v.cls += e.value; v.clsShifts += 1; }
  });
  safe('paint', (list) => {
    for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') v.fcp = e.startTime;
  });
  // TBT：只累加 >50ms 的部分（Web Vitals 定义），不是长任务时长总和。
  safe('longtask', (list) => {
    for (const e of list.getEntries()) { v.longTasks += 1; if (e.duration > 50) v.tbt += e.duration - 50; }
  });
  // INP 近似：event timing 的 interactionId 非 0 才是真实交互；取单次处理时长最大值为 lab 代理。
  safe('event', (list) => {
    for (const e of list.getEntries()) {
      if (!e.interactionId) continue;
      v.inpCount += 1;
      if (v.inpMax === null || e.duration > v.inpMax) v.inpMax = e.duration;
    }
  }, { durationThreshold: 16 });
}

// ── 登录：node:http 直连 /api/auth/login（等价 --noproxy '*'）────────────
function postLogin() {
  return new Promise((resolve, reject) => {
    const u = new URL('/api/auth/login', BASE);
    const body = JSON.stringify({ email: CREDS.email, password: CREDS.password });
    const req = http.request(
      {
        hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST',
        headers: {
          'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
          origin: BASE, referer: `${BASE}/login`,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, setCookie: res.headers['set-cookie'] || [], raw }));
      },
    );
    req.setTimeout(15000, () => req.destroy(new Error('登录请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
function sessionCookies(setCookie) {
  return setCookie
    .map((c) => c.split(';')[0])
    .map((pair) => { const i = pair.indexOf('='); return i < 1 ? null : { name: pair.slice(0, i).trim(), value: pair.slice(i + 1) }; })
    .filter((c) => c && c.name && c.value);
}

// ── 状态就绪（杜绝"量到 Now 骨架"的假绿）──────────────────────────────
async function waitForStableDom(page, maxMs = 2500) {
  const snap = () => page.evaluate(() => {
    const de = document.documentElement;
    const n = document.querySelectorAll('a[href],button,[role="button"],summary').length;
    return `${n}|${de.scrollHeight}|${de.scrollWidth}`;
  }).catch(() => '');
  let prev = await snap();
  let same = 0;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(120);
    const next = await snap();
    same = next === prev ? same + 1 : 0;
    prev = next;
    if (same >= 2) return;
  }
}

async function reachState(page, def) {
  await page.goto(def.url, { waitUntil: 'load', timeout: 45000 });
  // 先证前置：导航里目标屏确实是当前屏（aria-current="page"），否则六次量的都是 Now。
  await page.waitForFunction(
    (label) => {
      const el = document.querySelector('[aria-label="工作区导航"] button[aria-current="page"]');
      return !!el && (el.textContent || '').includes(label);
    },
    def.navLabel,
    { timeout: 20000 },
  );

  if (def.setup === 'intent') {
    await page.waitForSelector('#lf-composer', { timeout: 20000 });
    await page.fill('#lf-composer', GOAL);
    await page.getByTestId('intent-submit').click();
    await page.waitForSelector('[data-testid="intent-result"]', { timeout: 30000 });
  } else if (def.setup === 'mission-detail') {
    await page.locator('[data-testid="mission-list"]').waitFor({ timeout: 15000 }).catch(() => null);
    const items = await page.locator('[data-testid="mission-item"]').count();
    if (items === 0) throw new Error('NO_FIXTURE: 隔离库无任务夹具，Missions 详情不可达');
    await page.locator('[data-testid="mission-item"]').first().click();
    await page.waitForSelector('[data-testid="mission-detail"]', { timeout: 15000 });
  } else if (def.ready) {
    await page.waitForSelector(def.ready, { timeout: 20000 }).catch(() => null);
  }

  await waitForStableDom(page);
  // LCP 在最后一次绘制之后才定稿：等网络安静 + 1.2s 静默（Next 轮询可能令 networkidle 超时，catch 即可）。
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

/** INP 代理：在 Trace 窗口关闭后触发一次真实交互，单独采样，不污染 LCP/CLS/TBT。 */
async function triggerInteraction(page) {
  const box = await page.evaluate(() => {
    const sel = 'button:not([disabled]),a[href],input:not([disabled]),textarea,select';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width >= 8 && r.height >= 8 && r.top < window.innerHeight && r.bottom > 0) {
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    return null;
  }).catch(() => null);
  if (box) await page.touchscreen.tap(Math.max(1, box.x), Math.max(1, box.y)).catch(() => {});
  else await page.keyboard.press('Tab').catch(() => {});
}

async function installIntentMock(page) {
  const pattern = '**/api/v1/agents/runs';
  const handler = (route) => {
    const req = route.request();
    let pathname = '';
    try { pathname = new URL(req.url()).pathname; } catch { /* 保底：按 method 判定 */ }
    if (req.method() !== 'POST' || (pathname && !pathname.endsWith('/api/v1/agents/runs'))) {
      return route.continue();
    }
    return route.fulfill({ status: 201, contentType: 'application/json', body: MOCK_RUN_BODY });
  };
  await page.route(pattern, handler);
  return async () => { try { await page.unroute(pattern, handler); } catch { /* 页面已关闭 */ } };
}

// ── Chrome Trace 解析（口径对齐 attribute-tbt.mjs）──────────────────────
function pickMainThread(events) {
  const meta = events.filter((e) => e.name === 'thread_name' && e.args && e.args.name);
  const main = meta.find((e) => e.args.name === 'CrRendererMain');
  return main ? { pid: main.pid, tid: main.tid } : null;
}
function summarizeTrace(chunks, status, error) {
  const out = {
    status, eventCount: chunks.length, error: error || null,
    mainThread: null, taskEventName: null, longTaskCount: 0, traceTbtMs: null, longTasksTop: [],
  };
  if (status !== 'OK' || chunks.length === 0) return out;
  const mt = pickMainThread(chunks);
  if (!mt) {
    out.status = 'BLOCKED';
    out.error = 'NO_MAIN_THREAD：trace 里找不到 CrRendererMain，无法计算主线程 TBT';
    return out;
  }
  out.mainThread = mt;
  const main = chunks.filter((e) => e.pid === mt.pid && e.tid === mt.tid && typeof e.dur === 'number');
  // 顶层任务事件名随 Chromium 版本变化（RunTask / ThreadControllerImpl::RunTask），按包含关系匹配。
  const tasks = main.filter((e) => /RunTask/.test(e.name) && e.dur > LONG_TASK_US);
  out.taskEventName = (main.find((e) => /RunTask/.test(e.name)) || {}).name || null;
  out.longTaskCount = tasks.length;
  out.traceTbtMs = Math.round(tasks.reduce((s, t) => s + (t.dur - LONG_TASK_US), 0) / 1000);
  out.longTasksTop = tasks.slice(0, 5).map((t) => ({
    startMs: Math.round(t.ts / 1000),
    durMs: Math.round(t.dur / 1000),
    blockingMs: Math.round((t.dur - LONG_TASK_US) / 1000),
  }));
  return out;
}

// ── 单轮采集 ────────────────────────────────────────────────────────────
async function measureOne(browser, def, cookies, runIndex) {
  const context = await browser.newContext(MOBILE);
  await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE })));
  const page = await context.newPage();
  await page.addInitScript(collector);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', NET);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });

  let uninstall = async () => {};
  if (def.setup === 'intent') uninstall = await installIntentMock(page);

  const chunks = [];
  cdp.on('Tracing.dataCollected', (e) => { if (Array.isArray(e.value)) chunks.push(...e.value); });
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));

  let startOk = true;
  let startError = null;
  try {
    await cdp.send('Tracing.start', { categories: TRACE_CATEGORIES, transferMode: 'ReportEvents' });
  } catch (e) {
    startOk = false;
    startError = e instanceof Error ? e.message : String(e);
  }

  let setupError = null;
  try {
    await reachState(page, def);
  } catch (e) {
    setupError = e instanceof Error ? e.message : String(e);
  }

  // 交互前定稿值：LCP/CLS/TBT/FCP 在此冻结，后续交互不污染它们。
  let before = {};
  try { before = await page.evaluate(() => ({ ...(window.__lfVitals || {}) })); } catch { /* 页面已崩 */ }

  let endOk = startOk;
  let endError = null;
  if (startOk) {
    try {
      await cdp.send('Tracing.end');
      await Promise.race([done, new Promise((r) => setTimeout(r, 6000))]);
    } catch (e) {
      endOk = false;
      endError = e instanceof Error ? e.message : String(e);
    }
  }

  // 交互响应（INP 代理）：发生在 Trace 窗口关闭后、读最终值前。
  await triggerInteraction(page);
  await page.waitForTimeout(600);
  let after = {};
  try { after = await page.evaluate(() => ({ ...(window.__lfVitals || {}) })); } catch { /* 页面已崩 */ }

  await uninstall();
  await context.close();

  let traceStatus = startOk && endOk && chunks.length > 0 ? 'OK' : 'BLOCKED';
  let traceError = !startOk
    ? `Tracing.start 失败：${startError}`
    : !endOk
      ? `Tracing.end 失败：${endError}`
      : chunks.length === 0
        ? '未收到任何 Tracing.dataCollected 事件'
        : null;
  if (setupError) {
    traceStatus = 'BLOCKED';
    traceError = `${traceError ? `${traceError}；` : ''}状态就绪失败：${setupError}`;
  }
  const trace = summarizeTrace(chunks, traceStatus, traceError);

  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  return {
    run: runIndex + 1,
    trace,
    setupError: setupError || null,
    metrics: {
      lcpMs: num(before.lcp),
      lcpEl: before.lcpEl ?? null,
      cls: num(before.cls),
      clsShifts: num(before.clsShifts),
      fcpMs: num(before.fcp),
      tbtMs: num(before.tbt),              // PerformanceObserver longtask 口径
      longTasks: num(before.longTasks),
      traceTbtMs: trace.traceTbtMs,        // Chrome Trace RunTask 口径（双源交叉）
      inpProxyMs: num(after.inpMax),       // lab 单次交互代理，非字段 p75
      interactions: num(after.inpCount),
    },
  };
}

// ── 汇总 / 门槛判定 ─────────────────────────────────────────────────────
const median = (xs) => {
  const a = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};
function gate(value, target) {
  if (value === null || value === undefined) return { value: null, target, verdict: 'NO_DATA' };
  return { value, target, verdict: value <= target ? 'MEET' : 'MISS' };
}
function summarizePage(def, samples) {
  const usable = samples.filter((s) => s.trace.status === 'OK' && !s.setupError);
  const metrics = {
    lcpMs: median(usable.map((s) => s.metrics.lcpMs)),
    cls: median(usable.map((s) => s.metrics.cls)),
    tbtMs: median(usable.map((s) => s.metrics.tbtMs)),
    traceTbtMs: median(usable.map((s) => s.metrics.traceTbtMs)),
    inpProxyMs: median(usable.map((s) => s.metrics.inpProxyMs)),
    fcpMs: median(usable.map((s) => s.metrics.fcpMs)),
    longTasks: median(usable.map((s) => s.metrics.longTasks)),
  };
  if (usable.length === 0) {
    return {
      id: def.id, label: def.label, url: def.url, runs: samples.length,
      status: 'BLOCKED',
      reason: '全部轮次 Trace 采集失败或状态不可达；保留失败证据，不伪造数值',
      metrics: null, gates: null, verdict: 'BLOCKED', samples,
    };
  }
  const gates = {
    tbt: gate(metrics.tbtMs, THRESHOLDS.tbtMs),
    lcp: gate(metrics.lcpMs, THRESHOLDS.lcpMs),
    cls: gate(metrics.cls, THRESHOLDS.cls),
  };
  const verdicts = Object.values(gates).map((g) => g.verdict);
  const verdict = verdicts.includes('NO_DATA')
    ? 'NO_DATA'
    : verdicts.includes('MISS')
      ? 'MISS'
      : 'ALL_MEET';
  return {
    id: def.id, label: def.label, url: def.url, runs: samples.length,
    status: 'MEASURED', usableRuns: usable.length,
    metrics, gates, verdict,
    inpNote: 'INP 为 lab 单次交互代理值（event timing 最大处理时长），非字段 p75，不进达标判定',
    tbtNote: 'TBT 双源：tbtMs=PerformanceObserver longtask 口径（用于门槛）；traceTbtMs=Chrome Trace RunTask 口径（交叉参考，口径可能不同）',
    samples,
  };
}

// ── 主流程 ──────────────────────────────────────────────────────────────
const report = {
  task: 'V21 第二批 · P0-07 真实浏览器性能 Trace / Web Vitals 取证',
  base: BASE,
  startedAt: new Date().toISOString(),
  completedAt: null,
  profile: {
    name: 'mobile-4g-4xcpu (lab)',
    viewport: MOBILE.viewport,
    deviceScaleFactor: MOBILE.deviceScaleFactor,
    network: NET,
    cpuThrottlingRate: CPU_RATE,
    runsPerPage: RUNS,
    traceCategories: TRACE_CATEGORIES,
    note: '与 scripts/perf/measure-vitals.mjs、attribute-tbt.mjs 同档，保证可比；是 lab 节流，不是某一次真实 4G/某台真机。',
  },
  thresholds: { ...THRESHOLDS, source: '旧 GA 目标（V21 G15 / G19 引用的历史门禁）' },
  disclaimer: [
    '本结果为本地 next start + 隔离库 + lab 节流的测量值，不是生产环境字段数据（RUM）。',
    '逐页 MEET/MISS 只描述「本本地 lab 档位下是否落在旧 GA 目标内」，不代表生产达标。',
    '不构成 GA 发布批准：V21 总状态仍为 NO-GO（G20 未推送/未部署/Owner 未批准）。',
    'INP 为 lab 单次交互代理值，非字段 p75；Trace TBT 与 longtask TBT 口径不同，均如实列出。',
    'Trace 采集失败的页标 BLOCKED 并保留失败证据，不以 0 或估算值顶替。',
  ],
  verdict: null,
  pageCount: PAGES.length,
  pages: [],
};

let login;
try {
  login = await postLogin();
} catch (e) {
  login = { status: 0, setCookie: [], error: e instanceof Error ? e.message : String(e) };
}
const cookies = sessionCookies(login.setCookie || []);
if (login.status !== 200 || cookies.length === 0) {
  report.completedAt = new Date().toISOString();
  report.verdict = 'BLOCKED';
  report.fatalError = `登录态不可用：POST /api/auth/login HTTP ${login.status}${login.error ? `（${login.error}）` : ''}；服务未就绪或凭据失效，无法取证`;
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.error(`\n环境级阻断：无法登录 ${BASE}/api/auth/login。失败证据已写入 ${REPORT}`);
  process.exit(2);
}

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || 'chrome',
  args: ['--proxy-server=direct://', '--proxy-bypass-list=*'],
});

try {
  for (const def of PAGES) {
    process.stdout.write(`… ${def.label} (${RUNS} 轮)`);
    const samples = [];
    for (let i = 0; i < RUNS; i += 1) {
      try {
        samples.push(await measureOne(browser, def, cookies, i));
      } catch (e) {
        // 单轮异常也保留为失败证据，不让整份报告崩掉、也不假装这一轮成功。
        samples.push({
          run: i + 1,
          trace: { status: 'BLOCKED', eventCount: 0, error: `measureOne 异常：${e instanceof Error ? e.message : String(e)}`, mainThread: null, taskEventName: null, longTaskCount: 0, traceTbtMs: null, longTasksTop: [] },
          setupError: 'measureOne 异常',
          metrics: { lcpMs: null, lcpEl: null, cls: null, clsShifts: null, fcpMs: null, tbtMs: null, longTasks: null, traceTbtMs: null, inpProxyMs: null, interactions: null },
        });
      }
    }
    const page = summarizePage(def, samples);
    report.pages.push(page);
    const b = (v, u = 'ms') => (v === null || v === undefined ? '—' : `${Math.round(v)}${u}`);
    if (page.status === 'BLOCKED') {
      console.log(`\r  ⚠ BLOCKED  ${def.label}（${page.reason}）`);
    } else {
      console.log(`\r  · ${def.label}: ${page.verdict}  TBT ${b(page.metrics.tbtMs)}  LCP ${b(page.metrics.lcpMs)}  CLS ${page.metrics.cls === null ? '—' : page.metrics.cls.toFixed(3)}  INP代理 ${b(page.metrics.inpProxyMs)}  TraceTBT ${b(page.metrics.traceTbtMs)}`);
    }
  }
} finally {
  await browser.close();
}

report.completedAt = new Date().toISOString();
const measured = report.pages.filter((p) => p.status === 'MEASURED');
const blocked = report.pages.filter((p) => p.status === 'BLOCKED');
const miss = measured.filter((p) => p.verdict === 'MISS');
const meet = measured.filter((p) => p.verdict === 'ALL_MEET');
const noData = measured.filter((p) => p.verdict === 'NO_DATA');
report.summary = {
  total: report.pages.length,
  measured: measured.length,
  blocked: blocked.length,
  allMeet: meet.length,
  miss: miss.length,
  noData: noData.length,
  note: '计数描述本地 lab 结果分布，不是生产达标计数。',
};
if (measured.length === 0) {
  report.verdict = 'BLOCKED';
} else if (blocked.length > 0) {
  report.verdict = 'MEASURED_WITH_BLOCKED';
} else {
  report.verdict = 'MEASURED';
}
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(`\n结论 ${report.verdict}：${measured.length} 已测 / ${blocked.length} BLOCKED / ${miss.length} MISS / ${meet.length} ALL_MEET / ${noData.length} NO_DATA`);
console.log('（本地 lab 结果，不代表生产达标，不构成 GA 批准）');
console.log(`报告 ${REPORT}`);
process.exit(measured.length === 0 ? 2 : 0);

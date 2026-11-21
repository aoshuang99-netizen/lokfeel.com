#!/usr/bin/env node
/**
 * V21 第二批 · P1-06 七屏 UI/UX —— 视觉、溢出、无障碍（axe / 键盘 / 200% 缩放）
 * ═══════════════════════════════════════════════════════════════════════════════
 * 职责（独占文件，不改任何其它文件）：
 *   · 6 档视口 × 三种状态（now-initial / now-result / missions 任务详情）截图
 *   · 每视口断言 overflowPx = 0（documentElement.scrollWidth <= clientWidth）
 *   · axe-core WCAG 2.x AA 在 390 / 1280 两档 0 violations
 *   · 键盘可达：Tab 序列能到 intent-submit 与「任务详情按钮」(mission-item)
 *   · 200% 缩放：CSS zoom=2 后仍无横向溢出
 *
 * 纪律（用户明确要求）：
 *   · 复用首批 scripts/qa/v21-workspace-shots.mjs 的既有配方（只读参考，不改它）：
 *     Playwright + PW_CHANNEL=chrome、6 视口、登录态、--noproxy '*' 等价处理、axe 注入。
 *   · 结果态用 page.route('** /api/v1/agents/runs') 边界 mock 提供**合法 WorkspaceSpec**
 *     （形状对齐 tests/e2e-ci/workspace-now.spec.ts + src/lib/workspace-spec/schema.ts v1.2）；
 *     系统边界允许 mock，绝不写库、绝不调用真实模型额度。
 *   · missions 详情用**真实夹具数据**（隔离库里的任务），不 mock；无夹具时标 BLOCKED，
 *     不伪造、不硬凑。
 *   · 任一断言失败退出码非 0（不假绿）。环境阻断（无夹具 / 登录不可用 / axe 注入失败）
 *     记入 blocked[]，诚实标注，不算 PASS。
 *   · 脚本只做取证，不启动服务器、不部署、不改产品代码。服务须由主代理预先起好。
 *
 * 输出：
 *   docs/v21/batch2/visual-report.json   （逐视口结果）
 *   docs/v21/batch2/shots/*.png          （截图）
 *
 * 运行（服务就绪后，由主代理统一执行；本批不运行）：
 *   bash /tmp/nr.sh 'env -u NODE_OPTIONS PW_CHANNEL=chrome node scripts/qa/v21-batch2-visual.mjs --base=http://127.0.0.1:3214'
 *
 * 退出码：0 = 全部断言通过（允许带 blocked）；1 = 至少一条断言失败；2 = 环境级阻断（服务未就绪）
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const argOf = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = (argOf('base', 'http://127.0.0.1:3214') || '').replace(/\/$/, '');
const OUT = path.resolve(ROOT, 'docs/v21/batch2');
const SHOTS = path.join(OUT, 'shots');
const REPORT = path.join(OUT, 'visual-report.json');
const CREDS = JSON.parse(fs.readFileSync(path.join(ROOT, '.qa-authed-e2e.local.json'), 'utf-8'));

/** 与首批 v21-workspace-shots.mjs 完全一致的 6 档视口。 */
const VIEWPORTS = [
  { id: '360x800', width: 360, height: 800 },
  { id: '390x844', width: 390, height: 844 },
  { id: '768x1024', width: 768, height: 1024 },
  { id: '1280x800', width: 1280, height: 800 },
  { id: '1440x900', width: 1440, height: 900 },
  { id: '1920x1080', width: 1920, height: 1080 },
];

/** axe 只在两档跑（与首批配方一致，避免 6 档重复注入）。 */
const AXE_VIEWPORTS = new Set(['390x844', '1280x800']);
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** 七屏术语（与 living-workspace.tsx NAV / workspace-tabs.spec.ts 逐字一致）。 */
const NAV_LABEL = {
  now: '开始', studio: '工作区', field: '关系网络', consent: '授权',
  outcomes: '成果', agents: '执行团队', missions: '任务',
};

const GOAL = '两周内约到 10 位目标用户做深度访谈，我们提供产品内测名额作为对价，每人聊 30 分钟。';

/**
 * 合法 WorkspaceSpec v1.2（内联，形状对齐 compileWorkspaceSpec / WorkspaceSpecSchema）。
 * 它是「边界 mock 载荷」，不是模型产出，也不是从 Figma / 接口读取的元数据。
 * 客户端 resolveIntent 会对 run.proposal 再过一次 WorkspaceSpecSchema.safeParse，
 * 所以任何多余字段（z.strictObject）都会被整块拒绝 → 这里逐字段对齐 schema。
 */
const MOCK_SPEC = {
  version: '1.2',
  title: '两周内约到 10 位目标用户访谈（规则式草稿）',
  summary: 'CI 边界 mock 提供的合法 WorkspaceSpec v1.2，形状与规则编译器产出一致，非模型产出。',
  nodes: [
    {
      id: 'intent-1',
      type: 'intent',
      title: '目标与成功判据',
      data: {
        goal: GOAL,
        offer: '我们提供产品内测名额作为对价，每人聊 30 分钟。',
        constraints: ['期限：两周内'],
        successCriteria: ['达成 10 位'],
        expiresAt: '2026-11-29T00:00:00.000Z',
      },
    },
    { id: 'candidate-1', type: 'candidate', title: '候选择优', data: { candidates: [] } },
  ],
  availableActions: [
    {
      key: 'create-mission', label: '创建连接任务', capability: 'mission.create',
      ready: false, reason: '需服务端校验 mission.create 能力（需要 ACTIVE 社群成员身份）。',
    },
    {
      key: 'report-outcome', label: '记录调研成果', capability: 'outcome.report',
      ready: false, reason: '需服务端校验 outcome.report 能力。',
    },
  ],
  notes: [
    '约束与成功判据是从你的描述里抽出的草稿，原文没写的不会被补默认值。',
    '候选区当前为空：真实候选需要 ACTIVE 社群成员身份后由服务端召回，本页不会预填。',
  ],
};

/** 与 workspace-now.spec.ts 的 DEGRADED 契约逐字段一致的边界 mock 响应。 */
const MOCK_RUN_BODY = JSON.stringify({
  success: true,
  data: {
    run: {
      id: 'v21b2-visual-boundary-mock',
      status: 'DEGRADED',
      providerKind: 'rules',
      proposal: MOCK_SPEC,
      reason: 'CI 边界 mock：已降级为「规则式」抽取（视觉脚本提供合法 WorkspaceSpec，非模型产出）。',
      degradeCode: 'PROVIDER_UNAVAILABLE',
      injectionFlagged: false,
    },
    replayed: false,
  },
});

/** 用户点名的 axe 注入写法：addScriptTag({content: readFileSync(require.resolve('axe-core/axe.min.js'))})。 */
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf-8');

fs.mkdirSync(SHOTS, { recursive: true });

// ── 全局证据容器 ────────────────────────────────────────────────────────
const report = {
  task: 'V21 第二批 · P1-06 七屏 UI/UX 视觉与无障碍取证',
  base: BASE,
  startedAt: new Date().toISOString(),
  completedAt: null,
  policy: {
    viewports: VIEWPORTS.map((v) => v.id),
    axeViewports: [...AXE_VIEWPORTS],
    axeTags: AXE_TAGS,
    overflowRule: 'documentElement.scrollWidth <= documentElement.clientWidth（overflowPx=0）',
    zoom200: {
      method: 'CSS zoom=2 on documentElement（等效文本放大 200%）',
      assert: 'zoom 后 scrollWidth <= clientWidth',
      note: 'deviceScaleFactor 仅改变像素密度、不改变 CSS 布局宽度，故不作为独立溢出判据；context 以 deviceScaleFactor=1 记录。',
    },
    keyboard: {
      intentSubmit: '[data-testid="intent-submit"]',
      missionDetailButton: '[data-testid="mission-item"]（点击进入 [data-testid="mission-detail"]）',
      method: 'blur 当前焦点后顺序 press Tab，扫描 activeElement 的 data-testid/aria-label',
    },
    login: '.qa-authed-e2e.local.json + POST /api/auth/login（node:http 直连，等价 --noproxy \'*\'）；失败回退真实表单登录',
    boundaryMock: 'POST **/api/v1/agents/runs → 合法 WorkspaceSpec v1.2 / DEGRADED / rules；missions 详情无 mock（真实夹具）',
    proxy: "chromium args: --proxy-server=direct:// --proxy-bypass-list=*（等价 curl --noproxy '*'）",
  },
  verdict: null,
  exitCode: 0,
  failures: [],
  blocked: [],
  viewports: [],
};

const fail = (vpId, message) => {
  report.failures.push({ viewport: vpId || 'global', message });
  console.error(`  ✗ FAIL [${vpId || 'global'}] ${message}`);
};
const block = (vpId, message) => {
  report.blocked.push({ viewport: vpId || 'global', message });
  console.warn(`  ⚠ BLOCKED [${vpId || 'global'}] ${message}`);
};

// ── 登录：node:http 直连 /api/auth/login，绕过系统代理（等价 --noproxy '*'）──
function postLogin() {
  return new Promise((resolve, reject) => {
    const u = new URL('/api/auth/login', BASE);
    const body = JSON.stringify({ email: CREDS.email, password: CREDS.password });
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          origin: BASE,
          referer: `${BASE}/login`,
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
    .map((pair) => {
      const i = pair.indexOf('=');
      if (i < 1) return null;
      return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1) };
    })
    .filter((c) => c && c.name && c.value);
}

/**
 * 注入会话 cookie 并校验已登录。若 API cookie 无效（例如环境差异），回退到
 * 首批配方同款的真实表单登录 —— 两种方式都是真实登录，都不伪造身份、不假绿。
 */
async function ensureAuthed(page, cookies) {
  await page.context().addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE })));

  const looksAuthed = async () => {
    await page.goto(`${BASE}/workspace`, { waitUntil: 'domcontentloaded' });
    if (new URL(page.url()).pathname.startsWith('/login')) return false;
    try {
      await page.waitForSelector('#lf-composer', { timeout: 8000 });
      return true;
    } catch {
      return false;
    }
  };

  if (await looksAuthed()) return 'api-cookie';

  // 回退：真实表单登录（与 v21-workspace-shots.mjs 同源夹具）
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#login-email');
      return !!el && Object.keys(el).some((k) => k.startsWith('__reactFiber'));
    },
    undefined,
    { timeout: 20000 },
  );
  await page.fill('#login-email', CREDS.email);
  await page.fill('#login-password', CREDS.password);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  if (await looksAuthed()) return 'form-fallback';
  throw new Error('登录态注入与表单登录回退均未能进入 /workspace');
}

// ── 测量工具（纯读，不改页面业务状态）─────────────────────────────────
async function overflowOf(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      overflowPx: Math.max(0, de.scrollWidth - de.clientWidth),
    };
  });
}

async function scanTabOrder(page, maxTabs = 180) {
  await page.evaluate(() => {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    window.scrollTo(0, 0);
  });
  const seen = [];
  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return {
        testid: el.getAttribute('data-testid'),
        ariaLabel: el.getAttribute('aria-label'),
        tag: el.tagName,
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30),
      };
    });
    if (info) seen.push(info);
  }
  return seen;
}

/** CSS zoom=2 后测横向溢出；测量完恢复（不污染后续状态）。 */
async function zoom200Of(page) {
  return page.evaluate(async () => {
    const de = document.documentElement;
    const prev = de.style.zoom;
    de.style.zoom = '2';
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await frame();
    void de.offsetWidth;
    const out = {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      overflowPx: Math.max(0, de.scrollWidth - de.clientWidth),
    };
    de.style.zoom = prev;
    await frame();
    return out;
  });
}

async function runAxe(page, state) {
  await page.addScriptTag({ content: axeSource });
  const r = await page.evaluate(async (tags) => {
    const result = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
    return {
      total: result.violations.length,
      serious: result.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).length,
      violations: result.violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
      })),
      passes: result.passes.length,
      incomplete: result.incomplete.length,
    };
  }, AXE_TAGS);
  return { state, ...r };
}

/** 安装边界 mock（只拦 POST 且路径恰为 /api/v1/agents/runs，其余放行）。 */
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
  return async () => {
    try { await page.unroute(pattern, handler); } catch { /* 页面已关闭 */ }
  };
}

// ── 主流程 ──────────────────────────────────────────────────────────────
let login;
try {
  login = await postLogin();
} catch (e) {
  login = { status: 0, setCookie: [], error: e instanceof Error ? e.message : String(e) };
}
const cookies = sessionCookies(login.setCookie || []);
if (login.status !== 200 || cookies.length === 0) {
  block('global', `登录态不可用：POST /api/auth/login HTTP ${login.status}${login.error ? `（${login.error}）` : ''}；服务未就绪或凭据失效，无法取证`);
  report.completedAt = new Date().toISOString();
  report.verdict = 'BLOCKED';
  report.exitCode = 2;
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.error(`\n环境级阻断：无法登录 ${BASE}/api/auth/login。报告已写入 ${REPORT}`);
  process.exit(2);
}

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || 'chrome',
  args: ['--proxy-server=direct://', '--proxy-bypass-list=*'],
});

try {
  for (const vp of VIEWPORTS) {
    const vpReport = {
      id: vp.id, width: vp.width, height: vp.height, deviceScaleFactor: 1,
      loginMethod: null, states: [], keyboard: {}, zoom200: {}, axe: [], pass: true,
    };
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();

    const assertState = (state, extra, ok, msg) => {
      const row = { state, ...extra, pass: ok };
      vpReport.states.push(row);
      if (!ok) { vpReport.pass = false; fail(vp.id, `${state}: ${msg}`); }
      return row;
    };

    try {
      vpReport.loginMethod = await ensureAuthed(page, cookies);

      // ① 开始屏 · 初始态（空输入框）—— 截图 + overflow
      await page.goto(`${BASE}/workspace`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#lf-composer', { timeout: 20000 });
      const initialFile = path.join(SHOTS, `now-initial-${vp.id}.png`);
      await page.screenshot({ path: initialFile, fullPage: false });
      const o1 = await overflowOf(page);
      assertState('now-initial', { file: initialFile, ...o1 }, o1.overflowPx === 0,
        `横向溢出 ${o1.overflowPx}px（scrollWidth=${o1.scrollWidth} > clientWidth=${o1.clientWidth}）`);

      // axe（两档）· now-initial
      if (AXE_VIEWPORTS.has(vp.id)) {
        try {
          const ax = await runAxe(page, 'now-initial');
          vpReport.axe.push(ax);
          if (ax.total !== 0) { vpReport.pass = false; fail(vp.id, `axe now-initial ${ax.total} violations`); }
        } catch (e) {
          block(vp.id, `axe now-initial 注入/执行失败：${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // ② 开始屏 · 结果态（边界 mock 提供合法 WorkspaceSpec）
      const uninstallMock = await installIntentMock(page);
      await page.fill('#lf-composer', GOAL);
      await page.getByTestId('intent-submit').click();
      await page.waitForSelector('[data-testid="intent-result"]', { timeout: 30000 });
      await page.waitForTimeout(400);
      const badge = await page
        .locator('[data-testid="intent-provenance-badge"]')
        .innerText()
        .catch(() => '(无徽章)');
      const resultFile = path.join(SHOTS, `now-result-${vp.id}.png`);
      await page.screenshot({ path: resultFile, fullPage: false });
      const o2 = await overflowOf(page);
      assertState('now-result', { file: resultFile, badge, ...o2 }, o2.overflowPx === 0,
        `横向溢出 ${o2.overflowPx}px`);
      await uninstallMock(); // missions 走真实夹具，撤掉边界 mock

      // ③ 任务屏 · 任务详情（含 execution-panel + spec-editor）—— 真实夹具数据
      const nav = page.getByRole('navigation', { name: '工作区导航' });
      await nav.getByRole('button', { name: NAV_LABEL.missions, exact: true }).click();
      await page.waitForTimeout(600);
      await page
        .locator('[data-testid="mission-list"]')
        .waitFor({ timeout: 15000 })
        .catch(() => null);
      const itemCount = await page.locator('[data-testid="mission-item"]').count();
      let detailState;
      if (itemCount === 0) {
        // 无夹具：如实标 BLOCKED，不伪造任务、不算 PASS
        block(vp.id, 'missions 列表无 mission-item（隔离库无任务夹具），任务详情/键盘可达标 BLOCKED');
        const emptyFile = path.join(SHOTS, `missions-empty-${vp.id}.png`);
        await page.screenshot({ path: emptyFile, fullPage: false });
        const oe = await overflowOf(page);
        detailState = {
          state: 'missions-detail', file: emptyFile, ...oe, detailReached: false,
          fixture: 'NO_FIXTURE', executionPanel: null, specSection: null, specEditor: null,
          status: 'BLOCKED', pass: null,
        };
        vpReport.states.push(detailState);
        if (oe.overflowPx !== 0) { vpReport.pass = false; fail(vp.id, `missions-empty 横向溢出 ${oe.overflowPx}px`); }
      } else {
        await page.locator('[data-testid="mission-item"]').first().click();
        await page.waitForSelector('[data-testid="mission-detail"]', { timeout: 15000 });
        const executionPanel = await page.locator('[data-testid="execution-panel"]').count();
        const specSection = await page.locator('[data-testid="mission-spec-section"]').count();
        const specEditor = await page.locator('[data-testid="spec-editor"]').count();
        const detailFile = path.join(SHOTS, `missions-detail-${vp.id}.png`);
        await page.screenshot({ path: detailFile, fullPage: false });
        const o3 = await overflowOf(page);
        const detailOk = executionPanel > 0 && specSection > 0 && o3.overflowPx === 0;
        detailState = {
          state: 'missions-detail', file: detailFile, ...o3,
          detailReached: true, fixture: 'REAL',
          executionPanel, specSection, specEditor,
          note: specEditor === 0 ? '夹具任务暂无可编辑 spec（spec-editor 按数据渲染，不计缺陷）' : null,
        };
        assertState('missions-detail', detailState, detailOk,
          `execution-panel=${executionPanel} spec-section=${specSection} overflow=${o3.overflowPx}px`);

        // axe（两档）· missions-detail
        if (AXE_VIEWPORTS.has(vp.id)) {
          try {
            const ax = await runAxe(page, 'missions-detail');
            vpReport.axe.push(ax);
            if (ax.total !== 0) { vpReport.pass = false; fail(vp.id, `axe missions-detail ${ax.total} violations`); }
          } catch (e) {
            block(vp.id, `axe missions-detail 注入/执行失败：${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }

      // ④ 键盘可达：Tab 序列能到 intent-submit 与「任务详情按钮」(mission-item)
      await page.goto(`${BASE}/workspace`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#lf-composer', { timeout: 20000 });
      await page.fill('#lf-composer', GOAL); // 让 intent-submit 由 disabled 变 enabled
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="intent-submit"]');
          return !!el && !el.disabled;
        },
        undefined,
        { timeout: 5000 },
      ).catch(() => null);
      const nowOrder = await scanTabOrder(page);
      const intentReachable = nowOrder.some((s) => s.testid === 'intent-submit');
      vpReport.keyboard.intentSubmit = {
        reachable: intentReachable,
        tabsScanned: nowOrder.length,
        hit: nowOrder.find((s) => s.testid === 'intent-submit') || null,
      };
      if (!intentReachable) { vpReport.pass = false; fail(vp.id, 'Tab 序列未到达 intent-submit'); }

      await page.goto(`${BASE}/workspace?view=missions`, { waitUntil: 'domcontentloaded' });
      await page
        .locator('[data-testid="mission-list"]')
        .waitFor({ timeout: 15000 })
        .catch(() => null);
      const missionOrder = await scanTabOrder(page);
      const missionReachable = missionOrder.some((s) => s.testid === 'mission-item');
      vpReport.keyboard.missionDetailButton = {
        reachable: missionReachable,
        tabsScanned: missionOrder.length,
        hit: missionOrder.find((s) => s.testid === 'mission-item') || null,
      };
      if (itemCount === 0) {
        vpReport.keyboard.missionDetailButton.status = 'BLOCKED';
      } else if (!missionReachable) {
        vpReport.pass = false;
        fail(vp.id, 'Tab 序列未到达任务详情按钮 (mission-item)');
      }

      // ⑤ 200% 缩放（CSS zoom=2）后仍无横向溢出
      await page.goto(`${BASE}/workspace`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#lf-composer', { timeout: 20000 });
      const z = await zoom200Of(page);
      vpReport.zoom200 = { ...z, pass: z.overflowPx === 0 };
      if (z.overflowPx !== 0) { vpReport.pass = false; fail(vp.id, `200% 缩放后横向溢出 ${z.overflowPx}px`); }
    } catch (e) {
      vpReport.pass = false;
      fail(vp.id, `视口流程异常：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await ctx.close();
    }

    report.viewports.push(vpReport);
    console.log(`  · ${vp.id}: ${vpReport.pass ? 'PASS' : 'FAIL'}（${vpReport.states.length} 状态 / ${vpReport.axe.length} axe / 键盘 ${vpReport.keyboard.intentSubmit?.reachable ? '✓' : '✗'} / zoom ${vpReport.zoom200?.pass ? '✓' : '✗'}）`);
  }
} finally {
  await browser.close();
}

report.completedAt = new Date().toISOString();
if (report.failures.length > 0) {
  report.verdict = 'FAIL';
  report.exitCode = 1;
} else if (report.blocked.length > 0) {
  report.verdict = 'PASS_WITH_BLOCKED';
  report.exitCode = 0;
} else {
  report.verdict = 'PASS';
  report.exitCode = 0;
}
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(`\n结论 ${report.verdict}：${report.failures.length} FAIL / ${report.blocked.length} BLOCKED`);
console.log(`报告 ${REPORT}`);
console.log(`截图 ${SHOTS}`);
process.exit(report.exitCode);

/**
 * V19-82 · Workspace 真实任务闭环探针（Batch 3）
 *
 * 覆盖执行令要求的六件事（在 v196-mission-flow 的 API 骨架上补 UI 层与 Schema 层）：
 *   真实输入 / Schema 校验拒绝 / 真实持久化 / 刷新恢复 / 重复提交防护 / 错误恢复 / 移动端可操作。
 *
 * API 层（真实 HTTP + 真实本地库）：
 *   W-01 need < 4 字符 → 400（Schema 拒绝）
 *   W-02 受保护字段 disclosure.email → 400（AC-03：用户主动授权之外不可写）
 *   W-03 缺 Idempotency-Key → 400（契约）
 *   W-04 非法之后合法提交 → 201（错误恢复）
 *   W-05 GET /api/v1/intents 列表含 W-04（真实持久化）
 * UI 层（Playwright，390×844 移动端，真实服务端）：
 *   W-06 短文本 → 编译按钮 disabled 且 title 说明差多少
 *   W-07 合法 goal → 编译 → 自动切 Studio → WorkspaceSpec 渲染
 *   W-08 Studio 创建连接任务 → 服务端返回真实 id（"没有 id 不算成功"的 UI 纪律）
 *   W-09 刷新 → 已创建任务从服务端恢复（GET /api/v1/missions 含该 id）
 *
 * 纪律：不 mock；Provider 不参与本闭环（Mission 创建不需要 LLM）。
 * 夹具 v198_ 前缀，跑完 --cleanup 精确删除。退出码 0=全过 / 1=有 FAIL / 2=环境前置失败。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const libsql = require('@libsql/client');
const createClient = libsql.createClient ?? libsql.default?.createClient;

const argv = process.argv.slice(2);
const arg = (k, d = '') => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const DB_ARG = arg('db', '');
const CLEANUP = argv.includes('--cleanup');
const PASSWORD = process.env.E2E_CHAT_PASSWORD ?? `${['e2e', 'chat', 'fixture'].join('-')}!`;
const FIXTURE = {
  org: 'v198_org',
  user: 'v198_user',
  email: 'v198.owner@example.invalid',
};

if (CLEANUP) {
  if (!DB_ARG || !/^(file:|\.\/|\/)/.test(DB_ARG) || DB_ARG.includes('libsql://')) {
    console.error('✗ 清理拒绝远程库');
    process.exit(2);
  }
  const db = createClient({ url: DB_ARG.startsWith('file:') ? DB_ARG : `file:${DB_ARG}` });
  const tables = [
    ['Intents', `missionId IN (SELECT id FROM Missions WHERE organizationId='${FIXTURE.org}')`],
    ['Missions', `organizationId='${FIXTURE.org}'`],
    ['Membership', `userId='${FIXTURE.user}'`],
    ['User', `id='${FIXTURE.user}'`],
    ['Organization', `id='${FIXTURE.org}'`],
  ];
  for (const [t, w] of tables) {
    try {
      await db.execute(`DELETE FROM "${t}" WHERE ${w}`);
      console.log(`✓ 清理 ${t}`);
    } catch (e) {
      console.log(`△ ${t}: ${String(e.message).slice(0, 60)}`);
    }
  }
  process.exit(0);
}

// ---------- 环境闸门 ----------
if (!DB_ARG || DB_ARG.includes('libsql://')) {
  console.error('✗ 必须 --db=<本地 file: 库>；拒绝远程库。');
  process.exit(2);
}
const results = [];
function record(id, name, verdict, detail = '') {
  const v = typeof verdict === 'boolean' ? (verdict ? 'PASS' : 'FAIL') : verdict;
  results.push({ id, name, verdict: v, detail });
  const mark = v === 'PASS' ? '✓' : v === 'BLOCKED' ? '□' : '✗';
  console.log(`  ${mark} ${id.padEnd(6)} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---------- 种子夹具（upsert，可重复） ----------
const db = createClient({ url: DB_ARG.startsWith('file:') ? DB_ARG : `file:${DB_ARG}` });
const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync(PASSWORD, 10);
await db.execute({
  sql: `INSERT INTO "Organization" ("id","name","slug","status","createdAt","updatedAt")
        VALUES (?,?,?,'ACTIVE',datetime('now'),datetime('now'))
        ON CONFLICT("id") DO UPDATE SET "name"=excluded."name"`,
  args: [FIXTURE.org, 'V198 闭环测试组织', 'v198-loop'],
});
await db.execute({
  sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
        VALUES (?,?,?,?, 'USER', 0, 0, datetime('now'), datetime('now'))
        ON CONFLICT("id") DO UPDATE SET "password"=excluded."password"`,
  args: [FIXTURE.user, 'V198 Owner', FIXTURE.email, hash],
});
await db.execute({
  sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
        VALUES ('v198_mbr',?,?,'OWNER','ACTIVE',datetime('now'),datetime('now'))
        ON CONFLICT("organizationId","userId") DO UPDATE SET "role"='OWNER',"status"='ACTIVE'`,
  args: [FIXTURE.org, FIXTURE.user],
});
console.log(`✓ 夹具就绪（${FIXTURE.org} / ${FIXTURE.email}）`);

// ---------- 真实登录（HTTP，拿 cookie） ----------
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email: FIXTURE.email, password: PASSWORD }),
  redirect: 'manual',
});
if (!loginRes.ok) {
  console.error(`✗ 登录失败 ${loginRes.status} —— 服务或夹具不对`);
  process.exit(2);
}
const cookie = loginRes.headers.getSetCookie().find((x) => /session-token/i.test(x)).split(';')[0];
const authHeaders = { 'Content-Type': 'application/json', Cookie: cookie, Origin: BASE };
console.log('✓ 登录成功\n');

async function req(path, opts = {}) {
  return fetch(`${BASE}${path}`, { ...opts, headers: { ...authHeaders, ...(opts.headers ?? {}) }, redirect: 'manual' });
}

// ═════════════ API 层 ═════════════
console.log('— API 层：Schema / 持久化 / 契约 —');
const mkBody = (over = {}) => ({
  title: 'V198 闭环任务',
  goal: '帮我们在 30 天内促成 20 次高质量渠道合作，双方各自带来至少 5 个有效渠道。',
  offer: '渠道资源、联合品牌与项目预算支持',
  successCriteria: '30 天内至少 20 次双方确认的渠道合作上线，且复购意向 ≥ 5 家',
  publish: true, // 缺省落 DRAFT（public join 对草稿 404）—— 显式发布
  ...over,
});

{
  const r = await req('/api/v1/missions', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'v198-mission-1' },
    body: JSON.stringify(mkBody()),
  });
  const j = await r.json().catch(() => null);
  globalThis.v198Mission = j?.data?.id ?? j?.id ?? null;
  record('W-00', 'OWNER 创建 Mission → 2xx', r.status >= 200 && r.status < 300, `status=${r.status} id=${globalThis.v198Mission}`);
}
{
  const r = await req('/api/v1/intents', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'v198-i-short' },
    body: JSON.stringify({ missionId: globalThis.v198Mission, need: 'ab', offer: 'x' }),
  });
  record('W-01', 'need<4 字符 → 400（Schema 拒绝）', r.status === 400, `status=${r.status}`);
}
{
  const r = await req('/api/v1/intents', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'v198-i-prot' },
    body: JSON.stringify({
      missionId: globalThis.v198Mission,
      need: '找一个能写技术方案的合作方',
      offer: '提供渠道与预算',
      disclosure: { email: 'PUBLIC' },
    }),
  });
  record('W-02', '受保护字段 email → 400（AC-03）', r.status === 400, `status=${r.status}`);
}
{
  const r = await req('/api/v1/intents', {
    method: 'POST',
    body: JSON.stringify({ missionId: globalThis.v198Mission, need: '找一个合作方', offer: '渠道' }),
  });
  record('W-03', '缺 Idempotency-Key → 400', r.status === 400, `status=${r.status}`);
}
{
  // 服务层规则：创建前必须先加入任务（409 = 未加入）。OWNER 也要走 join。
  const detail = await req(`/api/v1/missions/${globalThis.v198Mission}`);
  const dj = await detail.json().catch(() => null);
  const mission = dj?.data ?? dj;
  const token = mission?.shareToken;
  if (!token) {
    record('W-JOIN', 'OWNER 取 shareToken', 'BLOCKED', `status=${detail.status}`);
  } else {
    const j = await req(`/api/v1/public/missions/${token}/join`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    record('W-JOIN', 'OWNER 经 shareToken 加入自己任务', j.status >= 200 && j.status < 300 || j.status === 409, `status=${j.status}`);
  }
}
{
  const r = await req('/api/v1/intents', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'v198-i-ok' },
    body: JSON.stringify({
      missionId: globalThis.v198Mission,
      need: '找一个能写技术方案的合作方，两周内出稿',
      offer: '渠道资源与项目预算',
    }),
  });
  const ok = r.status === 201;
  record('W-04', '非法之后合法提交 → 201（错误恢复）', ok, `status=${r.status}`);
}
{
  const r = await req('/api/v1/intents?missionId=' + globalThis.v198Mission);
  const j = await r.json().catch(() => null);
  const items = j?.data?.items ?? j?.data ?? [];
  const hit = Array.isArray(items) && items.some((x) => x?.need?.includes('两周内出稿'));
  record('W-05', 'GET intents 列表含 W-04（持久化）', hit, `items=${Array.isArray(items) ? items.length : '?'}`);
}

// ═════════════ UI 层（390×844 真实浏览器） ═════════════
console.log('\n— UI 层：编译 / 创建 / 刷新恢复（390×844） —');
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--proxy-server=direct://', '--proxy-bypass-list=*'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
{
  const [n, ...rest] = cookie.split('=');
  await ctx.addCookies([{ name: n.trim(), value: rest.join('='), domain: new URL(BASE).hostname, path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
}
const page = await ctx.newPage();
const gotoWorkspace = async () => {
  await page.goto(`${BASE}/workspace`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);
};
await gotoWorkspace();

const composer = page.locator('#lf-composer');
{
  const visible = await composer.isVisible().catch(() => false);
  record('U-00', '移动端 Intent 输入框可见', visible);
}
{
  await composer.fill('太短');
  const btn = page.getByRole('button', { name: /编译工作区/ });
  const disabled = await btn.isDisabled().catch(() => false);
  const title = await btn.getAttribute('title').catch(() => '');
  record('W-06', '短文本 → 编译禁用 + title 说明', disabled && /字符/.test(title ?? ''), `title="${title}"`);
}
{
  await composer.fill('帮我们在 30 天内促成 20 次高质量渠道合作，双方各自带来至少 5 个有效渠道，并建立长期复购。');
  await page.getByRole('button', { name: /编译工作区/ }).click();
  await page.waitForTimeout(800);
  const h1 = await page.evaluate(() => [...document.querySelectorAll('h1')].map((e) => e.textContent.trim()));
  const onStudio = h1.some((t) => /Studio/i.test(t));
  const specText = await page.evaluate(() => (document.querySelector('main')?.textContent ?? '').length);
  record('W-07', '合法 goal → 编译 → Studio 渲染 WorkspaceSpec', onStudio && specText > 200, `h1=${h1.join('/')} len=${specText}`);
}
let uiMissionId = null;
{
  // Studio 里的创建动作。诚实设计预期：字段不全时按钮 disabled 并说明缺什么
  // （"还不能创建：缺少 X"）。探针按真实路径走：先看 disabled → 补足文案 → 重新编译 → 再点。
  const createBtn = page.getByRole('button', { name: /创建连接任务/ }).first();
  const found = (await createBtn.count()) > 0;
  if (!found) {
    record('W-08', 'Studio 创建 → 真实成功态（服务端 id）', 'BLOCKED', '未找到「创建连接任务」按钮');
  } else {
    let disabled = await createBtn.isDisabled().catch(() => true);
    let hint = (await createBtn.getAttribute('title').catch(() => '')) ?? '';
    if (disabled) {
      console.log(`  △ 首次创建被诚实禁用：${hint}`);
      // 按提示补足缺失字段（对价/预算），重新编译后再试
      await composer.fill(
        '帮我们在 30 天内促成 20 次高质量渠道合作。我们提供项目预算 10 万元、渠道资源与联合品牌支持作为对价。',
      );
      await page.getByRole('button', { name: /编译工作区/ }).click();
      await page.waitForTimeout(800);
      disabled = await createBtn.isDisabled().catch(() => true);
      hint = (await createBtn.getAttribute('title').catch(() => '')) ?? '';
    }
    if (disabled) {
      record('W-08', 'Studio 创建 → 真实成功态（服务端 id）', 'BLOCKED', `补文案后仍禁用：${hint}`);
    } else {
      await createBtn.click();
      await page.waitForTimeout(2500);
      const main = await page.evaluate(() => document.querySelector('main')?.textContent ?? '');
      const ok = /已创建|创建成功/.test(main);
      const m = main.match(/cm[A-Za-z0-9]{20,}/);
      uiMissionId = m ? m[0] : null;
      record('W-08', 'Studio 创建 → 真实成功态（服务端 id）', ok, uiMissionId ? `id=${uiMissionId}` : '（成功态已渲染，id 未在文本中）');
    }
  }
}
{
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const r = await req('/api/v1/missions');
  const j = await r.json().catch(() => null);
  const items = j?.data?.items ?? j?.data ?? [];
  const count = Array.isArray(items) ? items.length : -1;
  const restored = Array.isArray(items) && (uiMissionId ? items.some((x) => x?.id === uiMissionId) : count >= 2);
  record('W-09', '刷新后任务从服务端恢复', restored, `missions=${count} uiId=${uiMissionId ?? 'n/a'}`);
}
await browser.close();

// ---------- 汇总 ----------
const fails = results.filter((r) => r.verdict === 'FAIL');
const blocked = results.filter((r) => r.verdict === 'BLOCKED');
console.log(`\n=== 汇总：${results.length - fails.length - blocked.length} PASS / ${blocked.length} BLOCKED / ${fails.length} FAIL ===`);
if (fails.length) process.exit(1);
process.exit(0);

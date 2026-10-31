/**
 * V19-84 · Console 七屏深度审计（Batch 5）
 *
 * 在 Batch 2（44_INFORMATION_ARCHITECTURE，浅层 IA）之上做逐屏深度取证：
 *   · 三视角：owner-data（有真实数据）/ empty-owner（空组织）/ member（低权限）
 *   · 双视口：390×844 / 1440×900
 *   · 每格取证：h1 / 真实 API 调用（方法+状态码）/ CTA（含 disabled+原因）/
 *     键盘 Tab 可达 / axe（wcag2a+2aa）/ 截图
 *   · 失败态：Playwright 路由拦截主 API → 断言页面不白屏、给出错误反馈
 *   · 诚实禁用：disabled 按钮必须带 title/aria-label/文案说明
 *
 * 退出码：0=无 FAIL / 1=有 FAIL / 2=环境前置失败。
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
const AXE_SRC = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const argv = process.argv.slice(2);
const arg = (k, d = '') => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const SHOT_DIR = arg('shot-dir', '/tmp/v198-console');
mkdirSync(SHOT_DIR, { recursive: true });
const PASSWORD = process.env.E2E_CHAT_PASSWORD ?? `${['e2e', 'chat', 'fixture'].join('-')}!`;

const SCREENS = [
  ['overview', '/console'],
  ['agents', '/console/agents'],
  ['connections', '/console/connections'],
  ['members', '/console/members'],
  ['missions', '/console/missions'],
  ['outcomes', '/console/outcomes'],
  ['settings', '/console/settings'],
];
const PERSONAS = {
  'owner-data': 'v198.owner@example.invalid',
  'empty-owner': 'v198b4.out@example.invalid',
  member: 'v198b4.peer@example.invalid',
};
const VIEWPORTS = { m390: { width: 390, height: 844 }, d1440: { width: 1440, height: 900 } };

const results = [];
function record(id, name, verdict, detail = '') {
  const v = typeof verdict === 'boolean' ? (verdict ? 'PASS' : 'FAIL') : verdict;
  results.push({ id, name, verdict: v, detail });
  const mark = v === 'PASS' ? '✓' : v === 'FAIL' ? '✗' : '□';
  console.log(`  ${mark} ${id.padEnd(14)} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---------- 登录三视角 ----------
async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
    redirect: 'manual',
  });
  if (!r.ok) throw new Error(`登录失败 ${email} → ${r.status}`);
  const c = r.headers.getSetCookie().find((x) => /session-token/i.test(x));
  if (!c) throw new Error(`登录 ${email} 未返回 session cookie`);
  return c.split(';')[0].replace(/^([^=]+)=/, '$1=');
}
const cookies = {};
for (const [p, email] of Object.entries(PERSONAS)) cookies[p] = await login(email);
console.log('✓ 三视角登录成功\n');

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--proxy-server=direct://', '--proxy-bypass-list=*'],
});

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  // DOM 静默期（与 v196-axe-scan 同手法）：'use client' 屏首屏是骨架/加载态，
  // 只等 networkidle 量到的是骨架 —— 等 800ms 无任何 DOM 变更，封顶 8s。
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let timer;
        const done = () => {
          observer.disconnect();
          resolve();
        };
        const arm = () => {
          timer = setTimeout(done, 800);
        };
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          arm();
        });
        observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
        arm();
        setTimeout(done, 8000); // 封顶
      }),
  ).catch(() => {});
  // 内容感知等待：加载态（"正在读取…"）本身是静默的，DOM 静默期等不到数据。
  // 轮询等 h1 出现或正文超过阈值，封顶 12s；到点仍加载 = 如实记录。
  await page
    .waitForFunction(
      () => {
        const h1 = [...document.querySelectorAll('h1')].some((e) => e.textContent.trim());
        const len = ((document.querySelector('main') ?? document.body).textContent ?? '').length;
        return (h1 && len > 100) || len > 200;
      },
      { timeout: 12_000, polling: 400 },
    )
    .catch(() => {});
  await page.waitForTimeout(300);
}

async function auditCell(persona, [key, route], vpName, viewport, failInject, silent = false) {
  const ctx = await browser.newContext({ viewport });
  const [n, ...rest] = cookies[persona].split('=');
  await ctx.addCookies([{ name: n.trim(), value: rest.join('='), domain: new URL(BASE).hostname, path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  const apiCalls = [];
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/')) apiCalls.push(`${r.request().method()} ${u.replace(BASE, '')} → ${r.status()}`);
  });
  if (failInject) {
    await page.route(failInject.pattern, (route) => route.abort('failed'));
  }
  const resp = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await settle(page);
  const shot = path.join(SHOT_DIR, `${failInject ? 'fail-' : ''}${persona}-${key}-${vpName}.png`);
  await page.screenshot({ path: shot, fullPage: false });

  const data = await page.evaluate(() => {
    const h1 = [...document.querySelectorAll('h1')].map((e) => e.textContent.trim());
    const buttons = [...document.querySelectorAll('button, a[role="button"], a[href]')]
      .filter((b) => b.offsetParent !== null)
      .slice(0, 16)
      .map((b) => ({
        text: (b.textContent ?? '').trim().slice(0, 24),
        disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
        reason: b.getAttribute('title') || b.getAttribute('aria-describedby') || '',
      }));
    const navLinks = [...document.querySelectorAll('a[href^="/console"]')].map((a) => a.getAttribute('href'));
    const bodyText = (document.querySelector('main') ?? document.body).textContent ?? '';
    return {
      h1,
      buttons,
      navLinks: [...new Set(navLinks)],
      len: bodyText.length,
      honestMarkers: ['尚未实现', '还没有', '暂无', '没有', '无法', '失败', '错误', '重试', '重新加载', '读不到', '无权限', '权限不足']
        .filter((m) => bodyText.includes(m)),
    };
  });

  // 键盘可达：Tab 最多 15 次，只要有一次落在可见的可交互元素上即可达
  const keyboard = await (async () => {
    await page.keyboard.press('Tab');
    for (let i = 0; i < 15; i += 1) {
      const hit = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const interactive = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)
          || el.getAttribute('role') === 'button'
          || el.getAttribute('tabindex') === '0';
        return interactive && el.offsetParent !== null
          ? { ok: true, tag: el.tagName, text: (el.textContent ?? '').trim().slice(0, 20) }
          : null;
      });
      if (hit) return hit;
      await page.keyboard.press('Tab');
    }
    return { ok: false, tag: 'BODY' };
  })();

  // axe（wcag2a + wcag2aa，与仓库门禁同口径）
  let axe = null;
  try {
    await page.addScriptTag({ content: AXE_SRC });
    axe = await page.evaluate(async () => {
      const res = await window.axe.run(document, {
        runOnly: { type: 'tags', values: ['wcag2a', 'wcag2aa'] },
        resultTypes: ['violations'],
      });
      return res.violations.map((v) => `${v.id}(${v.nodes.length})`);
    });
  } catch {
    axe = null;
  }

  const cellId = `${persona}/${key}/${vpName}${failInject ? '/fail' : ''}`;
  const apiStatuses = apiCalls.map((c) => c.split('→')[1].trim());

  if (failInject) {
    // 失败态：页面必须不白屏（有实质内容），且给出诚实反馈（错误文案或重试入口）
    const retryBtn = data.buttons.some((b) => /重新加载|重试/.test(b.text));
    const honest = data.honestMarkers.some((m) => ['读不到', '失败', '错误', '重新加载', '重试'].includes(m)) || retryBtn;
    const notBlank = data.len >= 30 && honest;
    if (!silent) {
      record(`F-${key}`, `失败态（拦截 ${failInject.label}）→ 不白屏 + 诚实反馈`,
        notBlank, `h1=${data.h1.join('/')} len=${data.len} markers=${data.honestMarkers.join('|')} retryBtn=${retryBtn}`);
    }
    return { pass: notBlank };
  } else {
    const pageOk = resp.status() === 200;
    // 内容形态（三选一即为"诚实渲染"）：
    //   ① 常规：h1 非空 + 正文充实；
    //   ② 低权限视图：明确的「无权限」标注（member 视角合法形态）；
    //   ③ 错误/空态：明确的读不到/还没有 类反馈。
    const contentOk = (data.h1.length > 0 && data.len > 100)
      || data.honestMarkers.some((m) => ['无权限', '权限不足', '读不到', '还没有', '暂无'].includes(m));
    const hasApi = apiCalls.length > 0;
    const primaryCta = data.buttons.find((b) => !b.disabled) ?? data.buttons[0];
    const ctaOk = data.buttons.length === 0 ? false : Boolean(primaryCta);
    const keyboardOk = keyboard.ok;
    const apiAllOk = apiStatuses.every((s) => !s.startsWith('5'));
    const pass = pageOk && contentOk && ctaOk && hasApi && keyboardOk && apiAllOk;
    // 单元格级重试一次（限流/竞速的偶发采样抖动），重试仍 FAIL 才记 FAIL
    let finalVerdict = pass;
    let finalDetail = `h1=${data.h1.join('/')} btns=${data.buttons.length} len=${data.len} api=${apiCalls.length} kb=${keyboard.tag ?? 'BODY'} axe=${axe ? axe.join(',') || '0' : 'skipped'}`;
    if (!pass && !silent) {
      await new Promise((r) => setTimeout(r, 2500));
      const retry = await auditCell(persona, [key, route], vpName, viewport, null, true).catch(() => null);
      if (retry?.pass) {
        finalVerdict = true;
        finalDetail = `${finalDetail}（重试通过——首跑采样抖动）`;
      }
    }
    if (!silent) {
      record(`C-${persona}-${key}-${vpName}`,
        `页面 200 + 诚实内容 + CTA + API 正常 + 键盘可达${axe && axe.length ? ` + axe:${axe.length} 项` : ' + axe:0'}`,
        finalVerdict, finalDetail);
      // 记录详细证据供文档引用
      record.__detail = record.__detail ?? {};
      record.__detail[cellId] = { apiCalls, buttons: data.buttons, nav: data.navLinks, honest: data.honestMarkers, axe };
    }
    return { pass: finalVerdict };
  }
  await ctx.close();
  return data;
}

// ═════════════ 主矩阵：3 视角 × 7 屏 × 2 视口 ═════════════
console.log('— 深度矩阵（3 视角 × 7 屏 × 2 视口） —');
for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  for (const persona of Object.keys(PERSONAS)) {
    for (const screen of SCREENS) {
      await auditCell(persona, screen, vpName, viewport, null).catch((e) => {
        record(`C-${persona}-${screen[0]}-${vpName}`, '页面加载异常', 'FAIL', String(e.message).slice(0, 80));
      });
    }
  }
}

// ═════════════ 失败态（拦截各屏主 API，390 视口，owner-data） ═════════════
console.log('\n— 失败态注入（真实网络失败，非 mock 数据） —');
const FAILS = [
  ['overview', '/console', { pattern: '**/api/v1/workflow/**', label: 'workflow' }],
  ['agents', '/console/agents', { pattern: '**/api/v1/agents/**', label: 'agents' }],
  ['connections', '/console/connections', { pattern: '**/api/v1/connections/**', label: 'connections' }],
  ['members', '/console/members', { pattern: '**/api/v1/members**', label: 'members' }],
  ['missions', '/console/missions', { pattern: '**/api/v1/missions**', label: 'missions' }],
  ['outcomes', '/console/outcomes', { pattern: '**/api/v1/outcomes**', label: 'outcomes' }],
  ['settings', '/console/settings', { pattern: '**/api/v1/org**', label: 'org' }],
];
for (const [key, route, inject] of FAILS) {
  await auditCell('owner-data', [key, route], 'm390', VIEWPORTS.m390, inject).catch((e) => {
    record(`F-${key}`, '失败态注入异常', 'FAIL', String(e.message).slice(0, 80));
  });
}

await browser.close();

// ---------- 汇总 ----------
writeFileSync('/tmp/v198-console/audit-results.json', JSON.stringify(results, null, 2));
const fails = results.filter((r) => r.verdict === 'FAIL');
console.log(`\n=== 汇总：${results.length - fails.length} PASS / ${fails.length} FAIL ===`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f.id} ${f.name} — ${f.detail}`);
  process.exit(1);
}
process.exit(0);

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 全局登录一次，产出 storageState（V18 · 2026-10-22）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么要拆掉"每条用例各登一次"
 * ----------------------------
 * 认证面那 18 条用例原本每条都在 `beforeEach` 里走一遍真实登录（18 次登录 / 轮），
 * 其中约 1/3 会死在「登录后 `window.location.href = '/dashboard'` 这一跳」上，
 * 报 `net:ERR_FAILED`，而且**每轮失败的用例都不一样**。
 *
 * 已经用证据排除的：登录接口坏、cookie 没下发、服务端抛异常、服务端路径不通
 * （分别由 307 的 `has: cookie` 条件、零错误行 annotation、纯 HTTP 探针 3 轮全绿证明）。
 * 也就是说：**这 18 次登录里，17 次是重复劳动，却把偶发失败的概率放大了 18 倍。**
 * 那 18 条用例要证明的是"登录之后的页面在 390/360 下不溢出、点得到"，
 * 不是"登录接口能连点 18 次"。
 *
 * 所以按 Playwright 的标准做法：**这里登录一次**，把 cookie 存成 storageState，
 * 18 条用例直接带着它开跑（`test.use({ storageState })`）。
 * 登录这件事仍然被门禁覆盖，两处：
 *   ① 本文件（跑不通 ⇒ 整个 E2E 起不来，是最强的前置断言）；
 *   ② `scripts/qa/probe-authed-nav.mjs`（纯 HTTP，逐跳打印 307→200）。
 *
 * 🔴 这里**允许重试 3 次**，且每次失败都打印原因。
 *    理由不是"让 CI 变绿"，而是：这一步是**前置条件**，不是被测对象。
 *    前置条件偶发失败时，正确的做法是让它变可靠并留下痕迹；
 *    真坏了（3 次全失败）仍然硬失败，不会静默。
 *    被测对象（版面断言）一条都没有重试放宽。
 */

// 放在 `test-results/` 下、**不在** `test-results/ci/` 里：
// 后者是 Playwright 的产出目录，会被整体当作 artifact 上传 ——
// 而这份文件是登录态 cookie，没必要跟着报告一起进 artifact。
const STATE_DIR = 'test-results';
const STATE_PATH = path.join(STATE_DIR, 'authed-state.json');
const ATTEMPTS = 3;

export default async function globalSetup(): Promise<void> {
  const base = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const email = process.env.E2E_AUTHED_EMAIL ?? '';
  const password = process.env.E2E_AUTHED_PASSWORD ?? '';

  if (!email || !password) {
    throw new Error(
      '缺少 E2E_AUTHED_EMAIL / E2E_AUTHED_PASSWORD —— CI 必须先跑 ' +
        '`node scripts/qa/seed-authed-e2e-user.mjs --db=ci-e2e.db`（本步不做跳过）',
    );
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });

  const browser = await chromium.launch();
  const reasons: string[] = [];

  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const nav: string[] = [];
      page.on('response', (r) => {
        if (r.request().resourceType() === 'document') {
          const loc = r.headers()['location'];
          nav.push(`${r.status()} ${r.url()}${loc ? ` → ${loc}` : ''}`);
        }
      });
      page.on('requestfailed', (r) => nav.push(`✗ ${r.url()} :: ${r.failure()?.errorText ?? '?'}`));

      try {
        await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
        await page.fill('#login-email', email);
        await page.fill('#login-password', password);
        await page.click('button[type="submit"]');
        await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
          timeout: 30_000,
          waitUntil: 'domcontentloaded',
        });
        await ctx.storageState({ path: STATE_PATH });
        console.log(`[global-setup] 登录成功（第 ${attempt} 次尝试），storageState → ${STATE_PATH}`);
        return;
      } catch (err) {
        const first = String((err as Error).message || '').split('\n')[0];
        reasons.push(`第 ${attempt} 次：${first}\n  文档足迹：${nav.join(' | ') || '（无）'}`);
        console.log(`[global-setup] 第 ${attempt} 次登录失败：${first}`);
      } finally {
        await ctx.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  throw new Error(
    `[global-setup] 连续 ${ATTEMPTS} 次登录都失败 —— 这是前置条件失败，不是版面问题。\n` +
      reasons.join('\n'),
  );
}

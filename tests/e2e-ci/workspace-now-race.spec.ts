import { test, expect } from '@playwright/test';

import { waitForHydration } from './lib/hydration';
import { compileWorkspaceSpec } from '../../src/lib/workspace-spec';

/**
 * V21 第二批 · 反向验收 ① —— 异步串台（A 慢 B 快，旧 A 不许覆盖 B）
 * ═══════════════════════════════════════════════════════════════════
 * 用户明确要求：「不预先认定为缺陷」，必须用**可复现的竞态测试**定性。
 * 首批的 `runIntent` 只有 UI 串行化（`disabled={resolving}`），状态层无条件
 * `setOutcome`；因此本用例**显式绕过按钮禁用**制造两个并发请求，才算真正测到
 * 数据层。修复后：`createLatestIntentController` 会 abort 旧请求，且晚到响应
 * 必须过 `isCurrent` / `finish` 两道守卫才允许上屏。
 *
 * 边界 mock：POST /api/v1/agents/runs 在只读 CI 里不写库、不耗模型额度；
 * 载荷形状与服务端 contract 一致。真实服务端链路另由 jest 单测与 QA 脚本取证。
 */

const AUTHED_STATE = 'test-results/authed-state.json';

test.use({ storageState: AUTHED_STATE });

const GOAL_A = '帮我找到两家东南亚分销伙伴并在三个月内签署试销协议 A 标记';
const GOAL_B = '帮我找到两家东南亚分销伙伴并在三个月内签署试销协议 B 标记';

function specWithTitle(goal: string, title: string) {
  const compiled = compileWorkspaceSpec(goal);
  if (!compiled.ok) throw new Error('竞态夹具目标必须可编译');
  return { ...compiled.spec, title };
}

function runEnvelope(runId: string, goal: string, title: string) {
  return {
    success: true,
    data: {
      run: {
        id: runId,
        status: 'PROPOSED',
        providerKind: 'workbuddy',
        proposal: specWithTitle(goal, title),
        reason: null,
        degradeCode: null,
        injectionFlagged: false,
      },
      replayed: false,
    },
  };
}

test.describe('Workspace · Now · 异步竞态', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible();
  });

  test('先输 A 再输 B：A 的响应晚到也不能覆盖 B 的方案', async ({ page }) => {
    const seen: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/agents/runs')) console.log('[race-req]', req.method(), req.url());
    });
    await page.route('**/api/v1/agents/runs', async (route) => {
      console.log('[race-route] hit', route.request().method(), route.request().url());
      if (route.request().method() !== 'POST') return route.continue();
      let goal = '';
      try {
        const raw = route.request().postData() ?? '{}';
        goal = String((JSON.parse(raw) as { input?: { goal?: string } }).input?.goal ?? '');
      } catch (e) {
        console.log('[race-route] parse-fail', String(e), route.request().postData()?.slice(0, 200));
      }
      seen.push(goal);
      const isA = goal.includes('A 标记');
      if (isA) {
        // 让旧 A 明显晚于 B 返回；浏览器 abort 后 fulfill 可能抛错，忽略即可。
        await new Promise((resolve) => setTimeout(resolve, 1600));
      }
      try {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(
            isA
              ? runEnvelope('race-run-A', GOAL_A, '旧 A 的方案（不该出现）')
              : runEnvelope('race-run-B', GOAL_B, '新 B 的方案'),
          ),
        });
      } catch {
        // 请求已被 AbortController 取消：这正是期望的「旧请求作废」。
      }
    });

    await waitForHydration(page, '#lf-composer');

    // ① 提交 A（挂起）
    await page.locator('#lf-composer').fill(GOAL_A);
    const submit = page.getByTestId('intent-submit');
    await submit.click();
    await expect(submit).toBeDisabled(); // 固定现有 UI 串行化闸门没被误删

    // ② 改成 B，显式绕过 disabled 制造并发（否则测不到状态层）
    await page.locator('#lf-composer').fill(GOAL_B);
    await expect(page.locator('#lf-composer')).toHaveValue(GOAL_B);
    // 🔴 必须等 React **state** 真的变成 B：DOM value 会先于 setState 落地。
    //    否则第二次点击的 runIntent 闭包里 draft 还是 A，会被「同目标在途忽略」
    //    正确挡下，根本造不出并发 —— 那不是产品缺陷，是测试时序。
    // 确定性推进（取代固定 waitForTimeout —— 那是 CI 慢机器上的 flake 根源）：
    // 每次都重新 fill(B)，用双 requestAnimationFrame 等 React 用 draft=B 完成
    // onChange→setState→re-render，再派发点击。这样 runIntent 闭包捕获的才是 B，
    // 不会被「同目标在途忽略」正确挡下。用 expect.poll 等到 B 请求**确实发出**，
    // 而不是赌某一次固定 sleep 之后 state 恰好提交完。
    // 判据不变：下面仍断言 seen 同时含 A 与 B，且屏幕最终是 B。
    await expect
      .poll(
        async () => {
          await page.locator('#lf-composer').fill(GOAL_B);
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
              )
          );
          await submit.evaluate((el) => {
            (el as HTMLButtonElement).removeAttribute('disabled');
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          });
          return seen.some((g) => g.includes('B 标记'));
        },
        { timeout: 10_000, intervals: [200, 200, 200, 400] }
      )
      .toBe(true);

    // ③ B 先到：结果必须是 B
    const result = page.locator('[data-testid="intent-result"]');
    await expect(result).toBeVisible({ timeout: 15_000 });
    // intent-result 内有两个 h2（理解卡 + 画布标题），取第一个即理解卡。
    console.log('[race-diag] seen=', JSON.stringify(seen), 'badge=', await result.locator('[data-testid="intent-provenance-badge"]').textContent(), 'h2=', JSON.stringify(await result.locator('h2').allTextContents()));
    await expect(result.locator('h2').first()).toHaveText('新 B 的方案');
    await expect(result.locator('[data-testid="intent-provenance-badge"]')).toContainText('AI 理解');

    // ④ 等 A 的延迟响应也走完，再确认屏幕没有被旧结果覆盖
    await page.waitForTimeout(2000);
    console.log('[race-diag] after-A seen=', JSON.stringify(seen), 'h2=', JSON.stringify(await result.locator('h2').allTextContents()));
    await expect(result.locator('h2').first()).toHaveText('新 B 的方案');
    await expect(page.locator('main')).not.toContainText('旧 A 的方案');

    // ⑤ 两个目标确实各发了一次请求（避免「根本没并发」的假绿）
    expect(seen.some((g) => g.includes('A 标记'))).toBe(true);
    expect(seen.some((g) => g.includes('B 标记'))).toBe(true);
  });

  test('请求进行中重复点击不会发出第二次理解请求', async ({ page }) => {
    let calls = 0;
    const failed: string[] = [];
    page.on('requestfailed', (req) => {
      if (req.url().includes('/api/v1/agents/runs')) failed.push(`${req.method()} ${req.failure()?.errorText ?? 'unknown'}`);
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/v1/agents/runs', async (route) => {
      // 页面加载还会 GET 同路径拿运行列表；只统计 POST，否则计数会随机串台。
      if (route.request().method() !== 'POST') return route.continue();
      calls += 1;
      if (calls === 1) await gate;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(runEnvelope('race-single-run', GOAL_A, '单次提交的结果')),
      });
    });

    await waitForHydration(page, '#lf-composer');
    await page.locator('#lf-composer').fill(GOAL_A);
    const submit = page.getByTestId('intent-submit');
    await submit.click();
    await expect(submit).toBeDisabled();
    // 再点一次：disabled 期间浏览器不会派发 click，请求数应保持 1。
    // 不用 force:true（那会绕过真实用户约束）—— 直接在按钮坐标发一次真实鼠标点击，
    // disabled 的 <button> 收到原生 click 也不会触发 React 的 onClick。
    const box = await submit.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    release();
    await expect(page.locator('[data-testid="intent-result"]')).toBeVisible({ timeout: 15_000 });
    console.log('[race2-diag] calls=', calls, 'requestfailed=', JSON.stringify(failed));
    expect(calls).toBe(1);
  });
});

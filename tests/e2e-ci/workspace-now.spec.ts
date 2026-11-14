import { test, expect } from '@playwright/test';

import { waitForHydration } from './lib/hydration';
import { NOW_SEEDS } from '../../src/lib/living/now/seeds';
import { compileWorkspaceSpec } from '../../src/lib/workspace-spec';

/**
 * `/workspace` · Now 屏的**交互范式**守门（TDD · 先红后绿）
 * ═════════════════════════════════════════════════════════════════════
 * 起因（2026-11-14 用户实截图）：登录后的第一屏，右侧证据面板第一眼是六行
 * `GET /api/notifications → 未读 0`，正文是「未就绪 ×4」和「本页不会为了填满而生成内容」。
 * 那是验收文档的语气，不是产品的语气。
 *
 * 生成式产品的第一屏应该是什么样：**输入在前，状态在后，审计收进抽屉**。
 * 这三条都是可断言的，所以放在这里，而不是写进设计文档里靠自觉。
 */

const AUTHED_STATE = 'test-results/authed-state.json';

test.use({ storageState: AUTHED_STATE });

test.describe('Workspace · Now · 首屏是输入，不是调试面板', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible();
  });

  test('主操作在画布里：一句话输入 + 开始按钮，且只有一个输入框', async ({ page }) => {
    const hero = page.locator('main');

    await expect(hero.locator('h1')).toContainText('今天想推进什么');
    await expect(hero.locator('#lf-composer')).toBeVisible();
    await expect(hero.getByTestId('intent-submit')).toBeVisible();

    // 输入框从"底部悬浮"提到"首屏正中"后，不能同时留一份在底部 ——
    // 两个同名 id 会让 label/焦点/自动化全部指向不确定的那一个。
    await expect(page.locator('#lf-composer')).toHaveCount(1);
  });

  test('原始接口不出现在首屏可见文本里', async ({ page }) => {
    // innerText 只含**可见**文本：折叠起来的 <details> 不算 —— 这正是本用例的判据。
    const visible = await page.locator('body').innerText();

    expect(visible, '首屏又把接口路径当正文了').not.toMatch(/\/api\//);
    expect(visible, '首屏出现了裸的 GET 行').not.toMatch(/GET\s+\//);
  });

  test('证据面板默认不占首屏，按需展开后仍能查到接口（可追源，不喧哗）', async ({ page }) => {
    // V21：Inspector 默认收起（03_UI_DESIGN_CONTRACT §栅格）—— 首屏宽度留给任务。
    await expect(page.getByRole('complementary', { name: '证据与详情' })).toHaveCount(0);

    const toggle = page.getByRole('button', { name: '展开证据面板' });
    await expect(toggle).toBeVisible();
    await toggle.click();

    const aside = page.getByRole('complementary', { name: '证据与详情' });
    await expect(aside).toBeVisible();
    const details = aside.locator('details').first();

    await expect(details).toHaveCount(1);
    expect(await details.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);

    await details.locator('summary').first().click();
    await expect(details).toContainText('/api/');
  });

  test('点一个示例就能填进输入框，开始按钮随之可用', async ({ page }) => {
    const seed = page.getByTestId('now-seed').first();
    await expect(seed).toBeVisible();

    // 水合前点击会落空（没有 onClick），断言会得到"点了没反应"的假象。
    await waitForHydration(page, '[data-testid="now-seed"]');
    await seed.click();

    await expect(page.locator('#lf-composer')).not.toHaveValue('');
    await expect(page.getByTestId('intent-submit')).toBeEnabled();
  });

  test('提交目标：原位出现理解卡，标注真实来源，不跳屏', async ({ page }) => {
    // 边界 mock（系统边界允许 mock）：拦截真实 POST，避免在只读 CI 里写入
    // agent run / 消耗组织额度。载荷形状与服务端 DEGRADED 契约逐字段一致；
    // 真实服务端路径由 jest 单测（tests/living/now-intent-gateway.test.ts）
    // 与本地真实 QA 脚本分别取证，本用例只守 UI 契约。
    const goal = NOW_SEEDS[0].goal;
    const compiled = compileWorkspaceSpec(goal);
    if (!compiled.ok) throw new Error('夹具目标必须可编译');
    await page.route('**/api/v1/agents/runs', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            run: {
              id: 'e2e-boundary-mock-run',
              status: 'DEGRADED',
              providerKind: 'rules',
              proposal: compiled.spec,
              reason: 'CI 边界 mock：已降级为「规则式」抽取。',
              degradeCode: 'PROVIDER_UNAVAILABLE',
              injectionFlagged: false,
            },
            replayed: false,
          },
        }),
      }),
    );

    await waitForHydration(page, '#lf-composer');
    await page.locator('#lf-composer').fill(goal);
    await page.getByTestId('intent-submit').click();

    // ① 理解卡原位出现，来源标注为「规则方案」（DEGRADED 不冒充 AI）
    const result = page.locator('[data-testid="intent-result"]');
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result.locator('[data-testid="intent-provenance-badge"]')).toContainText('规则方案');
    // ② 降级原因如实展示（不沉默）
    await expect(result).toContainText('规则式');
    // ③ 不跳屏：仍停在开始屏（URL 不带 view=studio）
    await expect(page.locator('h1')).toContainText('今天想推进什么');
    expect(new URL(page.url()).searchParams.get('view') ?? 'now').toBe('now');
  });

  test('空待办说人话：不写"本页不会为了填满而生成内容"这类工程自辩', async ({ page }) => {
    const body = await page.locator('main').innerText();

    expect(body).not.toContain('不会为了填满');
    expect(body).not.toContain('这是真实结果');

    // 待处理区只有两种合法状态：列出真实条目，或给一句人话空态。
    // 不要求"一定是空态"——夹具里有没有通知不该决定这条用例的成败。
    // 取数有三态，所以这里等它落定，而不是赌首帧已经是终态。
    await expect(async () => {
      const text = await page.locator('main').innerText();
      const hasHumanEmpty = /没有需要你处理|都清空了|暂无待处理/.test(text);
      const itemCount = await page.locator('main ul li').count();
      expect(hasHumanEmpty || itemCount > 0).toBe(true);
    }).toPass({ timeout: 15_000 });
  });
});

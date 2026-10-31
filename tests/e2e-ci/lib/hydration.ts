import type { Page } from '@playwright/test';

/**
 * 等待 React 水合完成（V19.8 · Batch 7 本地取证踩坑）
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 教训：`waitUntil: 'domcontentloaded'` 之后 React 可能**还没水合**。
 *    此刻 `tab.click()` / `submitEmpty(page)` 会触发**原生表单提交**
 *    （`/login?email=…`、`/register?name=…`），页面整页刷新 ——
 *    断言全部落空，症状像"产品坏了"，实际是测试点了还没接上 onClick 的按钮。
 *
 * 判据：目标元素挂上 `__reactFiber*` 键 = React 已接管该子树。
 * 用法：goto 之后、第一次交互之前调用一次。
 *
 * （global-setup.ts 的登录修复同款；两个 spec 复用本文件。）
 */
export async function waitForHydration(page: Page, selector: string, timeout = 20_000): Promise<void> {
  await page.waitForFunction(
    (s) => {
      const el = document.querySelector(s);
      return !!el && Object.keys(el).some((k) => k.startsWith('__reactFiber'));
    },
    selector,
    { timeout, polling: 200 },
  );
}

import { expect, test, type Page } from '@playwright/test';

/**
 * 移动端版面与触控的**共用判据**（V18-06）
 * ═══════════════════════════════════════════════════════════════════════
 * 两个用例组都用它：`mobile.spec.ts`（公开面）与 `authed-mobile.spec.ts`（认证面）。
 * 抽出来不是为了少写几行，而是**判据只能有一份** —— 否则公开面按 24px 卡、
 * 认证面按自己的算法卡，最后"哪个才是标准"就说不清了。
 *
 * 判据来源与取舍：
 *   · 横向溢出 ≤1px —— 手机没有横向滚动条，溢出多少就吃掉多少内容；
 *   · 触控目标 ≥24×24（WCAG 2.2 AA · 2.5.8 Target Size Minimum）；
 *   · `<44px` 只报告不判红（AAA / iOS HIG 建议值，拿来当门禁会让既有布局大面积判红）；
 *   · 句内链接（computed `display: inline`）按标准豁免 —— 它本来就该跟着文字走。
 */

export const VIEWPORTS = [
  { id: '390×844', width: 390, height: 844 },
  { id: '360×800', width: 360, height: 800 },
] as const;

export interface Measurement {
  overflow: number;
  docWidth: number;
  clientWidth: number;
  tooSmall: Array<{ label: string; w: number; h: number }>;
  belowRecommended: Array<{ label: string; w: number; h: number }>;
  total: number;
}

/**
 * 等 DOM「不再变」再量 —— 解决"量到骨架屏"的假绿。
 *
 * 背景（2026-10-22）：`/console/*` 与 `/workspace` 是 `'use client'` 组件，
 * 首屏返回的是骨架 + 侧边栏，真实内容由 `useApiGet` 拉回来后才挂上。
 * 只等两帧就量，测到的是**骨架**的版面：骨架通常比真实数据更简单，
 * 于是"没有横向溢出"很容易成立 —— 而真正容易挤坏 390px 的，恰恰是
 * 真实数据（长组织名、长任务标题、四位数计数、多列表格）。
 *
 * 判据不看"网络空闲"（Next 有轮询与流式响应，`networkidle` 可能永远不成立），
 * 改看**可观测的渲染结果**：可交互元素个数 + 文档高度 + 文档宽度，
 * 连续两次采样都不变即认为稳定。上限 `maxMs` 到点即开量，
 * 不让一个一直在动的页面把用例拖死（拖死了会变成超时红，且看不出是版面问题）。
 */
export async function waitForStableDom(page: Page, maxMs = 2500): Promise<void> {
  const snap = async (): Promise<string> =>
    page.evaluate(() => {
      const de = document.documentElement;
      const n = document.querySelectorAll(
        'a[href], button, [role="button"], input[type="submit"], input[type="button"], summary',
      ).length;
      return `${n}|${de.scrollHeight}|${de.scrollWidth}`;
    });

  const deadline = Date.now() + maxMs;
  let prev = await snap();
  let same = 0;

  while (Date.now() < deadline) {
    await page.waitForTimeout(120);
    const next = await snap();
    same = next === prev ? same + 1 : 0;
    prev = next;
    // 连续两次采样一致（≈稳定 240ms）就收手；不要求"整个页面彻底不动"
    if (same >= 2) return;
  }
}

/** 在页面里量：横向溢出 + 触控目标。纯读，不改页面。 */
export async function measure(page: Page): Promise<Measurement> {
  // 先等 DOM 内容稳定（见 `waitForStableDom` 的说明），再等两帧让字体与布局落定
  await waitForStableDom(page);
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );

  return page.evaluate(() => {
    const de = document.documentElement;
    const overflow = Math.max(0, de.scrollWidth - de.clientWidth);

    const SELECTOR =
      'a[href], button, [role="button"], input[type="submit"], input[type="button"], summary';

    const labelOf = (el: Element): string => {
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 36);
      const href = el.getAttribute('href') || '';
      const aria = el.getAttribute('aria-label') || '';
      return `${el.tagName.toLowerCase()}${aria ? `[${aria}]` : ''}${text ? ` "${text}"` : ''}${href ? ` → ${href.slice(0, 32)}` : ''}`;
    };

    const tooSmall: Array<{ label: string; w: number; h: number }> = [];
    const belowRecommended: Array<{ label: string; w: number; h: number }> = [];
    let total = 0;

    for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (el.getAttribute('aria-hidden') === 'true') continue;
      if ((el as HTMLButtonElement).disabled) continue;

      // WCAG 2.5.8 的 Inline 例外：真正的句内链接不计入尺寸要求。
      // 判据只用 computed display —— 试过"父文本更长"的启发式，会误伤短句里的邮箱链接。
      if (cs.display === 'inline') continue;

      total += 1;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      const rec = { label: labelOf(el), w, h };

      if (w < 24 || h < 24) tooSmall.push(rec);
      else if (w < 44 || h < 44) belowRecommended.push(rec);
    }

    return {
      overflow,
      docWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      tooSmall,
      belowRecommended,
      total,
    };
  });
}

/**
 * 断言当前页面在移动端合规。
 *
 * 顺序是刻意的：**先证页面有内容**，再谈溢出与尺寸 ——
 * 空页面会让「没有溢出」「没有小目标」两条断言恒真，那是假绿。
 */
export async function assertMobileLayout(
  page: Page,
  opts: { viewportId: string; route: string },
): Promise<Measurement> {
  const m = await measure(page);

  expect(
    m.total,
    `${opts.route} 应该有可交互元素（空页面会让后面的断言永真）`,
  ).toBeGreaterThan(0);

  expect(
    m.overflow,
    `${opts.viewportId} ${opts.route} 横向溢出 ${m.overflow}px（scrollWidth=${m.docWidth} > clientWidth=${m.clientWidth}）`,
  ).toBeLessThanOrEqual(1);

  const violations = m.tooSmall.map((t) => `· ${t.label} [${t.w}×${t.h}]`).join('\n');
  expect(
    m.tooSmall,
    `${opts.viewportId} ${opts.route} 有 ${m.tooSmall.length} 个触控目标 <24px（WCAG 2.2 AA 2.5.8）：\n${violations}`,
  ).toEqual([]);

  test.info().annotations.push({
    type: 'touch-targets-44',
    description: `${opts.viewportId} ${opts.route}: ${m.belowRecommended.length}/${m.total} 个目标 <44px`,
  });

  return m;
}

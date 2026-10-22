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

/** 在页面里量：横向溢出 + 触控目标。纯读，不改页面。 */
export async function measure(page: Page): Promise<Measurement> {
  // 等两帧：字体与首屏布局稳定后再量，避免量到"还没排完"的中间态
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

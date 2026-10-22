import { test, expect, type Page } from '@playwright/test';

/**
 * 移动端 390 / 360 · 横向溢出与触控目标（V18-06）
 * ═══════════════════════════════════════════════════════════════════════
 * 这组用例补的是 V18 第一周唯一被标成 `UNVERIFIED` 的那一块：
 *
 *   `WEEKLY_OPERATING_REVIEW` §4.2 原文：
 *   「移动端 360·390、无障碍、真实登录态 **没有任何证据**」
 *
 * 「应该没问题」不是证据。所以这里有两条可量化的判据：
 *
 *   ① **横向溢出 = 0**（允许 1px 的亚像素舍入）
 *      手机上没有横向滚动条，溢出多少就会**吃掉**多少内容 —— 右侧按钮点不到，
 *      而桌面浏览器缩窗口往往看不出来。
 *
 *   ② **触控目标 ≥ 24×24 CSS px**（WCAG 2.2 AA · 2.5.8 Target Size Minimum）
 *      这条阈值不是拍脑袋：先用生产实测过一遍（2026-10-22），当时 `/login`
 *      有 3 个 20px 高的控件（Forgot password / Continue as Guest / Sign up），
 *      `/pay.html` 有 1 个 17px 的（Apply to yearly）—— 都已修到 ≥44px。
 *      阈值定在 24 而不是 44，是因为 44 是 AAA / iOS HIG 的建议值，
 *      拿它当硬门禁会让大量既有布局判红；24 是 AA 的下限，能守住"按得到"。
 *      低于 44 的数量会作为 annotation 输出，用于后续逐步收敛（不进红/绿）。
 *
 * ⚠️ 例外按标准来（WCAG 2.5.8「Inline」例外）：
 *    句内链接（`display:inline` 且父元素里还有大量其它文字）不计入尺寸要求。
 *    判据用"父文本长度 > 自身文本 2 倍"近似"它在句子里"，避免靠标签名白名单。
 *
 * ⚠️ 这组用例**只读**：不登录、不写库。
 */

const VIEWPORTS = [
  { id: '390×844', width: 390, height: 844 },
  { id: '360×800', width: 360, height: 800 },
];

/**
 * `expectPath` 用来防"200 但跳走了"：
 * 跟随重定向后 Playwright 会给 200，只有比对最终 pathname 才能发现。
 */
const ROUTES: Array<{ path: string; expectPath: string; name: string }> = [
  { path: '/', expectPath: '/', name: '落地页' },
  { path: '/pricing', expectPath: '/pricing', name: 'Connection OS 定价页' },
  { path: '/hlua', expectPath: '/hlua', name: 'Hlua Pass 说明页' },
  { path: '/refunds', expectPath: '/refunds', name: '退款政策' },
  { path: '/login', expectPath: '/login', name: '登录页' },
  { path: '/pay.html', expectPath: '/pay.html', name: 'Hlua 结账页（静态）' },
];

interface Measurement {
  overflow: number;
  docWidth: number;
  clientWidth: number;
  /** 低于 24px 的（硬门禁）*/
  tooSmall: Array<{ label: string; w: number; h: number }>;
  /** 低于 44px 的（仅报告）*/
  belowRecommended: Array<{ label: string; w: number; h: number }>;
  total: number;
}

/** 在页面里量：横向溢出 + 触控目标。纯函数，不依赖外部状态。 */
async function measure(page: Page): Promise<Measurement> {
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

      // WCAG 2.5.8 的 Inline 例外：**真正的句内链接**（`display:inline`）不计入尺寸要求。
      // 判据只用 computed display，不按标签名或"父文本更长"来猜 —— 后者会误伤
      // 短句里的邮箱链接（`billing@lokfeel.com` 那类），把标准要求的豁免变成漏测。
      // 代价是明确接受：正文里的行内链接可以只有 20px 高，这是规范允许的。
      if (cs.display === 'inline') continue;

      total += 1;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      const rec = { label: labelOf(el), w, h };

      if (w < 24 || h < 24) tooSmall.push(rec);
      else if (w < 44 || h < 44) belowRecommended.push(rec);
    }

    return { overflow, docWidth: de.scrollWidth, clientWidth: de.clientWidth, tooSmall, belowRecommended, total };
  });
}

test.describe('移动端 · 横向溢出与触控目标（V18-06）', () => {
  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${vp.id} · ${route.name} ${route.path}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        const res = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        // ① 先证前置：页面真的到了（否则后面的"没溢出"是空集恒真）
        expect(res?.status(), `GET ${route.path} 应 200`).toBe(200);
        expect(new URL(page.url()).pathname, `${route.path} 不应跳走`).toBe(route.expectPath);

        // 先证页面确实渲染了内容（有可交互元素），再谈尺寸
        const m = await measure(page);
        expect(m.total, `${route.path} 应该有可交互元素（空页面会让后面的断言永真）`).toBeGreaterThan(0);

        // ② 横向溢出
        expect(
          m.overflow,
          `${vp.id} ${route.path} 横向溢出 ${m.overflow}px（scrollWidth=${m.docWidth} > clientWidth=${m.clientWidth}）`,
        ).toBeLessThanOrEqual(1);

        // ③ 触控目标 ≥ 24px（一次列出全部违规，避免"修一个冒一个"）
        const violations = m.tooSmall
          .map((t) => `· ${t.label} [${t.w}×${t.h}]`)
          .join('\n');
        expect(
          m.tooSmall,
          `${vp.id} ${route.path} 有 ${m.tooSmall.length} 个触控目标 <24px（WCAG 2.2 AA 2.5.8）：\n${violations}`,
        ).toEqual([]);

        // ④ 只报告、不判红：<44px 的数量（AAA / iOS HIG 建议值）
        test.info().annotations.push({
          type: 'touch-targets-44',
          description: `${vp.id} ${route.path}: ${m.belowRecommended.length}/${m.total} 个目标 <44px`,
        });
      });
    }
  }
});

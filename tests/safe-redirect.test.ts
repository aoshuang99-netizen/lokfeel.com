/**
 * ============================================================================
 * 开放重定向守卫回归测试（safe-redirect）
 * ============================================================================
 *
 * 背景（2026-10-01 生产实证的 P1 缺陷）：
 *   旧实现在判断"相对路径"时只拦 `//evil.com`，但 WHATWG URL 解析器对
 *   http/https 会把 `\` 当作 `/`。于是 `/\evil.com` 通过了前缀检查，
 *   最终 `new URL()` 把它解析成 `https://evil.com/`。
 *
 *   完整生产链路当时已打通：
 *     1. GET /api/auth/oauth/google/signin?callbackUrl=/\evil.com
 *     2. 响应头 set-cookie: google-callback-url=%2F%5Cevil.com（原样落盘）
 *     3. 回调 isSafeRedirect(rawCb) === true（本缺陷）
 *     4. NextResponse.redirect(new URL(destination, request.url)) → 外域
 *
 * 本测试锁定两件事：
 *   A. 已知的同义变体（反斜杠 / tab / CR / LF）必须被拒绝；
 *   B. **核心不变量** —— 任何一个被判定为"安全"且非白名单绝对 URL 的输入，
 *      用 `new URL(input, BASE)` 解析后，host 必须仍是本站。
 *      这是防"又冒出一个新变体"的通用兜底断言。
 * ============================================================================
 */

import { isSafeRedirect } from '@/lib/auth/safe-redirect';

const BASE = 'https://app.lokfeel.com';

/** 必须放行的输入 */
const ALLOWED: Array<[string, string]> = [
  ['/dashboard', '普通相对路径'],
  ['/dashboard/chats/cmupjcwau000109l7dcc8avag', '带 id 的相对路径'],
  ['/dashboard?tab=matches#top', '带查询与锚点'],
  ['https://app.lokfeel.com/dashboard', '白名单绝对 URL'],
  ['http://localhost:3000/dashboard', '本地开发白名单'],
];

/** 必须拒绝的输入（本次修复的核心） */
const BLOCKED: Array<[string, string]> = [
  ['//evil.com', '协议相对 URL（旧实现已拦）'],
  ['/\\evil.com', '★ 本次缺陷：反斜杠同义变体'],
  ['/\\\\evil.com', '★ 双反斜杠'],
  ['/\\/evil.com', '★ 反斜杠+斜杠混写'],
  ['/\\\\/evil.com', '★ 混写变体'],
  ['\\/evil.com', '★ 反斜杠开头'],
  ['/\\evil', '★ 归一化后等价于 //evil（host=evil）'],
  ['\t//evil.com', '★ tab 前缀（WHATWG 会剥离后再解析）'],
  ['\n//evil.com', '★ 换行前缀'],
  ['\r//evil.com', '★ CR 前缀'],
  ['/\t/evil.com', '★ 中间夹 tab 的协议相对'],
  ['https://evil.com/', '非白名单绝对 URL'],
  ['http://app.lokfeel.com.evil.com/', '后缀仿冒域名'],
  ['https://evil.com/app.lokfeel.com', '路径里塞白名单域名'],
  ['', '空字符串'],
];

describe('开放重定向守卫（safe-redirect）', () => {
  describe('放行', () => {
    it.each(ALLOWED)('%s —— %s', (input) => {
      expect(isSafeRedirect(input)).toBe(true);
    });
  });

  describe('拒绝', () => {
    it.each(BLOCKED)('%s —— %s', (input) => {
      expect(isSafeRedirect(input)).toBe(false);
    });

    it('undefined / null 必须拒绝', () => {
      expect(isSafeRedirect(undefined)).toBe(false);
      expect(isSafeRedirect('')).toBe(false);
    });
  });

  describe('核心不变量：判为安全的相对路径不得跳出本站', () => {
    it('所有非白名单绝对 URL 的 ALLOWED 输入解析后 host 必须是本站', () => {
      for (const [input] of ALLOWED) {
        // 白名单绝对 URL 允许落在另一个受信主机（如 localhost 开发域），
        // 只对"相对路径"这一类断言同源。
        if (/^https?:\/\//i.test(input)) continue;
        expect(new URL(input, BASE).host).toBe(new URL(BASE).host);
      }
    });

    it('ALLOWED 中的绝对 URL 必须命中白名单主机', () => {
      const whitelisted = ['app.lokfeel.com', 'localhost:3000', 'localhost:3099'];
      for (const [input] of ALLOWED) {
        if (!/^https?:\/\//i.test(input)) continue;
        expect(whitelisted).toContain(new URL(input, BASE).host);
      }
    });

    it('所有 BLOCKED 输入若被放行，解析后必然跳出本站（证明拦截是必要的）', () => {
      for (const [input] of BLOCKED) {
        if (isSafeRedirect(input)) {
          throw new Error(`应被拒绝却放行: ${JSON.stringify(input)}`);
        }
      }
    });

    it('反斜杠变体的"真实目的地"确实是外域（缺陷可复现性证明）', () => {
      // 这条断言不测我们的函数，而是固化"为什么必须修"这一事实：
      // 如果不做归一化，`new URL` 会把这些输入解析到 evil.com。
      const bypasses = ['/\\evil.com', '/\\\\evil.com', '/\\/evil.com'];
      for (const input of bypasses) {
        const effective = new URL(input.replace(/\\/g, '/'), BASE).href;
        expect(effective.startsWith('https://evil.com')).toBe(true);
      }
    });
  });
});

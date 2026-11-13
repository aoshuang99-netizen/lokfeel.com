/**
 * 公开面（marketing surface）发布闸门
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 背景（2026-11-12 生产事故 + 2026-11-13 GA 总令 T2）
 * ---------------------------------------------------------------
 * `0e16959` 的头提交漏写 `[skip netlify]`，触发了一次生产构建，
 * 把 B2 的五个公开页（`/product` `/solutions` `/stories` `/how-it-works` `/help`）
 * 一并上线。这些页面里有**未获批准的定价展示**与**未核实的法律主体**表述。
 *
 * "仅 noindex" 不是内容安全措施 —— 直接访问仍能看到未经批准的商业承诺。
 * 因此本模块提供一个**默认冻结、可一键解冻**的闸门：
 *
 *   1. 中间件把命中路由 **rewrite** 到 `/holding`（原页面组件根本不渲染）；
 *   2. 同时下发 `X-Robots-Tag: noindex, nofollow`；
 *   3. 导航 / 页脚 / sitemap 从同一份名单派生，不产生"孤儿入口"；
 *   4. 解冻只在拿到 D1 定价批准与 D8 法律主体后，改环境变量即可，
 *      不需要再改代码（避免"为解冻又发一次版"）。
 *
 * 为什么默认冻结而不是默认开放
 * ----------------------------
 * 默认开放意味着"忘了配置 = 对外承诺"。默认冻结意味着"忘了配置 = 少一个页面"。
 * 两种错误的代价不对称，所以 fail-closed。
 */

/** 在生产上被意外发布、且内容尚未通过商业/法律审核的公开路由。 */
export const FROZEN_PUBLIC_ROUTES = [
  '/product',
  '/solutions',
  '/stories',
  '/how-it-works',
  '/help',
] as const

export type FrozenPublicRoute = (typeof FROZEN_PUBLIC_ROUTES)[number]

/**
 * 判定纯函数（供单测注入，避免测试去改真实环境变量）。
 *
 * 语义：**只有显式写 `'false'` 才解冻**。
 * - `undefined`（未设置）→ 冻结（生产当前状态，安全默认）
 * - `'false'` → 解冻（GA 批准后的动作）
 * - `'0'` / `'no'` / 拼错 → 冻结（fail-closed，不做"聪明"解析）
 */
export function resolvePublicSurfaceFrozen(raw: string | undefined): boolean {
  return raw !== 'false'
}

/**
 * 运行时开关。**服务端与客户端读同一个变量**，避免"中间件已解冻、导航还藏着"
 * 这种半解冻状态。用 `NEXT_PUBLIC_` 前缀是因为客户端组件（导航/页脚）也要读它；
 * 它只控制**可见性**，真正的拦截在中间件里，不依赖这个值保密。
 */
export function isPublicSurfaceFrozen(): boolean {
  const raw = process.env.NEXT_PUBLIC_PUBLIC_SURFACE_FROZEN ?? process.env.PUBLIC_SURFACE_FROZEN
  return resolvePublicSurfaceFrozen(raw)
}

/** 归一化后用**精确匹配**，避免 `/product-xyz` 或 `/helps` 被误伤或漏拦。 */
export function isFrozenPublicRoute(pathname: string): boolean {
  const normalized = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return (FROZEN_PUBLIC_ROUTES as readonly string[]).includes(normalized)
}

/**
 * 导航/页脚链接过滤。
 * 返回 `false` 表示该链接当前不得出现在公开导航里（但直接访问依然被中间件兜住）。
 */
export function isPublicLinkVisible(href: string, frozen = isPublicSurfaceFrozen()): boolean {
  if (!isFrozenPublicRoute(href)) return true
  return !frozen
}

/** 给 `<a>` 列表用的过滤函数（保持原有顺序）。 */
export function visiblePublicLinks<T extends { href: string }>(links: T[], frozen = isPublicSurfaceFrozen()): T[] {
  return links.filter((l) => isPublicLinkVisible(l.href, frozen))
}

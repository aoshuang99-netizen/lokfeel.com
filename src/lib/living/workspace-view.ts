/**
 * Workspace 视图深链接（V20.3 · Continuity / 交互原则 4「上下文永不无故丢失」）
 *
 * 背景：`src/app/workspace/living-workspace.tsx` 的 `activeKey` 原为纯内存 `useState('now')`，
 * 六屏切换不写 URL —— 刷新回到 Now、浏览器返回不会回上一屏、无法分享「我正在看的那一屏」。
 * `docs/implementation/v20/02_V200_GAP_AND_RISK_REGISTER.md` 的 G-03 记录了这一缺口。
 *
 * 设计约束（对齐仓库既有纪律）：
 *   1. **不新建路由**：仍是单路由 `/workspace`，只用 query `?view=`，不改 07/08 已验收的屏幕结构。
 *   2. **白名单由调用方传入**：只有 `NAV` 中 `ready:true` 的屏可被深链接。
 *      `missions` 是 `ready:false` 的未接线屏 —— 拼 `?view=missions` 不得绕过「未开放功能不伪装可用」。
 *   3. **纯函数、无 React、无 IO**：与 `adaptive/stages.ts` 同构，便于单测把守与变异检验。
 *   4. 未知参数原样保留；只读写 `view` 这一个键，不吞掉调用方已有的 query。
 */

/** URL query 参数名。单一事实源，避免组件与测试各写一份字面量。 */
export const WORKSPACE_VIEW_PARAM = 'view'

/** 默认视图。与 `LivingWorkspace` 的 `activeKey` 初始值一致。 */
export const DEFAULT_WORKSPACE_VIEW = 'now'

/**
 * 解析 URL 上的视图 key。
 *
 * 返回 `null` 表示「不覆盖当前 state」——涵盖缺省、空值、非法值、以及
 * 白名单外（例如尚未接线的 `missions`）。绝不因为拼了恶意/废弃参数而把用户
 * 带进一个不存在的屏。
 */
export function resolveWorkspaceView(
  raw: string | null,
  allowedViews: readonly string[],
): string | null {
  if (raw === null || raw === '') return null
  return allowedViews.includes(raw) ? raw : null
}

/**
 * 生成带视图参数的 search 串。
 *
 * - 保留其他 query 参数原值；
 * - 默认视图（`now`）移除 `view` 参数，保持 URL 干净、分享链接稳定；
 * - 白名单外的视图一律移除 `view`，不允许写入不可达状态。
 */
export function withWorkspaceView(
  search: string,
  view: string,
  allowedViews: readonly string[],
): string {
  const params = new URLSearchParams(search)
  if (!allowedViews.includes(view) || view === DEFAULT_WORKSPACE_VIEW) {
    params.delete(WORKSPACE_VIEW_PARAM)
  } else {
    params.set(WORKSPACE_VIEW_PARAM, view)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** 供 `history.pushState` 使用的同源 URL（保留 hash）。 */
export function workspaceViewUrl(
  pathname: string,
  search: string,
  hash: string,
  view: string,
  allowedViews: readonly string[],
): string {
  return `${pathname}${withWorkspaceView(search, view, allowedViews)}${hash}`
}

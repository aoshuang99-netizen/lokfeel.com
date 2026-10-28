/**
 * Focus-loop arithmetic for a keyboard-trapped dialog.
 *
 * 为什么要有这个文件
 * ------------------
 * 「Tab 圈定」这件事有两层：**算哪一格**（纯算术）和**读写 DOM**（生命周期）。
 * 混在一起写，就只能靠浏览器测，边缘条件（空列表、越界索引、动态增删）几乎测不到。
 * 所以这里只保留算得出来、又不碰 DOM 的那部分，`use-dialog-a11y` 负责把它们喂进去。
 *
 * 本文件**不 import 任何 DOM / React 类型**：它跑在 node 里，`tests/a11y/*.test.ts`
 * 直接对着它断言。凡是要读 `offsetParent`、`disabled`、`document.activeElement`
 * 的事，都在 hook 里做，做成 `FocusCandidate` 描述符再传进来。
 */

/** 一个候选可聚焦元素**当时**的状态，由 hook 从 DOM 读出来后填。 */
export interface FocusCandidate {
  /** 原生 `disabled`，或 `aria-disabled="true"` */
  disabled?: boolean
  /** `offsetParent === null` / `display:none` / `visibility:hidden` / `aria-hidden="true"` */
  hidden?: boolean
  /** input / select / textarea：初始焦点优先落到这里 */
  isFormField?: boolean
  /** 是否就是 `document.activeElement` —— 隐藏元素只有它自己还能拿焦点 */
  isCurrent?: boolean
}

/** 索引落在 `[0,count)` 里就原样返回，否则 -1（= 焦点不在圈内）。 */
export function activeIndexIn(count: number, activeIndex: number): number {
  if (count <= 0) return -1
  if (activeIndex < 0 || activeIndex >= count) return -1
  return activeIndex
}

/**
 * 这个候选还算不算「可聚焦」。
 *
 * 隐藏元素一律排除，**除非**它自己正拿着焦点：`offsetParent === null` 也会命中
 * `position:fixed` 的祖先（比如弹窗本身），此时浏览器确实允许它持有焦点，
 * 把它一起踢掉会让「当前元素不在列表中」变成常态。
 */
export function isUsableCandidate(candidate: FocusCandidate): boolean {
  if (candidate.disabled) return false
  if (candidate.hidden && !candidate.isCurrent) return false
  return true
}

/** 过滤可聚焦候选，**保持原顺序**（Tab 序 = DOM 序）。 */
export function filterUsable<T extends FocusCandidate>(list: readonly T[]): T[] {
  return list.filter(isUsableCandidate)
}

/**
 * 打开弹窗时焦点该落在第几个（下标基于**已过滤**的列表）。
 *
 * 规则：第一个可见的表单项 > 第一个可聚焦元素 > -1（调用方负责退到容器本身）。
 * 这里刻意**不看** `isCurrent`：刚打开时焦点还在触发按钮上，跟容器内无关。
 */
export function pickInitialFocusIndex(list: readonly FocusCandidate[]): number {
  if (list.length === 0) return -1
  const formField = list.findIndex((c) => c.isFormField && !c.disabled && !c.hidden)
  if (formField !== -1) return formField
  const first = list.findIndex((c) => !c.disabled && !c.hidden)
  return first
}

/**
 * 关窗时那个「原来拿着焦点的元素」还值不值得把焦点还回去。
 *
 * 弹窗开着的这几百毫秒里，触发按钮可能已经被卸载（列表刷新、路由切换），
 * 盲目 `focus()` 只会把焦点丢到 `<body>`，读屏用户当场失语。
 */
export function shouldRestoreFocus(
  target: { stillConnected: boolean; focusable: boolean } | null | undefined
): boolean {
  if (!target) return false
  return target.stillConnected && target.focusable
}

/**
 * Where focus should land on Tab (shift=false) / Shift+Tab (shift=true).
 * Returns -1 when the caller should not intervene (the browser default is fine).
 */
export function nextFocusIndex(count: number, activeIndex: number, shift: boolean): number {
  if (count <= 0) return -1
  const current = activeIndexIn(count, activeIndex)

  // Focus is outside the container (or on the container itself): pull it back in.
  if (current === -1) return shift ? count - 1 : 0

  if (shift) {
    // Shift+Tab on the first element wraps to the last.
    return current === 0 ? count - 1 : -1
  }
  // Tab on the last element wraps to the first.
  return current === count - 1 ? 0 : -1
}

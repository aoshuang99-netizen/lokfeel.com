/**
 * 背景滚动锁 —— 引用计数版。
 *
 * 为什么不能每个弹窗各自 `document.body.style.overflow = 'hidden'`：
 * 两个弹窗叠在一起时（确认框盖在举报框上），先关的那个会把 overflow 抹回 `""`，
 * 底下那个明明还开着，页面却跟着滚起来。反过来，先关的那个恢复原值时
 * 也可能把上层刚设上的锁冲掉。
 *
 * 所以锁只认「谁还开着」：进一个 +1，出一个 -1，归零才恢复**最初的**内联值。
 * 真正碰 DOM 的部分被隔离在 `createScrollLock` 的 target 参数里，
 * `tests/a11y/scroll-lock.test.ts` 传一个假 target 就能断言嵌套行为。
 */

export interface ScrollLockTarget {
  style: { overflow: string }
}

export interface ScrollLock {
  /** 锁一次，返回释放函数（幂等：重复调用不会把计数减成负数）。 */
  acquire: () => () => void
  /** 当前持有者数量，仅用于测试与诊断。 */
  readonly depth: number
}

export function createScrollLock(target: ScrollLockTarget): ScrollLock {
  let depth = 0
  let saved = ''

  return {
    acquire() {
      if (depth === 0) {
        saved = target.style.overflow
        target.style.overflow = 'hidden'
      }
      depth += 1

      let released = false
      return () => {
        if (released) return
        released = true
        depth -= 1
        if (depth === 0) target.style.overflow = saved
      }
    },
    get depth() {
      return depth
    },
  }
}

/** 浏览器里的那一个实例；SSR 期间不碰 `document`。 */
let browserLock: ScrollLock | null = null

export function lockBackgroundScroll(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (!browserLock) browserLock = createScrollLock(document.body)
  return browserLock.acquire()
}

'use client'

import { useEffect, useRef, type RefObject } from 'react'
import {
  filterUsable,
  nextFocusIndex,
  pickInitialFocusIndex,
  shouldRestoreFocus,
} from './focus-trap'
import { lockBackgroundScroll } from './scroll-lock'

/**
 * 与 `focus-trap.ts` 的分工
 * ------------------------
 * 这里只做三件事：读 DOM 现状 → 交给纯函数算 → 把结果写回 DOM。
 * 任何「算哪一格」的判断都不许写在这里，否则只能靠浏览器验，边缘条件测不到。
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** 元素此刻是否真的占位可见（`position:fixed` 自身的 offsetParent 也是 null，故并上 getClientRects）。 */
function isVisible(el: HTMLElement): boolean {
  if (el === document.activeElement) return true
  if (el.offsetParent !== null) return true
  return el.getClientRects().length > 0
}

interface DialogA11yOptions {
  isOpen: boolean
  onClose: () => void
  containerRef: RefObject<HTMLElement | null>
  /**
   * 打开时优先聚焦的元素。危险操作确认框应当显式指向「取消」，
   * 而不是依赖「DOM 里第一个按钮恰好是取消」这种巧合。
   */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** 是否顺带锁背景滚动（默认锁，嵌套时靠引用计数不互相踩）。 */
  lockScroll?: boolean
}

/**
 * Keyboard dialog behavior: Escape closes, Tab is trapped inside the
 * container, focus moves in on open and is restored to the previously
 * focused element on close.
 *
 * Only wires keyboard/focus behavior — never renders anything, never
 * touches visual state.
 */
export function useDialogA11y({
  isOpen,
  onClose,
  containerRef,
  initialFocusRef,
  lockScroll = true,
}: DialogA11yOptions): void {
  // onClose 保持最新，但不作为主 effect 依赖 —— 否则调用方传内联箭头函数时
  // 每次渲染都会重建 effect，cleanup 恢复焦点后又被重新聚焦抢走，
  // 表现为「每输入一个字符就失焦」。
  // 赋值放在 effect 内（而非渲染期直接写 ref），避免 react-hooks/refs 报错。
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // 背景滚动锁：单独一个 effect，和键盘逻辑互不影响。
  useEffect(() => {
    if (!isOpen || !lockScroll) return
    return lockBackgroundScroll()
  }, [isOpen, lockScroll])

  useEffect(() => {
    if (!isOpen) return

    const previouslyFocused =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null

    /** 读 DOM → 描述符 → 纯函数过滤。数组顺序 = DOM 顺序 = Tab 序。 */
    const collect = (container: HTMLElement) => {
      const elements = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      const active = document.activeElement
      return filterUsable(
        elements.map((el) => ({
          el,
          disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
          hidden: !isVisible(el),
          isFormField: /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName),
          isCurrent: el === active,
        }))
      )
    }

    const focusInto = (container: HTMLElement) => {
      const explicit = initialFocusRef?.current
      if (explicit && isVisible(explicit)) {
        explicit.focus()
        return
      }
      const usable = collect(container)
      const index = pickInitialFocusIndex(usable)
      const target = index >= 0 ? usable[index] : null
      if (target) target.el.focus()
      else container.focus()
    }

    // 容器可能是懒加载出来的（`next/dynamic` 的 MotionDiv 首帧还只是 fallback），
    // 效果跑完那一刻拿不到节点很正常。所以按帧重试，最多 ~500ms；
    // 一旦焦点已经进到容器里就立刻停手，避免和用户自己的点击抢。
    let frame = 0
    let attempts = 0
    const settleInitialFocus = () => {
      const container = containerRef.current
      if (container && container.contains(document.activeElement)) return
      if (container) focusInto(container)
      attempts += 1
      if (attempts <= 30) frame = requestAnimationFrame(settleInitialFocus)
    }
    settleInitialFocus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const container = containerRef.current
      if (!container) return
      const usable = collect(container)
      if (usable.length === 0) {
        // 圈里没东西可聚焦：把焦点摁回容器，别让它跑到背景页面上
        event.preventDefault()
        container.focus()
        return
      }
      const active = document.activeElement
      const currentIndex = usable.findIndex((c) => c.el === active)
      const targetIndex = nextFocusIndex(usable.length, currentIndex, event.shiftKey)
      if (targetIndex === -1) return
      event.preventDefault()
      usable[targetIndex]?.el.focus()
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown, true)
      if (
        previouslyFocused &&
        shouldRestoreFocus({
          stillConnected: previouslyFocused.isConnected,
          focusable: isVisible(previouslyFocused),
        })
      ) {
        previouslyFocused.focus()
      }
    }
  }, [isOpen, containerRef, initialFocusRef])
}

'use client'

import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface DialogA11yOptions {
  isOpen: boolean
  onClose: () => void
  containerRef: RefObject<HTMLElement | null>
}

/**
 * Keyboard dialog behavior: Escape closes, Tab is trapped inside the
 * container, focus moves in on open and is restored to the previously
 * focused element on close.
 *
 * Only wires keyboard/focus behavior — never renders anything, never
 * touches visual state.
 */
export function useDialogA11y({ isOpen, onClose, containerRef }: DialogA11yOptions): void {
  // onClose 保持最新，但不作为主 effect 依赖 —— 否则调用方传内联箭头函数时
  // 每次渲染都会重建 effect，cleanup 恢复焦点后又被 focusFirst() 抢走，
  // 表现为「每输入一个字符就失焦」。
  // 赋值放在 effect 内（而非渲染期直接写 ref），避免 react-hooks/refs 报错。
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!isOpen) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusFirst = () => {
      const container = containerRef.current
      if (!container) return
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      // 优先落到第一个输入项，而不是右上角关闭按钮
      const preferred = container.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
      )
      const target = preferred ?? focusable[0]
      if (target) {
        target.focus()
      } else {
        container.focus()
      }
    }
    // 焦点已在容器内则不动，避免任何重入抢夺
    if (!containerRef.current?.contains(document.activeElement)) focusFirst()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const container = containerRef.current
      if (!container) return
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last || !container.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [isOpen, containerRef])
}

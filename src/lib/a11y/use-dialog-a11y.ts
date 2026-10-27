'use client'

import { useEffect, type RefObject } from 'react'

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
  useEffect(() => {
    if (!isOpen) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusFirst = () => {
      const container = containerRef.current
      if (!container) return
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      const target = focusable[0]
      if (target) {
        target.focus()
      } else {
        container.focus()
      }
    }
    focusFirst()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
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
  }, [isOpen, onClose, containerRef])
}

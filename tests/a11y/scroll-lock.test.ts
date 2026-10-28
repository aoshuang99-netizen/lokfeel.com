import { createScrollLock } from '@/lib/a11y/scroll-lock'

/**
 * 背景滚动锁用假 target 测：不引 jsdom，也不假装测了 DOM。
 * 真实「弹窗开着时滚轮不动」由 E2E 断言 `document.body.style.overflow`。
 */
function fakeTarget(initial = '') {
  return { style: { overflow: initial } }
}

describe('scroll-lock: 引用计数', () => {
  test('第一把锁：改成 hidden，并记住原来的内联值', () => {
    const t = fakeTarget('auto')
    const lock = createScrollLock(t)
    lock.acquire()
    expect(t.style.overflow).toBe('hidden')
  })

  test('释放后恢复的是**原来的**内联值，不是硬编码的空串', () => {
    const t = fakeTarget('auto')
    const release = createScrollLock(t).acquire()
    release()
    expect(t.style.overflow).toBe('auto')
  })

  test('嵌套两层：先关上层不会把底层刚设上的锁抹掉', () => {
    const t = fakeTarget('')
    const lock = createScrollLock(t)
    const releaseOuter = lock.acquire()
    const releaseInner = lock.acquire()

    releaseInner() // 关掉叠加在上面的那个确认框
    expect(t.style.overflow).toBe('hidden') // 底层弹窗还开着，页面必须仍然锁住
    expect(lock.depth).toBe(1)

    releaseOuter()
    expect(t.style.overflow).toBe('')
    expect(lock.depth).toBe(0)
  })

  test('释放函数幂等：重复调用不会把计数减成负数，也不会提前解锁', () => {
    const t = fakeTarget('auto')
    const lock = createScrollLock(t)
    const release = lock.acquire()
    lock.acquire()

    release()
    release() // 第二次应当被忽略
    expect(lock.depth).toBe(1)
    expect(t.style.overflow).toBe('hidden')
  })

  test('归零后再次获取，仍然正确锁上', () => {
    const t = fakeTarget('visible')
    const lock = createScrollLock(t)
    lock.acquire()()
    expect(t.style.overflow).toBe('visible')

    lock.acquire()
    expect(t.style.overflow).toBe('hidden')
    expect(lock.depth).toBe(1)
  })
})

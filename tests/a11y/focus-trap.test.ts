import {
  activeIndexIn,
  filterUsable,
  isUsableCandidate,
  nextFocusIndex,
  pickInitialFocusIndex,
  shouldRestoreFocus,
  type FocusCandidate,
} from '@/lib/a11y/focus-trap'

/**
 * 这组用例只覆盖**算得出来**的部分：Tab 该去哪一格、初始焦点该给谁、恢复焦点该不该做。
 * 真正「读了 DOM 之后算出来的索引能不能让浏览器移动焦点」属于 hook 的活，
 * 在 `tests/e2e-ci/dialogs.spec.ts` 里用真实 Chromium 断言 —— 两者不互相替代。
 */

/** 造一个候选元素。默认可见、可用、非表单项。 */
const cand = (over: Partial<FocusCandidate> = {}): FocusCandidate => ({
  disabled: false,
  hidden: false,
  isFormField: false,
  isCurrent: false,
  ...over,
})

describe('focus-trap: nextFocusIndex（Tab 圈定）', () => {
  test('① 空列表：任何方向都不干预（-1），由调用方 preventDefault 并自己兜底', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1)
    expect(nextFocusIndex(0, 0, true)).toBe(-1)
  })

  test('② 单元素：Tab 与 Shift+Tab 都停在它身上（自己指向自己）', () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0)
    expect(nextFocusIndex(1, 0, true)).toBe(0)
  })

  test('③ 多元素中间：不干预，交给浏览器默认行为', () => {
    expect(nextFocusIndex(3, 1, false)).toBe(-1)
    expect(nextFocusIndex(3, 1, true)).toBe(-1)
  })

  test('④ Tab 在末尾：回卷到第一个', () => {
    expect(nextFocusIndex(3, 2, false)).toBe(0)
  })

  test('⑤ Shift+Tab 在开头：回卷到最后一个', () => {
    expect(nextFocusIndex(3, 0, true)).toBe(2)
  })

  test('⑥ 当前元素不在列表中（indexOf 得 -1）：按方向拉回圈内', () => {
    expect(nextFocusIndex(4, -1, false)).toBe(0)
    expect(nextFocusIndex(4, -1, true)).toBe(3)
  })

  test('⑥b 索引越界（>= count）视同容器外，不得原样透传', () => {
    expect(nextFocusIndex(2, 5, false)).toBe(0)
    expect(nextFocusIndex(2, 5, true)).toBe(1)
  })

  test('⑨ 动态删除：列表从 4 缩到 3 后，原来的「末尾」变成越界 → 拉回第一个', () => {
    // 删之前：active 在最后一格（索引 3），Tab 回卷到 0
    expect(nextFocusIndex(4, 3, false)).toBe(0)
    // 删掉一个后元素数组只剩 3 个，同一个 active 索引 3 已经越界
    expect(nextFocusIndex(3, 3, false)).toBe(0)
    // 而原本「中间」的索引 2 在新列表里成了末尾，Tab 必须回卷 —— 不能沿用旧判断
    expect(nextFocusIndex(3, 2, false)).toBe(0)
  })

  test('⑩ 动态插入：列表从 2 涨到 3 后，旧的末尾不再是末尾，不再回卷', () => {
    expect(nextFocusIndex(2, 1, false)).toBe(0)
    expect(nextFocusIndex(3, 1, false)).toBe(-1)
  })

  test('返回值要么 -1，要么落在 [0,count) —— 永不越界', () => {
    const seen = new Set<number>()
    for (const count of [1, 2, 5, 13]) {
      for (let active = -2; active <= count + 2; active++) {
        for (const shift of [false, true]) {
          const idx = nextFocusIndex(count, active, shift)
          seen.add(idx)
          if (!(idx === -1 || (idx >= 0 && idx < count))) {
            throw new Error(`越界: count=${count} active=${active} shift=${shift} -> ${idx}`)
          }
        }
      }
    }
    // 断言这轮枚举真的有覆盖面（空集恒真是本仓踩过的坑）
    expect(seen.size).toBeGreaterThan(1)
    expect(seen.has(-1)).toBe(true)
    expect(seen.has(0)).toBe(true)
  })
})

describe('focus-trap: activeIndexIn', () => {
  test('合法索引原样返回', () => {
    expect(activeIndexIn(3, 0)).toBe(0)
    expect(activeIndexIn(3, 2)).toBe(2)
  })

  test('容器外 / 越界 / 空容器统一返回 -1', () => {
    expect(activeIndexIn(3, -1)).toBe(-1)
    expect(activeIndexIn(3, 3)).toBe(-1)
    expect(activeIndexIn(0, 0)).toBe(-1)
  })
})

describe('focus-trap: 候选过滤（禁用 / 隐藏）', () => {
  test('⑦ 禁用元素：原生 disabled 与 aria-disabled 都不算可聚焦', () => {
    expect(isUsableCandidate(cand({ disabled: true }))).toBe(false)
    expect(filterUsable([cand(), cand({ disabled: true }), cand()])).toHaveLength(2)
  })

  test('⑧ 隐藏元素：排除；但「正拿着焦点的隐藏元素」必须留下', () => {
    expect(isUsableCandidate(cand({ hidden: true }))).toBe(false)
    expect(isUsableCandidate(cand({ hidden: true, isCurrent: true }))).toBe(true)
  })

  test('过滤保持原顺序（Tab 序 = DOM 序），不是重排', () => {
    const a = { id: 'a', ...cand() }
    const b = { id: 'b', ...cand({ disabled: true }) }
    const c = { id: 'c', ...cand() }
    expect(filterUsable([a, b, c]).map((x) => x.id)).toEqual(['a', 'c'])
  })

  test('全部不可用时过滤结果为空 —— 调用方据此 preventDefault', () => {
    const all = [cand({ disabled: true }), cand({ hidden: true })]
    expect(filterUsable(all)).toEqual([])
    expect(pickInitialFocusIndex(filterUsable(all))).toBe(-1)
  })
})

describe('focus-trap: 初始焦点选择', () => {
  test('⑪ 有表单项：优先第一个表单项（而不是右上角关闭按钮）', () => {
    const list = [cand(), cand({ isFormField: true }), cand({ isFormField: true })]
    expect(pickInitialFocusIndex(list)).toBe(1)
  })

  test('⑪b 没有表单项（如确认框）：退回第一个可聚焦元素', () => {
    expect(pickInitialFocusIndex([cand(), cand()])).toBe(0)
  })

  test('⑪c 空列表：-1，调用方把焦点退到容器本身', () => {
    expect(pickInitialFocusIndex([])).toBe(-1)
  })

  test('⑪d 第一个表单项被禁用时，跳到下一个可用表单项', () => {
    const list = [cand({ isFormField: true, disabled: true }), cand({ isFormField: true })]
    expect(pickInitialFocusIndex(list)).toBe(1)
  })
})

describe('focus-trap: 关闭后是否恢复焦点', () => {
  test('⑫ 目标已卸载（stillConnected=false）：不恢复，别把焦点丢给 body', () => {
    expect(shouldRestoreFocus({ stillConnected: false, focusable: true })).toBe(false)
  })

  test('⑫b 目标还在但已不可聚焦：不恢复', () => {
    expect(shouldRestoreFocus({ stillConnected: true, focusable: false })).toBe(false)
  })

  test('目标健在且可聚焦：恢复', () => {
    expect(shouldRestoreFocus({ stillConnected: true, focusable: true })).toBe(true)
  })

  test('从未记录过触发元素（null / undefined）：不恢复', () => {
    expect(shouldRestoreFocus(null)).toBe(false)
    expect(shouldRestoreFocus(undefined)).toBe(false)
  })
})

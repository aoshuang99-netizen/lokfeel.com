/**
 * V21 · 第二批 · C02 —— 「最新提交获胜」控制器（TDD · 先红后绿）
 *
 * 背景：`src/app/workspace/living-workspace.tsx:513-527` 的 runIntent 目前无条件
 * `setOutcome(await resolveIntent(...))`，没有 attempt 序号 / AbortController / 超时；
 * `src/lib/living/now/intent-gateway.ts:120` 的 fetch 也没有 signal。
 * 用户要求「A→B 快速切换时旧 A 不覆盖 B」，且「不预先认定为缺陷」，须用可复现
 * 测试定性。这组用例把时序固定下来：没有归属判定的实现下，晚到的 A 会覆盖 B；
 * 控制器必须让这种覆盖不成立。
 *
 * ⚠️ 这是**请求归属判定**，不是模型流式：没有任何假流式承诺，不假设 SSE/token，
 *    只回答「这次响应还该不该写进 UI」。
 */

import {
  createLatestIntentController,
  type LatestIntentController,
} from '@/lib/living/now/intent-race'

/** 模拟 UI 提交口：只有「归属判定 + finish」都通过才写入 state。 */
function makeSubmitter(c: LatestIntentController) {
  let state: string | null = null
  const accepted: boolean[] = []
  return {
    get state() {
      return state
    },
    get accepted() {
      return accepted
    },
    commit(token: number, value: string): boolean {
      if (!c.isCurrent(token)) {
        accepted.push(false) // 旧响应：丢弃
        return false
      }
      if (!c.finish(token)) {
        accepted.push(false) // 已超时/取消：丢弃
        return false
      }
      state = value
      accepted.push(true)
      return true
    },
  }
}

describe('createLatestIntentController', () => {
  it('begin() 返回单调递增的 token', () => {
    const c = createLatestIntentController()
    const t1 = c.begin().token
    const t2 = c.begin().token
    const t3 = c.begin().token
    expect(t2).toBeGreaterThan(t1)
    expect(t3).toBeGreaterThan(t2)
    c.dispose()
  })

  it('新 begin 会 abort 旧 signal', () => {
    const c = createLatestIntentController()
    const a = c.begin()
    expect(a.signal.aborted).toBe(false)
    const b = c.begin()
    expect(a.signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(false)
    c.dispose()
  })

  it('A 发起 → B 发起 → A 晚返回被判 stale（旧 A 不覆盖 B）', () => {
    const c = createLatestIntentController()
    const io = makeSubmitter(c)
    const a = c.begin()
    const b = c.begin()
    expect(c.isCurrent(a.token)).toBe(false)
    expect(c.isCurrent(b.token)).toBe(true)
    expect(io.commit(a.token, 'A 的结果')).toBe(false)
    expect(io.state).toBeNull()
    expect(io.commit(b.token, 'B 的结果')).toBe(true)
    expect(io.state).toBe('B 的结果')
    c.dispose()
  })

  it('B 正常 finish；finish 只认当前 token', () => {
    const c = createLatestIntentController()
    const a = c.begin()
    const b = c.begin()
    expect(c.finish(a.token)).toBe(false)
    expect(c.finish(b.token)).toBe(true)
    c.dispose()
  })

  it('A 的响应比 B 晚到（异步乱序）：不覆盖 B', async () => {
    const c = createLatestIntentController()
    const io = makeSubmitter(c)
    let resolveA!: (v: string) => void
    const pA = new Promise<string>((r) => {
      resolveA = r
    })
    const a = c.begin()
    const b = c.begin()
    const taskB = Promise.resolve('B 的结果').then((v) => io.commit(b.token, v))
    const taskA = pA.then((v) => io.commit(a.token, v))
    await taskB
    resolveA('A 的结果') // A 晚到
    await taskA
    expect(io.state).toBe('B 的结果')
    c.dispose()
  })

  it('重复点击两次：只有最后一次有效（且第一次晚到）', () => {
    const c = createLatestIntentController()
    const io = makeSubmitter(c)
    const first = c.begin()
    const second = c.begin()
    expect(io.commit(second.token, '第 2 次')).toBe(true)
    expect(io.commit(first.token, '第 1 次（晚到）')).toBe(false)
    expect(io.state).toBe('第 2 次')
    expect(io.accepted).toEqual([true, false])
    c.dispose()
  })

  it('超时触发 abort，且超时后的结果不得提交', () => {
    jest.useFakeTimers()
    try {
      const c = createLatestIntentController()
      const a = c.begin()
      c.withTimeout(1000)
      jest.advanceTimersByTime(999)
      expect(a.signal.aborted).toBe(false)
      jest.advanceTimersByTime(1)
      expect(a.signal.aborted).toBe(true)
      expect(c.finish(a.token)).toBe(false)
      // 超时只作废「这一次」：之后的新 begin 仍是干净的当前请求
      const b = c.begin()
      expect(c.isCurrent(b.token)).toBe(true)
      expect(c.finish(b.token)).toBe(true)
      expect(b.signal.aborted).toBe(false)
      c.dispose()
    } finally {
      jest.useRealTimers()
    }
  })

  it('withTimeout 返回的 cancel 能取消超时，不误伤请求', () => {
    jest.useFakeTimers()
    try {
      const c = createLatestIntentController()
      const a = c.begin()
      const cancel = c.withTimeout(1000)
      cancel()
      jest.advanceTimersByTime(5000)
      expect(a.signal.aborted).toBe(false)
      expect(c.finish(a.token)).toBe(true)
      c.dispose()
    } finally {
      jest.useRealTimers()
    }
  })

  it('dispose 后全部失效（旧 token 与之后 begin 的 token 都不 current）', () => {
    const c = createLatestIntentController()
    const io = makeSubmitter(c)
    const a = c.begin()
    expect(io.commit(a.token, 'A 的结果')).toBe(true)
    c.dispose()
    expect(a.signal.aborted).toBe(true)
    expect(c.isCurrent(a.token)).toBe(false)
    expect(c.finish(a.token)).toBe(false)
    const b = c.begin()
    expect(b.signal.aborted).toBe(true)
    expect(c.isCurrent(b.token)).toBe(false)
    expect(io.commit(b.token, 'dispose 后的结果')).toBe(false)
    expect(io.state).toBe('A 的结果') // 不被 dispose 后的请求覆盖
  })

  it('abortAll 中止在途请求，但控制器仍可继续 begin', () => {
    const c = createLatestIntentController()
    const a = c.begin()
    c.abortAll()
    expect(a.signal.aborted).toBe(true)
    expect(c.isCurrent(a.token)).toBe(false)
    const b = c.begin()
    expect(c.isCurrent(b.token)).toBe(true)
    expect(c.finish(b.token)).toBe(true)
    c.dispose()
  })

  it('supersede() 主动让位：本次请求作废', () => {
    const c = createLatestIntentController()
    const a = c.begin()
    a.supersede()
    expect(a.signal.aborted).toBe(true)
    expect(c.isCurrent(a.token)).toBe(false)
    expect(c.finish(a.token)).toBe(false)
    const b = c.begin()
    expect(c.finish(b.token)).toBe(true)
    c.dispose()
  })

  it('并发 Promise.all 乱序完成不串味：只有最后一次 begin 的结果落地', async () => {
    const c = createLatestIntentController()
    const io = makeSubmitter(c)
    const labels = ['A', 'B', 'C', 'D']
    const attempts = labels.map(() => c.begin())
    const deferred = labels.map(() => {
      let resolve!: (v: string) => void
      const promise = new Promise<string>((r) => {
        resolve = r
      })
      return { promise, resolve }
    })
    const tasks = attempts.map((att, i) =>
      deferred[i].promise.then((value) => io.commit(att.token, value)),
    )
    // 乱序 resolve：D(3) → B(1) → A(0) → C(2)
    deferred[3].resolve('结果 D')
    deferred[1].resolve('结果 B')
    deferred[0].resolve('结果 A')
    deferred[2].resolve('结果 C')
    const accepted = await Promise.all(tasks)
    expect(accepted).toEqual([false, false, false, true])
    expect(io.state).toBe('结果 D')
    c.dispose()
  })
})

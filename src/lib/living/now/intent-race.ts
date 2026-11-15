/**
 * V21 · 第二批 · C02 —— 「最新提交获胜」控制器（纯 TS，无 React 依赖）
 *
 * 这是**请求归属判定**，不是模型流式：没有任何假流式承诺，不假设 SSE / token，
 * 也不产生任何「流式」接口；它只回答「这次响应还该不该写进 UI」。
 *
 * 调用方范式（两步守卫，缺一不可）：
 *   const attempt = controller.begin()
 *   const res = await fetch(url, { signal: attempt.signal })
 *   if (!controller.isCurrent(attempt.token)) return  // 已被新请求取代 → 丢弃
 *   if (!controller.finish(attempt.token)) return     // 已超时/取消 → 丢弃
 *   setState(res)
 *
 * 与 `runIntent`（src/app/workspace/living-workspace.tsx:513-527）的关系：本模块只提供
 * 归属判定与 AbortSignal；是否接入 UI、是否给 intent-gateway 的 fetch 传 signal，
 * 由主代理决定 —— 本模块不改动任何现有文件，也不预先认定现有实现是缺陷。
 */

export interface IntentAttempt {
  /** 单调递增的提交序号。 */
  token: number
  /** 来自 AbortController；新 begin / supersede / 超时 / abortAll / dispose 会 abort。 */
  signal: AbortSignal
  /** 主动让位：作废本次请求，使任何晚到响应都不会被提交。 */
  supersede(): void
}

export interface LatestIntentController {
  begin(): IntentAttempt
  /** 该 token 是否仍是「最新一次提交」（响应回来时先做这一步丢弃判断）。 */
  isCurrent(token: number): boolean
  /** 是否允许把该 token 的结果提交进 UI（= 当前 token 且请求未被取消/超时）。 */
  finish(token: number): boolean
  /** 中止所有在途请求；控制器仍可继续 begin。 */
  abortAll(): void
  /** 释放控制器：之后所有 token（含 dispose 后新 begin 的）一律失效。 */
  dispose(): void
  /**
   * 给「当前这次 begin」挂超时：ms 后若它仍是当前请求则 abort 其 signal。
   * 只作废这一次，不连带影响之后 begin 的新请求；返回 cancel() 供正常结束时清定时器。
   * 调用方也可以自己用 setTimeout 触发 abort()，本辅助只是把这件事收口。
   */
  withTimeout(ms: number): () => void
}

interface Current {
  token: number
  controller: AbortController
}

export function createLatestIntentController(): LatestIntentController {
  let seq = 0
  let disposed = false
  let current: Current | null = null
  const timers = new Set<ReturnType<typeof setTimeout>>()

  /** 让某次请求彻底作废：abort signal，并清掉 current。 */
  function invalidate(target: Current): void {
    if (!target.controller.signal.aborted) target.controller.abort()
    if (current === target) current = null
  }

  function begin(): IntentAttempt {
    if (disposed) {
      // dispose 后全部失效：给一个已 abort 的 signal，token 永不被认为 current。
      const controller = new AbortController()
      controller.abort()
      const token = ++seq
      return { token, signal: controller.signal, supersede: () => {} }
    }
    // 新 begin 会 abort 旧 signal —— 「最新提交获胜」的核心。
    if (current) invalidate(current)
    const controller = new AbortController()
    const token = ++seq
    const attempt: Current = { token, controller }
    current = attempt
    return {
      token,
      signal: controller.signal,
      supersede: () => {
        if (!disposed && current === attempt) invalidate(attempt)
      },
    }
  }

  function isCurrent(token: number): boolean {
    return !disposed && current !== null && current.token === token
  }

  function finish(token: number): boolean {
    if (!isCurrent(token)) return false
    // 超时 / abortAll / 主动取消会让 signal.aborted = true，此时结果也不许提交。
    return current !== null && !current.controller.signal.aborted
  }

  function abortAll(): void {
    if (current) invalidate(current)
  }

  function dispose(): void {
    disposed = true
    if (current) invalidate(current)
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
  }

  function withTimeout(ms: number): () => void {
    if (disposed || current === null) return () => {}
    const target = current
    const timer = setTimeout(() => {
      timers.delete(timer)
      // 只作废「这一次」：若它仍是最新的在途请求，abort 它。
      if (!disposed && current === target) target.controller.abort()
    }, ms)
    timers.add(timer)
    return () => {
      clearTimeout(timer)
      timers.delete(timer)
    }
  }

  return { begin, isCurrent, finish, abortAll, dispose, withTimeout }
}

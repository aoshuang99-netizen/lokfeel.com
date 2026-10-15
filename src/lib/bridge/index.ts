/**
 * T10 · Community Bridge —— 内核出口（**纯**：无 IO、无网络、不碰授权）
 *
 * 消费纪律（与 T09 的 `src/lib/agent/index.ts` 同一取向）：
 *   · API 层 / 服务层（`src/lib/bridges/`）从这里取**类型与纯判定**；
 *   · 🔴 **不要**从 `src/lib/bridges/`（复数，服务层）反向 import 进内核 ——
 *     内核一旦能拿到 DB/租户，门禁 B1/B2 立刻失效。
 */

export * from './types'
export * from './policy'

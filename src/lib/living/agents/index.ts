/**
 * P2 · Agent 区 —— 出口
 *
 * 目录约定与 P2 · Field / Consent / Observatory 一致：
 *   - `types.ts` 服务端取值域的镜像 + 文案 + 编译期漂移守卫
 *   - `board.ts` 运行面板与用量装配器（纯函数，零 IO）
 *
 * 🔴 引用纪律：只 `import type` 服务端模块，且类型取自 `@/lib/agent`（**内核**）
 *    而非 `@/lib/agents`（**服务层**）。由门禁 R10 把守。
 *
 * ⚠️ 目录名 `agents` 与服务层 `@/lib/agents` 同名但**不同物**：这里是 `src/lib/living/agents`。
 *    两者不会互相 import（本目录只做展示，服务层只做 IO）。
 */

export * from './types'
export * from './board'

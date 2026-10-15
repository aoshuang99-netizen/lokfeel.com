/**
 * T10 Slice 4 · Community Bridge —— 出口
 *
 * 目录约定与 P2 各区一致：
 *   - `types.ts`  展示模型 + 文案 + **编译期漂移守卫**
 *   - `board.ts`  纯函数装配器（零 IO）+ 动作请求形状 + zod 输入契约
 *
 * 🔴 引用纪律（与 `consent/index.ts` **刻意不同**，理由见 `types.ts` 文件头）：
 *   · 取值域与文案**直接值导入** `@/lib/bridge`（单数）—— 那是零 import 的纯内核，
 *     本来就可以进客户端 bundle，因此**只有一份**，不存在镜像漂移；
 *   · 服务层 `@/lib/bridges`（复数）**只 `import type`** —— 由 `check:ui-invariants`
 *     的 R10 把守（该前缀已在黑名单里），值导入会把 Prisma / 租户守卫拖进 bundle。
 *   · 字段文案取自 `@/lib/connection/field-catalog`（R10 唯一的**值导入白名单**，
 *     零 import 的纯目录）。
 */

export * from './types'
export * from './board'

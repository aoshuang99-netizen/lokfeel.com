/**
 * Living Connection OS · P2 —— Field 关系网络（出口）
 *
 * 结构：
 *   `types.ts` 服务端形状的**镜像**（取值域 + 编译期漂移守卫）
 *   `graph.ts` 装配器（纯函数、零 IO、确定性 2.5D 布局）
 *
 * 渲染层在 `src/components/living/field/`，其中只有那里允许引 `@xyflow/react`
 * （由 `npm run check:ui-invariants` 的 R8 把守）。
 */

export * from './types'
export * from './graph'

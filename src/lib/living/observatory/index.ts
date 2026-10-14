/**
 * P2 · Outcome Observatory —— 出口
 *
 * 目录约定与 P2 · Field / Consent 一致：
 *   - `types.ts`    服务端取值域的镜像 + 文案 + 编译期漂移守卫
 *   - `timeline.ts` 时间轴与指标装配器（纯函数，零 IO）
 *
 * 🔴 引用纪律：只 `import type` 服务端模块（`@/lib/outcome`）。
 *    由 `npm run check:ui-invariants` 的 R10 把守。
 */

export * from './types'
export * from './timeline'

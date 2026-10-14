/**
 * P2 · Consent Gate —— 出口
 *
 * 目录约定与 P2 · Field 一致：
 *   - `types.ts`      服务端取值域的镜像 + 文案 + 编译期漂移守卫
 *   - `projection.ts` 纯函数装配器（零 IO）
 *
 * 🔴 引用纪律：本目录只允许 `import type` 服务端模块（`@/lib/connection`）；
 *    唯一的**值**导入白名单是 `@/lib/connection/field-catalog`（零 import 的纯目录）。
 *    由 `npm run check:ui-invariants` 的 R10 把守 —— 值导入会把 Prisma/租户守卫
 *    拖进客户端 bundle。详见 `scripts/check-ui-invariants.mjs` 的文件头。
 */

export * from './types'
export * from './projection'

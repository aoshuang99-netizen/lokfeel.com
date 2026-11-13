/**
 * 客户端 instrumentation —— ⚠️ Next 会在**每一个页面**加载这个文件。
 *
 * R6-T7 实测（`scripts/perf/attribute-tbt.mjs`）：
 *   本文件原本静态 `import * as Sentry from "@sentry/nextjs"`，
 *   于是共享 chunk 变成 **485KB**（含 Replay 与 browserTracing），
 *   8 个公开页全部要下载、解析、执行它；
 *   而 `.env*` 里根本没有 `NEXT_PUBLIC_SENTRY_DSN`（只有 `.env.example` 有），
 *   所以 `Sentry.init({ dsn: undefined })` 之后**不发送任何事件**。
 *   归因数据里，这块的执行时间直接落在长任务窗口内（EvaluateScript 1.4s 量级）。
 *
 * 所以改法不是"删掉监控"，而是**让它在没有 DSN 时不进入首屏**：
 *   · 有 DSN → 仍然 init（动态导入，第一个路由切换可能晚一帧被采样，其余不变）；
 *   · 无 DSN → 打包器把 `if (undefined)` 判成死代码，chunk 不被任何页面引用。
 *
 * 这是"去掉不可能生效的代码"，不是降低可观测性：没有 DSN 时它本来就不上报。
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  void import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      debug: false,
    })
  })
}

/**
 * 路由切换埋点。签名与 `Sentry.captureRouterTransitionStart` 对齐，
 * 但只在 SDK 真被加载后才转发 —— 否则这里会变成本文件唯一的静态依赖，
 * 又把 485KB 拉回来（那等于把优化做成了自我抵消）。
 */
export const onRouterTransitionStart = (
  href: string,
  navigationType: 'push' | 'replace' | 'traverse',
): void => {
  if (!dsn) return
  void import('@sentry/nextjs').then((Sentry) => {
    Sentry.captureRouterTransitionStart(href, navigationType)
  })
}

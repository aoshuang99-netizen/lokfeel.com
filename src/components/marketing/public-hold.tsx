import Link from 'next/link'

/**
 * 冻结期的合规占位内容（GA 总令 T2）
 * ═══════════════════════════════════════════════════════════════════════
 * 由 `/holding` 页面与五个被冻结的公开页共用。
 *
 * 为什么让**页面自己**返回它，而不是只靠中间件 rewrite：
 * 本轮实测 `next build` 产出的 `middleware.js` 存在，但 `middleware-manifest`
 * 的 middleware 表为空 —— 也就是说"中间件改写"在这条构建链上不能被当作
 * 唯一保证。**内容安全的保证必须落在渲染层**：页面组件不渲染商业声明，
 * 就没有商业声明可泄漏。中间件是第二层，不是第一层。
 *
 * 三条硬约束：
 *   1. 不出现任何金额、法律主体、客户案例（所以这里一句商业承诺都没有）；
 *   2. 告诉访问者"发生了什么、去哪里"，不让它变成 404 或空白；
 *   3. 与 `noindex` 配套，避免"审核中"被索引。
 */
export function PublicHold() {
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-6 py-24">
      <div className="max-w-xl text-center">
        <p className="text-sm uppercase tracking-widest text-foreground-muted mb-4">LokFeel</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">该页面正在最终审核</h1>
        <p className="text-foreground-muted leading-relaxed mb-8">
          为了避免对外传递尚未确认的信息，这个页面暂时不展示内容。
          审核完成后会自动恢复，不需要你做任何操作。
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <Link
            href="/"
            className="inline-flex min-h-6 items-center text-sm font-semibold text-primary hover:underline"
          >
            返回首页
          </Link>
          <Link
            href="/contact"
            className="inline-flex min-h-6 items-center text-sm font-semibold text-foreground hover:underline"
          >
            联系我们
          </Link>
        </div>
      </div>
    </main>
  )
}

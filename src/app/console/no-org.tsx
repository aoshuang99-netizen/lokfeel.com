/**
 * T07 · 「你还没有加入任何社群」说明页
 *
 * ⚠️ 这不是错误页。B2C 用户（个人态）点进 `/console` 是完全正常的操作，
 * 必须看到**为什么看不到**以及**接下来能做什么**，而不是一个 403 / 500 或空白。
 *
 * 三条信息缺一不可：
 *   1. 发生了什么（你当前不属于任何社群）；
 *   2. 为什么会这样（控制台是给社群运营者用的，需要被加入某个社群）；
 *   3. 怎么回去（返回个人模式 —— 唯一的跨态出口）。
 */

import Link from 'next/link'
import { ArrowLeft, Building2, UserRound } from 'lucide-react'

export default function ConsoleNoOrg() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-card-border bg-background-secondary p-8">
        <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center mb-5">
          <Building2 className="w-6 h-6 text-primary" />
        </div>

        <h1 className="text-xl font-semibold text-foreground font-display mb-2">
          你还没有加入任何社群
        </h1>

        <p className="text-sm text-foreground-muted leading-relaxed mb-2">
          社群控制台是给<strong className="text-foreground">社群运营者</strong>用的工作台 ——
          它展示的是「某个社群的」任务、成员、连接与工作流，而不是你个人的匹配。
        </p>
        <p className="text-sm text-foreground-muted leading-relaxed mb-6">
          你当前没有处于任何生效中的社群成员关系。请联系社群管理员把你加入某个社群；
          加入后刷新本页即可看到控制台。
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary-hover transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            返回个人模式
          </Link>
          <Link
            href="/dashboard/profile"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-card-border text-foreground-muted text-sm font-medium hover:text-foreground hover:bg-background-tertiary transition-colors"
          >
            <UserRound className="w-4 h-4" />
            查看我的资料
          </Link>
        </div>

        <p className="text-xs text-foreground-subtle mt-6">
          提示：<code className="text-foreground-muted">/dashboard/*</code> 是个人模式（关于「我」），
          <code className="text-foreground-muted">/console/*</code> 是社群模式（关于「我的社群」）——
          两者刻意分开，避免把两套信息混在一起。
        </p>
      </div>
    </main>
  )
}

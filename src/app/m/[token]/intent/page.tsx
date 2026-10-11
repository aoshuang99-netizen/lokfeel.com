/**
 * T03 · 意图提交页 —— `/m/<token>/intent`
 *
 * 设计目标（对应 AC-12「意图提交」+ AC-03「逐字段披露」）：
 *   1. **敏感动作需身份验证**：未登录直接重定向到登录页（带回跳），不渲染表单；
 *   2. **逐字段披露**：字段目录由服务端下发，用户在页面上逐项选择可见范围；
 *   3. **移动优先**：单列布局、大点击区、无横向滚动。
 *
 * 数据流的一个关键点：分享页的**公开投影**刻意不含 `missionId`（内部标识不进 DOM），
 * 但提交意图需要它。因此这里用 `getMyIntentByShareToken()` 在**服务端**把 missionId
 * 取出来交给表单 —— 它只存在于 RSC 的渲染数据里，不会出现在匿名可见的响应中。
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth/auth'
import {
  AUDIENCE_OPTIONS,
  DISCLOSURE_FIELDS,
  getMyIntentByShareToken,
  getSharePageData,
  isShareTokenShaped,
  suggestedDisclosure,
} from '@/lib/connection'
import { IntentForm } from './intent-form'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ token: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  // 与分享页同口径：令牌即能力凭证，绝不允许被索引。
  return { title: '提交我的连接意图', robots: { index: false, follow: false, nocache: true } }
}

export default async function IntentPage({ params }: PageProps) {
  const { token } = await params
  if (!isShareTokenShaped(token)) notFound()

  const session = await auth().catch(() => null)
  const viewerId = ((session?.user as { id?: string } | undefined)?.id) ?? null
  const loginHref = `/login?callbackUrl=${encodeURIComponent(`/m/${token}/intent`)}`

  // ── 敏感动作：未登录不得进入表单（AC-11/AC-12 的身份验证口径）──
  if (!viewerId) redirect(loginHref)

  const ctx = await getMyIntentByShareToken(token, viewerId)
  if (!ctx) notFound()

  const share = await getSharePageData(token, viewerId)
  if (share.kind === 'not_found') notFound()

  const joined = share.kind === 'view' ? Boolean(share.viewer?.joined) : false
  const missionTitle = share.kind === 'view' ? share.view.title : '连接任务'

  // 只把**可展示**的目录字段传给客户端组件（不传内部实现细节）。
  const fields = DISCLOSURE_FIELDS.map((f) => ({
    key: f.key as string,
    label: f.label,
    group: f.group as string,
    sensitive: f.sensitive,
    disclosable: f.disclosable,
    defaultAudience: f.defaultAudience as string,
  }))

  return (
    <main data-testid="intent-page" className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-2xl px-5 pb-16 pt-8">
        <Link
          href={`/m/${token}`}
          className="text-sm text-muted-foreground"
          data-testid="intent-back"
        >
          ← 返回任务
        </Link>

        <h1 className="mt-4 text-2xl font-semibold leading-snug text-foreground">
          提交我的连接意图
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          针对「{missionTitle}」。你可以逐项决定哪些信息给谁看 ——
          默认一项都不披露，只有你主动选择的字段才会被看到。
        </p>

        <div className="mt-7">
          <IntentForm
            missionId={ctx.missionId}
            missionOpen={ctx.missionOpen}
            joined={joined}
            fields={fields}
            suggested={Object.fromEntries(Object.entries(suggestedDisclosure()))}
            audiences={AUDIENCE_OPTIONS.map((o) => ({ value: o.value as string, label: o.label }))}
            initialIntent={
              ctx.myIntent
                ? {
                    id: ctx.myIntent.id,
                    need: ctx.myIntent.need,
                    offer: ctx.myIntent.offer,
                    constraints: ctx.myIntent.constraints,
                    disclosure: ctx.myIntent.disclosure as unknown as Record<string, string>,
                    expiresAt: ctx.myIntent.expiresAt,
                    status: ctx.myIntent.status,
                  }
                : null
            }
          />
        </div>
      </div>
    </main>
  )
}

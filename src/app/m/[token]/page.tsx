/**
 * T02 · Mission Link 分享页 —— `/m/<shareToken>`
 *
 * 设计目标（对应 AC-11）：
 *   1. **移动优先**：单列、拇指可达的底部主行动（sticky CTA）、大字号、无横向滚动；
 *   2. **未注册可预览**：匿名访客即可看到最小披露的公开投影；
 *   3. **敏感动作需身份验证**：未登录时"加入"改为引导登录，由客户端按钮发起。
 *
 * 两条产品铁律：
 *   - **最小披露**：页面只渲染 `getSharePageData()` 的公开投影；内部标识
 *     （missionId / organizationId / ownerId）**不**进入 DOM。
 *   - **无候选时不伪造**：`candidates` 在本阶段恒为空，页面渲染**显式空态**
 *     并说明"不会展示占位结果"，而不是造几条好看的假数据。
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth/auth'
import { getSharePageData, isShareTokenShaped, type PublicMissionView } from '@/lib/connection'
import { JoinButton } from './join-button'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ token: string }>
}

/** 状态 → 展示文案。集中在函数里，避免 JSX 里散落三元表达式。 */
function statusChip(view: PublicMissionView): { label: string; className: string } {
  switch (view.status) {
    case 'ACTIVE':
      return { label: '招募中', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' }
    case 'PAUSED':
      return { label: '已暂停', className: 'bg-amber-500/15 text-amber-300 border-amber-500/30' }
    case 'CLOSED':
      return { label: '已结束', className: 'bg-slate-500/15 text-slate-300 border-slate-500/30' }
    default:
      return { label: '草稿', className: 'bg-slate-500/15 text-slate-300 border-slate-500/30' }
  }
}

function blockedText(view: PublicMissionView): string | null {
  if (view.acceptingJoins) return null
  switch (view.joinBlockedReason) {
    case 'paused':
      return '该任务已暂停，暂时不接受新的加入。'
    case 'closed':
      return '该任务已结束。'
    case 'expired':
      return '该任务已过截止时间。'
    case 'full':
      return '名额已满。'
    default:
      return '该任务暂不接受加入。'
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params
  // 分享链接**绝不允许被搜索引擎索引**：token 即能力凭证，进索引等于公开泄露。
  const base: Metadata = { robots: { index: false, follow: false, nocache: true } }
  if (!isShareTokenShaped(token)) return { ...base, title: '连接任务' }

  const result = await getSharePageData(token, null).catch(() => null)
  if (!result || result.kind !== 'view') return { ...base, title: '连接任务' }
  return {
    ...base,
    title: result.view.title,
    description: result.view.goal.slice(0, 120),
  }
}

export default async function MissionSharePage({ params }: PageProps) {
  const { token } = await params
  if (!isShareTokenShaped(token)) notFound()

  // 会话是可选的：匿名访客也应当能预览（AC-11）。这里不 throw、不重定向。
  const session = await auth().catch(() => null)
  const viewerId = ((session?.user as { id?: string } | undefined)?.id) ?? null

  const result = await getSharePageData(token, viewerId)
  if (result.kind === 'not_found') notFound()

  const loginHref = `/login?callbackUrl=${encodeURIComponent(`/m/${token}`)}`

  // ── 需要登录（任务关闭了公开预览）──
  if (result.kind === 'auth_required') {
    return (
      <main
        data-testid="mission-share-auth-required"
        className="min-h-screen flex items-center justify-center px-5 py-10 bg-background"
      >
        <div className="w-full max-w-md text-center space-y-5">
          <div className="mx-auto w-16 h-16 rounded-2xl border border-blue-500/25 bg-blue-500/10 flex items-center justify-center">
            <span className="text-2xl" aria-hidden>
              🔒
            </span>
          </div>
          <h1 className="text-xl font-semibold text-foreground">此连接任务需要登录后查看</h1>
          <p className="text-sm text-muted-foreground">
            该任务未开放公开预览，登录后即可查看详情并申请加入。
          </p>
          <Link
            href={loginHref}
            className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white"
            data-testid="mission-share-login"
          >
            登录后查看
          </Link>
        </div>
      </main>
    )
  }

  const { view, viewer } = result
  const chip = statusChip(view)
  const blocked = blockedText(view)
  const seatsLabel =
    view.seats.capacity === null
      ? `已有 ${view.seats.taken} 人加入`
      : `已有 ${view.seats.taken}/${view.seats.capacity} 人加入`

  return (
    <main
      data-testid="mission-share"
      className="min-h-screen bg-background pb-28"
    >
      <div className="mx-auto w-full max-w-2xl px-5 pt-8">
        {/* 社群 + 状态 */}
        <div className="flex items-center gap-3">
          {view.community ? (
            <span className="text-sm text-muted-foreground">{view.community}</span>
          ) : null}
          <span
            className={`ml-auto rounded-full border px-2.5 py-0.5 text-xs font-medium ${chip.className}`}
            data-testid="mission-status"
          >
            {chip.label}
          </span>
        </div>

        {/* 标题 */}
        <h1
          className="mt-4 text-2xl font-semibold leading-snug text-foreground"
          data-testid="mission-title"
        >
          {view.title}
        </h1>
        <p className="mt-2 text-xs text-muted-foreground" data-testid="mission-seats">
          {seatsLabel}
        </p>

        {/* 正文块 */}
        <section className="mt-7 space-y-5">
          <Field label="目标" value={view.goal} testId="mission-goal" />
          <Field label="我能提供" value={view.offer} testId="mission-offer" />
          <Field label="成功标准" value={view.successCriteria} testId="mission-success" />
        </section>

        {/* 匹配候选 —— 显式空态（铁律：无候选时不伪造） */}
        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5" data-testid="mission-candidates">
          <h2 className="text-sm font-semibold text-foreground">匹配候选</h2>
          {/*
            ⚠️ 此处**只有**空态分支：公开投影的 `candidates` 类型是 `never[]`
            （见 src/lib/connection/public-view.ts），类型系统保证渲染不出候选。
            T04 引入双向检索时，才会在这里新增真实候选分支 —— 在那之前，
            任何"占位候选"都会让用户以为系统已经匹配到了人。
          */}
          <p className="mt-2 text-sm text-muted-foreground" data-testid="mission-candidates-empty">
            暂无匹配候选。我们不会在缺少真实匹配结果时展示占位数据 ——
            在成员提交意图、且完成双向匹配之后，这里才会出现有依据的推荐。
          </p>
          {!view.candidatesAvailable ? (
            <p className="mt-3 text-xs text-muted-foreground">
              匹配能力当前尚未启用（本社群尚未开启双向检索）。
            </p>
          ) : null}
        </section>

        {view.expiresAt ? (
          <p className="mt-6 text-xs text-muted-foreground">
            截止时间：{new Date(view.expiresAt).toLocaleString('zh-CN')}
          </p>
        ) : null}
      </div>

      {/* 底部主行动（移动优先：拇指可达、始终可见） */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto w-full max-w-2xl">
          {viewer?.joined ? (
            <div
              className="w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 text-center text-sm font-semibold text-emerald-300"
              data-testid="mission-joined"
            >
              你已加入这个任务
            </div>
          ) : !view.acceptingJoins ? (
            // 不可加入时**对所有人**给出确定原因（含匿名访客）——
            // 不能因为"没登录"就显示"登录后加入"，那会让用户白跑一趟。
            <div
              className="w-full rounded-xl border border-border bg-card/60 px-5 py-3 text-center text-sm text-muted-foreground"
              data-testid="mission-blocked-reason"
            >
              {blocked}
            </div>
          ) : !viewer ? (
            // 未登录、但任务可加入 → 引导登录（敏感动作需身份验证）
            <Link
              href={loginHref}
              className="block w-full rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-semibold text-white"
              data-testid="mission-login-cta"
            >
              登录后加入
            </Link>
          ) : (
            <JoinButton token={token} disabled={false} disabledReason={null} loginHref={loginHref} />
          )}
        </div>
      </div>
    </main>
  )
}

function Field({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div>
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h2>
      <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground" data-testid={testId}>
        {value}
      </p>
    </div>
  )
}

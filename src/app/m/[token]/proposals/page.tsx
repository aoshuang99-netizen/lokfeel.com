/**
 * T05 · 我的连接 —— `/m/<token>/proposals`
 *
 * 这是「双边同意」在界面上的**唯一落点**（AC-04 / AC-05）：
 *
 *   - **待决**：我与对方都还没表态（或只表了一半）→ 给出「接受 / 拒绝 / 撤回」。
 *     文案必须说清「**单方同意不会产生介绍**」—— 这正是用户最容易误解的一步：
 *     先点同意的人会以为连接已经建立。可见文案把 `CONSENT_PENDING` 明确说成
 *     等待双方，而不是已同意。
 *   - **已建立连接**：只有**运营真正执行介绍**之后才会出现在这里。
 *     此处的对方档案经 `COUNTERPARTY` 档投影（`proposals.ts` 里该档位的唯一读路径）。
 *   - **已关闭**：拒绝 / 撤回 / 过期 —— 只作事实陈述，**不提供任何重新打开**的动作
 *     （终态不可逆是 AC-05 的一部分）。
 *
 * 三条与全站一致的红线：
 *   1. **内部标识不进 DOM**：`organizationId` / `missionId` / 对侧 `userId`
 *      一概不渲染 —— 页面只需要提案自身的可见语义。
 *   2. **动作由服务端下发**（`proposal.actions`）：前端不自己推断"我现在能点什么"。
 *   3. **拒绝理由不回流**：对侧只显示"是否已表态"，不显示 `note`（见 DTO 注释）。
 *
 * 采用纯 RSC（无客户端状态）+ 一个小客户端组件承载写操作。
 */

import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth/auth'
import {
  DISCLOSURE_FIELDS,
  getSharePageData,
  isShareTokenShaped,
  listMyProposalsByShareToken,
  resolveShareTokenTenant,
  type DecisionKind,
  type ProposalDto,
} from '@/lib/connection'
import { ProposalActions } from './proposal-actions'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ token: string }>
}

const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  DISCLOSURE_FIELDS.map((f) => [f.key as string, f.label])
)

export async function generateMetadata(): Promise<Metadata> {
  // 与分享页同口径：令牌即能力凭证，绝不允许被索引。
  return { title: '我的连接', robots: { index: false, follow: false, nocache: true } }
}

/** 决策 → 中文，用于"我/对方"的表态行。`null` = 尚未回应。 */
function decisionText(d: DecisionKind | null): string {
  switch (d) {
    case 'ACCEPT':
      return '已同意'
    case 'REJECT':
      return '已拒绝'
    case 'REVOKE':
      return '已撤回'
    default:
      return '尚未回应'
  }
}

/**
 * 状态 → 标签与解释。
 *
 * ⚠️ 「双方都同意」但**尚未介绍**时，绝不能显示成"已连接" —— 那会跳过
 * 介绍这一环，让用户以为可以开始联系了。两者文案必须明确区分。
 */
function stateInfo(p: ProposalDto): { label: string; className: string; hint: string } {
  if (p.introducedAt !== null) {
    return {
      label: '已建立连接',
      className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      hint: '双方已同意，运营已发出介绍。对方授权给「匹配后的对手方」的字段见下方。',
    }
  }
  switch (p.state) {
    case 'CONSENT_PENDING':
      return p.actions.includes('ACCEPT')
        ? {
            label: '待你回应',
            className: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
            hint: '你同意之后，还需要对方也同意才会推进 —— 单方同意不会产生介绍。',
          }
        : {
            label: '等待对方回应',
            className: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
            hint: '你已表态，正在等待对方。双方都同意后，运营才会执行介绍。',
          }
    case 'MUTUALLY_ACCEPTED':
      return {
        label: '双方已同意，等待介绍',
        className: 'bg-blue-500/15 text-blue-200 border-blue-500/30',
        hint: '双方都同意只是"愿意被介绍"，运营执行介绍后才会真正建立连接。',
      }
    case 'EXPIRED':
      return {
        label: '已过期',
        className: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
        hint: '这条提案的有效期已过，不能再接受。',
      }
    case 'REJECTED':
      return {
        label: '已拒绝',
        className: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
        hint: '提案已关闭，不会产生任何介绍。',
      }
    case 'REVOKED':
      return {
        label: '已撤回',
        className: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
        hint: '提案已被撤回，不会产生任何介绍。',
      }
    default:
      return {
        label: '待决',
        className: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
        hint: '',
      }
  }
}

/** 关闭态（拒绝 / 撤回 / 过期）—— 与「待决」的判据分开写，避免两处漂移。 */
function isClosedState(p: ProposalDto): boolean {
  return p.state === 'REJECTED' || p.state === 'REVOKED' || p.state === 'EXPIRED'
}

export default async function ProposalsPage({ params }: PageProps) {
  const { token } = await params
  if (!isShareTokenShaped(token)) notFound()

  const session = await auth().catch(() => null)
  const viewerId = ((session?.user as { id?: string } | undefined)?.id) ?? null
  const loginHref = `/login?callbackUrl=${encodeURIComponent(`/m/${token}/proposals`)}`

  // 提案是**成员数据**：未登录不渲染任何内容，直接去登录。
  if (!viewerId) redirect(loginHref)

  // 令牌 → 租户上下文（含成员关系校验）。非成员 / 草稿 → "不存在"。
  const resolved = await resolveShareTokenTenant(token, viewerId)
  if (!resolved) notFound()

  const proposals = await listMyProposalsByShareToken(token, viewerId)
  if (proposals === null) notFound()

  const share = await getSharePageData(token, viewerId).catch(() => null)
  const missionTitle = share && share.kind === 'view' ? share.view.title : '连接任务'

  // 三分区。顺序即信息优先级：待我处理 → 已建立 → 已结束。
  const pending = proposals.filter((p) => p.introducedAt === null && !isClosedState(p))
  const connections = proposals.filter((p) => p.introducedAt !== null)
  const closed = proposals.filter((p) => p.introducedAt === null && isClosedState(p))

  return (
    <main data-testid="proposals-page" className="min-h-screen bg-background pb-16">
      <div className="mx-auto w-full max-w-2xl px-5 pt-8">
        <Link href={`/m/${token}`} className="text-sm text-muted-foreground" data-testid="proposals-back">
          ← 返回任务
        </Link>

        <h1 className="mt-4 text-2xl font-semibold leading-snug text-foreground">我的连接</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          针对「{missionTitle}」。连接需要<strong className="text-foreground">双方各自同意</strong>
          ，再由运营发出介绍 —— 系统不会替任何一方做决定。
        </p>

        {proposals.length === 0 ? (
          <section
            className="mt-7 rounded-2xl border border-border bg-card/40 p-5"
            data-testid="proposals-empty"
          >
            <h2 className="text-sm font-semibold text-foreground">还没有与你相关的连接</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              当有人（或运营）为你和某位成员牵线时，提案会出现在这里，由你决定是否同意。
            </p>
            <Link
              href={`/m/${token}/matches`}
              className="mt-4 inline-flex rounded-xl border border-blue-500/40 bg-blue-500/10 px-5 py-3 text-sm font-semibold text-blue-100"
              data-testid="proposals-cta-matches"
            >
              查看与我互补的人 →
            </Link>
          </section>
        ) : null}

        {pending.length > 0 ? (
          <ProposalSection title="待处理" count={pending.length} testId="proposals-pending">
            {pending.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </ProposalSection>
        ) : null}

        {connections.length > 0 ? (
          <ProposalSection title="已建立连接" count={connections.length} testId="proposals-connections">
            {connections.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </ProposalSection>
        ) : null}

        {closed.length > 0 ? (
          <ProposalSection title="已结束" count={closed.length} testId="proposals-closed">
            {closed.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </ProposalSection>
        ) : null}

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5">
          <h2 className="text-sm font-semibold text-foreground">关于连接与隐私</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            同意之前，你与对方仍是任务里的候选关系，互相看到的只有授权给「同任务的伙伴」这一档的档案。
            <strong className="text-foreground">只有介绍真正建立之后</strong>
            ，你此前授权给「匹配后的对手方」的字段才会被对方看到。
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            你可以随时撤销自己的意图 —— 资料会<strong className="text-foreground">立即</strong>
            停止披露，无需等待。
          </p>
          <Link
            href={`/m/${token}/intent`}
            className="mt-3 inline-flex text-sm text-blue-300"
            data-testid="proposals-edit-intent"
          >
            调整我的披露范围 →
          </Link>
        </section>
      </div>
    </main>
  )
}

function ProposalSection({
  title,
  count,
  testId,
  children,
}: {
  title: string
  count: number
  testId: string
  children: ReactNode
}) {
  return (
    <section className="mt-7" data-testid={testId}>
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}（{count}）
      </h2>
      <ul className="mt-3 space-y-4">{children}</ul>
    </section>
  )
}

function ProposalCard({ proposal: p }: { proposal: ProposalDto }) {
  const info = stateInfo(p)
  // `DisclosedProfile` 的键是闭合的字段目录；未授权的键**根本不存在**，
  // 因此渲染层不需要（也不该）知道目录全集。
  const subject = p.counterpart.subject as Record<string, unknown>
  const subjectKeys = Object.keys(subject)

  return (
    <li
      className="rounded-2xl border border-border bg-card/40 p-5"
      data-testid="proposal-card"
      data-state={p.state}
      data-introduced={p.introducedAt ? 'true' : 'false'}
    >
      <div className="flex items-center gap-3">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${info.className}`}
          data-testid="proposal-state"
        >
          {info.label}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground" data-testid="proposal-my-role">
          {p.myRole === 'PROPOSER' ? '你是发起方' : '你是被介绍方'}
        </span>
      </div>

      {info.hint ? (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="proposal-hint">
          {info.hint}
        </p>
      ) : null}

      {/* 发起理由（运营/发起方填写的"为什么推荐你们认识"） */}
      <div className="mt-4">
        <h3 className="text-xs text-muted-foreground">推荐理由</h3>
        <p
          className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground"
          data-testid="proposal-rationale"
        >
          {p.rationale}
        </p>
      </div>

      {/* 双方表态（只有"是否已表态"，不含拒绝理由） */}
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="proposal-decisions">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">你的表态</dt>
          <dd className="text-foreground" data-testid="proposal-my-decision">
            {decisionText(p.myDecision)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">对方表态</dt>
          <dd className="text-foreground" data-testid="proposal-counterpart-decision">
            {decisionText(p.counterpartDecision)}
          </dd>
        </div>
      </dl>

      {/* 对方经授权披露的档案。未授权的键不存在，自然渲染不出来。 */}
      <div className="mt-4 border-t border-border pt-3" data-testid="proposal-counterpart">
        <h3 className="text-xs text-muted-foreground">
          {p.introducedAt !== null ? '对方公开给你的信息' : '对方目前公开给你的信息'}
        </h3>
        {subjectKeys.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="proposal-counterpart-empty">
            {p.introducedAt !== null
              ? '对方尚未授权任何档案字段，或已撤销/过期的意图使披露暂时为空。'
              : '对方尚未向「同任务的伙伴」公开任何档案字段。'}
          </p>
        ) : (
          <dl className="mt-1 space-y-0.5 text-sm text-foreground">
            {subjectKeys.map((k) => (
              <div key={k} className="flex gap-2">
                <dt className="text-muted-foreground">{FIELD_LABELS[k] ?? k}</dt>
                <dd>{String(subject[k])}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* 写操作（动作清单由服务端下发；此处只负责发起与反馈） */}
      {p.actions.length > 0 ? (
        <div className="mt-4">
          <ProposalActions proposalId={p.id} actions={p.actions} />
        </div>
      ) : null}
    </li>
  )
}

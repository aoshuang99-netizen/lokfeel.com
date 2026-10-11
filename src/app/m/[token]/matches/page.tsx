/**
 * T04 · 候选页 —— `/m/<token>/matches`
 *
 * 设计目标（AC-13「双向检索与可解释排序」）：
 *   1. **每个候选都必须带得走依据**：展示**实际命中的词元**，而不是一个匹配百分比；
 *   2. **无候选不伪造**：没有互补关系时给出**确定性的原因**，绝不填占位候选；
 *   3. **移动优先**：单列、大字号、无横向滚动（与 T02/T03 的分享页一致）。
 *
 * 三条隐私边界（都在服务层强制，这里只是把它们显示出来）：
 *   - 档案字段经 `discloseSubject(..., 'CANDIDATE')` 白名单投影：对方
 *     **未授权给「同任务的伙伴」档的字段，键根本不存在**，因此这里无从渲染；
 *   - 对方的 `constraints`（筛选口径）不进候选；
 *   - 被门控拒绝的意图只贡献**计数**，不贡献内容 —— 页面拿不到"是谁被挡掉了"。
 *
 * 采用**纯服务端渲染**（无客户端状态）：与 T03 意图表单不同，本页没有交互写操作，
 * 因此不需要 `'use client'` —— 顺带避开了 dev 模式下 hydration 与 `networkidle`
 * 的一整类不稳定（T02/T03 都在那上面花过时间）。
 *
 * ⚠️ 本页**不提供"建立连接"按钮**：双边同意与联系方式交换属于 T05。
 *   放一个点了没用的按钮，比放一句"下一步开放"更糟 —— 前者会让用户以为
 *   连接已经发出去了。
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth/auth'
import {
  DISCLOSURE_FIELDS,
  explainCandidate,
  getMyIntentByShareToken,
  isShareTokenShaped,
  listCandidatesByShareToken,
  type CandidateList,
  type NoCandidateReason,
} from '@/lib/connection'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ token: string }>
}

const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  DISCLOSURE_FIELDS.map((f) => [f.key as string, f.label])
)

export async function generateMetadata(): Promise<Metadata> {
  // 与分享页同口径：令牌即能力凭证，绝不允许被索引。
  return { title: '与我互补的人', robots: { index: false, follow: false, nocache: true } }
}

/** 没有候选时的说明。**每个原因都要能说出口**，不许用"暂无数据"糊过去。 */
function reasonText(reason: NoCandidateReason): { title: string; detail: string } {
  switch (reason) {
    case 'no_own_intent':
      return {
        title: '先提交你的诉求',
        detail:
          '你还没有在这条任务上提交意图（或它已被撤销/过期）。提交之后，系统才会把你和同任务里互补的人排在一起。',
      }
    case 'no_other_intents':
      return {
        title: '目前只有你提交了诉求',
        detail: '这条任务上还没有其他人提交意图。等有人提交后，这里会自动出现互补对象。',
      }
    case 'all_gated_out':
      return {
        title: '其他诉求当前都不参与匹配',
        detail:
          '有其他成员提交过意图，但都已被撤销或过期，或对方已不再是这条任务的参与者。',
      }
    case 'no_reciprocal_overlap':
      return {
        title: '还没有形成双向互补',
        detail:
          '匹配需要双向成立 —— "你需要什么 ↔ 对方能提供什么"与"对方需要什么 ↔ 你能提供什么"要同时对上。目前还没有人同时满足两侧。',
      }
  }
}

export default async function MatchesPage({ params }: PageProps) {
  const { token } = await params
  if (!isShareTokenShaped(token)) notFound()

  const session = await auth().catch(() => null)
  const viewerId = ((session?.user as { id?: string } | undefined)?.id) ?? null
  const loginHref = `/login?callbackUrl=${encodeURIComponent(`/m/${token}/matches`)}`

  // 候选是**成员数据**：未登录一律先登录，不渲染任何内容。
  if (!viewerId) redirect(loginHref)

  const ctx = await getMyIntentByShareToken(token, viewerId)
  if (!ctx) notFound()

  const result: CandidateList | null = await listCandidatesByShareToken(token, viewerId, {
    limit: 20,
  })
  // 令牌无效 / 非本社群成员 → 一律"不存在"（不区分 404 与 403，避免接口探测）。
  if (!result) notFound()

  const reason = result.noCandidatesReason

  return (
    <main data-testid="matches-page" className="min-h-screen bg-background pb-16">
      <div className="mx-auto w-full max-w-2xl px-5 pt-8">
        <Link href={`/m/${token}`} className="text-sm text-muted-foreground" data-testid="matches-back">
          ← 返回任务
        </Link>

        <h1 className="mt-4 text-2xl font-semibold leading-snug text-foreground">
          与我互补的人
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          按「你需要 ↔ 他提供」与「他需要 ↔ 你提供」<strong className="text-foreground">双向</strong>
          同时成立来筛选，每条都附上实际命中的关键词 —— 你可以据此反驳排序。
        </p>

        {/* ── 无候选：给原因，不给占位 ── */}
        {reason ? (
          <section
            className="mt-7 rounded-2xl border border-border bg-card/40 p-5"
            data-testid="matches-empty"
            data-reason={reason}
          >
            <h2 className="text-sm font-semibold text-foreground">{reasonText(reason).title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{reasonText(reason).detail}</p>

            {reason === 'no_own_intent' ? (
              <Link
                href={`/m/${token}/intent`}
                className="mt-4 inline-flex rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white"
                data-testid="matches-cta-intent"
              >
                去提交我的诉求
              </Link>
            ) : null}

            {/* 门控拒绝的**计数**（不含对方身份）：让"为什么没有"可被追问。 */}
            {result.gatedOut.length > 0 ? (
              <ul className="mt-4 space-y-1 text-xs text-muted-foreground" data-testid="matches-gated">
                {result.gatedOut.map((g) => (
                  <li key={g.code}>
                    已排除 {g.count} 条（原因：{g.code}）
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : (
          <ul className="mt-7 space-y-4" data-testid="matches-list">
            {result.candidates.map((c) => {
              const lines = explainCandidate(c.evidence, {
                me: '你',
                them: '对方',
              })
              // `DisclosedProfile` 的键是闭合的字段目录；这里按普通字典读取，
              // 因为**未授权的键根本不存在**，渲染层不需要（也不该）知道目录全集。
              const subject = c.subject as Record<string, unknown>
              const subjectKeys = Object.keys(subject)
              return (
                <li
                  key={c.intentId}
                  className="rounded-2xl border border-border bg-card/40 p-5"
                  data-testid="match-card"
                >
                  {/* 互补依据（必须有） */}
                  <h2 className="text-sm font-semibold text-foreground">为什么推荐</h2>
                  <ul className="mt-2 space-y-1 text-sm text-foreground" data-testid="match-evidence">
                    {lines.map((l) => (
                      <li key={l}>· {l}</li>
                    ))}
                  </ul>

                  {/* 对方的诉求正文（参与匹配的字段） */}
                  <div className="mt-4 space-y-3">
                    <div>
                      <h3 className="text-xs text-muted-foreground">对方需要</h3>
                      <p
                        className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground"
                        data-testid="match-need"
                      >
                        {c.need}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-xs text-muted-foreground">对方能提供</h3>
                      <p
                        className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground"
                        data-testid="match-offer"
                      >
                        {c.offer}
                      </p>
                    </div>
                  </div>

                  {/* 经授权的档案字段。未授权的键**不存在**，所以这里自然渲染不出来。 */}
                  <div className="mt-4 border-t border-border pt-3" data-testid="match-profile">
                    <h3 className="text-xs text-muted-foreground">对方公开给你的信息</h3>
                    {subjectKeys.length === 0 ? (
                      <p className="mt-1 text-sm text-muted-foreground" data-testid="match-profile-empty">
                        对方尚未向「同任务的伙伴」公开任何档案字段。
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
                </li>
              )
            })}
          </ul>
        )}

        {/* ── 边界说明（诚实：连接流程尚未交付）── */}
        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5">
          <h2 className="text-sm font-semibold text-foreground">关于这些信息</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            对方看到的你的信息，同样只包含你授权给「同任务的伙伴」这一档的档案字段；
            你的诉求正文（我需要/我能提供）会展示给同任务的参与者。
            想收紧范围，可随时回到意图页修改 —— 改动**立即生效**，无需等待。
          </p>
          <p className="mt-2 text-xs text-muted-foreground" data-testid="matches-connect-coming">
            建立连接（双方确认、交换联系方式）将在下一步开放 ——
            这一步需要双方各自的同意，不会由系统替你决定。
          </p>
          <Link
            href={`/m/${token}/intent`}
            className="mt-3 inline-flex text-sm text-blue-300"
            data-testid="matches-edit-intent"
          >
            调整我的披露范围 →
          </Link>
        </section>
      </div>
    </main>
  )
}

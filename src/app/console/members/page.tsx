'use client'

/**
 * T07 · Console — 成员屏
 *
 * 数据源：`GET /api/v1/members`（本切片新增，`member.read` = OPERATOR+）。
 *
 * 🔴 「无空按钮」在这里的落实：
 *   - 角色过滤条、搜索、分页都是真交互（点了真的改查询）；
 *   - **没有「邀请成员」按钮** —— `member.invite` 能力虽已在能力矩阵里，
 *     但邀请流程（发信 + 接受链接 + 幂等）尚未实现。渲染一个点了没反应的
 *     "邀请"是最典型的空按钮，所以这里只陈述事实。
 *
 * ⚠️ 前端**不做**权限判断，只做降级展示；能力不足时服务端会 403，
 *    这里把 403 渲染成"权限不足"而不是报错。
 */

import { useMemo, useState } from 'react'
import { Mail, RefreshCw, Search, Users } from 'lucide-react'
import { useApiGet } from '@/hooks/use-api'

interface ApiEnvelope<T> {
  success: boolean
  data: T
  meta?: { total?: number; page?: number; pageSize?: number; totalPages?: number }
}

interface MemberDto {
  membershipId: string
  userId: string
  displayName: string
  email: string
  image: string | null
  role: string
  status: string
  city: string | null
  isBot: boolean
  joinedAt: string
}

const ROLE_FILTERS = [
  { value: 'ALL', label: '全部' },
  { value: 'OWNER', label: '所有者' },
  { value: 'ADMIN', label: '管理员' },
  { value: 'OPERATOR', label: '运营' },
  { value: 'MEMBER', label: '成员' },
] as const

const ROLE_BADGE: Record<string, string> = {
  OWNER: 'bg-primary/15 text-primary',
  ADMIN: 'bg-accent/15 text-accent',
  OPERATOR: 'bg-success/15 text-success',
  MEMBER: 'bg-background-tertiary text-foreground-muted',
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: '所有者',
  ADMIN: '管理员',
  OPERATOR: '运营',
  MEMBER: '成员',
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: '正常',
  INVITED: '已邀请（未接受）',
  SUSPENDED: '已停用',
}

const PAGE_SIZE = 20

export default function ConsoleMembersPage() {
  const [role, setRole] = useState<string>('ALL')
  const [page, setPage] = useState(1)
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')

  const url = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (role !== 'ALL') p.set('role', role)
    if (q) p.set('q', q)
    return `/api/v1/members?${p.toString()}`
  }, [role, page, q])

  const members = useApiGet<ApiEnvelope<MemberDto[]>>(url)

  const items = members.data?.data ?? []
  const total = members.data?.meta?.total ?? 0
  const totalPages = members.data?.meta?.totalPages ?? 1

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setQ(qInput.trim().length >= 2 ? qInput.trim() : '')
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-foreground font-display">成员</h1>
          <p className="text-xs text-foreground-muted mt-0.5">
            本社群的成员目录 —— 谁在这里、担任什么角色。
          </p>
        </div>
        <button
          type="button"
          onClick={() => members.refetch()}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${members.isLoading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* ── 过滤 + 搜索 ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {ROLE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => {
              setRole(f.value)
              setPage(1)
            }}
            aria-pressed={role === f.value}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              role === f.value
                ? 'bg-primary/15 text-primary font-medium'
                : 'border border-card-border text-foreground-muted hover:text-foreground hover:bg-background-tertiary'
            }`}
          >
            {f.label}
          </button>
        ))}

        <form onSubmit={submitSearch} className="flex items-center gap-1.5 ml-auto">
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="按姓名或邮箱搜索（≥2 字）"
            aria-label="按姓名或邮箱搜索成员"
            className="w-52 px-3 py-1.5 rounded-lg border border-card-border bg-background-secondary text-xs text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            搜索
          </button>
          {q ? (
            <button
              type="button"
              onClick={() => {
                setQInput('')
                setQ('')
                setPage(1)
              }}
              className="px-2.5 py-1.5 rounded-lg text-xs text-foreground-subtle hover:text-foreground transition-colors"
            >
              清除
            </button>
          ) : null}
        </form>
      </div>

      {members.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-foreground-muted py-10">
          <RefreshCw className="w-4 h-4 animate-spin" />
          正在读取成员…
        </div>
      ) : members.error ? (
        <div className="rounded-2xl border border-card-border bg-background-secondary p-6">
          <p className="text-sm text-warning mb-1">
            {/permission|403/i.test(members.error) ? '权限不足' : '读不到成员列表'}
          </p>
          <p className="text-sm text-foreground-muted">
            {/permission|403/i.test(members.error)
              ? '查看成员目录需要「运营」及以上角色。你在本社群的角色不够 —— 这不是错误，而是权限边界。'
              : members.error}
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-card-border bg-background-secondary p-6">
          <div className="flex items-center gap-2 text-foreground-muted mb-2">
            <Users className="w-4 h-4" />
            <p className="text-sm font-medium text-foreground">
              {q || role !== 'ALL' ? '没有符合条件的成员' : '本社群还没有成员记录'}
            </p>
          </div>
          <p className="text-sm text-foreground-muted">
            {q || role !== 'ALL' ? '换个条件再试。' : '成员通过接受邀请加入（邀请流程在后续切片）。'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((m) => (
            <li
              key={m.membershipId}
              className="rounded-xl border border-card-border bg-background-secondary p-3 flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-full bg-background-tertiary overflow-hidden shrink-0 flex items-center justify-center">
                {m.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs text-foreground-muted">
                    {m.displayName.slice(0, 1)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground truncate">{m.displayName}</p>
                  <span
                    className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      ROLE_BADGE[m.role] ?? 'bg-background-tertiary text-foreground-muted'
                    }`}
                  >
                    {ROLE_LABEL[m.role] ?? m.role}
                  </span>
                  {m.isBot ? (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-background-tertiary text-foreground-subtle">
                      数字用户
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-foreground-subtle">
                  <span className="inline-flex items-center gap-1 min-w-0">
                    <Mail className="w-3 h-3 shrink-0" />
                    <span className="truncate">{m.email}</span>
                  </span>
                  {m.city ? <span>{m.city}</span> : null}
                  <span>加入于 {new Date(m.joinedAt).toLocaleDateString()}</span>
                  {m.status !== 'ACTIVE' ? (
                    <span className="text-warning">{STATUS_LABEL[m.status] ?? m.status}</span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!members.isLoading && !members.error && totalPages > 1 ? (
        <div className="flex items-center justify-between text-xs text-foreground-muted">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-lg border border-card-border disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground hover:bg-background-tertiary transition-colors"
          >
            上一页
          </button>
          <span>
            第 {page} / {totalPages} 页 · 共 {total} 位成员
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 rounded-lg border border-card-border disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground hover:bg-background-tertiary transition-colors"
          >
            下一页
          </button>
        </div>
      ) : null}

      <p className="text-[11px] text-foreground-subtle">
        邀请成员需要 `member.invite`（管理员及以上）—— 邀请流程尚未实现，因此这里没有「邀请」按钮。
      </p>
    </div>
  )
}

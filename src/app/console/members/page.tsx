'use client'

/**
 * T07 · Console — 成员屏
 *
 * 数据源：`GET /api/v1/members`（本切片新增，`member.read` = OPERATOR+）。
 *
 * 🔴 「无空按钮」在这里的落实：
 *   - 角色过滤条、搜索、分页都是真交互（点了真的改查询）；
 *   - **角色调整下拉是真写入**：`PATCH /api/v1/members/[membershipId]`（`member.update_role`
 *     = ADMIN+），并且只在服务端下发的 capabilities 含该能力时渲染；
 *   - **邀请成员是真流程**：`POST /api/v1/invitations`（`member.invite` = ADMIN+），
 *     发信成功与失败**分开呈现** —— 邮件没发出去时给出可复制的链接，而不是说"已发送"；
 *   - **移出成员是真写入**：`DELETE /api/v1/members/[membershipId]`（`member.remove`），
 *     点击后先给影响提示（立即失去访问权、下一次请求即 403、历史保留），确认才执行。
 *
 * 🔴 角色调整为什么必须存在：组织一旦失去最后一名管理员，`agent.approve` 与
 *   `outcome.verify` 就**无人可用**（D-12 的真实现场）。服务端禁止把最后一名管理员
 *   降级；这个下拉让"再认命一名管理员"成为组织内**自助**动作，而不是等运维改库。
 *
 * ⚠️ 前端**不做**权限判断，只做降级展示；能力不足时服务端会 403，
 *    这里把 403 渲染成"权限不足"而不是报错。
 */

import { useMemo, useState } from 'react'
import { Clock, Copy, Mail, RefreshCw, Search, Trash2, UserPlus, Users, X } from 'lucide-react'
import { useApiGet, useApiPatch, useApiResult } from '@/hooks/use-api'

interface ApiEnvelope<T> {
  success: boolean
  data: T
  meta?: { total?: number; page?: number; pageSize?: number; totalPages?: number }
}

/** `/api/v1/org` 只取判别用的两个字段（能力集合由服务端算，前端不推理）。 */
interface OrgEnvelope {
  success: boolean
  data: { myRole?: string; capabilities?: string[] }
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

interface InvitationDto {
  id: string
  email: string
  role: string
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
  expiresAt: string
  createdAt: string
  acceptedAt: string | null
  revokedAt: string | null
}

const INVITATION_STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: '待接受', className: 'bg-warning/15 text-warning' },
  ACCEPTED: { label: '已接受', className: 'bg-success/15 text-success' },
  REVOKED: { label: '已撤销', className: 'bg-background-tertiary text-foreground-subtle' },
  EXPIRED: { label: '已过期', className: 'bg-background-tertiary text-foreground-subtle' },
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
  // ⚠️ 原先是 `bg-accent/15 text-accent`，而 `--color-accent` 实际等于
  // `--background-tertiary`（深色主题下 #1a1a1a）—— 深灰字压深灰底，
  // axe 实测对比度不足直接判 serious。改用 Living 主题的 signal 令牌：
  // 深色下是暖金、纸面下是深棕，两套主题都是可读的。
  ADMIN: 'bg-lf-signal-soft text-lf-signal',
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

/** 可被本接口授予的角色。`OWNER` 刻意不在列 —— 所有权只能通过 `org.transfer` 转移。 */
const ASSIGNABLE_ROLES = ['ADMIN', 'OPERATOR', 'MEMBER'] as const

/** 把服务端的拒绝码翻译成一句人能读的话（码优先，文案兜底）。 */
function roleErrorText(code: string | undefined, message: string | undefined): string {
  switch (code) {
    case 'LAST_ADMIN':
      return '不能把最后一名管理员降级 —— 组织必须保留至少一名在用管理员。'
    case 'SELF_ROLE_CHANGE':
      return '不能修改自己的角色。请让另一位管理员来调整。'
    case 'OWNER_GRANT_FORBIDDEN':
      return '不能把成员直接设为所有者 —— 所有权转移走单独流程。'
    case 'OWNER_PROTECTED':
      return '只有所有者本人可以调整所有者的角色。'
    case 'NO_CHANGE':
      return '这个成员已经是该角色，没有需要保存的改动。'
    case 'CAPABILITY_REQUIRED':
      return '权限不足：调整角色需要管理员或所有者。'
    default:
      return message || '角色没有改成，请重试。'
  }
}

/** 邀请被拒绝时的文案。同样以码为准：不同码背后是完全不同的补救动作。 */
function inviteErrorText(code: string | undefined, message: string | undefined): string {
  switch (code) {
    case 'ALREADY_MEMBER':
      return '该邮箱已经是本组织成员，不需要再邀请。'
    case 'INVALID_EMAIL':
      return '邮箱格式不正确，请检查后再发。'
    case 'OWNER_GRANT_FORBIDDEN':
      return '不能通过邀请授予所有者身份 —— 所有权转移走单独流程。'
    case 'CAPABILITY_REQUIRED':
      return '权限不足：邀请成员需要管理员或所有者。'
    default:
      return message || '邀请没有发出去，请重试。'
  }
}

/** 移出被拒绝时的文案。这几条都是"看起来能做但服务端不该允许"的动作。 */
function removeErrorText(code: string | undefined, message: string | undefined, m: MemberDto): string {
  switch (code) {
    case 'LAST_ADMIN':
      return '不能移出最后一名管理员 —— 否则组织将没有人能审批与核验。请先任命另一位管理员。'
    case 'SELF_REMOVE':
      return '不能移出自己。退出组织应走单独流程，避免误操作把自己锁在门外。'
    case 'OWNER_PROTECTED':
      return '只有所有者本人可以移出所有者。'
    case 'NOT_ACTIVE':
      return `${m.displayName} 已经不是在用成员（状态：${STATUS_LABEL[m.status] ?? m.status}）。`
    case 'CAPABILITY_REQUIRED':
      return '权限不足：移出成员需要管理员或所有者。'
    default:
      return message || '移出没有成功，请重试。'
  }
}

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

  // 能力判定由服务端给出（`/api/v1/org` 已返回 capabilities）；前端只做显隐。
  const org = useApiGet<OrgEnvelope>('/api/v1/org')
  const canUpdateRole = (org.data?.data?.capabilities ?? []).includes('member.update_role')

  const { patch } = useApiPatch()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const changeRole = async (m: MemberDto, next: string) => {
    if (next === m.role) return
    setBusyId(m.membershipId)
    setNotice(null)
    const r = await patch<MemberDto>(`/api/v1/members/${m.membershipId}`, { role: next })
    setBusyId(null)
    if (!r.ok) {
      setNotice({ kind: 'error', text: roleErrorText(r.code, r.message) })
      return
    }
    setNotice({
      kind: 'ok',
      text: `${m.displayName}：${ROLE_LABEL[m.role] ?? m.role} → ${ROLE_LABEL[next] ?? next}`,
    })
    members.refetch()
  }

  // ── 邀请 ────────────────────────────────────────────────────────────
  const canInvite = (org.data?.data?.capabilities ?? []).includes('member.invite')
  const canRemove = (org.data?.data?.capabilities ?? []).includes('member.remove')
  const invitations = useApiGet<ApiEnvelope<InvitationDto[]>>(canInvite ? '/api/v1/invitations' : null)
  const { send } = useApiResult()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('MEMBER')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [lastInvite, setLastInvite] = useState<{
    email: string
    url: string
    emailSent: boolean
    emailError?: string
  } | null>(null)
  const [copied, setCopied] = useState(false)

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviteBusy(true)
    setInviteError(null)
    const r = await send<{ invitation: InvitationDto; inviteUrl: string; emailSent: boolean; emailError?: string }>(
      '/api/v1/invitations',
      'POST',
      { email: inviteEmail.trim(), role: inviteRole }
    )
    setInviteBusy(false)
    if (!r.ok) {
      setInviteError(inviteErrorText(r.code, r.message))
      return
    }
    setLastInvite({
      email: r.data!.invitation.email,
      url: r.data!.inviteUrl,
      emailSent: r.data!.emailSent,
      emailError: r.data!.emailError,
    })
    setInviteEmail('')
    setInviteOpen(false)
    invitations.refetch()
  }

  const copyInviteLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板被拒时不要把链接吞掉 —— 它已经渲染成一个可选中的输入框。
      setCopied(false)
    }
  }

  const revokeInvite = async (inv: InvitationDto) => {
    const r = await send(`/api/v1/invitations/${inv.id}`, 'DELETE')
    if (!r.ok) {
      setNotice({ kind: 'error', text: r.message || '撤销失败，请重试。' })
      return
    }
    setNotice({ kind: 'ok', text: `已撤销对 ${inv.email} 的邀请，链接立即失效。` })
    invitations.refetch()
  }

  // ── 移出 ────────────────────────────────────────────────────────────
  const [confirmRemove, setConfirmRemove] = useState<MemberDto | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  const doRemove = async () => {
    if (!confirmRemove) return
    setRemoveBusy(true)
    const r = await send(`/api/v1/members/${confirmRemove.membershipId}`, 'DELETE')
    setRemoveBusy(false)
    if (!r.ok) {
      setNotice({ kind: 'error', text: removeErrorText(r.code, r.message, confirmRemove) })
      setConfirmRemove(null)
      return
    }
    setNotice({ kind: 'ok', text: `${confirmRemove.displayName} 已被移出本社群。` })
    setConfirmRemove(null)
    members.refetch()
  }

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
        {canInvite ? (
          <button
            type="button"
            onClick={() => {
              setInviteOpen((v) => !v)
              setInviteError(null)
            }}
            aria-expanded={inviteOpen}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 text-primary text-xs font-medium hover:bg-primary/25 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            邀请成员
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => members.refetch()}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${members.isLoading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* ── 变更结果（错误必须看得见：被拒绝时角色没有改，用户不能以为改了） ── */}
      {notice ? (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-xl border px-3 py-2 text-xs ${
            notice.kind === 'ok'
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-warning/40 bg-warning/10 text-warning'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      {/* ── 邀请表单（只在有 member.invite 时出现） ── */}
      {canInvite && inviteOpen ? (
        <form
          onSubmit={submitInvite}
          className="rounded-2xl border border-card-border bg-background-secondary p-4 space-y-3"
        >
          <div>
            <p className="text-sm font-medium text-foreground">邀请一位同事</p>
            <p className="text-xs text-foreground-muted mt-0.5">
              对方会收到一封邮件。链接 7 天内有效，且只能由这个邮箱接受。
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="flex-1 min-w-0">
              <span className="sr-only">被邀请人邮箱</span>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full px-3 py-2 rounded-lg border border-card-border bg-background-secondary text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
            <label className="sm:w-36">
              <span className="sr-only">加入后的角色</span>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-card-border bg-background-secondary text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r] ?? r}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={inviteBusy || !inviteEmail.trim()}
              className="px-4 py-2 rounded-lg bg-primary text-background text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
            >
              {inviteBusy ? '发送中…' : '发送邀请'}
            </button>
            <button
              type="button"
              onClick={() => setInviteOpen(false)}
              className="px-3 py-2 rounded-lg text-sm text-foreground-muted hover:text-foreground transition-colors"
            >
              取消
            </button>
          </div>
          {inviteError ? (
            <p role="alert" className="text-xs text-warning">
              {inviteError}
            </p>
          ) : null}
        </form>
      ) : null}

      {/* ── 刚创建的邀请：**邮件到底发没发出去**必须分开说 ── */}
      {lastInvite ? (
        <div className="rounded-2xl border border-card-border bg-background-secondary p-4 space-y-2">
          <div className="flex items-start gap-2">
            <p className="text-sm text-foreground flex-1 min-w-0">
              {lastInvite.emailSent
                ? `邀请邮件已发送到 ${lastInvite.email}。`
                : `邀请已创建，但邮件没有发出去（${lastInvite.emailError || '邮件服务未配置'}）。`}
            </p>
            <button
              type="button"
              onClick={() => setLastInvite(null)}
              aria-label="关闭邀请结果"
              className="shrink-0 text-foreground-subtle hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-foreground-muted">
            {lastInvite.emailSent
              ? '对方没收到时，可以把下面的链接直接发给他（同一个链接，7 天内有效）：'
              : '请把下面的链接直接发给对方 —— 这是它唯一一次出现，关闭后无法再显示。'}
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={lastInvite.url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="邀请链接"
              className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-card-border bg-background-tertiary text-xs text-foreground-muted font-mono"
            />
            <button
              type="button"
              onClick={() => void copyInviteLink(lastInvite.url)}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? '已复制' : '复制'}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── 邀请状态（可视化：待接受 / 已接受 / 已撤销 / 已过期） ── */}
      {canInvite && (invitations.data?.data?.length ?? 0) > 0 ? (
        <div className="rounded-2xl border border-card-border bg-background-secondary p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3.5 h-3.5 text-foreground-muted" />
            <p className="text-sm font-medium text-foreground">邀请记录</p>
            <span className="text-xs text-foreground-subtle">
              最近 {invitations.data?.data?.length} 条
            </span>
          </div>
          <ul className="divide-y divide-card-border">
            {(invitations.data?.data ?? []).map((inv) => {
              const st = INVITATION_STATUS[inv.status] ?? INVITATION_STATUS.EXPIRED
              return (
                <li key={inv.id} className="py-2 flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-foreground-muted">{inv.email}</span>
                  <span className="shrink-0 text-foreground-subtle">{ROLE_LABEL[inv.role] ?? inv.role}</span>
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${st.className}`}>
                    {st.label}
                  </span>
                  {inv.status === 'PENDING' ? (
                    <button
                      type="button"
                      onClick={() => void revokeInvite(inv)}
                      className="shrink-0 px-2 py-0.5 rounded text-[10px] text-foreground-muted hover:text-warning transition-colors"
                    >
                      撤销
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

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
            {q || role !== 'ALL'
              ? '换个条件再试。'
              : canInvite
                ? '用右上角的「邀请成员」发一封邀请，对方接受后就会出现在这里。'
                : '成员通过接受邀请加入 —— 邀请需要管理员或所有者权限。'}
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

              {/*
                ── 角色调整 ──
                只在**有权限**时出现（服务端已给出 capabilities）；没有权限时保留徽章，
                不渲染一个点了会 403 的控件。
                OWNER 行不给控件：所有权只能通过 org.transfer 转移。
                「改自己」不在这里隐藏 —— 服务端会以 409 拒绝并给出明确原因，
                这比前端猜"哪个是我"更可靠（列表未返回当前登录者身份）。
              */}
              {canUpdateRole && m.role !== 'OWNER' ? (
                <label className="shrink-0">
                  <span className="sr-only">修改 {m.displayName} 的角色</span>
                  <select
                    value={m.role}
                    disabled={busyId === m.membershipId}
                    onChange={(e) => void changeRole(m, e.target.value)}
                    aria-label={`修改 ${m.displayName} 的角色`}
                    className="px-2 py-1 rounded-lg border border-card-border bg-background-secondary text-xs text-foreground-muted hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40"
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r] ?? r}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {/*
                ── 移出 ──
                OWNER 行不渲染：只有所有者能移出所有者（且所有者应先转移所有权）。
                点击后先弹影响提示，确认才发请求 —— 移出是不可逆的权限变更，
                不该由"手滑点一下"完成。
              */}
              {canRemove && m.role !== 'OWNER' ? (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(m)}
                  aria-label={`移出 ${m.displayName}`}
                  className="shrink-0 p-1.5 rounded-lg text-foreground-subtle hover:text-warning hover:bg-warning/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              ) : null}
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

      {/* ── 移出确认：把"会发生什么"说清楚，而不是只问"确定吗" ── */}
      {confirmRemove ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-sm rounded-2xl border border-card-border bg-background-secondary p-5 space-y-3">
            <h2 id="remove-title" className="text-sm font-semibold text-foreground">
              移出 {confirmRemove.displayName}？
            </h2>
            <ul className="text-xs text-foreground-muted space-y-1 list-disc pl-4">
              <li>他/她将立即失去本社群的全部访问权限。</li>
              <li>已登录的会话在下一次请求时即被拒绝（不需要等他重新登录）。</li>
              <li>任务、成果与审计记录都会保留；重新邀请可恢复成员关系。</li>
              {confirmRemove.role === 'ADMIN' || confirmRemove.role === 'OWNER' ? (
                <li className="text-warning">
                  对方是管理员 —— 若这是最后一名管理员，操作会被拒绝。
                </li>
              ) : null}
            </ul>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmRemove(null)}
                disabled={removeBusy}
                className="px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground disabled:opacity-40 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void doRemove()}
                disabled={removeBusy}
                className="px-3 py-1.5 rounded-lg bg-warning/20 text-warning text-xs font-medium hover:bg-warning/30 disabled:opacity-40 transition-colors"
              >
                {removeBusy ? '移出中…' : '确认移出'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="text-[11px] text-foreground-subtle">
        邀请与移出都需要管理员及以上（`member.invite` / `member.remove`）。
        没有该能力时，这里的按钮不会出现 —— 而不是「点了没反应」。
      </p>
    </div>
  )
}

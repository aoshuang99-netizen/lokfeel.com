/**
 * T07 · 成员邀请（邀请 → 发送 → 接受 → 加入 → 审计）
 *
 * 三条设计决定，都是被具体的失败模式逼出来的：
 *
 * 1. **库里只存 token 的哈希**。明文的邀请 token 就是一张可直接使用的入场券；
 *    数据库一旦泄露，等价于把所有人的组织大门敞开。代价是"重发邀请"必须换票
 *    （旧链接立即失效）——这不是缺陷，而是"链接只在发出那一刻存在"的正确含义。
 *
 * 2. **接受时必须校验邮箱与会话账号一致**。否则一个链接被转发到群聊，
 *    任何拿到它的人都能加入组织。这是"链接即凭据"这个模型里最容易被忽略的一条。
 *
 * 3. **过期是惰性的**。没有定时任务去扫全表改状态；`expiresAt < now` 时
 *    读取即视为 EXPIRED，并在**真正被拿去接受**时落库为 EXPIRED（留下审计）。
 *    定时任务会带来"任务没跑就永远不过期"的新失败模式，而惰性判断不会。
 */

import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sendOrganizationInviteEmail } from '@/lib/email'
import { writeTenantAudit } from './audit'
import { TENANT_TX } from './tx'
import { TENANT_ROLES, can, type TenantRole } from './capabilities'
import type { TenantContext } from './resolve'

/** 邀请有效期（天）。7 天是"够传达到位"与"别留下长期有效链接"的折中。 */
export const INVITE_TTL_DAYS = 7
export const INVITE_EMAIL_MAX = 254

export type InviteRejectionCode =
  | 'CAPABILITY_REQUIRED'
  | 'INVALID_EMAIL'
  | 'INVALID_ROLE'
  | 'OWNER_GRANT_FORBIDDEN'
  | 'ALREADY_MEMBER'

export interface InviteRejection {
  ok: false
  status: 400 | 403 | 409
  code: InviteRejectionCode
  message: string
}

export type InvitePlan =
  | { ok: true; email: string; role: TenantRole }
  | InviteRejection

export interface InviteInput {
  actorRole: TenantRole
  email: unknown
  role: unknown
  /** 目标邮箱在本租户的成员状态；null 表示不是成员。 */
  existingMembershipStatus: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | null
}

/**
 * 邮箱规范化：去空白 + 小写。
 * 不在这里做"严格的 RFC 校验"——那件事没有正确的轻量实现，
 * 真正有效的验证是那封邮件能不能被收到（即接受时必须登录同一邮箱）。
 * 这里只拦明显不是邮箱的输入，避免把垃圾写进审计与发信队列。
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  if (!email || email.length > INVITE_EMAIL_MAX) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

/** 纯判定：这次邀请是否允许，以及拒绝的确切原因。 */
export function planInvite(input: InviteInput): InvitePlan {
  const { actorRole, existingMembershipStatus } = input

  if (!can(actorRole, 'member.invite')) {
    return {
      ok: false,
      status: 403,
      code: 'CAPABILITY_REQUIRED',
      message: 'Forbidden: missing capability member.invite',
    }
  }

  const email = normalizeEmail(input.email)
  if (!email) {
    return { ok: false, status: 400, code: 'INVALID_EMAIL', message: '邮箱格式不正确' }
  }

  const role = typeof input.role === 'string' ? input.role.trim().toUpperCase() : 'MEMBER'
  if (!(TENANT_ROLES as readonly string[]).includes(role)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_ROLE',
      message: `role must be one of ${TENANT_ROLES.join(' | ')}`,
    }
  }

  // 所有权不能"邀请"得到：只能通过 org.transfer 转移。
  // 否则"发一封邮件"就成了提权路径，而邮件是可以被转发/被误发的。
  if (role === 'OWNER') {
    return {
      ok: false,
      status: 403,
      code: 'OWNER_GRANT_FORBIDDEN',
      message: 'Forbidden: ownership must be transferred via org.transfer, not an invitation',
    }
  }

  if (existingMembershipStatus === 'ACTIVE') {
    return { ok: false, status: 409, code: 'ALREADY_MEMBER', message: '该邮箱已经是本组织成员' }
  }

  return { ok: true, email, role: role as TenantRole }
}

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function inviteAcceptUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.lokfeel.com').replace(/\/$/, '')
  return `${base}/invitations/accept?token=${encodeURIComponent(token)}`
}

export interface InvitationDto {
  id: string
  email: string
  role: string
  /** 展示态：PENDING 但已过期时返回 EXPIRED（库里可能仍是 PENDING，见文件头 3）。 */
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
  expiresAt: string
  createdAt: string
  acceptedAt: string | null
  revokedAt: string | null
}

interface InvitationRow {
  id: string
  email: string
  role: string
  status: string
  expiresAt: Date
  createdAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
}

const INVITATION_SELECT = {
  id: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  acceptedAt: true,
  revokedAt: true,
} as const

export function toInvitationDto(row: InvitationRow, now: Date = new Date()): InvitationDto {
  const expired = row.status === 'PENDING' && row.expiresAt.getTime() <= now.getTime()
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: (expired ? 'EXPIRED' : row.status) as InvitationDto['status'],
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  }
}

/**
 * 创建邀请。
 *
 * 同一邮箱重复邀请 → **换票**：旧 PENDING 置 REVOKED，新建一条。
 * 这样"重发"的语义是清楚的：只有最后发出的那封邮件有效，不用猜哪条链接还能用。
 */
export async function createInvitation(
  ctx: TenantContext,
  input: { email: unknown; role: unknown; organizationName?: string; inviterName?: string | null },
): Promise<{ invitation: InvitationDto; inviteUrl: string; emailSent: boolean; emailError?: string }> {
  if (!can(ctx.role, 'member.invite')) {
    throw new ForbiddenError('Forbidden: missing capability member.invite')
  }

  const existing = await db.membership.findFirst({
    where: {
      organizationId: ctx.organizationId,
      user: { email: typeof input.email === 'string' ? input.email.trim().toLowerCase() : '__none__' },
    },
    select: { status: true },
  })

  const plan = planInvite({
    actorRole: ctx.role,
    email: input.email,
    role: input.role,
    existingMembershipStatus: (existing?.status as InviteInput['existingMembershipStatus']) ?? null,
  })
  if (!plan.ok) {
    const details = { code: plan.code }
    if (plan.status === 403) throw new ForbiddenError(plan.message, details)
    if (plan.status === 409) throw new ConflictError(plan.message, details)
    throw new ValidationError(plan.message, details)
  }

  const token = generateInviteToken()
  const tokenHash = hashInviteToken(token)
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)

  const created = await db.$transaction(async (tx) => {
    // 旧票作废：同一邮箱只保留一条可用链接。
    await tx.organizationInvitation.updateMany({
      where: { organizationId: ctx.organizationId, email: plan.email, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    })
    return tx.organizationInvitation.create({
      data: {
        organizationId: ctx.organizationId,
        email: plan.email,
        role: plan.role,
        tokenHash,
        status: 'PENDING',
        invitedBy: ctx.userId,
        expiresAt,
      },
      select: INVITATION_SELECT,
    })
  }, TENANT_TX)

  const inviteUrl = inviteAcceptUrl(token)

  // 发信失败**不**回滚邀请：管理员仍然可以把链接直接给人（返回值里有 inviteUrl）。
  // 反过来"邮件发不出去就当作邀请失败"会让一次 SMTP 抖动变成一次业务失败。
  let emailSent = false
  let emailError: string | undefined
  try {
    const res = await sendOrganizationInviteEmail({
      to: plan.email,
      organizationName: input.organizationName || 'LokFeel 组织',
      inviterName: input.inviterName ?? null,
      inviteUrl,
      expiresInDays: INVITE_TTL_DAYS,
    })
    emailSent = res.success
    emailError = res.error
  } catch (err) {
    emailError = (err as Error)?.message ?? 'send_failed'
  }

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'invitation.created',
    resourceType: 'invitation',
    resourceId: created.id,
    // 邮箱属 PII：审计里只留域名以外的事实（角色 + 是否发出），不落完整地址。
    safeMetadata: { role: plan.role, emailSent, reissued: Boolean(existing) },
  }).catch(() => {})

  return { invitation: toInvitationDto(created as unknown as InvitationRow), inviteUrl, emailSent, emailError }
}

export async function listInvitations(ctx: TenantContext): Promise<InvitationDto[]> {
  if (!can(ctx.role, 'member.read')) {
    throw new ForbiddenError('Forbidden: missing capability member.read')
  }
  const rows = await db.organizationInvitation.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: INVITATION_SELECT,
  })
  const now = new Date()
  return rows.map((r) => toInvitationDto(r as unknown as InvitationRow, now))
}

export async function revokeInvitation(ctx: TenantContext, invitationId: string): Promise<InvitationDto> {
  if (!can(ctx.role, 'member.invite')) {
    throw new ForbiddenError('Forbidden: missing capability member.invite')
  }
  const target = await db.organizationInvitation.findFirst({
    where: { id: invitationId, organizationId: ctx.organizationId },
    select: { ...INVITATION_SELECT, status: true },
  })
  if (!target) throw new NotFoundError('Invitation not found')
  if (target.status !== 'PENDING') {
    throw new ConflictError(`invitation is not pending (status=${target.status})`, { code: 'NOT_PENDING' })
  }

  const updated = await db.organizationInvitation.update({
    where: { id: target.id },
    data: { status: 'REVOKED', revokedAt: new Date() },
    select: INVITATION_SELECT,
  })

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'invitation.revoked',
    resourceType: 'invitation',
    resourceId: target.id,
    safeMetadata: {},
  }).catch(() => {})

  return toInvitationDto(updated as unknown as InvitationRow)
}

export type AcceptRejectionCode =
  | 'INVALID_TOKEN'
  | 'NOT_PENDING'
  | 'EXPIRED'
  | 'EMAIL_MISMATCH'
  | 'ALREADY_MEMBER'

export interface AcceptResult {
  organizationId: string
  role: TenantRole
  /** true 表示这次接受把一条 SUSPENDED 的旧成员关系恢复成了 ACTIVE。 */
  reactivated: boolean
}

/**
 * 接受邀请。
 *
 * 全部判定与写入在同一事务里：邀请只能被消费一次，不能出现"两个人同时点同一个链接
 * 都成功"（那时第一条 UPDATE 之后 status 已不是 PENDING，第二条会拿到 NOT_PENDING）。
 *
 * 🔴 为什么 reject 分支是 `return` 而不是 `throw`：
 *   交互事务里 `throw` 会**回滚事务内已执行的全部语句**。过期分支需要在库里留下
 *   `status='EXPIRED'`（那是"有人拿过期链接来试过"的唯一证据），一旦边写边抛，
 *   这条写入就永远提交不了 —— 接口一直答 EXPIRED，库里永远还是 PENDING，
 *   于是"惰性落库"只是注释里的说法。
 *   改成"事务内正常返回判定结果、事务提交后再抛"，两边都对：
 *   过期事实落库了，对外仍然是 409 EXPIRED。
 *   2026-11-07 生产路径 E2E 的 A06 就是这条断言红：接口 409/EXPIRED，DB 仍是 PENDING。
 */
export async function acceptInvitation(params: {
  userId: string
  userEmail: string
  token: string
}): Promise<AcceptResult> {
  const token = params.token?.trim()
  if (!token) throw new ValidationError('token is required', { code: 'INVALID_TOKEN' })

  const tokenHash = hashInviteToken(token)

  const outcome = await db.$transaction(
    async (tx) => {
      const invitation = await tx.organizationInvitation.findUnique({
        where: { tokenHash },
        select: { id: true, organizationId: true, email: true, role: true, status: true, expiresAt: true },
      })
      if (!invitation) return { kind: 'invalid_token' as const }

      if (invitation.status !== 'PENDING') {
        return { kind: 'not_pending' as const, status: invitation.status }
      }

      if (invitation.expiresAt.getTime() <= Date.now()) {
        // 惰性落库：把过期这个事实写下来，审计里才看得到"有人拿过期链接来试过"。
        await tx.organizationInvitation.update({
          where: { id: invitation.id },
          data: { status: 'EXPIRED' },
        })
        return { kind: 'expired' as const }
      }

      // 链接即凭据 ⇒ 必须绑定到被邀请的邮箱，否则转发即越权。
      if (invitation.email.toLowerCase() !== params.userEmail.trim().toLowerCase()) {
        return { kind: 'email_mismatch' as const }
      }

      const existing = await tx.membership.findFirst({
        where: { organizationId: invitation.organizationId, userId: params.userId },
        select: { id: true, status: true },
      })
      if (existing?.status === 'ACTIVE') {
        return { kind: 'already_member' as const }
      }

      // 恢复旧关系而不是新建：@@unique([organizationId, userId]) 决定了只能有一条。
      const membership = existing
        ? await tx.membership.update({
            where: { id: existing.id },
            data: { status: 'ACTIVE', role: invitation.role as TenantRole },
            select: { id: true, role: true },
          })
        : await tx.membership.create({
            data: {
              organizationId: invitation.organizationId,
              userId: params.userId,
              role: invitation.role as TenantRole,
              status: 'ACTIVE',
            },
            select: { id: true, role: true },
          })

      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedBy: params.userId },
      })

      return {
        kind: 'accepted' as const,
        organizationId: invitation.organizationId,
        role: membership.role as TenantRole,
        reactivated: Boolean(existing),
        membershipId: membership.id,
        invitationId: invitation.id,
      }
    },
    TENANT_TX,
  )

  // ── 事务已提交，按判定结果向外抛出（副作用已被保留） ──
  switch (outcome.kind) {
    case 'invalid_token':
      throw new NotFoundError('Invitation not found', { code: 'INVALID_TOKEN' })
    case 'not_pending':
      throw new ConflictError(`invitation is not pending (status=${outcome.status})`, { code: 'NOT_PENDING' })
    case 'expired':
      throw new ConflictError('invitation has expired', { code: 'EXPIRED' })
    case 'email_mismatch':
      throw new ForbiddenError('This invitation was issued to a different email address', {
        code: 'EMAIL_MISMATCH',
      })
    case 'already_member':
      throw new ConflictError('you are already a member of this organization', { code: 'ALREADY_MEMBER' })
  }

  await writeTenantAudit({
    organizationId: outcome.organizationId,
    actorId: params.userId,
    eventType: 'invitation.accepted',
    resourceType: 'membership',
    resourceId: outcome.membershipId,
    safeMetadata: {
      role: outcome.role,
      reactivated: outcome.reactivated,
      invitationId: outcome.invitationId,
    },
  }).catch(() => {})

  return {
    organizationId: outcome.organizationId,
    role: outcome.role,
    reactivated: outcome.reactivated,
  }
}

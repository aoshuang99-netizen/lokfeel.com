/**
 * P0-1 · 真人邀请完整闭环 —— 领域层
 *
 * 修的是一条真实的断链：旧 `/api/invites` 用进程内存 Map 存邀请码，
 * 服务一重启就全丢；POST 只返回 `valid:true`，从不建立任何关系。
 * 用户看到「邀请码看起来有效、复制了链接、对方注册了，却什么连接都没有」。
 *
 * 本模块把邀请码落到**持久化**的 `VerificationToken` 表（重启仍在），并让
 * 「接受」成为唯一能建立真实关系的操作：
 *   A 创建 → B 打开 → 注册/登录 → B 显式 accept → Match(ACCEPTED) + Conversation
 *
 * 设计约束（全部有对应测试）：
 *   1. 持久化：`createFriendInvite` 写入 DB，换实例（重启）仍可 find 回来；
 *   2. 过期/重复/撤回/伪造/越权：五种拒绝，各有稳定 `code`；
 *   3. 未同意不建联：只有 `acceptFriendInvite` 会写 Match/Conversation；
 *   4. 幂等：token 一次性（maxUses=1）；按用户对 upsert Conversation，
 *      重复 accept 不产生第二条关系或会话；
 *   5. **不碰企业邀请**：本模块不读 organizationInvitation / membership，
 *      个人好友关系与企业成员身份是两套东西。
 *
 * 依赖注入 `db` 而非直接 import singleton：让"服务重启"可被确定性地单测，
 * 也让 API 层可以传入带事务的 client。
 */

export const INVITE_PREFIX = 'INV-'
const INVITE_IDENTIFIER = 'friend-invite'
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 去掉易混的 I/O/0/1
const CODE_LEN = 6

export type InviteStatus = 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'REVOKED'

export type FriendInviteErrorCode =
  | 'INVALID_CODE'
  | 'EXPIRED'
  | 'ALREADY_ACCEPTED'
  | 'INVITE_REVOKED'
  | 'SELF_INVITE'
  | 'FORBIDDEN'
  | 'CONFLICT'

export class FriendInviteError extends Error {
  readonly code: FriendInviteErrorCode
  readonly httpStatus: number
  constructor(code: FriendInviteErrorCode, message: string) {
    super(message)
    this.name = 'FriendInviteError'
    this.code = code
    this.httpStatus =
      code === 'INVALID_CODE' || code === 'SELF_INVITE' || code === 'FORBIDDEN'
        ? 400
        : 409
  }
}

/** 领域所需的最小 db 表面（便于注入 fake 与事务 client）。 */
export interface FriendInviteDb {
  verificationToken: {
    findFirst(args: {
      where: { identifier: string; token: string }
    }): Promise<{ id: string; token: string; expires: Date; userId: string | null; used: boolean; useCount: number; maxUses: number } | null>
    create(args: {
      data: { identifier: string; token: string; expires: Date; userId: string; maxUses: number }
    }): Promise<unknown>
    update(args: {
      where: { id: string }
      data: Record<string, unknown>
    }): Promise<unknown>
    updateMany(args: {
      where: { id?: string; used?: boolean }
      data: Record<string, unknown>
    }): Promise<{ count: number }>
  }
  match: {
    findFirst(args: {
      where: { id?: string; OR?: { senderId: string; receiverId: string }[] }
    }): Promise<{ id: string; status: string } | null>
    create(args: {
      data: { senderId: string; receiverId: string; status: string; matchScore: number; matchReason: string }
    }): Promise<{ id: string; status?: string }>
  }
  conversation: {
    upsert(args: {
      where: { userAId_userBId: { userAId: string; userBId: string } }
      create: {
        userAId: string
        userBId: string
        initiatorId: string
        matchId?: string
        state: string
        participants: { create: { userId: string }[] }
      }
      update: Record<string, unknown>
    }): Promise<{ id: string }>
  }
  $transaction<T>(fn: (tx: FriendInviteDb) => Promise<T>): Promise<T>
}

export interface CreateInviteResult {
  /** 展示给用户的短码（不含前缀，便于输入） */
  code: string
  /** 完整 token（落库用），形如 INV-AB12CD */
  token: string
  expiresAt: Date
  inviteUrl: string
}

export interface FoundInvite {
  token: string
  inviterId: string
  status: InviteStatus
  expiresAt: Date
}

export interface AcceptResult {
  inviterId: string
  accepterId: string
  matchId: string
  conversationId: string
}

/** 规范化用户输入的邀请码：大小写归一、去连字符/空白，非法形状抛错。 */
export function normalizeInviteCode(raw: unknown): string {
  if (typeof raw !== 'string') throw new FriendInviteError('INVALID_CODE', '邀请码不合法')
  const cleaned = raw.trim().toUpperCase().replace(/[\s-]/g, '')
  if (!cleaned || cleaned.length > 32 || !/^[A-Z0-9]+$/.test(cleaned)) {
    throw new FriendInviteError('INVALID_CODE', '邀请码不合法')
  }
  return cleaned
}

function tokenFromInput(raw: string): string {
  const cleaned = normalizeInviteCode(raw)
  // normalizeInviteCode 会去掉连字符，故 "INV-AB12CD" 变成 "INVAB12CD"。
  // 这里按「去连字符后的前缀」判断，再补回规范形式，避免重复加前缀。
  const prefixNoDash = INVITE_PREFIX.replace(/-/g, '')
  const body = cleaned.startsWith(prefixNoDash) ? cleaned.slice(prefixNoDash.length) : cleaned
  return `${INVITE_PREFIX}${body}`
}

function generateCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LEN; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return out
}

function inviteUrlFor(code: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.lokfeel.com').replace(/\/$/, '')
  return `${base}/connect/invite?code=${encodeURIComponent(code)}`
}

/** A 创建邀请：写入持久化 token（一次性、7 天有效）。 */
export async function createFriendInvite(
  db: FriendInviteDb,
  inviterId: string,
  now: Date = new Date()
): Promise<CreateInviteResult> {
  if (!inviterId) throw new FriendInviteError('FORBIDDEN', '必须先登录才能邀请好友')
  const code = generateCode()
  const token = `${INVITE_PREFIX}${code}`
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS)
  await db.verificationToken.create({
    data: {
      identifier: INVITE_IDENTIFIER,
      token,
      expires: expiresAt,
      userId: inviterId,
      maxUses: 1,
    },
  })
  // code 对外就是完整 token（带前缀）：复制即用，输入时 normalizeInviteCode 兼容
  // 带/不带前缀两种写法，避免"短码与完整码到底哪个能输"的二义性。
  return { code: token, token, expiresAt, inviteUrl: inviteUrlFor(code) }
}

/**
 * 查询邀请码状态（不消费、不建联）。
 * 过期是惰性的：expires <= now 时对外报 EXPIRED，但不在这里写库
 * （写库发生在真正 accept 时，见 acceptFriendInvite 的过期分支）。
 */
export async function findInviteByCode(
  db: FriendInviteDb,
  rawCode: string,
  now: Date = new Date(Date.now())
): Promise<FoundInvite | null> {
  const token = tokenFromInput(rawCode)
  const row = await db.verificationToken.findFirst({
    where: { identifier: INVITE_IDENTIFIER, token },
  })
  if (!row) return null
  let status: InviteStatus
  if (row.maxUses === 0) status = 'REVOKED'
  else if (row.used || row.useCount > 0) status = 'ACCEPTED'
  else if (row.expires.getTime() <= now.getTime()) status = 'EXPIRED'
  else status = 'PENDING'
  return {
    token,
    inviterId: row.userId ?? '',
    status,
    expiresAt: row.expires,
  }
}

/**
 * B 显式接受：唯一建立真实关系的操作。
 *
 * 事务内 CAS 消费 token（used=false → used=true），任一并发者拿不到即判
 * ALREADY_ACCEPTED；随后 upsert Match + Conversation。过期分支在事务内
 * 落库 EXPIRED 后**返回判定**（不 throw，避免回滚掉过期事实），提交后再抛。
 */
export async function acceptFriendInvite(
  db: FriendInviteDb,
  params: {
    code: string
    accepterId: string
    /** 幂等模式：已接受时返回同一 conversation，不抛错（供重试/网络抖动） */
    idempotent?: boolean
  },
  now: Date = new Date(Date.now())
): Promise<AcceptResult> {
  const { accepterId, idempotent } = params
  if (!accepterId) throw new FriendInviteError('FORBIDDEN', '必须先登录才能接受邀请')
  const token = tokenFromInput(params.code)

  const outcome:
    | { kind: 'ok'; inviterId: string; matchId: string; conversationId: string }
    | { kind: 'invalid' }
    | { kind: 'expired' }
    | { kind: 'already'; inviterId: string; conversationId: string }
    | { kind: 'self' }
    | { kind: 'revoked' } = await db.$transaction(async (tx) => {
    const row = await tx.verificationToken.findFirst({
      where: { identifier: INVITE_IDENTIFIER, token },
    })
    if (!row) return { kind: 'invalid' as const }

    const inviterId = row.userId ?? ''
    if (inviterId === accepterId) return { kind: 'self' as const }

    // 撤回：maxUses 被置 0（见 revokeFriendInvite）。必须在 used 分支之前判，
    // 否则撤回会被误读成"已接受"。
    if (row.maxUses === 0) return { kind: 'revoked' as const }

    // 已消费：按用户对找已有会话，幂等返回同一条。
    if (row.used || row.useCount > 0) {
      const existing = await tx.match.findFirst({
        where: {
          OR: [
            { senderId: inviterId, receiverId: accepterId },
            { senderId: accepterId, receiverId: inviterId },
          ],
        },
      })
      const conv = await tx.conversation.upsert({
        where: {
          userAId_userBId: {
            userAId: inviterId < accepterId ? inviterId : accepterId,
            userBId: inviterId < accepterId ? accepterId : inviterId,
          },
        },
        create: {
          userAId: inviterId < accepterId ? inviterId : accepterId,
          userBId: inviterId < accepterId ? accepterId : inviterId,
          initiatorId: inviterId,
          ...(existing ? { matchId: existing.id } : {}),
          state: 'ACTIVE',
          participants: {
            create: [{ userId: inviterId }, { userId: accepterId }],
          },
        },
        update: { state: 'ACTIVE' },
      })
      return { kind: 'already' as const, inviterId, conversationId: conv.id }
    }

    if (row.expires.getTime() <= now.getTime()) {
      // 惰性留痕：只写 lastUsedAt，记录"有人拿过期邀请来试过"。
      // 刻意不设 used/useCount —— 那会把"过期"误读成"已接受"（findInviteByCode
      // 靠 expires<=now 判 EXPIRED，present status 必须保持一致）。
      await tx.verificationToken.update({
        where: { id: row.id },
        data: { lastUsedAt: now },
      })
      return { kind: 'expired' as const }
    }

    // CAS：只有把 used=false 的那一行抢到，才算真正消费成功。
    const consumed = await tx.verificationToken.updateMany({
      where: { id: row.id, used: false },
      data: { used: true, useCount: 1, lastUsedAt: now },
    })
    if (consumed.count === 0) return { kind: 'already' as const, inviterId, conversationId: '' }

    // 按用户对幂等取 Match：已 ACCEPTED 则复用，不新建第二条关系。
    const existingMatch = await tx.match.findFirst({
      where: {
        OR: [
          { senderId: inviterId, receiverId: accepterId },
          { senderId: accepterId, receiverId: inviterId },
        ],
      },
    })
    const matchId = existingMatch
      ? existingMatch.id
      : (
          await tx.match.create({
            data: {
              senderId: inviterId,
              receiverId: accepterId,
              status: 'ACCEPTED',
              matchScore: 100,
              matchReason: 'friend-invite: explicit accept',
            },
          })
        ).id

    const [first, second] = inviterId < accepterId ? [inviterId, accepterId] : [accepterId, inviterId]
    const conv = await tx.conversation.upsert({
      where: { userAId_userBId: { userAId: first, userBId: second } },
      create: {
        userAId: first,
        userBId: second,
        initiatorId: inviterId,
        matchId,
        state: 'ACTIVE',
        participants: { create: [{ userId: first }, { userId: second }] },
      },
      update: { state: 'ACTIVE', matchId },
    })

    return { kind: 'ok' as const, inviterId, matchId, conversationId: conv.id }
  })

  switch (outcome.kind) {
    case 'ok':
      return {
        inviterId: outcome.inviterId,
        accepterId,
        matchId: outcome.matchId,
        conversationId: outcome.conversationId,
      }
    case 'invalid':
      throw new FriendInviteError('INVALID_CODE', '邀请码无效')
    case 'expired':
      throw new FriendInviteError('EXPIRED', '邀请已过期')
    case 'self':
      throw new FriendInviteError('SELF_INVITE', '不能接受自己发出的邀请')
    case 'already':
      if (idempotent) {
        // 需要 inviterId 才能拼结果；再查一次（此时 token 已消费）。
        const found = await findInviteByCode(db, params.code, now)
        return {
          inviterId: found?.inviterId ?? '',
          accepterId,
          matchId: '',
          conversationId: outcome.conversationId,
        }
      }
      throw new FriendInviteError('ALREADY_ACCEPTED', '该邀请已被接受')
    case 'revoked':
      throw new FriendInviteError('INVITE_REVOKED', '邀请已被撤回')
  }
}

/** 撤回邀请：仅邀请人本人有权；已接受的不能再撤。 */
export async function revokeFriendInvite(
  db: FriendInviteDb,
  params: { code: string; actorId: string },
  now: Date = new Date(Date.now())
): Promise<{ token: string; status: InviteStatus }> {
  const token = tokenFromInput(params.code)
  const row = await db.verificationToken.findFirst({
    where: { identifier: INVITE_IDENTIFIER, token },
  })
  if (!row) throw new FriendInviteError('INVALID_CODE', '邀请码无效')
  if ((row.userId ?? '') !== params.actorId) {
    throw new FriendInviteError('FORBIDDEN', '只有邀请人本人可以撤回')
  }
  if (row.used || row.useCount > 0) {
    throw new FriendInviteError('ALREADY_ACCEPTED', '已被接受的邀请无法撤回')
  }
  // maxUses=0 表达 REVOKED（复用已有持久化字段，无需新增 schema 列）。
  // 刻意不设 used：这样 accept 能先判 maxUses===0 → REVOKED，而不是误读成已接受。
  await db.verificationToken.update({
    where: { id: row.id },
    data: { maxUses: 0, lastUsedAt: now },
  })
  return { token, status: 'REVOKED' }
}

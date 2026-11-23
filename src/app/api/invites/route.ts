/**
 * `/api/invites` —— 个人好友邀请（**不是**企业成员邀请）
 *
 * 原实现用进程内存 Map 存邀请码：服务一重启全丢，POST 只返回 `valid:true`
 * 从不建关系。现在邀请码落到持久化的 `VerificationToken`（领域层见
 * `lib/social/friend-invites.ts`），重启仍在；建立关系只发生在显式 accept。
 *
 *   GET  列出我的邀请码 + 状态（登录后）
 *   POST 生成一张新的好友邀请（登录后）
 *
 * 企业成员邀请走 `/api/v1/invitations`（ADMIN + member.invite 能力），
 * 与本接口是两套东西 —— 不能拿企业邀请冒充个人好友连接。
 */
import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth/auth'
import { db } from '@/lib/db'
import { FriendInviteError, createFriendInvite, findInviteByCode, type FriendInviteDb } from '@/lib/social/friend-invites'

export const dynamic = 'force-dynamic'

const dbDomain = db as unknown as FriendInviteDb

/** GET：返回当前用户所有个人好友邀请及其展示状态。 */
export async function GET() {
  try {
    const { user } = await requireAuth()
    // 复用 VerificationToken 表，identifier 固定；只取当前用户的邀请行。
    const rows = await db.verificationToken.findMany({
      where: { identifier: 'friend-invite', userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { token: true, expires: true, used: true, useCount: true, maxUses: true },
    })
    const invites = await Promise.all(
      rows.map(async (r) => {
        const found = await findInviteByCode(dbDomain, r.token)
        return {
          code: r.token,
          status: found?.status ?? 'PENDING',
          expiresAt: r.expires.toISOString(),
        }
      })
    )
    // 兼容旧 UX：用户第一次打开邀请面板就应有一张可用邀请码（旧实现 GET 即生成）。
    // 若一张都没有，惰性创建一张持久化的，避免空态把「Your Invite Code」整块藏掉。
    let current = invites
    if (invites.length === 0) {
      const created = await createFriendInvite(dbDomain, user.id)
      current = [
        {
          code: created.code,
          status: 'PENDING',
          expiresAt: created.expiresAt.toISOString(),
        },
      ]
    }
    const pending = current.filter((i) => i.status === 'PENDING')
    const connected = current.filter((i) => i.status === 'ACCEPTED')
    return success({
      inviteCode: pending[0]?.code ?? current[0]?.code ?? null,
      invites: current,
      // 兼容旧 UI 字段：accepted 张数即"好友已加入数"
      inviteCount: connected.length,
      inviteRewards: connected.length * 50,
      rewards: { perInvite: 50, maxInvites: 10 },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

/** POST：生成一张新的好友邀请（7 天有效、一次性）。 */
export async function POST(_req: NextRequest) {
  try {
    const { user } = await requireAuth()
    const created = await createFriendInvite(dbDomain, user.id)
    return success(
      {
        code: created.code,
        inviteUrl: created.inviteUrl,
        expiresAt: created.expiresAt.toISOString(),
      },
      undefined,
      201
    )
  } catch (error) {
    if (error instanceof FriendInviteError) {
      return errorResponse(new Error(error.message))
    }
    return errorResponse(error)
  }
}

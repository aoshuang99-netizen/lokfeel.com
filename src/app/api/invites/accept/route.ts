/**
 * POST `/api/invites/accept` —— B 显式接受个人好友邀请
 *
 * 这是**唯一**会建立真实好友关系的操作。注册/登录本身绝不自动建联 ——
 * 用户必须带着邀请码来到这里、明确点"接受"，才会写 Match(ACCEPTED) +
 * Conversation（双方 participant）。从此 A/B 会话列表里能看到彼此、能收发消息。
 *
 * 会话身份即受邀人：accepterId 取自 requireAuth()，不读 body —— 否则
 * "谁接受了邀请"就由客户端说了算（越权建联）。
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/auth'
import { db } from '@/lib/db'
import { acceptFriendInvite, FriendInviteError, type FriendInviteDb } from '@/lib/social/friend-invites'

export const dynamic = 'force-dynamic'

const dbDomain = db as unknown as FriendInviteDb

function fail(err: FriendInviteError) {
  return NextResponse.json(
    {
      error: { code: err.code, message: err.message },
      code: err.code,
      message: err.message,
    },
    { status: err.httpStatus }
  )
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth()
    let body: { code?: unknown; idempotent?: unknown }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'INVALID_CODE', message: '请求体必须是合法 JSON' } },
        { status: 400 }
      )
    }
    if (typeof body.code !== 'string' || !body.code.trim()) {
      return NextResponse.json(
        { error: { code: 'INVALID_CODE', message: '缺少邀请码' } },
        { status: 400 }
      )
    }

    const result = await acceptFriendInvite(dbDomain, {
      code: body.code,
      accepterId: user.id,
      idempotent: body.idempotent === true,
    })
    return NextResponse.json({
      success: true,
      inviterId: result.inviterId,
      accepterId: result.accepterId,
      matchId: result.matchId,
      conversationId: result.conversationId,
      // 前端拿到它可直接跳到会话详情；/dashboard/chats 与该 id 都认。
      chatUrl: result.conversationId ? `/dashboard/chats/${result.conversationId}` : '/dashboard/chats',
    })
  } catch (error) {
    if (error instanceof FriendInviteError) return fail(error)
    console.error('[invites/accept] unexpected error:', error)
    return NextResponse.json({ error: { code: 'INTERNAL', message: '接受邀请失败，请稍后重试' } }, { status: 500 })
  }
}

/**
 * POST `/api/invites/revoke` —— 邀请人撤回个人好友邀请
 *
 * 只有邀请人本人有权撤回（领域层校验），已接受的邀请不可撤回。
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/auth'
import { db } from '@/lib/db'
import { revokeFriendInvite, FriendInviteError, type FriendInviteDb } from '@/lib/social/friend-invites'

export const dynamic = 'force-dynamic'

const dbDomain = db as unknown as FriendInviteDb

function fail(err: FriendInviteError) {
  return NextResponse.json(
    { error: { code: err.code, message: err.message }, code: err.code, message: err.message },
    { status: err.httpStatus }
  )
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth()
    let body: { code?: unknown }
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
    const result = await revokeFriendInvite(dbDomain, { code: body.code, actorId: user.id })
    return NextResponse.json({ success: true, code: result.token, status: result.status })
  } catch (error) {
    if (error instanceof FriendInviteError) return fail(error)
    console.error('[invites/revoke] unexpected error:', error)
    return NextResponse.json({ error: { code: 'INTERNAL', message: '撤回失败，请稍后重试' } }, { status: 500 })
  }
}

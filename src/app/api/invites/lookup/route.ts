/**
 * GET `/api/invites/lookup?code=...` —— 公开的邀请码只读校验
 *
 * 落地页在用户登录前就要判断"这张邀请还在不在"，所以此端点不要求会话。
 * 严格限制暴露面：只回 `status`（PENDING/EXPIRED/ACCEPTED/REVOKED），
 * **不回邀请人 id/邮箱**，也不创建任何关系 —— 那是显式 accept 的事。
 * 邀请码本身（16 位随机）就是凭据，枚举成本高；这里不做限流（沿用全局限流层）。
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { findInviteByCode, type FriendInviteDb } from '@/lib/social/friend-invites'

export const dynamic = 'force-dynamic'

const dbDomain = db as unknown as FriendInviteDb

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') ?? ''
  if (!code.trim()) {
    return NextResponse.json({ error: { code: 'INVALID_CODE', message: '缺少邀请码' } }, { status: 400 })
  }
  try {
    const found = await findInviteByCode(dbDomain, code)
    if (!found) {
      return NextResponse.json({ error: { code: 'INVALID_CODE', message: '邀请码无效' } }, { status: 404 })
    }
    return NextResponse.json({ success: true, data: { status: found.status } })
  } catch (error) {
    console.error('[invites/lookup] unexpected error:', error)
    return NextResponse.json({ error: { code: 'INTERNAL', message: '查询失败' } }, { status: 500 })
  }
}

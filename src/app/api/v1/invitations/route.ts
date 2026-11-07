/**
 * `/api/v1/invitations` —— 成员邀请（租户作用域）
 *
 *   GET   列出本组织的邀请（能力 `member.read`）
 *   POST  发出邀请（能力 `member.invite`，ADMIN+）
 *
 * 🔴 响应里**包含一段时间的邀请链接**（`inviteUrl`）。这是有意的：
 *    邮件服务抖动时，"把链接直接发给对方"是唯一不撒谎的兜底。
 *    同时 `emailSent` 明确告诉调用方邮件到底发出去没有 —— UI 必须据此显示不同的文案，
 *    不能一律显示"邀请已发送"。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { db } from '@/lib/db'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { createInvitation, listInvitations } from '@/lib/tenancy/invitations'

export const dynamic = 'force-dynamic'

export const GET = withTenant('member.read')(async (_req: NextRequest, tenant) => {
  try {
    return success({ invitations: await listInvitations(tenant) })
  } catch (error) {
    return errorResponse(error)
  }
})

export const POST = withTenant('member.invite')(async (req: NextRequest, tenant) => {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    if (!body || typeof body !== 'object') throw new ValidationError('Request body must be an object')
    const { email, role } = body as { email?: unknown; role?: unknown }

    // 邮件正文里的组织名与邀请人名字：从库读，不信任客户端传值
    // （否则可以伪造一封"来自 X 组织"的邮件发给自己）。
    const [org, inviter] = await Promise.all([
      db.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true } }),
      db.user.findUnique({ where: { id: tenant.userId }, select: { name: true, email: true } }),
    ])

    const result = await createInvitation(tenant, {
      email,
      role,
      organizationName: org?.name,
      inviterName: inviter?.name || inviter?.email || null,
    })
    return success(result, undefined, 201)
  } catch (error) {
    return errorResponse(error)
  }
})

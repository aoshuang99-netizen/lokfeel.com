/**
 * `/api/v1/invitations/[invitationId]`
 *
 *   DELETE  撤销一条待接受的邀请（能力 `member.invite`）
 *
 * 撤销是**终态**：不再接受同一 token。要让对方重新进来，请重新发一封（换票）。
 * 这样"撤销"的语义才可靠 —— 否则撤销后旧链接仍然有效，撤销就是假的。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { NotFoundError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { revokeInvitation } from '@/lib/tenancy/invitations'

function invitationIdOf(params: unknown): string {
  const id = (params as { invitationId?: string } | undefined)?.invitationId
  if (!id || typeof id !== 'string') throw new NotFoundError('Invitation not found')
  return id
}

export const DELETE = withTenant('member.invite')(async (_req: NextRequest, tenant, params) => {
  try {
    return success(await revokeInvitation(tenant, invitationIdOf(params)))
  } catch (error) {
    return errorResponse(error)
  }
})

/**
 * V21 · G09 `GET|POST /api/v1/missions/[missionId]/verification`
 *
 *   GET   核验记录或 **null**（不是空数组假绿）
 *   POST  第二人对真实回执做独立核验；模型输出不作为证据
 *
 * 能力：GET `outcome.read`（成员可读），POST `outcome.verify`（ADMIN+，取严）。
 * 五道前置全部在**服务端**强制（sourceRunId / EXECUTED / AgentExecution 回执 /
 * criteria 全 true / verifierId !== run.requestedBy），缺一 409。
 * verifierId 只取会话，不接受请求体里的身份字段。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { createVerification, getVerification } from '@/lib/connection/verification'

function missionIdOf(params: unknown): string {
  const id = (params as { missionId?: string } | undefined)?.missionId
  if (!id || typeof id !== 'string') throw new NotFoundError('Mission not found')
  return id
}

export const GET = withTenant('outcome.read')(async (_req: NextRequest, tenant, params) => {
  try {
    return success(await getVerification(tenant, missionIdOf(params)))
  } catch (error) {
    return errorResponse(error)
  }
})

export const POST = withTenant('outcome.verify')(async (req: NextRequest, tenant, params) => {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    return success(await createVerification(tenant, missionIdOf(params), body))
  } catch (error) {
    return errorResponse(error)
  }
})

/**
 * T03 · `/api/v1/intents/[intentId]`
 *
 *   GET    读取自己的意图（能力 `intent.read`）
 *   PATCH  编辑意图（能力 `intent.manage`）
 *
 * ⚠️ 服务层的 where 是**三重谓词**（id + organizationId + userId）。
 * 因此"别人的意图"与"别家租户的意图"在这里表现完全一致 —— 都是 404。
 * 这一层不额外做 owner 判断：把"谁能读"下沉到服务层谓词里，
 * 路由层就不存在"忘了加 owner 检查"的漏洞面。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { getIntent, parseIntentPatch, updateIntent } from '@/lib/connection'

function intentIdOf(params: unknown): string {
  const id = (params as { intentId?: string } | undefined)?.intentId
  if (!id || typeof id !== 'string') throw new NotFoundError('Intent not found')
  return id
}

export const GET = withTenant('intent.read')(async (_req: NextRequest, tenant, params) => {
  try {
    return success(await getIntent(tenant, intentIdOf(params)))
  } catch (error) {
    return errorResponse(error)
  }
})

export const PATCH = withTenant('intent.manage')(async (req: NextRequest, tenant, params) => {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    const patch = parseIntentPatch(body)
    return success(await updateIntent(tenant, intentIdOf(params), patch))
  } catch (error) {
    return errorResponse(error)
  }
})

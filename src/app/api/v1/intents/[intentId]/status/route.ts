/**
 * T03 · `/api/v1/intents/[intentId]/status` —— 意图状态迁移
 *
 *   POST { action: 'withdraw' | 'reactivate' }
 *
 * 与 T02 的 `/missions/[missionId]/pause` 同形（`{ action }` 风格），
 * 但语义上**幂等**：目标态已达成时直接返回当前状态，不报 409 ——
 * 撤销是本人对自己数据的动作，重复点击不该收到错误。
 *
 * 「撤销」的实际约束力不只在 status 字段：服务层的 `liveDisclosureOf()`
 * 会让撤销/过期后的意图**当即可披露字段归零**，无需任何定时任务参与。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { parseIntentStatusAction, transitionIntent } from '@/lib/connection'

function intentIdOf(params: unknown): string {
  const id = (params as { intentId?: string } | undefined)?.intentId
  if (!id || typeof id !== 'string') throw new NotFoundError('Intent not found')
  return id
}

export const POST = withTenant('intent.manage')(async (req: NextRequest, tenant, params) => {
  try {
    let body: unknown = {}
    const raw = await req.text()
    if (raw && raw.trim()) {
      try {
        body = JSON.parse(raw)
      } catch {
        throw new ValidationError('Request body must be valid JSON')
      }
    }
    const action = parseIntentStatusAction(
      (body as { action?: unknown })?.action ?? 'withdraw'
    )
    return success(await transitionIntent(tenant, intentIdOf(params), action))
  } catch (error) {
    return errorResponse(error)
  }
})

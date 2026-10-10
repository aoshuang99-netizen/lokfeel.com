/**
 * T03 · `/api/v1/intents/[intentId]/disclosure` —— 披露预览
 *
 *   GET  查看"哪些字段将披露给谁"，含**真实值投影**
 *
 * 这是 PRD 用户故事「我能看到即将披露给谁的哪些信息」的直接落点：
 * 返回两个视角（组织者 / 对手方）的**实际内容**，而不是抽象配置。
 * 因为只有看到具体值，用户才真正知道自己会暴露什么。
 *
 * ⚠️ 该端点只返回**本人**的意图（服务层带 `userId: ctx.userId` 谓词）。
 * 它让用户自查，不代表他人可读。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { NotFoundError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { previewDisclosure } from '@/lib/connection'

function intentIdOf(params: unknown): string {
  const id = (params as { intentId?: string } | undefined)?.intentId
  if (!id || typeof id !== 'string') throw new NotFoundError('Intent not found')
  return id
}

export const GET = withTenant('intent.read')(async (_req: NextRequest, tenant, params) => {
  try {
    return success(await previewDisclosure(tenant, intentIdOf(params)))
  } catch (error) {
    return errorResponse(error)
  }
})

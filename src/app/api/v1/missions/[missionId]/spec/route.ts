/**
 * V21 · C04 `GET|POST /api/v1/missions/[missionId]/spec`
 *
 *   GET   当前版本 + 历史版本摘要（success({...}) **对象** data，不是 paginated 数组）
 *   POST  保存一版经 WorkspaceSpecSchema 校验的 spec（expectedVersion 乐观并发）
 *
 * 租户与能力由 `withTenant()` 在进入 handler 前完成；服务层所有 DB 谓词都带
 * `organizationId`。跨租户一律表现为 404（不泄露"该 id 存在"）。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import {
  getMissionSpec,
  parseSpecSaveBody,
  saveMissionSpec,
} from '@/lib/connection/mission-spec'

function missionIdOf(params: unknown): string {
  const id = (params as { missionId?: string } | undefined)?.missionId
  if (!id || typeof id !== 'string') throw new NotFoundError('Mission not found')
  return id
}

export const GET = withTenant('mission.read')(async (_req: NextRequest, tenant, params) => {
  try {
    return success(await getMissionSpec(tenant, missionIdOf(params)))
  } catch (error) {
    return errorResponse(error)
  }
})

export const POST = withTenant('mission.update')(async (req: NextRequest, tenant, params) => {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    const input = parseSpecSaveBody(body)
    return success(await saveMissionSpec(tenant, missionIdOf(params), input))
  } catch (error) {
    return errorResponse(error)
  }
})

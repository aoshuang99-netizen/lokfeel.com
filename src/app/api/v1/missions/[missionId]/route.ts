/**
 * T02 · `/api/v1/missions/[missionId]`
 *
 *   GET    读取单条（能力 `mission.read`）
 *   PATCH  编辑字段（能力 `mission.update`）
 *
 * ⚠️ 所有查询都经服务层，**强制带 `organizationId` 谓词** ——
 * 跨租户访问表现为 404（"不存在"），而不是 403。这是刻意的：
 * 403 会泄露"该 id 真实存在"这一事实。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { getMission, parseMissionPatch, updateMission } from '@/lib/connection'

function missionIdOf(params: unknown): string {
  const id = (params as { missionId?: string } | undefined)?.missionId
  if (!id || typeof id !== 'string') throw new NotFoundError('Mission not found')
  return id
}

export const GET = withTenant('mission.read')(async (_req: NextRequest, tenant, params) => {
  try {
    return success(await getMission(tenant, missionIdOf(params)))
  } catch (error) {
    return errorResponse(error)
  }
})

export const PATCH = withTenant('mission.update')(async (req: NextRequest, tenant, params) => {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    const patch = parseMissionPatch(body)
    return success(await updateMission(tenant, missionIdOf(params), patch))
  } catch (error) {
    return errorResponse(error)
  }
})

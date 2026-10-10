/**
 * T02 · `/api/v1/missions/[missionId]/pause` —— Mission 状态迁移
 *
 * 命名沿用任务卡（`POST/GET/PATCH/pause`）。本端点接受：
 *   POST { action: 'publish' | 'pause' | 'resume' | 'close' }
 * `action` 缺省为 `'pause'`（与路径名一致）。
 *
 * 为什么状态迁移**不**放进 PATCH：PATCH 是"改字段"，状态是**有向迁移**，
 * 混在一起最容易产出的缺陷是"忘了校验 from 状态"。这里由服务层的
 * `TRANSITIONS` 表统一裁决，非法迁移一律 409。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { parseMissionAction, transitionMission } from '@/lib/connection'

function missionIdOf(params: unknown): string {
  const id = (params as { missionId?: string } | undefined)?.missionId
  if (!id || typeof id !== 'string') throw new NotFoundError('Mission not found')
  return id
}

export const POST = withTenant('mission.update')(async (req: NextRequest, tenant, params) => {
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
    const action = parseMissionAction(
      (body as { action?: unknown })?.action ?? 'pause'
    )
    return success(await transitionMission(tenant, missionIdOf(params), action))
  } catch (error) {
    return errorResponse(error)
  }
})

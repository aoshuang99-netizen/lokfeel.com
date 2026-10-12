/**
 * T06 · `POST /api/v1/workflow/jobs/{jobId}/takeover` —— 人工接管
 *
 *   能力 `workflow.manage`（ADMIN+）
 *
 * 语义：**把这条任务从自动流程手里取走**。接管后它进入终态 `TAKEN_OVER`，
 * `claimJobs()` 不会再领取它 —— 否则运营刚决定"先别发"，下一次 tick 就把它发出去了。
 *
 * 与 T03/T05「带用户内容的东西不落审计」的取向一致：本端点**只接受一句备注**，
 * 不参与消息内容生成。
 *
 * 响应码：
 *   200  已接管
 *   * 404 任务不存在或不在本租户
 *   409 任务已是终态（已成功 / 已取消），接管没有意义
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { takeOverJob } from '@/lib/workflow'
import { jobIdOf } from '../../../_shared/params'

const MAX_NOTE_LENGTH = 500

export const POST = withTenant('workflow.manage')(async (req: NextRequest, tenant, params) => {
  try {
    const jobId = jobIdOf(params)

    // body 可空（接管本身不需要理由）；给了就校验长度。
    let note: string | null = null
    const raw = await req.text()
    if (raw && raw.trim()) {
      let body: unknown
      try {
        body = JSON.parse(raw)
      } catch {
        throw new ValidationError('Request body must be valid JSON')
      }
      const candidate = (body as { note?: unknown })?.note
      if (candidate !== undefined && candidate !== null) {
        if (typeof candidate !== 'string') {
          throw new ValidationError('note must be a string', { field: 'note' })
        }
        const trimmed = candidate.trim()
        if (trimmed.length > MAX_NOTE_LENGTH) {
          throw new ValidationError(`note must be at most ${MAX_NOTE_LENGTH} characters`, {
            field: 'note',
          })
        }
        note = trimmed || null
      }
    }

    await takeOverJob(tenant, jobId, note)
    return success({ jobId, status: 'TAKEN_OVER' })
  } catch (error) {
    return errorResponse(error)
  }
})

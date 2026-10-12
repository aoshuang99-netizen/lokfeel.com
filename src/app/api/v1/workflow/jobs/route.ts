/**
 * T06 · `GET /api/v1/workflow/jobs` —— 列出本租户的工作流任务
 *
 *   能力 `workflow.read`（OPERATOR+）
 *
 * 用途：运营看"哪些通知还没发出去 / 卡在哪一步 / 需不需要人介入"。
 *
 * `?status=` 支持逗号分隔（如 `?status=DEAD,TAKEN_OVER`），取值必须是已知状态 ——
 * 未知值一律 400，而不是静默忽略：静默忽略会让运营以为自己筛过了，
 * 实际看到的却是全量（"筛选没生效"比"筛选报错"难发现得多）。
 *
 * ⚠️ 返回值里**不含载荷正文**：`payload` 只存寻址用的 id，
 *   而投递正文在 `NotificationDelivery`（另一个更受控的面）。
 *   这里也不返回 `lastError` 之外的用户内容 —— 它已被截断且不含正文。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { listWorkflowJobs, type WorkflowJobStatus } from '@/lib/workflow'

const ALLOWED_STATUSES: readonly WorkflowJobStatus[] = [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'DEAD',
  'TAKEN_OVER',
  'CANCELLED',
]

export const GET = withTenant('workflow.read')(async (req: NextRequest, tenant) => {
  try {
    const statusRaw = req.nextUrl.searchParams.get('status')
    let statuses: WorkflowJobStatus[] | undefined
    if (statusRaw) {
      const parsed = statusRaw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
      const unknown = parsed.filter((s) => !ALLOWED_STATUSES.includes(s as WorkflowJobStatus))
      if (unknown.length > 0) {
        throw new ValidationError(`unknown status(es): ${unknown.join(', ')}`, { field: 'status' })
      }
      statuses = parsed as WorkflowJobStatus[]
    }

    const limitRaw = req.nextUrl.searchParams.get('limit')
    const limit = limitRaw ? Number(limitRaw) : undefined
    if (limitRaw && (!Number.isFinite(limit) || (limit as number) < 1)) {
      throw new ValidationError('limit must be a positive integer', { field: 'limit' })
    }

    const jobs = await listWorkflowJobs(tenant.organizationId, {
      ...(statuses ? { statuses } : {}),
      ...(limit !== undefined ? { limit } : {}),
    })
    return success({ jobs })
  } catch (error) {
    return errorResponse(error)
  }
})

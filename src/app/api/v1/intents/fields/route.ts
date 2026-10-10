/**
 * T03 · `/api/v1/intents/fields` —— 披露字段目录
 *
 *   GET  返回可披露字段清单、合法档位、表单建议值、结构性受保护字段
 *
 * 为什么要由服务端下发目录（而不是前端各写一份）：
 *   前端的字段清单只要与后端漂移一个字段，就会出现"界面上没有这个开关、
 *   但投影里仍在往外发"。目录是 `field-catalog.ts` 的单一事实来源，
 *   这里只是把它原样暴露给 UI。
 *
 * `suggested` 是**表单建议**（非敏感字段建议 ORGANIZER），
 * 与 API 的缺省口径（缺失字段一律 SELF）是两回事 —— 响应里用
 * `missingFieldAudience` 明确写出后者，避免前端把两者混为一谈。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import {
  AUDIENCE_ORDER,
  DISCLOSURE_FIELDS,
  MISSING_FIELD_AUDIENCE,
  PROTECTED_FIELD_KEYS,
  SENSITIVE_FIELD_KEYS,
  auditCatalog,
  suggestedDisclosure,
} from '@/lib/connection'

export const GET = withTenant('intent.read')(async (_req: NextRequest, tenant) => {
  try {
    return success({
      audiences: AUDIENCE_ORDER,
      fields: DISCLOSURE_FIELDS,
      /** 表单建议勾选值（≠ API 缺省值）。 */
      suggested: suggestedDisclosure(),
      /** API 侧缺省：字段未出现时按此处理。 */
      missingFieldAudience: MISSING_FIELD_AUDIENCE,
      /** 结构性不可授权的字段（联系方式类），前端应展示原因而不是开关。 */
      protectedFields: PROTECTED_FIELD_KEYS,
      sensitiveFields: SENSITIVE_FIELD_KEYS,
      /** 目录自检结果（空数组 = 健康）。放在响应里便于运维一眼看出配置腐化。 */
      catalogProblems: auditCatalog(),
      organizationId: tenant.organizationId,
    })
  } catch (error) {
    return errorResponse(error)
  }
})

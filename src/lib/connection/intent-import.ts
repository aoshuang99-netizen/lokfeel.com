/**
 * T03 · 档案导入许可检查
 *
 * 「导入」在本任务里的含义：把**账户档案里已有的**字段纳入本意图的披露范围，
 * 免得用户重新手填昵称/头像/职业。**不复制字段值** —— 披露时实时从 Profile 读，
 * 因此不存在"档案改了、意图里还是旧值"的数据副本。
 *
 * 为什么必须有许可检查（AC-12「用户主动授权」）：
 *   档案里的数据是用户在**别的语境**下填的（例如交友场景的年龄、性别认同）。
 *   把它默认搬进"我要找商业合作伙伴"的语境并对外披露，是典型的语境越界。
 *   所以规则是：**必须显式同意**，且只能导入目录里标记为 `importable` 的字段。
 *
 * 拒绝一律 fail loud（而不是静默过滤）：用户勾了 5 个字段、系统只导入 3 个
 * 却不告诉他，等于让他误判自己的披露面。
 */

import { ValidationError } from '@/lib/errors'
import { requiredStringArray } from './input-helpers'
import {
  IMPORTABLE_FIELD_KEYS,
  fieldSpec,
  isFieldKey,
  type DisclosureFieldKey,
} from './field-catalog'

export type ImportRejectReason =
  /** 目录里没有这个字段键。 */
  | 'unknown_field'
  /** 目录里有，但明确不允许从档案导入。 */
  | 'not_importable'

export interface ImportPlan {
  /** 允许导入的字段（保序、去重）。 */
  accepted: DisclosureFieldKey[]
  /** 被拒绝的字段及原因。**非空即应当拒绝整个请求**（见 `assertImportPlanAllAccepted`）。 */
  rejected: Array<{ field: string; reason: ImportRejectReason }>
  /** 是否含有敏感字段（用于审计标注：本次授权是否扩大了敏感数据的披露面）。 */
  includesSensitive: boolean
}

/** 导入字段数的上限。防止把整张档案表塞进一次请求。 */
export const MAX_IMPORT_FIELDS = 30

/**
 * 生成导入计划（**纯函数，不抛异常**）—— 既服务于写路径的前置校验，
 * 也服务于前端"预览：这些字段可以导入、那些不行"。
 */
export function planProfileImport(requested: unknown): ImportPlan {
  const fields = Array.isArray(requested)
    ? (requested as unknown[]).filter((v): v is string => typeof v === 'string')
    : []

  const accepted: DisclosureFieldKey[] = []
  const rejected: Array<{ field: string; reason: ImportRejectReason }> = []
  let includesSensitive = false

  for (const raw of fields) {
    const key = raw.trim()
    if (!key) continue
    if (accepted.includes(key as DisclosureFieldKey)) continue

    if (!isFieldKey(key)) {
      rejected.push({ field: key, reason: 'unknown_field' })
      continue
    }
    const spec = fieldSpec(key)
    if (!spec || !spec.importable || !IMPORTABLE_FIELD_KEYS.includes(key)) {
      rejected.push({ field: key, reason: 'not_importable' })
      continue
    }
    accepted.push(key)
    if (spec.sensitive) includesSensitive = true
  }

  return { accepted, rejected, includesSensitive }
}

/**
 * 写路径断言：有任何被拒字段即 400，并把**全部**拒绝项放进 `details`
 * （一次说清，避免用户改一个、再撞一个）。
 */
export function assertImportPlanAllAccepted(plan: ImportPlan): void {
  if (plan.rejected.length === 0) return
  throw new ValidationError(
    `Cannot import field(s): ${plan.rejected.map((r) => `${r.field} (${r.reason})`).join(', ')}`,
    { field: 'importFields', rejected: plan.rejected }
  )
}

/**
 * 解析并校验「导入字段清单」。
 * `value === undefined` 时返回空计划（= 不导入任何字段），不报错 ——
 * 「没有导入」是合法状态，不是错误。
 */
export function parseImportFields(value: unknown): ImportPlan {
  if (value === undefined || value === null) {
    return { accepted: [], rejected: [], includesSensitive: false }
  }
  // 形状错误（非数组/含非字符串）先在这里拦下，再交给 plan 做语义判定。
  requiredStringArray(value, 'importFields', MAX_IMPORT_FIELDS)
  const plan = planProfileImport(value)
  assertImportPlanAllAccepted(plan)
  return plan
}

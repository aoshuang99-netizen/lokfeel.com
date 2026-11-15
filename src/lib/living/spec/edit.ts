/**
 * V21 · C04 —— WorkspaceSpec 字段编辑纯函数（无 IO / 无 React）
 *
 * WorkspaceSpec v1.2（`src/lib/workspace-spec/schema.ts`）是 `z.strictObject`：
 *   intent 节点 data = { goal, offer?, constraints[], successCriteria[], expiresAt? }
 *   —— **没有负责人（owner）字段**，本模块如实标注，绝不伪造 schema 字段。
 *
 * 编辑结果一律过 `WorkspaceSpecSchema.safeParse`：超长文本、不可解析日期、
 * 未知字段（strict）都会被拒绝并给出人话 reason，而不是静默写入非法 spec。
 */

import { WorkspaceSpecSchema, type WorkspaceSpec } from '@/lib/workspace-spec/schema'

export interface EditableFields {
  offer: string | null
  successCriteria: string[]
  constraints: string[]
  expiresAt: string | null
  /** WorkspaceSpec v1.2 无负责人字段，不伪造 —— 恒为 null。 */
  owner: null
}

export type EditableField = 'offer' | 'successCriteria' | 'constraints' | 'expiresAt'

export interface SpecFieldEdit {
  field: EditableField
  value: unknown
}

export type ApplyEditResult =
  | { ok: true; spec: WorkspaceSpec }
  | { ok: false; reason: string }

export interface SpecDiffEntry {
  field: EditableField
  /** 人话字段名。 */
  label: string
  before: string | string[] | null
  after: string | string[] | null
  /** 一句人话差异描述。 */
  text: string
}

export interface RevisionConflict {
  conflict: boolean
  code: string | null
  status: number
  message: string
}

/** 409 细节码：spec 版本冲突。 */
export const SPEC_VERSION_CONFLICT = 'SPEC_VERSION_CONFLICT' as const

const EDITABLE_FIELDS: readonly EditableField[] = [
  'offer',
  'successCriteria',
  'constraints',
  'expiresAt',
]

const FIELD_LABELS: Record<EditableField, string> = {
  offer: '提议内容（offer）',
  successCriteria: '成功判据',
  constraints: '约束条件',
  expiresAt: '过期时间',
}

type UnknownRecord = Record<string, unknown>

function isRecord(v: unknown): v is UnknownRecord {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function emptyFields(): EditableFields {
  return { offer: null, successCriteria: [], constraints: [], expiresAt: null, owner: null }
}

/** 提取 intent 节点的四个可编辑字段；owner 恒为 null（v1.2 无负责人字段）。 */
export function editableFields(spec: unknown): EditableFields {
  const fields = emptyFields()
  if (!isRecord(spec) || !Array.isArray(spec.nodes)) return fields
  const intent = (spec.nodes as unknown[]).find(
    (n: unknown) => isRecord(n) && n.type === 'intent',
  )
  if (!isRecord(intent)) return fields
  const data = intent.data
  if (!isRecord(data)) return fields

  if (typeof data.offer === 'string') fields.offer = data.offer
  if (Array.isArray(data.successCriteria)) {
    fields.successCriteria = data.successCriteria.filter(
      (x): x is string => typeof x === 'string',
    )
  }
  if (Array.isArray(data.constraints)) {
    fields.constraints = data.constraints.filter((x): x is string => typeof x === 'string')
  }
  if (typeof data.expiresAt === 'string') fields.expiresAt = data.expiresAt
  // owner 不赋值，保持 null：v1.2 的 intent.data 是 strictObject，没有负责人字段，
  // 凭空补一个 owner 会在下一次 safeParse 被整块拒绝。
  return fields
}

/**
 * 应用一次字段编辑：返回**新** spec（不 mutate 入参），并经
 * `WorkspaceSpecSchema.safeParse` 校验；非法编辑返回 `{ok:false, reason}`。
 * `value === null` 表示清空 optional 字段（offer / expiresAt）。
 */
export function applySpecFieldEdit(spec: unknown, edit: SpecFieldEdit): ApplyEditResult {
  if (!isRecord(spec) || !Array.isArray(spec.nodes)) {
    return { ok: false, reason: '编辑失败：spec 形状不合法（缺少 nodes 数组）' }
  }

  // ① 字段白名单：v1.2 只有四个可编辑字段，owner / goal 等一律拒绝（不伪造字段）。
  if (!EDITABLE_FIELDS.includes(edit.field)) {
    return {
      ok: false,
      reason: `编辑失败：未知可编辑字段 ${String(edit.field)}（WorkspaceSpec v1.2 仅允许 ${EDITABLE_FIELDS.join('/')}；无负责人字段）`,
    }
  }

  // ② expiresAt 必须可解析（与 schema 的 isoTemporal 同口径）；null 表示清空。
  if (edit.field === 'expiresAt' && edit.value !== null) {
    if (typeof edit.value !== 'string' || Number.isNaN(Date.parse(edit.value))) {
      return { ok: false, reason: '编辑失败：expiresAt 不是可解析的 ISO 日期时间' }
    }
  }

  // ③ 深拷贝，绝不 mutate 入参。
  let next: UnknownRecord
  try {
    next = JSON.parse(JSON.stringify(spec)) as UnknownRecord
  } catch {
    return { ok: false, reason: '编辑失败：spec 不是可序列化对象' }
  }
  const nodes = next.nodes as unknown[]
  const index = nodes.findIndex((n: unknown) => isRecord(n) && n.type === 'intent')
  if (index < 0) {
    return { ok: false, reason: '编辑失败：spec 里没有 intent 节点，无可编辑字段' }
  }
  const node = nodes[index] as UnknownRecord
  const data = node.data
  if (!isRecord(data)) {
    return { ok: false, reason: '编辑失败：intent 节点缺少合法的 data 对象' }
  }

  // ④ 应用编辑。
  if (edit.value === null) {
    delete data[edit.field]
  } else {
    data[edit.field] = edit.value
  }

  // ⑤ strictObject 校验：未知字段、超长文本、类型错误一律拒绝，并给出人话 reason。
  const parsed = WorkspaceSpecSchema.safeParse(next)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.map((p) => String(p)).join('.') || '<root>'}: ${i.message}`)
      .join('; ')
    return {
      ok: false,
      reason: `编辑失败：${edit.field} 未通过 WorkspaceSpecSchema 校验（${issues}）`,
    }
  }
  return { ok: true, spec: parsed.data }
}

function humanValue(value: string | string[] | null): string {
  if (value === null) return '未设置'
  if (Array.isArray(value)) {
    return value.length === 0 ? '空列表' : `${value.length} 项：${value.join('、')}`
  }
  return `「${value}」`
}

/** 人话差异数组（字段 / 旧值 / 新值）；无改动返回 []。 */
export function specDiff(before: unknown, after: unknown): SpecDiffEntry[] {
  const a = editableFields(before)
  const b = editableFields(after)
  const diffs: SpecDiffEntry[] = []
  for (const field of EDITABLE_FIELDS) {
    const oldValue = a[field]
    const newValue = b[field]
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue
    diffs.push({
      field,
      label: FIELD_LABELS[field],
      before: oldValue,
      after: newValue,
      text: `${FIELD_LABELS[field]}：由${humanValue(oldValue)}改为${humanValue(newValue)}`,
    })
  }
  return diffs
}

/** 版本冲突判定：冲突时给出 409 与细节码 SPEC_VERSION_CONFLICT。 */
export function specRevisionConflict(
  expectedVersion: unknown,
  currentVersion: unknown,
): RevisionConflict {
  if (Object.is(expectedVersion, currentVersion)) {
    return { conflict: false, code: null, status: 200, message: '版本一致，无冲突' }
  }
  return {
    conflict: true,
    code: SPEC_VERSION_CONFLICT,
    status: 409,
    message: `版本冲突：期望 ${String(expectedVersion)}，当前 ${String(currentVersion)}`,
  }
}

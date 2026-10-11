/**
 * T03 · 逐字段披露（**AC-03 的唯一执法点**）
 *
 * 本文件负责把「用户的披露选择」变成「某人能看到的字段集合」。所有对外输出
 * （API 响应、分享页、未来的向量索引 / Agent 上下文）都必须经 `discloseSubject()`
 * 取字段，**不得**直接把 Profile/User 行丢出去。
 *
 * 读/写路径的**非对称容错**是刻意的：
 *   - 写路径 `normalizeDisclosure()` —— **fail loud**。未知字段、非法档位、
 *     把 email 之类受保护字段塞进披露表，一律 400。因为"我以为我授权了 X，
 *     其实系统把它丢了"是最危险的静默失败（用户以为自己保护了隐私/以为已披露）。
 *   - 读路径 `decodeDisclosure()` —— **fail silent**。DB 里的历史脏数据
 *     （老版本写的未知键、被人工改坏的档位）只会被丢弃，绝不抛异常 ——
 *     一行脏数据不该打挂整个列表或整张页面。
 *
 * 白名单式投影（与 T02 的 public-view.ts 同一取向）：
 *   `discloseSubject()` 只遍历 `DISCLOSURE_FIELDS`，逐个判定；因此字段目录里
 *   **新增**一个字段时，它默认处于"未授权"状态，不会因为"忘了加过滤"而泄露。
 *
 * ⚠️ 投影受众类型是 `ExternalAudience`（编译期排除 `SELF`）：
 *   本人不需要走投影 —— 他直接读自己的数据。若允许 `viewer='SELF'`，
 *   `discloseSubject(profile, {}, 'SELF')` 会返回**整份档案**，那是一个
 *   "传 SELF 即全量"的危险形状（详见 field-catalog.ts 的 `audienceCanSee`）。
 */

import { ValidationError } from '@/lib/errors'
import { decodeJson, encodeJson } from './json-codec'
import {
  DISCLOSURE_FIELDS,
  MISSING_FIELD_AUDIENCE,
  audienceCanSee,
  fieldSpec,
  isAudience,
  type DisclosureAudience,
  type DisclosureFieldKey,
  type ExternalAudience,
} from './field-catalog'

// ═══════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════

/** 披露表：字段 → 授权档位。**缺失的键 = 未授权**（按 SELF 处理）。 */
export type DisclosureMap = Partial<Record<DisclosureFieldKey, DisclosureAudience>>

/** 字段值。数组仅用于 tags/priorities 这类多值字段。 */
export type SubjectFieldValue = string | number | string[]

/** 主体档案（从 User + Profile 实时组装，**不落副本**）。 */
export type SubjectProfile = Partial<
  Record<DisclosureFieldKey, SubjectFieldValue | null | undefined>
>

/** 投影结果：**只包含被授权且有值的字段**；未授权的键在对象上根本不存在。 */
export type DisclosedProfile = Partial<Record<DisclosureFieldKey, SubjectFieldValue>>

export interface DisclosureEntry {
  key: DisclosureFieldKey
  label: string
  sensitive: boolean
}

export interface DisclosureSummary {
  /**
   * 各**外部**受众下的字段。刻意不含 `SELF`：
   *   「仅本人可见」等于「不披露」，它属于 `withheld`，而不是一个受众分组。
   *   把 SELF 混进来会让前端把它渲染成一个"受众"，从而误导用户以为那是某种披露。
   *
   * ⚠️ 这里的键是**用户显式选择的档位**，不是"谁能看到"。同一份披露表下，
   * 三个受众**实际**看到的字段集合是逐层变宽的（见下面三个 `visibleTo*`）：
   *   `visibleToCandidate` ⊆ `visibleToCounterparty` ⊆ `visibleToOrganizer`
   * 因为档位是包含式的 —— 组织者看到的最多，候选看到的最少。
   */
  byAudience: Record<ExternalAudience, DisclosureEntry[]>
  /** 结构性不可授权的字段（联系方式类），单独列出以便前端说明原因。 */
  protectedFields: DisclosureEntry[]
  /** 组织者能看到的字段键（授权档 ∈ ORGANIZER / COUNTERPARTY / CANDIDATE，最宽）。 */
  visibleToOrganizer: DisclosureFieldKey[]
  /** 同任务的候选伙伴能看到的字段键（授权档 = CANDIDATE，最窄）。 */
  visibleToCandidate: DisclosureFieldKey[]
  /** 对手方（双向同意后）能看到的字段键（授权档 ∈ COUNTERPARTY / CANDIDATE）。 */
  visibleToCounterparty: DisclosureFieldKey[]
  /** 谁都不披露的字段键（仅自己）。 */
  withheld: DisclosureFieldKey[]
}

// ═══════════════════════════════════════════════════════════
// 编解码
// ═══════════════════════════════════════════════════════════

/** 编码：`{}` → `null`（空披露表不落一坨 `"{}"`，语义上"没有授权任何字段"）。 */
export function encodeDisclosure(map: DisclosureMap): string | null {
  const keys = Object.keys(map)
  if (keys.length === 0) return null
  return encodeJson(map)
}

/**
 * 读路径解码（**全函数，绝不抛**）。
 * 未知字段键、非法档位一律**丢弃** —— 保留它们只会让下游以为"某个字段被授权了"。
 */
export function decodeDisclosure(text: unknown): DisclosureMap {
  // 入参是 `unknown`：列可能是 JSON 文本，也可能是历史代码直接写的对象。
  // 两种形态都要能读，所以先归一化成"对象"，再交给同一套字段过滤。
  const parsed =
    text !== null && typeof text === 'object' && !Array.isArray(text)
      ? text
      : decodeJson<unknown>(typeof text === 'string' ? text : null, null)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  const out: DisclosureMap = {}
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    const spec = fieldSpec(key)
    if (!spec) continue // 未知字段：丢弃（读路径不抛）
    if (!spec.disclosable) continue // 受保护字段：即使历史数据里有也不认
    if (!isAudience(raw)) continue // 非法档位：丢弃
    out[spec.key] = raw
  }
  return out
}

/**
 * 写路径校验（**fail loud**）。
 *
 * 三条拒绝规则，每条都有明确的"为什么不静默处理"：
 *   1. 未知字段 → 400。静默丢弃会让用户以为"我授权了 X"，实际没有。
 *   2. 受保护字段（email 等）→ 400。逐字段开关**不得**成为联系方式外泄的通道。
 *   3. 非法档位 → 400。字符串拼错（如 `"organizer"` 小写）必须被明确拒绝，
 *      而不是落库后变成"一个谁都不认识的档位"。
 */
export function normalizeDisclosure(value: unknown): DisclosureMap {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('disclosure must be an object mapping field name to audience', {
      field: 'disclosure',
    })
  }

  const out: DisclosureMap = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const spec = fieldSpec(key)
    if (!spec) {
      throw new ValidationError(`Unknown disclosure field: ${key}`, {
        field: 'disclosure',
        unknownField: key,
      })
    }
    if (!spec.disclosable) {
      throw new ValidationError(
        `Field "${key}" cannot be granted via disclosure; contact details are exchanged through the consent flow`,
        { field: 'disclosure', protectedField: key }
      )
    }
    if (!isAudience(raw)) {
      throw new ValidationError(
        `Invalid audience for "${key}": ${String(raw)}`,
        { field: 'disclosure', invalidAudienceFor: key }
      )
    }
    out[spec.key] = raw
  }
  return out
}

// ═══════════════════════════════════════════════════════════
// 判定
// ═══════════════════════════════════════════════════════════

/**
 * 某字段的实际授权档位。
 *
 * 双保险：披露表里没写 → `MISSING_FIELD_AUDIENCE`（SELF）；
 * 字段**结构性不可授权** → 恒 SELF（无论表里写了什么，防脏数据绕过）。
 */
export function grantedAudience(map: DisclosureMap, key: DisclosureFieldKey): DisclosureAudience {
  const spec = fieldSpec(key)
  if (!spec || !spec.disclosable) return MISSING_FIELD_AUDIENCE
  return map[key] ?? MISSING_FIELD_AUDIENCE
}

/** 补齐缺省值后的完整披露表（供前端回显：每个字段"当前是什么档"一目了然）。 */
export function effectiveDisclosure(
  map: DisclosureMap
): Record<DisclosureFieldKey, DisclosureAudience> {
  const out = {} as Record<DisclosureFieldKey, DisclosureAudience>
  for (const f of DISCLOSURE_FIELDS) out[f.key] = grantedAudience(map, f.key)
  return out
}

/** 指定**外部**受众能看到哪些字段（键列表，已按目录顺序稳定排序）。 */
export function fieldsVisibleTo(
  map: DisclosureMap,
  viewer: ExternalAudience
): DisclosureFieldKey[] {
  return DISCLOSURE_FIELDS.filter(
    (f) => f.disclosable && audienceCanSee(grantedAudience(map, f.key), viewer)
  ).map((f) => f.key)
}

/**
 * **投影**：把主体档案裁剪成某外部受众可见的字段子集。
 *
 * 返回对象里**未授权字段的键根本不存在**（而不是 `undefined`）——
 * 这样序列化后不会出现 `"email": null` 这种"看起来有这个字段"的痕迹，
 * 也让"泄露断言"可以用 `hasOwnProperty` 精确判定。
 */
export function discloseSubject(
  profile: SubjectProfile,
  map: DisclosureMap,
  viewer: ExternalAudience
): DisclosedProfile {
  const out: DisclosedProfile = {}
  for (const f of DISCLOSURE_FIELDS) {
    if (!f.disclosable) continue
    if (!audienceCanSee(grantedAudience(map, f.key), viewer)) continue

    const value = profile[f.key]
    if (value === null || value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue

    out[f.key] = value
  }
  return out
}

/**
 * 「我能看到即将披露给谁的哪些信息」（PRD 用户故事）。
 *
 * ⚠️ 这是给**提交者本人**看的说明，因此它列出的是**字段清单**（含未披露的），
 * 而不是字段**值**。泄露断言必须针对值，不能针对这些键名 ——
 * 「让你知道有哪些字段、以及它们是否会被披露」本身就是这个接口的目的。
 */
export function describeDisclosure(map: DisclosureMap): DisclosureSummary {
  const byAudience: Record<ExternalAudience, DisclosureEntry[]> = {
    ORGANIZER: [],
    CANDIDATE: [],
    COUNTERPARTY: [],
  }
  const withheld: DisclosureFieldKey[] = []
  const protectedFields: DisclosureEntry[] = []

  for (const f of DISCLOSURE_FIELDS) {
    const entry: DisclosureEntry = { key: f.key, label: f.label, sensitive: f.sensitive }
    if (!f.disclosable) {
      protectedFields.push(entry)
      continue
    }
    const granted = grantedAudience(map, f.key)
    if (granted === 'SELF') {
      // 「仅本人」= 不披露，归入 withheld（而不是造一个 SELF 受众分组）
      withheld.push(f.key)
      continue
    }
    byAudience[granted].push(entry)
  }

  return {
    byAudience,
    protectedFields,
    visibleToOrganizer: fieldsVisibleTo(map, 'ORGANIZER'),
    visibleToCandidate: fieldsVisibleTo(map, 'CANDIDATE'),
    visibleToCounterparty: fieldsVisibleTo(map, 'COUNTERPARTY'),
    withheld,
  }
}

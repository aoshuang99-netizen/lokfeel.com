/**
 * P2 · Consent Gate —— **逐字段披露投影**装配器（纯函数，零 IO）
 *
 * 数据源：`GET /api/v1/intents/{id}/disclosure`（T03 `previewDisclosure`）
 *         `GET /api/v1/connections/proposals`（T05，双边同意状态与可执行动作）
 *
 * 🔴 六条纪律（前三条与 P1 装配器同源，后三条是本区特有）：
 *
 *   1. **零 IO**：只做"服务端载荷 → 可渲染模型"。取数在容器组件里。
 *
 *   2. **不重算服务端已算好的派生值**。这是本区最要紧的一条：
 *      档位可见性是**包含式**的（`rank(granted) >= rank(viewer)`），前端自己实现一遍
 *      就是第二个真相来源；而它一旦写反，用户会看到"我授权给组织者的字段，候选也能看到"
 *      —— 一次静默的越权展示。因此这里**只读**服务端下发的
 *      `visibleToOrganizer / visibleToCounterparty / visibleToCandidate`，
 *      并把它当**不变量断言**（违反 → 产出说明），而不是当输入去重算。
 *
 *   3. **来源不可用 ≠ 没有数据**。载荷不认识、缺键、非对象 → 整块拒绝并写明原因，
 *      绝不复用"暂无披露字段"的空态文案（那会让"读不到"看起来像"我什么都没披露"）。
 *
 *   4. **结构性不可授权 ≠ 用户没开**。联系方式类字段（email 等）在服务端
 *      `disclosable: false`，它既不出现在任何受众分组里，也不在 `withheld` 里，
 *      而是单列在 `protectedFields`。三者必须分开渲染。
 *
 *   5. **键的完整性有两条来路**：服务端下发的键（真相）与本地字段目录（文案来源）。
 *      服务端多出目录没有的键 → 说明**目录落后于服务端**（新增字段前端还不知道），
 *      这必须被说出来，而不是把那个键渲染成一个没有标签的方框。
 *
 *   6. **顺序必须确定**。行序 = 字段目录顺序（稳定），目录之外的键追加在末尾并按
 *      字母序 —— 同一份载荷恒得同一张表，可被单测断言，也避免每次刷新重排。
 */

import { z } from 'zod'
import { DISCLOSURE_FIELDS, fieldSpec } from '@/lib/connection/field-catalog'
import {
  CONSENT_AUDIENCE_LABELS,
  CONSENT_DECISION_LABELS,
  CONSENT_EXTERNAL_AUDIENCES,
  CONSENT_INTENT_STATUS_LABELS,
  CONSENT_NO_DECISION_LABEL,
  CONSENT_PARTY_ROLE_LABELS,
  CONSENT_PROPOSAL_STATE_LABELS,
  CONSENT_PROPOSAL_STATES,
  CONSENT_PARTY_ROLES,
  CONSENT_PROPOSAL_ACTIONS,
  CONSENT_INTENT_STATUSES,
  type ConsentAudience,
  type ConsentExternalAudience,
  type ConsentFieldRow,
  type ConsentGateModel,
  type ConsentProposalAction,
  type ConsentProposalBoard,
  type ConsentProposalRow,
} from './types'

// ═══════════════════════════════════════════════════════════
// 结果类型
// ═══════════════════════════════════════════════════════════

export type ConsentAssembly<T> = { ok: true; value: T } | { ok: false; error: string }

/** 首个 schema 问题拼成可读原因（含路径，便于定位是哪条数据）。 */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  const path = issue?.path.length ? `字段 ${issue.path.join('.')}` : '顶层形状'
  return `${path} 不符合契约（${issue?.message ?? '未知'}）`
}

// ═══════════════════════════════════════════════════════════
// 输入侧：宽松对象（服务端新增字段不该让整块失效），但读到的字段必须合法
// ═══════════════════════════════════════════════════════════

const EntryLike = z.looseObject({
  key: z.string().min(1),
  label: z.string().min(1),
  sensitive: z.boolean(),
})

const DisclosedValue = z.union([z.string(), z.number(), z.array(z.string())])
const DisclosedProfileLike = z.record(z.string(), DisclosedValue)

const SummaryLike = z.looseObject({
  byAudience: z.looseObject({
    ORGANIZER: z.array(EntryLike),
    COUNTERPARTY: z.array(EntryLike),
    CANDIDATE: z.array(EntryLike),
  }),
  protectedFields: z.array(EntryLike),
  visibleToOrganizer: z.array(z.string()),
  visibleToCandidate: z.array(z.string()),
  visibleToCounterparty: z.array(z.string()),
  withheld: z.array(z.string()),
})

const PreviewLike = z.looseObject({
  organizer: DisclosedProfileLike,
  candidate: DisclosedProfileLike,
  counterparty: DisclosedProfileLike,
})

const DisclosurePreviewLike = z.looseObject({
  intentId: z.string().min(1),
  status: z.enum(CONSENT_INTENT_STATUSES),
  summary: SummaryLike,
  preview: PreviewLike,
})

const ProposalLike = z.looseObject({
  id: z.string().min(1),
  state: z.enum(CONSENT_PROPOSAL_STATES),
  rationale: z.string(),
  myRole: z.enum(CONSENT_PARTY_ROLES),
  myDecision: z.union([z.literal('ACCEPT'), z.literal('REJECT'), z.literal('REVOKE'), z.null()]),
  counterpartDecision: z.union([
    z.literal('ACCEPT'),
    z.literal('REJECT'),
    z.literal('REVOKE'),
    z.null(),
  ]),
  counterpart: z.looseObject({ subject: z.record(z.string(), z.unknown()).optional() }).optional(),
  actions: z.array(z.enum(CONSENT_PROPOSAL_ACTIONS)),
  canIntroduce: z.boolean(),
  introducedAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
})

// ═══════════════════════════════════════════════════════════
// 值字符串化（**只做类型转换，不做美化**）
// ═══════════════════════════════════════════════════════════

function stringifyValue(value: string | number | string[] | undefined): string | null {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) return value.length === 0 ? null : value.join('、')
  if (typeof value === 'number') return String(value)
  return value.length === 0 ? null : value
}

/** 目录顺序索引（不存在的键 → 排在最后，由调用方决定其内部次序）。 */
const CATALOG_ORDER = new Map<string, number>(DISCLOSURE_FIELDS.map((f, i) => [f.key, i]))

// ═══════════════════════════════════════════════════════════
// 主装配器：DisclosurePreview → ConsentGateModel
// ═══════════════════════════════════════════════════════════

export function assembleConsentGate(payload: unknown): ConsentAssembly<ConsentGateModel> {
  const parsed = DisclosurePreviewLike.safeParse(payload)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const { intentId, status, summary, preview } = parsed.data
  const notes: string[] = []

  // ── ① 键 → 档位（服务端唯一的真相来源） ──
  const audienceOf = new Map<string, ConsentAudience>()
  for (const audience of CONSENT_EXTERNAL_AUDIENCES) {
    for (const entry of summary.byAudience[audience]) audienceOf.set(entry.key, audience)
  }
  for (const key of summary.withheld) audienceOf.set(key, 'SELF')

  const protectedKeys = new Set(summary.protectedFields.map((e) => e.key))
  for (const key of protectedKeys) audienceOf.set(key, 'SELF')

  // ── ② 标签：优先服务端下发（byAudience / protectedFields 都带 label）；
  //        withheld 只有键，故回退到本地目录；目录也没有 → 说出"目录落后"。
  const labelOf = new Map<string, string>()
  const sensitiveOf = new Map<string, boolean>()
  for (const audience of CONSENT_EXTERNAL_AUDIENCES) {
    for (const e of summary.byAudience[audience]) {
      labelOf.set(e.key, e.label)
      sensitiveOf.set(e.key, e.sensitive)
    }
  }
  for (const e of summary.protectedFields) {
    labelOf.set(e.key, e.label)
    sensitiveOf.set(e.key, e.sensitive)
  }

  const catalogMissing: string[] = []
  for (const key of audienceOf.keys()) {
    if (!labelOf.has(key)) {
      const spec = fieldSpec(key)
      if (spec) {
        labelOf.set(key, spec.label)
        sensitiveOf.set(key, spec.sensitive)
      } else {
        // 服务端下发了目录里没有的键 —— 目录版本落后，必须说出来而不是静默回退。
        catalogMissing.push(key)
        labelOf.set(key, key)
        sensitiveOf.set(key, false)
      }
    }
  }
  if (catalogMissing.length > 0) {
    notes.push(
      `服务端下发了本地字段目录不认识的路段：${catalogMissing.sort().join('、')} —— ` +
        `说明前端目录落后于服务端，这些字段暂以原始键显示。`,
    )
  }

  // ── ③ 行序：目录顺序优先，目录外的键按字母序追加（确定性） ──
  const allKeys = [...audienceOf.keys()]
  const inCatalog = allKeys.filter((k) => CATALOG_ORDER.has(k)).sort((a, b) => CATALOG_ORDER.get(a)! - CATALOG_ORDER.get(b)!)
  const outOfCatalog = allKeys.filter((k) => !CATALOG_ORDER.has(k)).sort()
  const ordered = [...inCatalog, ...outOfCatalog]

  const rows: ConsentFieldRow[] = ordered.map((key) => {
    const audience = audienceOf.get(key) ?? 'SELF'
    const values = {} as Record<ConsentExternalAudience, string | null>
    for (const target of CONSENT_EXTERNAL_AUDIENCES) {
      values[target] = stringifyValue(preview[target.toLowerCase() as Lowercase<ConsentExternalAudience>][key])
    }
    return {
      key,
      label: labelOf.get(key) ?? key,
      audience,
      audienceLabel: CONSENT_AUDIENCE_LABELS[audience],
      sensitive: sensitiveOf.get(key) ?? false,
      protectedFromDisclosure: protectedKeys.has(key),
      values,
    }
  })

  // ── ④ 单调性断言（服务端注释承诺 `cand ⊆ cp ⊆ org`；前端**自证**它成立）──
  //    为什么前端还要查一遍：这个集合一旦倒挂，UI 上不会报错 —— 只会**少显示**
  //    某个受众本该看到的值，或反过来多显示。前者看不出来，后者是越权展示。
  const subset = (a: readonly string[], b: readonly string[]): string[] => {
    const setB = new Set(b)
    return a.filter((k) => !setB.has(k))
  }
  const cpMinusOrg = subset(summary.visibleToCounterparty, summary.visibleToOrganizer)
  const candMinusCp = subset(summary.visibleToCandidate, summary.visibleToCounterparty)
  if (cpMinusOrg.length > 0 || candMinusCp.length > 0) {
    notes.push(
      `披露可见性出现反直觉倒挂（对手方独有 ${cpMinusOrg.length} 项 / 伙伴独有 ${candMinusCp.length} 项）—— ` +
        `档位是包含式的，"更窄的受众看到更多"不应发生。本页如实展示服务端下发的数据，但这一条值得核对。`,
    )
  }

  return {
    ok: true,
    value: {
      intentId,
      status,
      statusLabel: CONSENT_INTENT_STATUS_LABELS[status],
      rows,
      totals: {
        disclosedToOrganizer: summary.visibleToOrganizer.length,
        disclosedToCounterparty: summary.visibleToCounterparty.length,
        disclosedToCandidate: summary.visibleToCandidate.length,
        withheld: summary.withheld.length,
        protectedFields: summary.protectedFields.length,
      },
      notes,
    },
  }
}

/** 受众 → 该受众可见的字段键（直接读服务端的键列表，**不重算**）。 */
export function visibleKeysOf(
  payload: unknown,
  audience: ConsentExternalAudience,
): readonly string[] | null {
  const parsed = DisclosurePreviewLike.safeParse(payload)
  if (!parsed.success) return null
  const s = parsed.data.summary
  if (audience === 'ORGANIZER') return s.visibleToOrganizer
  if (audience === 'COUNTERPARTY') return s.visibleToCounterparty
  return s.visibleToCandidate
}

// ═══════════════════════════════════════════════════════════
// 提案（双边同意）+ 可执行动作
// ═══════════════════════════════════════════════════════════

/**
 * 🔴 动作**完全**照搬服务端下发的 `actions`，前端不自己算权限。
 *    前端"看起来该能点"与"服务端允许"是两件事 —— 后者才是唯一的判据
 *    （服务端 `withTenant('proposal.decide')` 会重新判一遍）。
 */
export function assembleProposalBoard(payload: unknown): ConsentAssembly<ConsentProposalBoard> {
  const parsed = z.array(ProposalLike).safeParse(payload)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const notes: string[] = []
  const rows: ConsentProposalRow[] = parsed.data.map((p) => {
    const actions = p.actions.filter(
      (a): a is ConsentProposalAction => (CONSENT_PROPOSAL_ACTIONS as readonly string[]).includes(a),
    )
    return {
      id: p.id,
      state: p.state,
      stateLabel: CONSENT_PROPOSAL_STATE_LABELS[p.state],
      rationale: p.rationale,
      myRole: p.myRole,
      myRoleLabel: CONSENT_PARTY_ROLE_LABELS[p.myRole],
      myDecisionLabel: p.myDecision ? CONSENT_DECISION_LABELS[p.myDecision] : CONSENT_NO_DECISION_LABEL,
      counterpartDecisionLabel: p.counterpartDecision
        ? CONSENT_DECISION_LABELS[p.counterpartDecision]
        : CONSENT_NO_DECISION_LABEL,
      counterpartFieldKeys: [...new Set(Object.keys(p.counterpart?.subject ?? {}))].sort(),
      availableActions: actions,
      canIntroduce: p.canIntroduce,
      introducedAt: p.introducedAt ?? null,
      expiresAt: p.expiresAt ?? null,
    }
  })

  if (rows.length === 0) {
    // 「查询成功但没有提案」是一种结论，不该与"读不到"共用一个空态。
    notes.push('本次查询成功，当前没有与你相关的连接提案（不是"读不到"）。')
  }

  return { ok: true, value: { rows, notes } }
}

/** 动作 → 请求路径与请求体。**撤销走独立端点**（不是 `{decision:'revoke'}`）。 */
export function actionRequest(
  proposalId: string,
  action: ConsentProposalAction,
): { url: string; body: unknown } {
  if (action === 'REVOKE') {
    return { url: `/api/v1/connections/${encodeURIComponent(proposalId)}/revoke`, body: {} }
  }
  return {
    url: `/api/v1/connections/${encodeURIComponent(proposalId)}/consent`,
    body: { decision: action === 'ACCEPT' ? 'accept' : 'reject' },
  }
}

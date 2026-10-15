/**
 * T10 Slice 4 · Community Bridge —— 装配器（纯函数，零 IO）
 *
 * 数据源：`GET /api/v1/bridges`                      → `{ bridges, total }`
 *         `GET /api/v1/bridges/{id}`                  → `{ bridge, myProjection }`
 *         `GET /api/v1/bridges/{id}/discovery`        → `BridgeDiscoveryDto`
 *
 * 🔴 五条纪律（前三条与各区装配器同源，后两条是本区特有）：
 *
 *   1. **零 IO**：只做"服务端载荷 → 可渲染模型"。取数在容器组件里。
 *
 *   2. **不重算服务端已算好的派生值**。本区有一条特别容易犯的：
 *      `status` 里的 `EXPIRED` 是**服务端派生**的（落库只有三个值）。前端若自己拿
 *      `expiresAt` 与当前时刻比一遍，就多出第二个真相来源 —— 而它一旦与服务器时钟
 *      差几秒，界面会显示"已过期"而端点仍放行（或反之），用户看到的是**自相矛盾**。
 *      因此这里只读 `status`，`storedStatus` 原样透出（排障用，不参与分支）。
 *
 *   3. **来源不可用 ≠ 没有数据**。载荷不认识 / 缺键 / 非对象 → 整块拒绝并写明原因，
 *      绝不复用"还没有协议"的空态文案（那会让"读不到"看起来像"本群没有协议"）。
 *
 *   4. **①环 ≠ 单侧配置**。界面上的"已同意共享"只能是 `agreedFieldKeys`（双边交集）。
 *      单侧配置只作 opt-in 的**可选范围**（`myAllowedFieldKeys`）。把单侧键渲染成
 *      "已共享"是本模块最典型的误读：它会让成员以为"我已经给了"，而对方根本没批。
 *
 *   5. **交集是上界，投影是事实，两者必须自洽**。跨群成员的 `subject` 里**只能**
 *      出现 `sharedFieldKeys` 里的键。若服务端多给了，装配器**剔除并产出告警** ——
 *      静默渲染出去等于把服务端的裁剪失效直接显示在屏幕上（那就是泄漏本身）。
 */

import { z } from 'zod'
import {
  BRIDGE_NARROW_LABELS,
  BRIDGE_NARROW_OWNER,
  BRIDGE_NARROW_REASONS,
  BRIDGE_OPT_IN_STATUSES,
  BRIDGE_OPT_IN_STATUS_LABELS,
  BRIDGE_REFUSAL_CODES,
  BRIDGE_REFUSAL_LABELS,
  BRIDGE_STATUS_LABELS,
  BRIDGE_STATUSES,
  BRIDGE_STATUS_VIEWS,
  type BridgeNarrowReason,
  type BridgeOptInStatus,
  type BridgeRefusalCode,
  type BridgeStatusView,
} from '@/lib/bridge'
import {
  AUDIENCE_OPTIONS,
  DISCLOSURE_AUDIENCES,
  DISCLOSURE_FIELDS,
  fieldSpec,
} from '@/lib/connection/field-catalog'
import {
  BRIDGE_NARROW_OWNER_LABELS,
  BRIDGE_PARTY_LABELS,
  type BridgeCard,
  type BridgeDetailModel,
  type BridgeDiscoveryMember,
  type BridgeDiscoveryModel,
  type BridgeListModel,
  type BridgeNarrowedRow,
  type BridgeOptInOption,
  type BridgeOptInView,
} from './types'

// ═══════════════════════════════════════════════════════════
// 结果类型与工具
// ═══════════════════════════════════════════════════════════

export type BridgeAssembly<T> = { ok: true; value: T } | { ok: false; error: string }

/** 首个 schema 问题拼成可读原因（含路径，便于定位是哪条数据）。 */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  const path = issue?.path.length ? `字段 ${issue.path.join('.')}` : '顶层形状'
  return `${path} 不符合契约（${issue?.message ?? '未知'}）`
}

/** 字段目录顺序索引（确定性排序用）。 */
const CATALOG_ORDER = new Map<string, number>(DISCLOSURE_FIELDS.map((f, i) => [f.key, i]))

/**
 * 稳定排序 + 去重：目录内的键按目录顺序，目录外的键按字母序追加。
 * 同一份载荷恒得同一序列 —— 可被单测断言，也避免每次刷新重排。
 */
export function orderFieldKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)].sort((a, b) => {
    const ia = CATALOG_ORDER.get(a)
    const ib = CATALOG_ORDER.get(b)
    if (ia !== undefined && ib !== undefined) return ia - ib
    if (ia !== undefined) return -1
    if (ib !== undefined) return 1
    return a < b ? -1 : a > b ? 1 : 0
  })
}

/** 字段键 → 中文标签。目录查不到 → **原样返回键**（不隐藏；调用方会在此情形产出说明）。 */
export function fieldLabelOf(key: string): string {
  return fieldSpec(key)?.label ?? key
}

const AUDIENCE_LABEL = new Map<string, string>(AUDIENCE_OPTIONS.map((o) => [o.value, o.label]))

function audienceLabelOf(audience: string): string {
  return AUDIENCE_LABEL.get(audience) ?? audience
}

/** 值 → 可渲染字符串（**只做类型转换，不做美化**）。 */
function stringifyValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) {
    const parts = value.filter((v): v is string => typeof v === 'string' && v.length > 0)
    return parts.length === 0 ? null : parts.join('、')
  }
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value.length === 0 ? null : value
  return null
}

/**
 * 目录落后检测：服务端下发了本地目录不认识的键 ⇒ 说出来，而不是渲染成没有标签的方框。
 * （与 `consent/projection.ts` 同一条纪律。）
 */
function collectCatalogGaps(keys: readonly string[], notes: string[], where: string): void {
  const unknown = keys.filter((k) => fieldSpec(k) === null).sort()
  if (unknown.length > 0) {
    notes.push(
      `${where}出现了本地字段目录不认识的字段（${unknown.join('、')}）—— ` +
        `说明前端目录落后于服务端，这些字段暂以原始键显示。`,
    )
  }
}

// ═══════════════════════════════════════════════════════════
// 输入侧 schema（宽松对象：服务端新增字段不该让整块失效）
// ═══════════════════════════════════════════════════════════

const FieldKeys = z.array(z.string())

const MemberOptInLike = z.looseObject({
  id: z.string().min(1),
  userId: z.string().min(1),
  status: z.enum(BRIDGE_OPT_IN_STATUSES),
  disclosedFieldKeys: FieldKeys,
  optedInAt: z.string(),
  withdrawnAt: z.string().nullable(),
})

const BridgeLike = z.looseObject({
  id: z.string().min(1),
  status: z.enum(BRIDGE_STATUS_VIEWS),
  storedStatus: z.enum(BRIDGE_STATUSES),
  initiatorOrgId: z.string().min(1),
  recipientOrgId: z.string().min(1),
  side: z.enum(['INITIATOR', 'RECIPIENT']).nullable(),
  counterpartyOrgId: z.string().nullable(),
  initiatorFieldKeys: FieldKeys,
  recipientFieldKeys: FieldKeys,
  agreedFieldKeys: FieldKeys,
  shareableMissionKinds: z.array(z.string()),
  purpose: z.string(),
  initiatorApprovedAt: z.string(),
  recipientApprovedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  myOptIn: MemberOptInLike.nullable(),
  canApprove: z.boolean(),
  canRevoke: z.boolean(),
  canOptIn: z.boolean(),
  canOptOut: z.boolean(),
})

const BridgeListLike = z.looseObject({
  bridges: z.array(BridgeLike),
  total: z.number().int().nonnegative(),
})

const NarrowedLike = z.looseObject({
  key: z.string().min(1),
  by: z.enum(BRIDGE_NARROW_REASONS),
  owner: z.enum(['ORGANIZER', 'MEMBER']),
})

const SelfProjectionLike = z.looseObject({
  bridgeId: z.string().min(1),
  status: z.enum(BRIDGE_STATUS_VIEWS),
  organizationId: z.string().min(1),
  counterpartyOrgId: z.string().min(1),
  bridgeRefusalCode: z.enum(BRIDGE_REFUSAL_CODES).nullable(),
  sharedFieldKeys: FieldKeys,
  narrowed: z.array(NarrowedLike),
  myOptIn: MemberOptInLike.nullable(),
  profileAudience: z.enum(DISCLOSURE_AUDIENCES),
})

const BridgeDetailLike = z.looseObject({
  bridge: BridgeLike,
  myProjection: SelfProjectionLike,
})

const DiscoveryMemberLike = z.looseObject({
  userId: z.string().min(1),
  sharedFieldKeys: FieldKeys,
  subject: z.record(z.string(), z.unknown()),
  optedInAt: z.string(),
})

const DiscoveryLike = z.looseObject({
  bridgeId: z.string().min(1),
  status: z.enum(BRIDGE_STATUS_VIEWS),
  organizationId: z.string().min(1),
  counterpartyOrgId: z.string().min(1),
  bridgeRefusalCode: z.enum(BRIDGE_REFUSAL_CODES).nullable(),
  members: z.array(DiscoveryMemberLike),
  visibleCount: z.number().int().nonnegative(),
  optedInCount: z.number().int().nonnegative(),
  gatedOut: z.array(z.looseObject({ code: z.enum(BRIDGE_REFUSAL_CODES), count: z.number().int().nonnegative() })),
  profileAudience: z.enum(DISCLOSURE_AUDIENCES),
})

type BridgeLikeRow = z.infer<typeof BridgeLike>
type MemberOptInLikeRow = z.infer<typeof MemberOptInLike>

// ═══════════════════════════════════════════════════════════
// 行 → 卡片
// ═══════════════════════════════════════════════════════════

function toOptInView(row: MemberOptInLikeRow): BridgeOptInView {
  const keys = orderFieldKeys(row.disclosedFieldKeys)
  return {
    status: row.status,
    statusLabel: BRIDGE_OPT_IN_STATUS_LABELS[row.status],
    disclosedFieldKeys: keys,
    disclosedFieldLabels: keys.map(fieldLabelOf),
    optedInAt: row.optedInAt,
    withdrawnAt: row.withdrawnAt,
  }
}

function toCard(row: BridgeLikeRow, notes: string[], prefix: string): BridgeCard {
  const agreedFieldKeys = orderFieldKeys(row.agreedFieldKeys)
  collectCatalogGaps(
    [...row.initiatorFieldKeys, ...row.recipientFieldKeys, ...agreedFieldKeys],
    notes,
    prefix,
  )

  // 🔴 我方单侧配置 = opt-in 的**可选范围**。由**服务端下发的 `side`** 二选一，
  //    不是"前端的组织 id 与 DTO 比对"（那个值来自客户端存储，多一处可被改坏的地方）。
  //    `side === null`（观察者不是当事方，正常路径不出现）→ 空集 + 说明，绝不用默认值兜。
  let myAllowedFieldKeys: string[] = []
  if (row.side === null) {
    notes.push(
      `${prefix}服务端未给出我方在这份协议里的立场（side 为 null）—— ` +
        `「可加入的字段范围」无法确定，本卡片按空集处理。正常路径下不应出现。`,
    )
  } else {
    myAllowedFieldKeys = orderFieldKeys(
      row.side === 'RECIPIENT' ? row.recipientFieldKeys : row.initiatorFieldKeys,
    )
  }

  return {
    id: row.id,
    status: row.status,
    statusLabel: BRIDGE_STATUS_LABELS[row.status],
    side: row.side,
    sideLabel: row.side ? BRIDGE_PARTY_LABELS[row.side] : '（非当事方）',
    counterpartyOrgId: row.counterpartyOrgId,
    purpose: row.purpose,
    agreedFieldKeys,
    agreedFieldLabels: agreedFieldKeys.map(fieldLabelOf),
    myAllowedFieldKeys,
    shareableMissionKinds: [...row.shareableMissionKinds],
    expiresAt: row.expiresAt,
    recipientApprovedAt: row.recipientApprovedAt,
    createdAt: row.createdAt,
    myOptIn: row.myOptIn ? toOptInView(row.myOptIn) : null,
    canApprove: row.canApprove,
    canRevoke: row.canRevoke,
    canOptIn: row.canOptIn,
    canOptOut: row.canOptOut,
  }
}

// ═══════════════════════════════════════════════════════════
// 主装配器 ①：列表
// ═══════════════════════════════════════════════════════════

export function assembleBridgeList(payload: unknown): BridgeAssembly<BridgeListModel> {
  const parsed = BridgeListLike.safeParse(payload)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const notes: string[] = []
  const cards = parsed.data.bridges.map((b) => toCard(b, notes, `协议 ${b.id}：`))

  // 「查询成功但没有协议」是一种**结论**，不该与"读不到"共用一个空态。
  if (cards.length === 0) {
    notes.push('本次查询成功，本组织当前没有参与任何跨群协议（不是"读不到"）。')
  }
  // 总数与本次返回条数不一致 ⇒ 发生了截断，必须说出来（否则用户以为就这么多）。
  if (parsed.data.total > cards.length) {
    notes.push(
      `共 ${parsed.data.total} 份协议，本次只取回 ${cards.length} 份（服务端分页上限）—— 列表未显示全部。`,
    )
  }

  return { ok: true, value: { cards, total: parsed.data.total, notes } }
}

// ═══════════════════════════════════════════════════════════
// 主装配器 ②：详情 + 本人视角归因
// ═══════════════════════════════════════════════════════════

export function assembleBridgeDetail(payload: unknown): BridgeAssembly<BridgeDetailModel> {
  const parsed = BridgeDetailLike.safeParse(payload)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const { bridge, myProjection } = parsed.data
  const notes: string[] = []
  const card = toCard(bridge, notes, '协议详情：')

  const mySharedFieldKeys = orderFieldKeys(myProjection.sharedFieldKeys)
  collectCatalogGaps(mySharedFieldKeys, notes, '我的可见字段里')

  const narrowed: BridgeNarrowedRow[] = myProjection.narrowed
    .map((n) => ({
      key: n.key,
      label: fieldLabelOf(n.key),
      reason: n.by as BridgeNarrowReason,
      reasonLabel: BRIDGE_NARROW_LABELS[n.by],
      owner: n.owner,
      ownerLabel: BRIDGE_NARROW_OWNER_LABELS[n.owner],
    }))
    // 行序：先按字段目录顺序（稳定），同一字段再按归因环（群主 → 成员）排 —— 确定性。
    .sort((a, b) => {
      const oa = CATALOG_ORDER.get(a.key) ?? Number.MAX_SAFE_INTEGER
      const ob = CATALOG_ORDER.get(b.key) ?? Number.MAX_SAFE_INTEGER
      if (oa !== ob) return oa - ob
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
    })

  // ── 归因自洽断言：`owner` 必须与领域层写死的归属一致 ──
  //    为什么前端还要查一遍：`owner` 决定"该找谁"，找错人会让人白跑一趟。
  //    服务端与内核若各改了一半（换了 reason 的归属），页面上不会有任何报错。
  const mismatched = narrowed.filter((n) => n.owner !== BRIDGE_NARROW_OWNER[n.reason])
  if (mismatched.length > 0) {
    notes.push(
      `归因归属出现不一致（${mismatched.map((m) => m.key).join('、')}）：服务端下发的 owner 与领域层写死的归属不同 —— ` +
        `本页按服务端下发的归属展示，但这一条值得核对（找错人会让人白跑一趟）。`,
    )
  }

  // ── opt-in 勾选框：范围 = 我方单侧配置（不是交集！见文件头纪律 4）──
  const selected = new Set(card.myOptIn?.disclosedFieldKeys ?? [])
  const optInOptions: BridgeOptInOption[] = card.myAllowedFieldKeys.map((key) => {
    const spec = fieldSpec(key)
    return {
      key,
      label: spec?.label ?? key,
      selected: selected.has(key),
      sensitive: spec?.sensitive ?? false,
      disclosable: spec?.disclosable ?? true,
    }
  })
  if (card.myOptIn && card.myOptIn.status === 'WITHDRAWN') {
    notes.push(
      '你已退出这份协议的共享。勾选框里保留的是你「上次」的选择 —— 重新提交即视为再次加入（方向是收窄/恢复，不是扩大范围）。',
    )
  }

  return {
    ok: true,
    value: {
      card,
      mySharedFieldKeys,
      mySharedFieldLabels: mySharedFieldKeys.map(fieldLabelOf),
      narrowed,
      bridgeRefusalCode: myProjection.bridgeRefusalCode,
      bridgeRefusalLabel: myProjection.bridgeRefusalCode
        ? BRIDGE_REFUSAL_LABELS[myProjection.bridgeRefusalCode]
        : null,
      profileAudienceLabel: audienceLabelOf(myProjection.profileAudience),
      optInOptions,
      notes,
    },
  }
}

// ═══════════════════════════════════════════════════════════
// 主装配器 ③：跨群可见成员
// ═══════════════════════════════════════════════════════════

export function assembleBridgeDiscovery(payload: unknown): BridgeAssembly<BridgeDiscoveryModel> {
  const parsed = DiscoveryLike.safeParse(payload)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const d = parsed.data
  const notes: string[] = []
  const members: BridgeDiscoveryMember[] = []

  for (const m of d.members) {
    const sharedFieldKeys = orderFieldKeys(m.sharedFieldKeys)
    const sharedSet = new Set(sharedFieldKeys)
    const present = Object.keys(m.subject)

    // 🔴 纪律 5：交集是**上界**。服务端投影里出现交集之外的键 = 裁剪失效。
    const leaked = present.filter((k) => !sharedSet.has(k)).sort()
    if (leaked.length > 0) {
      notes.push(
        `成员 ${m.userId} 的投影里出现了「不在三方交集内」的字段（${leaked.join('、')}）—— ` +
          `这是服务端裁剪失效（本页已剔除这些字段，不会显示出去），请立刻排查。`,
      )
    }

    // 只渲染"既在交集里、服务端又真的给了值"的键。
    const fields = sharedFieldKeys
      .filter((k) => Object.prototype.hasOwnProperty.call(m.subject, k))
      .map((k) => ({ key: k, label: fieldLabelOf(k), value: stringifyValue(m.subject[k]) ?? '（该字段无值）' }))

    collectCatalogGaps(sharedFieldKeys, notes, '跨群可见字段里')

    // 交集里有、投影里却没有的键 ⇒ 计数并说明（不是错误，但会让人以为"少了一块"）。
    const absent = sharedFieldKeys.filter((k) => !Object.prototype.hasOwnProperty.call(m.subject, k))
    if (absent.length > 0) {
      notes.push(
        `成员 ${m.userId} 有 ${absent.length} 个字段在交集内、但投影里没有对应值 —— ` +
          `这些字段在当前档案里是空的。`,
      )
    }

    members.push({ userId: m.userId, sharedFieldKeys, fields, optedInAt: m.optedInAt })
  }

  // 聚合自洽：visibleCount 必须等于实际返回的成员数。
  // 这两者不一致时，界面上"可见 3 位"而列表只有 2 位 —— 用户会以为列表被截断。
  if (d.visibleCount !== members.length) {
    notes.push(
      `服务端下发的可见人数（${d.visibleCount}）与实际返回的成员条数（${members.length}）不一致 —— ` +
        `本页以实际条数为准，但这一条值得核对。`,
    )
  }
  if (d.optedInCount < members.length) {
    notes.push(
      `对方组织已加入共享的人数（${d.optedInCount}）少于本页可见人数（${members.length}）—— ` +
        `这在授权模型上不应发生，请立刻排查。`,
    )
  }

  const gatedOut = d.gatedOut.map((g) => ({
    code: g.code as BridgeRefusalCode,
    label: BRIDGE_REFUSAL_LABELS[g.code],
    count: g.count,
  }))

  // 协议不可用时不抛错：`PENDING` 是**正常**状态（"等对方群主批准"），要渲染的是引导。
  if (d.bridgeRefusalCode !== null && members.length === 0 && d.optedInCount > 0) {
    notes.push(
      `对方组织已有 ${d.optedInCount} 人加入共享，但当前协议层未放行 —— ` +
        `原因是「${BRIDGE_REFUSAL_LABELS[d.bridgeRefusalCode]}」。这是协议状态问题，不是成员设置问题。`,
    )
  }

  return {
    ok: true,
    value: {
      bridgeId: d.bridgeId,
      status: d.status,
      statusLabel: BRIDGE_STATUS_LABELS[d.status],
      counterpartyOrgId: d.counterpartyOrgId,
      bridgeRefusalCode: d.bridgeRefusalCode,
      bridgeRefusalLabel: d.bridgeRefusalCode ? BRIDGE_REFUSAL_LABELS[d.bridgeRefusalCode] : null,
      profileAudienceLabel: audienceLabelOf(d.profileAudience),
      visibleCount: members.length,
      optedInCount: d.optedInCount,
      members,
      gatedOut,
      notes,
    },
  }
}

// ═══════════════════════════════════════════════════════════
// 请求形状（动作 → 路径 + 请求体）
// ═══════════════════════════════════════════════════════════

/**
 * 协议动作。**批准与撤销走各自的端點**（不是 `{decision:'...'}` 一个端点两用）——
 * 与 T05 的 `actionRequest` 同一取向：契约如此，且两者在界面上是独立的语义。
 */
export function bridgeDecideRequest(
  bridgeId: string,
  action: 'APPROVE' | 'REVOKE',
): { url: string; body: unknown } {
  const segment = action === 'APPROVE' ? 'approve' : 'revoke'
  return { url: `/api/v1/bridges/${encodeURIComponent(bridgeId)}/${segment}`, body: {} }
}

/**
 * 成员加入。**不要求幂等键** —— 它是"把我的选择设成这个"的更新语义
 * （库级 `@@unique([bridgeId, userId])` 已保证天然幂等），与发起协议刻意不同。
 */
export function bridgeOptInRequest(
  bridgeId: string,
  disclosedFieldKeys: readonly string[],
): { url: string; body: unknown } {
  return {
    url: `/api/v1/bridges/${encodeURIComponent(bridgeId)}/opt-in`,
    body: { disclosedFieldKeys: [...disclosedFieldKeys] },
  }
}

/** 成员退出。**收窄方向** ⇒ 一律允许（服务端也如此，不需要前置判据）。 */
export function bridgeOptOutRequest(bridgeId: string): { url: string; body: unknown } {
  return { url: `/api/v1/bridges/${encodeURIComponent(bridgeId)}/opt-out`, body: {} }
}

// 供 UI 直接渲染的取值域（**值**放这里，不放 `types.ts` —— 见那里的说明）。
export { BRIDGE_STATUS_VIEWS, BRIDGE_REFUSAL_CODES, BRIDGE_OPT_IN_STATUSES, BRIDGE_NARROW_REASONS }
export type { BridgeStatusView, BridgeRefusalCode, BridgeOptInStatus, BridgeNarrowReason }

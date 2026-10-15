/**
 * T10 · Community Bridge —— 可见性与状态迁移的**纯判定内核**
 *
 * 本文件是 T10 的**唯一**判定处。它回答两个问题，都是纯函数：
 *
 *   1. 「这份协议现在**能不能**被用来共享？」          → `bridgeUsableReason()` / `planBridgeTransition()`
 *   2. 「某一名成员的**哪些字段**此刻真的可以被对方看到？」 → `planBridgeVisibility()`
 *
 * ── 判据的合成方式（AC-19 的可执行定义）─────────────────────────────
 *   跨群可见字段 = **三环取交集**，任一环缺失则字段不可见：
 *
 *     ① 群主配置：`initiatorFieldKeys` ∩ `recipientFieldKeys`
 *         —— **双边群主配置生效**：只有双方都允许的字段才可能共享。
 *     ② 成员 opt-in：`optIn.disclosedFieldKeys`
 *         —— 成员必须**逐个**选择加入，且只能勾 ① 允许的字段。
 *     ③ 成员披露档位：`intentVisibleFieldKeys`（T03 的投影读数）
 *         —— 成员在意图层面至少要对该字段公开过。
 *
 *   由此得到单调性：任一**下层**若比上层宽，只能被**收窄**，绝不能放宽。
 *   本文件的实现天然满足这一点（交集只会变小），`narrowed` 只是把"被哪一环砍掉"
 *   如实归因出来 —— 用户据此才知道该找群主还是改自己的设置。
 *
 * ── 为什么不 import 字段目录 / Prisma / 网络 ─────────────────────────
 *   字段键在本文件里是**不透明的字符串**。内核只做集合运算，因此：
 *     · 字段目录演进（新增一个可披露字段）时**不需要改本文件**；
 *     · 门禁 `check-bridge-invariants`（B1/B2/B5）能静态证明这里**写不出**
 *       "直接查询对方私有行"的代码 —— 这正是 AC-19「不得直接查询对方私有行」
 *       的第一道结构性保证。
 *
 * ⚠️ 本文件是 `tsc` 覆盖范围内的 `.ts`；`.mjs` 才是盲区（见 `check:script-decls`）。
 */

import type {
  BridgeAction,
  BridgeRefusalCode,
  BridgeStatusView,
  BridgeTransitionPlan,
  BridgeView,
  BridgeVisibilityInput,
  BridgeVisibilityPlan,
  BridgeNarrowReason,
} from './types'

// ═══════════════════════════════════════════════════════════
// 工具
// ═══════════════════════════════════════════════════════════

/**
 * 字段键归一化：去首尾空白、丢弃空串、去重、**稳定排序**。
 *
 * 排序不是洁癖：投影结果会进 API 响应与审计。同一份配置在不同请求里产出
 * 不同顺序的数组，会让「这次比上次多了哪个字段」这类对账**没法做**
 * （只能逐项比对而非 diff）。故此处把顺序固定下来，作为**契约的一部分**。
 */
export function normalizeFieldKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const k of keys) {
    if (typeof k !== 'string') continue
    const trimmed = k.trim()
    if (trimmed.length === 0) continue
    seen.add(trimmed)
  }
  return [...seen].sort()
}

/**
 * `expiresAt` 是否已到（或不可解析）。
 *
 * 🔴 无法解析的 `expiresAt` 一律视为**已过期**（fail-closed）。
 *    把它当成"永久有效"是最糟的选择：一条被人工改坏的日期会让协议**永不失效**，
 *    且没有任何东西会报错。
 */
function isExpired(expiresAt: string | null, now: Date): boolean {
  if (expiresAt === null) return false
  const t = Date.parse(expiresAt)
  if (!Number.isFinite(t)) return true
  return t <= now.getTime()
}

// ═══════════════════════════════════════════════════════════
// 协议本身可用吗
// ═══════════════════════════════════════════════════════════

/** 协议可用性判定（**不含**成员维度）。 */
export function bridgeUsableReason(
  bridge: BridgeView,
  now: Date,
): { ok: true } | { ok: false; code: BridgeRefusalCode } {
  if (bridge.status === 'REVOKED') return { ok: false, code: 'BRIDGE_REVOKED' }
  if (bridge.status === 'PENDING') return { ok: false, code: 'BRIDGE_PENDING' }
  if (isExpired(bridge.expiresAt, now)) return { ok: false, code: 'BRIDGE_EXPIRED' }
  return { ok: true }
}

/**
 * 对外的状态视图：落库状态 + **派生**的 `EXPIRED`。
 * 与 T03 的 `IntentStatusView` 同一手法 —— `EXPIRED` 不落库（否则是第二个事实来源）。
 */
export function bridgeStatusView(bridge: BridgeView, now: Date): BridgeStatusView {
  if (bridge.status === 'ACTIVE' && isExpired(bridge.expiresAt, now)) return 'EXPIRED'
  return bridge.status
}

// ═══════════════════════════════════════════════════════════
// 状态迁移
// ═══════════════════════════════════════════════════════════

/**
 * 迁移**真相表**。`ACTIVE` 的**唯一**入口是被邀方批准 —— 这是「双边群主配置生效」
 * 在结构上的落点：代码里**不存在**"发起方单边把协议激活"这条边。
 *
 * @param side 调用者在本协议里的**立场**。服务层必须**从 DB 行推导**（而不是从请求体读），
 *             否则请求体可以自称是被邀方来绕过 `WRONG_SIDE`。
 */
export function planBridgeTransition(
  bridge: BridgeView,
  action: BridgeAction,
  side: 'INITIATOR' | 'RECIPIENT',
  now: Date,
): BridgeTransitionPlan {
  if (bridge.status === 'REVOKED') return { ok: false, reason: 'BRIDGE_REVOKED' }
  if (isExpired(bridge.expiresAt, now)) return { ok: false, reason: 'BRIDGE_EXPIRED' }

  if (action === 'APPROVE') {
    // 发起方在**创建时**已自动批准，故批准权只属于被邀方。
    if (side !== 'RECIPIENT') return { ok: false, reason: 'WRONG_SIDE' }
    if (bridge.status === 'ACTIVE') return { ok: false, reason: 'ALREADY_ACTIVE' }
    return { ok: true, from: 'PENDING', to: 'ACTIVE' }
  }

  // REVOKE：**任一方**都可，且 PENDING 与 ACTIVE 都可撤销。
  if (bridge.status === 'PENDING') return { ok: true, from: 'PENDING', to: 'REVOKED' }
  return { ok: true, from: 'ACTIVE', to: 'REVOKED' }
}

// ═══════════════════════════════════════════════════════════
// 三方交集（核心）
// ═══════════════════════════════════════════════════════════

/**
 * 计算某名成员此刻**实际**可被共享的字段集。
 *
 * 早退顺序即**闸门顺序**（越靠前越"整体性"）：
 *   协议不可用 → 未 opt-in → 已退出 → 无披露依据 → 交集为空。
 * 这个顺序是有意的：先报"这份协议根本不能用"，再报"这个人没加入"，
 * 最后才是"配置没交集" —— 用户从最外层的问题开始修。
 */
export function planBridgeVisibility(input: BridgeVisibilityInput): BridgeVisibilityPlan {
  const empty = (code: BridgeRefusalCode): BridgeVisibilityPlan => ({
    ok: false,
    code,
    sharedFieldKeys: [],
    narrowed: [],
  })

  const usable = bridgeUsableReason(input.bridge, input.now)
  if (!usable.ok) return empty(usable.code)

  if (input.optIn === null) return empty('MEMBER_NOT_OPTED_IN')
  if (input.optIn.status === 'WITHDRAWN') return empty('MEMBER_OPTED_OUT')
  if (input.intentVisibleFieldKeys === null) return empty('NO_INTENT_DISCLOSURE')

  const initiator = new Set(normalizeFieldKeys(input.bridge.initiatorFieldKeys))
  const recipient = new Set(normalizeFieldKeys(input.bridge.recipientFieldKeys))
  const memberOptIn = new Set(normalizeFieldKeys(input.optIn.disclosedFieldKeys))
  const intent = new Set(normalizeFieldKeys(input.intentVisibleFieldKeys))

  // 候选全集 = 四者的并集。用并集（而非某一环）作候选，才能把
  // 「某一环自己冒出来的、根本不在协议里的字段」也如实归因为被收窄，
  // 而不是让它悄悄消失 —— 后者的症状是"我明明勾了却什么都没有"，无从排查。
  const candidates = [
    ...new Set([...initiator, ...recipient, ...memberOptIn, ...intent]),
  ].sort()

  const sharedFieldKeys: string[] = []
  const narrowed: Array<{ key: string; by: BridgeNarrowReason }> = []

  for (const key of candidates) {
    // 归因取**最上游**被砍的那一环（群主 > 成员 > 意图），
    // 因为上游不改，下游怎么改都没用 —— 让用户先找对的人。
    if (!initiator.has(key) || !recipient.has(key)) {
      narrowed.push({ key, by: 'GROUP_POLICY' })
      continue
    }
    if (!memberOptIn.has(key)) {
      narrowed.push({ key, by: 'MEMBER_POLICY' })
      continue
    }
    if (!intent.has(key)) {
      narrowed.push({ key, by: 'INTENT_DISCLOSURE' })
      continue
    }
    sharedFieldKeys.push(key)
  }

  if (sharedFieldKeys.length === 0) {
    // 闸门都过了但交集为空 —— 仍然把 `narrowed` 带出去，
    // 否则用户只看到"无字段可共享"，不知道是哪一环没配。
    return { ok: false, code: 'NOTHING_SHARED', sharedFieldKeys: [], narrowed }
  }

  return { ok: true, code: null, sharedFieldKeys, narrowed }
}

/**
 * 批量版本：为**多名**候选成员各算一次，复用同一份协议配置。
 *
 * 为什么单独开一个函数而不是让调用方循环：协议侧（①环的两个集合）只需
 * 归一化**一次**。列表页最多上百名成员，逐人归一化是纯粹的浪费 ——
 * 与 T09 `loadOutboundGates()` 做批量的理由相同。
 */
export function planBridgeVisibilityBatch(
  input: Omit<BridgeVisibilityInput, 'optIn' | 'intentVisibleFieldKeys'>,
  members: ReadonlyArray<Pick<BridgeVisibilityInput, 'optIn' | 'intentVisibleFieldKeys'>>,
): BridgeVisibilityPlan[] {
  return members.map((m) =>
    planBridgeVisibility({
      ...input,
      optIn: m.optIn,
      intentVisibleFieldKeys: m.intentVisibleFieldKeys,
    }),
  )
}

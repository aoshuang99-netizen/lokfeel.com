/**
 * T08 · 三级成果验证 —— **纯函数内核**（零 IO、零 Prisma 依赖）
 *
 * 为什么单列一层：AC-15 要求「**自报不算验证成功**」，这条判断必须**只有一处实现**，
 * 且被**执行点（服务层）**与**展示层（Console 徽章、指标统计）共用**。
 * 两处各写一份 `=== 'EXTERNALLY_VERIFIED'` 式的比较，是漂移的经典来源 ——
 * 而且它不会报错，只会在某一边少算。
 *
 * 派生而非入参：级别由 `OutcomeVerification` 记录集算出（`deriveVerificationLevel`），
 * **不接受客户端写入**。否则第一个越权的客户端就能"把自己标成已验证"。
 */

/** 验证级别（与 `prisma/schema/outcome.prisma` 的枚举**逐字一致**）。 */
export type OutcomeVerificationLevel =
  | 'SELF_REPORTED'
  | 'COUNTERPARTY_CONFIRMED'
  | 'EXTERNALLY_VERIFIED'

/** 由低到高。**顺序即语义**：派生取最高，迁移只允许前进。 */
export const LEVEL_ORDER: readonly OutcomeVerificationLevel[] = [
  'SELF_REPORTED',
  'COUNTERPARTY_CONFIRMED',
  'EXTERNALLY_VERIFIED',
] as const

export const LEVEL_LABELS: Record<OutcomeVerificationLevel, string> = {
  SELF_REPORTED: '仅自报',
  COUNTERPARTY_CONFIRMED: '对手方已确认',
  EXTERNALLY_VERIFIED: '外部已核验',
}

export function levelIndex(level: OutcomeVerificationLevel): number {
  return LEVEL_ORDER.indexOf(level)
}

/** 解析外部输入（查询串）→ 级别；未知值返回 `null`（由调用方转 400，**不静默忽略**）。 */
export function parseVerificationLevel(value: unknown): OutcomeVerificationLevel | null {
  return typeof value === 'string' && (LEVEL_ORDER as readonly string[]).includes(value)
    ? (value as OutcomeVerificationLevel)
    : null
}

/**
 * 🔴 **AC-15 的字面判据 —— 全项目只此一处**。
 *
 * 「自报不算验证成功」：`SELF_REPORTED` 是"上报即得"的**下限**，不是验证结论。
 * 任何"已验证成果数 / 验证率"都必须经过本函数，**不得**直接比较 enum 字面量 ——
 * 后者在日后新增第四级时会静默漏算（散落的比较不会报错，只会少算）。
 */
export function isVerified(level: OutcomeVerificationLevel): boolean {
  return level !== 'SELF_REPORTED'
}

/**
 * 「已验证」级别的集合 —— **由 `isVerified` 派生**，供 SQL 下推使用。
 *
 * ⚠️ 不要手写 `['COUNTERPARTY_CONFIRMED','EXTERNALLY_VERIFIED']`：
 * 那正是"两个地方各写一份"的开端。这里派生一次，加第四级时自动跟着变。
 */
export const VERIFIED_LEVELS: readonly OutcomeVerificationLevel[] =
  LEVEL_ORDER.filter(isVerified)

/**
 * 由验证记录集**派生**级别 —— 取记录集中最高的一档。
 *
 * 空集 → `SELF_REPORTED`：上报这件事本身就是最低一级，不需要额外记录来"证明"它。
 */
export function deriveVerificationLevel(
  verifications: readonly { level: OutcomeVerificationLevel }[]
): OutcomeVerificationLevel {
  let best: OutcomeVerificationLevel = 'SELF_REPORTED'
  for (const v of verifications) {
    if (levelIndex(v.level) > levelIndex(best)) best = v.level
  }
  return best
}

/** 级别是否**前进**（同级不算）。用于判断是否需要写回 `Outcome.verificationLevel` 快照。 */
export function isLevelAdvance(
  from: OutcomeVerificationLevel,
  to: OutcomeVerificationLevel
): boolean {
  return levelIndex(to) > levelIndex(from)
}

/** 某人相对**某一条成果**的角色。 */
export type OutcomeRole = 'REPORTER' | 'COUNTERPARTY' | 'OBSERVER'

/**
 * 判定角色。`reporterId` / `counterpartyId` **只在服务层使用**，不进 DTO ——
 * 返回 userId 等于把"谁跟谁连接了"披露给任意 `outcome.read` 持有者（MEMBER 起即有）。
 */
export function outcomeRoleOf(
  row: { reporterId: string; counterpartyId: string },
  userId: string
): OutcomeRole {
  if (row.reporterId === userId) return 'REPORTER'
  if (row.counterpartyId === userId) return 'COUNTERPARTY'
  return 'OBSERVER'
}

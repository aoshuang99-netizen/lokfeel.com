/**
 * AC-10 · 数据导出（数据可携带）—— **服务层**（有 IO，判定完全来自 `account.ts`）
 *
 * ## 口径
 *
 *   - **只导出当前登录用户自己的数据**（`userId` 来自服务端会话，**不接受**任何
 *     请求参数指定他人 —— 写成 `?userId=` 就把"猜 id"变成了攻击面）。
 *   - 组织侧只导出**该用户自己的成员关系**（`Membership`），**不**导出组织全量成员/
 *     全量任务 —— 那是组织的数据，不是这个人的。
 *   - 单表上限 `EXPORT_ROW_LIMIT`：超出给计数 + `truncated:true`，**不静默截断**成
 *     "看起来完整"的导出物。
 *
 * ## 与 AC-03（逐字段披露）的关系
 *
 * 这里**不经过** `discloseSubject()`：披露投影管的是"给别人看什么"，而导出是
 * **自己看自己**。两者方向相反，共用出口反而会把"对自己也要脱敏"混进来。
 * 唯一保留的剔除是**内部运营字段**（`adminNotes`）与**凭据字段**（`password` 等）。
 */

import { db } from '@/lib/db'
import {
  ACCOUNT_EXPORT_VERSION,
  EXPORT_ROW_LIMIT,
  redactProfileForExport,
  redactUserForExport,
} from './account'

/** 本导出**未覆盖**的面（诚实声明，随导出物一起交给用户）。 */
export const EXPORT_UNCOVERED = [
  'IM 会话与消息（属 B2C 域，不在 Connection OS 范围）',
  '匹配历史（Match / MatchReaction，属 B2C 域）',
  '订单与支付流水（属计费域，见 BillingEvent / UsageRecord）',
] as const

export interface ExportSection {
  count: number
  /** true = 命中行数超过 `EXPORT_ROW_LIMIT`，只导出了前 N 条。 */
  truncated: boolean
  rows: unknown[]
}

export interface AccountExport {
  meta: {
    exportVersion: string
    generatedAt: string
    userId: string
    rowLimit: number
    /** 未覆盖的面（见 `EXPORT_UNCOVERED`）。 */
    uncovered: readonly string[]
  }
  data: Record<string, ExportSection>
}

/** 取多一行用于判断是否被截断；返回时截回上限。 */
async function sectionOf(
  fetch: (take: number) => Promise<Record<string, unknown>[]>
): Promise<ExportSection> {
  const raw = await fetch(EXPORT_ROW_LIMIT + 1)
  const truncated = raw.length > EXPORT_ROW_LIMIT
  const rows = truncated ? raw.slice(0, EXPORT_ROW_LIMIT) : raw
  return { count: rows.length, truncated, rows }
}

/**
 * 导出当前用户的全部**已覆盖**数据。
 *
 * 顺序无所谓；每张表独立取，某张表失败不影响其余（失败会抛出 —— 宁可整体失败，
 * 也不要给出一份"缺了一块却看不出来"的导出物）。
 */
export async function exportAccountData(userId: string, now: Date = new Date()): Promise<AccountExport> {
  const data: Record<string, ExportSection> = {}

  const user = await db.user.findUnique({ where: { id: userId } })
  data.account = {
    count: user ? 1 : 0,
    truncated: false,
    rows: user ? [redactUserForExport(user as unknown as Record<string, unknown>)] : [],
  }

  const profile = await db.profile.findUnique({ where: { userId } })
  data.profile = {
    count: profile ? 1 : 0,
    truncated: false,
    rows: profile ? [redactProfileForExport(profile as unknown as Record<string, unknown>)] : [],
  }

  data.memberships = await sectionOf((take) =>
    db.membership.findMany({ where: { userId }, take }) as Promise<Record<string, unknown>[]>
  )
  data.missions = await sectionOf((take) =>
    db.mission.findMany({ where: { ownerId: userId }, take }) as Promise<Record<string, unknown>[]>
  )
  data.missionParticipations = await sectionOf((take) =>
    db.missionParticipation.findMany({ where: { userId }, take }) as Promise<Record<string, unknown>[]>
  )
  data.socialIntents = await sectionOf((take) =>
    db.socialIntent.findMany({ where: { userId }, take }) as Promise<Record<string, unknown>[]>
  )
  data.connectionProposals = await sectionOf((take) =>
    db.connectionProposal.findMany({
      where: { OR: [{ proposerId: userId }, { candidateId: userId }] },
      take,
    }) as Promise<Record<string, unknown>[]>
  )
  data.proposalDecisions = await sectionOf((take) =>
    db.proposalDecision.findMany({ where: { personId: userId }, take }) as Promise<Record<string, unknown>[]>
  )
  data.outcomes = await sectionOf((take) =>
    db.outcome.findMany({
      where: { OR: [{ reporterId: userId }, { counterpartyId: userId }] },
      take,
    }) as Promise<Record<string, unknown>[]>
  )
  data.bridgeMemberOptIns = await sectionOf((take) =>
    db.bridgeMemberOptIn.findMany({ where: { userId }, take }) as Promise<Record<string, unknown>[]>
  )
  data.agentRuns = await sectionOf((take) =>
    db.agentRun.findMany({ where: { requestedBy: userId }, take }) as Promise<Record<string, unknown>[]>
  )
  data.notifications = await sectionOf((take) =>
    db.notification.findMany({ where: { userId }, take }) as Promise<Record<string, unknown>[]>
  )

  return {
    meta: {
      exportVersion: ACCOUNT_EXPORT_VERSION,
      generatedAt: now.toISOString(),
      userId,
      rowLimit: EXPORT_ROW_LIMIT,
      uncovered: EXPORT_UNCOVERED,
    },
    data,
  }
}

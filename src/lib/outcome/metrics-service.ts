/**
 * T08 · 商业指标 —— **服务层**（唯一做 IO 的地方）
 *
 * 职责刻意很窄：把"需求"翻译成**一组计数查询**，然后交给纯函数内核算指标。
 * 指标公式**不在这里** —— 否则对账脚本（原始表 SQL）与这里会各写一份公式，
 * 而"两份实现"正是 AC-16 要消灭的东西（漂移不会报错，只会让两个数慢慢分开）。
 *
 * 🔴 三条不变量：
 *   ① **租户谓词不可省** —— 每个 count 都以 `organizationId` 为首要条件（T01 铁律）；
 *   ② **不做时间窗口** —— 见 `metrics.ts` 文件头口径 2 与 `risks.md` R10；
 *   ③ **`missionId` 只作收窄，不作授权** —— 传一个不属于本租户的 id 只会得到全 0，
 *      不会泄漏任何信息（也不报 404：那会变成一个"任务是否存在"的探测器）。
 */

import { db } from '@/lib/db'
import type { TenantContext } from '@/lib/tenancy/resolve'
import { VERIFIED_LEVELS } from './verification'
import {
  computeOutcomeMetrics,
  type OutcomeMetricCounts,
  type OutcomeMetrics,
} from './metrics'

/** 指标响应（= 内核输出 + 本次生成时间）。 */
export interface OutcomeMetricsDto extends OutcomeMetrics {
  /** 本次计算时间。**不属于指标本身** —— 同一份数据在不同时刻算出的指标应当相同。 */
  generatedAt: string
}

export interface OutcomeMetricsOptions {
  /** 可选：把全部指标收窄到某条任务。 */
  missionId?: string | null
}

/**
 * 采集原始计数。
 *
 * 每个计数都对应**一条可独立重写的 SQL 谓词** —— 这是"可复算"的机械保证：
 * `scripts/qa/outcome-reconcile.mjs` 会用原始表 SQL 把其中每一个重算一遍。
 *
 * ⚠️ 「已验证」用的是 `verificationLevel ∈ VERIFIED_LEVELS`（**下推 SQL**），
 *    而不是取出所有成果再调 `isVerified()` 逐条判 —— 后者在租户成果多时是
 *    全表加载，而且会诱使别人在别处再写一遍 `isVerified` 的等价判断。
 *    `VERIFIED_LEVELS` 由 `isVerified` 派生（见 `verification.ts`），故两者不会漂移。
 */
export async function collectOutcomeMetricCounts(
  ctx: TenantContext,
  options: OutcomeMetricsOptions = {}
): Promise<OutcomeMetricCounts> {
  const organizationId = ctx.organizationId
  const missionFilter = options.missionId ? { missionId: options.missionId } : {}

  const [
    proposals,
    consentPending,
    mutuallyAccepted,
    introduced,
    outcomesReported,
    outcomesVerified,
    takeovers,
    deadLettered,
  ] = await Promise.all([
    db.connectionProposal.count({ where: { organizationId, ...missionFilter } }),
    db.connectionProposal.count({
      where: { organizationId, ...missionFilter, status: 'CONSENT_PENDING' },
    }),
    db.connectionProposal.count({
      where: { organizationId, ...missionFilter, status: 'MUTUALLY_ACCEPTED' },
    }),
    // 「已介绍」是 `introducedAt` 这件事，与授权状态**无关**（介绍后授权冻结在 MUTUALLY_ACCEPTED）。
    db.connectionProposal.count({
      where: { organizationId, ...missionFilter, introducedAt: { not: null } },
    }),
    db.outcome.count({ where: { organizationId, ...missionFilter } }),
    db.outcome.count({
      where: {
        organizationId,
        ...missionFilter,
        verificationLevel: { in: [...VERIFIED_LEVELS] },
      },
    }),
    db.workflowJob.count({ where: { organizationId, ...missionFilter, status: 'TAKEN_OVER' } }),
    db.workflowJob.count({ where: { organizationId, ...missionFilter, status: 'DEAD' } }),
  ])

  return {
    proposals,
    consentPending,
    mutuallyAccepted,
    introduced,
    outcomesReported,
    outcomesVerified,
    takeovers,
    deadLettered,
  }
}

/**
 * 本租户的成果/成本/工时指标。
 *
 * `now` 只用于 `generatedAt` —— 不参与任何计算（内核是纯函数，见 `metrics.ts`）。
 */
export async function getOutcomeMetrics(
  ctx: TenantContext,
  options: OutcomeMetricsOptions = {},
  now: Date = new Date()
): Promise<OutcomeMetricsDto> {
  const counts = await collectOutcomeMetricCounts(ctx, options)
  const metrics = computeOutcomeMetrics(counts, { missionId: options.missionId ?? null })
  return { generatedAt: now.toISOString(), ...metrics }
}

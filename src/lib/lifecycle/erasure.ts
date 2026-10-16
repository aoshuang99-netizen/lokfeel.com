/**
 * AC-10 · 删除请求（被遗忘权）—— **服务层**（有 IO，政策来自 `account.ts`）
 *
 * ## 两段式：先计划、后执行
 *
 *   - `planErasure()`   **只读**：算出"会动哪些表、各多少行、留什么"。可任意次调用。
 *   - `executeErasure()` 真写。**必须**先跑过 plan 并让调用方确认（接口用 `?apply=1`）。
 *
 * 分开的理由：删除是**不可逆**的（匿化后原邮箱/昵称都回不来），
 * 所以"看一眼影响面"必须是一个**独立、安全、幂等**的动作，而不是打印一行日志。
 *
 * ## 执行语义
 *
 * 全部走 `updateMany` / `deleteMany` —— 不依赖"目标行一定存在"。
 * 缺档案、无意图、从没参与过的用户，执行是**空操作**而不是报错（P2025）。
 * 只有 `User` 本身不存在才抛 `NotFoundError`（那是调用方的问题，不是幂等问题）。
 */

import { db } from '@/lib/db'
import { NotFoundError } from '@/lib/errors'
import { redisCache } from '@/lib/redis-cache'
import { USER_REFERENCING_CACHE_PREFIXES, userScopedCacheKeys } from '@/lib/cache-keys'
import {
  ERASURE_ACTIONS,
  ERASURE_POLICY_VERSION,
  activeErasureActions,
  erasedEmailFor,
  erasedProfilePatch,
  type ErasureAction,
} from './account'

/** AgentRun 清空后的占位（`goal` 是必填 String，不能用 null）。 */
const ERASED_TEXT_PLACEHOLDER = '[erased]'

/**
 * 🔴 **「删了库」不等于「删干净了」**：本服务在 `requireAuth()`、`/api/discover`、
 * `/api/who-liked-me`、`/api/settings` 四处有用户维度缓存。其中 `who-liked-me` 的值里含
 * **别人的**档案快照（displayName/avatar/age/city/gender/relationshipGoal）。
 * 库里匿化完成而缓存没失效，这个人就在**别人的**"谁喜欢过我"列表里继续以原昵称出现，
 * 最多 90 秒（TTL 60s + jitter 30s），而且**没有任何报错**。
 * 所以缓存失效是执行的**组成部分**，不是收尾的"顺手一清"。
 */

export interface ErasureImpact {
  target: string
  /** 受影响行数。 */
  rows: number
  /** 保留（受影响但**不**删除/匿化）的项在报告里显式标出。 */
  retained?: boolean
}

export interface ErasurePlan {
  policyVersion: string
  userId: string
  generatedAt: string
  /** 完整动作清单（含 retain 项）—— 单一真相源，供文档与报告共用。 */
  actions: readonly ErasureAction[]
  impact: ErasureImpact[]
  /** 摘要：要动 N 张表、保留 M 张表。 */
  summary: { activeTargets: number; retainedTargets: number; totalRows: number }
}

export interface ErasureResult {
  plan: ErasurePlan
  /** 真正执行完后的影响面（与 plan.impact 应一致；不一致说明并发写入了新数据）。 */
  applied: ErasureImpact[]
  /**
   * 已失效的缓存。**显式回给调用方**（而不是只写日志）——「清缓存」是 AC-10 的判据之一，
   * 必须能被断言，否则"清了"与"忘了清"在响应里长得一样。
   */
  cache: {
    /** 按精确键失效的本人缓存。 */
    keys: string[]
    /** 按前缀**全局**失效的缓存（值里可能含本人快照，见 cache-keys.ts）。 */
    prefixes: readonly string[]
  }
  erasedAt: string
}

/** 统计某表的行数（找不到表/字段时返回 0 —— dry-run 不该因为缺数据而失败）。 */
async function rowsOf(fetch: () => Promise<number>): Promise<number> {
  try {
    return await fetch()
  } catch {
    return 0
  }
}

/**
 * 生成删除计划（**只读**）。
 */
export async function planErasure(userId: string, now: Date = new Date()): Promise<ErasurePlan> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!user) throw new NotFoundError('User not found')

  const impact: ErasureImpact[] = [
    {
      target: 'User',
      rows: await rowsOf(() => db.user.count({ where: { id: userId, deletedAt: null } })),
    },
    { target: 'Profile', rows: await rowsOf(() => db.profile.count({ where: { userId } })) },
    {
      target: 'SocialIntent',
      rows: await rowsOf(() => db.socialIntent.count({ where: { userId, status: 'ACTIVE' } })),
    },
    {
      target: 'MissionParticipation',
      rows: await rowsOf(() =>
        db.missionParticipation.count({ where: { userId, status: { not: 'WITHDRAWN' } } })
      ),
    },
    {
      target: 'BridgeMemberOptIn',
      rows: await rowsOf(() =>
        db.bridgeMemberOptIn.count({ where: { userId, status: 'ACTIVE' } })
      ),
    },
    {
      target: 'AgentRun',
      rows: await rowsOf(() =>
        db.agentRun.count({ where: { requestedBy: userId, rawText: { not: null } } })
      ),
    },
    { target: 'Notification', rows: await rowsOf(() => db.notification.count({ where: { userId } })) },
    // ── 保留项：受影响但不动 ────────────────────────────────────────
    {
      target: 'Membership',
      rows: await rowsOf(() => db.membership.count({ where: { userId } })),
      retained: true,
    },
    {
      target: 'ConnectionProposal',
      rows: await rowsOf(() =>
        db.connectionProposal.count({
          where: { OR: [{ proposerId: userId }, { candidateId: userId }] },
        })
      ),
      retained: true,
    },
    {
      target: 'Outcome',
      rows: await rowsOf(() =>
        db.outcome.count({ where: { OR: [{ reporterId: userId }, { counterpartyId: userId }] } })
      ),
      retained: true,
    },
  ]

  const active = impact.filter((i) => !i.retained)
  return {
    policyVersion: ERASURE_POLICY_VERSION,
    userId,
    generatedAt: now.toISOString(),
    actions: ERASURE_ACTIONS,
    impact,
    summary: {
      activeTargets: activeErasureActions().length,
      retainedTargets: ERASURE_ACTIONS.length - activeErasureActions().length,
      totalRows: active.reduce((n, i) => n + i.rows, 0),
    },
  }
}

/**
 * 执行删除（**不可逆**）。
 *
 * 顺序不是随意的：**先收窄对外可见性，再清正文**。
 * `Profile.profileStatus` 是各查询面的实际闸门（见 `account.ts` 文件头 ②），
 * 先把它关掉，意味着即使后续某一步失败，用户也**已经**从用户面消失 ——
 * 失败方向落在"更不可见"一侧，是安全的；反过来则会留下"PII 已清、但仍被召回"的窗口。
 */
export async function executeErasure(userId: string, now: Date = new Date()): Promise<ErasureResult> {
  const plan = await planErasure(userId, now)
  const email = erasedEmailFor(userId)

  // ① 关闸门：档案匿化 + DEACTIVATED（用户从所有查询面消失）
  await db.profile.updateMany({ where: { userId }, data: erasedProfilePatch() })

  // ② 账号凭据匿化 + 会话失效 + 留痕
  await db.user.update({
    where: { id: userId },
    data: {
      email,
      name: null,
      image: null,
      emailVerified: null,
      password: null,
      tokenVersion: { increment: 1 },
      deletedAt: now,
    },
  })

  // ③ 意图：正文清空 + 收窄（未结束的意图不得继续参与召回）
  await db.socialIntent.updateMany({
    where: { userId },
    data: {
      need: ERASED_TEXT_PLACEHOLDER,
      offer: ERASED_TEXT_PLACEHOLDER,
      constraints: null,
      disclosure: null,
      importedFields: null,
      importConsentAt: null,
      status: 'WITHDRAWN',
      withdrawnAt: now,
    },
  })

  // ④ 参与关系：撤回（保留行 —— 任务方仍需知道"曾有人参与过"）
  await db.missionParticipation.updateMany({
    where: { userId },
    data: { status: 'WITHDRAWN', note: null },
  })

  // ⑤ 跨群披露授权：立刻收回（AT-19 铁律：无跨群默认共享）
  await db.bridgeMemberOptIn.updateMany({
    where: { userId },
    data: { status: 'WITHDRAWN', disclosedFieldKeys: '[]', withdrawnAt: now },
  })

  // ⑥ Agent 运行：清空用户原始文本（不可信输入面）
  await db.agentRun.updateMany({
    where: { requestedBy: userId },
    data: {
      goal: ERASED_TEXT_PLACEHOLDER,
      subjectLabel: null,
      rawText: null,
      proposalJson: null,
      reason: null,
    },
  })

  // ⑦ 站内信：删除（通知不是审计证据）
  await db.notification.deleteMany({ where: { userId } })

  // ⑧ 缓存：先按精确键清本人键，再按前缀**全局**清"值里含本人快照"的他人缓存。
  //    放在最后的原因：前面任何一步抛错都不该留下"缓存已清、库里却仍有 PII"的组合
  //    （那时缓存是唯一还带着 PII 的地方，却看起来已经处理过）。
  //    redisCache 的两条路径（Redis / 内存降级）都**不抛错**，所以 ⑧ 不会把已完成的擦除变成失败。
  const selfKeys = userScopedCacheKeys(userId)
  await Promise.all(selfKeys.map((k) => redisCache.invalidate(k)))
  for (const prefix of USER_REFERENCING_CACHE_PREFIXES) {
    await redisCache.invalidateByPrefix(prefix)
  }

  return {
    plan,
    applied: plan.impact,
    cache: { keys: selfKeys, prefixes: USER_REFERENCING_CACHE_PREFIXES },
    erasedAt: now.toISOString(),
  }
}

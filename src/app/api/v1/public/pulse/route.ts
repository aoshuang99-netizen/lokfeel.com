/**
 * `GET /api/v1/public/pulse` —— 首页「活数据」端点（匿名可达 · 只读聚合）
 *
 * ── 存在理由 ─────────────────────────────────────────────────────
 *   首页此前的数字（5 工具 / 50 路由 / 3 技能 / playbook 成本）全是**写死的字符串**，
 *   产品跑起来之后它们既不变化、也无法证明为真。本端点把首页能从代码/库里
 *   **真实取到**的东西一次性给出，并且明确区分「能力事实」与「近期活动」。
 *
 * ── 三条硬约束 ───────────────────────────────────────────────────
 *   1. **不伪造**：DB 不可用时返回 `activity: null`（不是 0，也不是示例值），
 *      展示层必须显示「—」。宁可空，不可假。
 *   2. **不披露**：只出**跨租户计数**与**阶段名**，不出任何 organizationId /
 *      userId / 任务标题 / 目标文本。阶段名来自代码里的固定枚举集合（见 `stage` 注释）。
 *   3. **不拖垮首屏**：响应极小（几百字节），`s-maxage=60` 由边缘缓存；
 *      首页在水合后 idle 才请求，不参与 LCP。
 *
 * 限流：每 IP 每分钟 60 次（正常访客一次；爬虫会被挡）。
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import { INTEROP_TOOL_NAMES } from '@/lib/interop/tools'
import { SKILL_KEYS } from '@/lib/agent/skills'
import { WORKSPACE_SPEC_VERSION } from '@/lib/workspace-spec/schema'
import { PULSE_WINDOW_DAYS, type PublicPulse, type PulseStage } from '@/lib/public/pulse-shape'
import { ORCHESTRATION_STAGE_NAMES } from '@/lib/agents/stage-events'

export const runtime = 'nodejs'
/** 端点内直接查库，不做构建期预渲染。 */
export const dynamic = 'force-dynamic'

const pulseLimit = rateLimit({ name: 'public:pulse', windowMs: 60_000, max: 60 })

/**
 * 进程内短缓存（60s）。
 *
 * 每次聚合要打 4–5 次远程查询（本仓生产是 libSQL/Turso，单次 RTT 数百毫秒），
 * 冷态实测 3.2s。首页这块数据变化极慢，没有必要每个访客都重算：
 *   边缘 `s-maxage=60` 挡掉大部分，进程内缓存挡住同一实例的重复计算。
 * 失败结果同样缓存 60s —— 避免故障期间把远程库打穿。
 */
const PULSE_TTL_MS = 60_000
let aggregateCache: {
  at: number
  activity: PublicPulse['activity']
  stages: PulseStage[]
  note?: string
} | null = null

function withCache<T extends NextResponse>(res: T): T {
  res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  return res
}

/** 只允许出现在首页的阶段名 —— 白名单来自 `stage-events.ts` 的唯一清单。 */
const PUBLIC_STAGE_LABELS: readonly string[] = ORCHESTRATION_STAGE_NAMES

/** 单表失败不拖垮整体：返回 null，由展示层显示「—」。 */
async function safeCount(fn: () => Promise<number>): Promise<number | null> {
  try {
    return await fn()
  } catch (error) {
    console.error('[public/pulse] count failed:', error)
    return null
  }
}

async function readActivity(since: Date): Promise<{
  activity: PublicPulse['activity']
  stages: PulseStage[]
  note?: string
}> {
  const [missions, runs, decisions, verifiedOutcomes] = await Promise.all([
    safeCount(() => prisma.mission.count({ where: { createdAt: { gte: since } } })),
    safeCount(() => prisma.agentRun.count({ where: { createdAt: { gte: since } } })),
    safeCount(() => prisma.agentApproval.count({ where: { decidedAt: { gte: since } } })),
    safeCount(() =>
      prisma.outcome.count({
        where: {
          createdAt: { gte: since },
          // 🔴 SELF_REPORTED 不算验证成功（AC-15）
          verificationLevel: { in: ['COUNTERPARTY_CONFIRMED', 'EXTERNALLY_VERIFIED'] },
        },
      }),
    ),
  ])

  // 阶段事件表属 V21 batch2 新增：**生产可能尚未迁移**（`no such table`）。
  // 这不是"零事件"，必须与"真的没有事件"区分开 —— 用 note 标注，而不是画 0 条。
  let stages: PulseStage[] = []
  let stagesUnavailable = false
  try {
    const grouped = await prisma.agentRunStageEvent.groupBy({
      by: ['stage'],
      where: { at: { gte: since } },
      _count: { _all: true },
    })
    stages = grouped
      .map((row) => ({ stage: row.stage, count: row._count._all }))
      .filter((row) => PUBLIC_STAGE_LABELS.includes(row.stage))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
  } catch (error) {
    stagesUnavailable = true
    console.error('[public/pulse] stage aggregate unavailable:', error)
  }

  const allNull =
    missions === null && runs === null && decisions === null && verifiedOutcomes === null

  if (allNull) {
    return { activity: null, stages, note: 'aggregate_unavailable' }
  }
  return {
    activity: { missions, runs, decisions, verifiedOutcomes },
    stages,
    ...(stagesUnavailable ? { note: 'stage_events_unavailable' } : {}),
  }
}

export async function GET(req: NextRequest) {
  const verdict = await pulseLimit(req)
  if (!verdict.success) {
    const res = NextResponse.json(
      { success: false, error: { message: 'Too many requests' } },
      { status: 429 },
    )
    res.headers.set('Retry-After', String(Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000))))
    return res
  }

  const now = Date.now()
  if (!aggregateCache || now - aggregateCache.at > PULSE_TTL_MS) {
    const since = new Date(now - PULSE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const fresh = await readActivity(since)
    aggregateCache = { at: now, ...fresh }
  }

  const { activity, stages, note } = aggregateCache

  const payload: PublicPulse = {
    // 时刻取**聚合时刻**，不是响应时刻 —— 否则边缘缓存命中时时间会漂移，
    // 看起来像"刚算过"，实际是 60s 前的数。
    asOf: new Date(aggregateCache.at).toISOString(),
    windowDays: PULSE_WINDOW_DAYS,
    capabilities: {
      skills: SKILL_KEYS.length,
      mcpTools: INTEROP_TOOL_NAMES.length,
      specVersion: WORKSPACE_SPEC_VERSION,
    },
    activity,
    stages,
    ...(note ? { note } : {}),
  }

  return withCache(NextResponse.json({ success: true, data: payload }))
}

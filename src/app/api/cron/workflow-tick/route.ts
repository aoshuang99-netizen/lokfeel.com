/**
 * T06 · 工作流驱动器端点（内部）
 *
 *   POST /api/cron/workflow-tick   —— 跑一轮：领取 → 执行 → 收尾；顺带对账 + 运营告警
 *   GET  /api/cron/workflow-tick   —— 同上（便于手工/浏览器触发排障）
 *
 * 三段顺序（有依赖，不可换）：**执行 → 对账 → 告警**。
 * 告警排在最后，是因为它读的是"此刻仍需人处置"的状态；参数 `?alerts=0` / `?reconcile=0` 可单独关掉。
 *
 * 守卫：`Authorization: Bearer <CRON_SECRET>`（与 `src/app/api/cron/*` 其余端点一致）。
 * 由 `netlify/functions/cron-runner.ts` 按 `netlify.toml` 的 schedule 触发。
 *
 * ⚠️ **Netlify 免费计划只保证小时级**（见 cron-runner 注释）。这意味着：
 *   - 重试退避的实际粒度是小时级，不是秒级 —— 抖动的意义因此更小，但幂等不变；
 *   - 需要更细粒度时，用外部 cron（cron-job.org）打同一个端点，不改代码。
 * 因此本模块的**正确性不依赖调度频率**：晚一点跑只是慢一点，
 * 不会漏、不会重复（幂等键 + 租约兜底）。
 *
 * `maxDuration`：本地/其他平台的自定义上限。Netlify 上由平台决定，
 * 所以真正的自我保护在 `runWorkflowTick` 的**时间预算**里（默认 8s 主动收手）。
 */

import { NextResponse } from 'next/server'
import { alertOperatorsOfAttention, runWorkflowTick, reconcileMissingJobs } from '@/lib/workflow'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

async function handle(request: Request): Promise<NextResponse> {
  const startedAt = Date.now()
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return unauthorized()
  }

  const url = new URL(request.url)

  // 可调参数（都有安全默认值；用于压测与排障，不改变语义）。
  const limitRaw = url.searchParams.get('limit')
  const budgetRaw = url.searchParams.get('budgetMs')
  const limit = limitRaw && Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : undefined
  const budgetMs = budgetRaw && Number.isFinite(Number(budgetRaw)) ? Number(budgetRaw) : undefined
  const doReconcile = url.searchParams.get('reconcile') !== '0'
  const doAlerts = url.searchParams.get('alerts') !== '0'

  try {
    const tick = await runWorkflowTick({
      ...(limit !== undefined ? { limit } : {}),
      ...(budgetMs !== undefined ? { budgetMs } : {}),
    })

    // 对账放在 tick **之后**：先把手头的活干完，再补漏。
    // 漏网的来源只有"钩子没跑成"（见 hooks.ts 的可靠性说明），因此量很小。
    const reconciliation = doReconcile ? await reconcileMissingJobs({ limit: 20 }) : null

    // 运营告警放在**最后**：它读的是"此刻仍需人处置"的状态，
    // 必须在对账补入队之后，否则会漏报刚补上的那批。
    // 告警**不产生任务**（见 alerts.ts 的防回路说明），因此不会影响本轮 tick 的语义。
    const alerts = doAlerts ? await alertOperatorsOfAttention() : null

    return NextResponse.json({
      ok: true,
      tick,
      reconciliation,
      alerts,
      wallClockMs: Date.now() - startedAt,
    })
  } catch (err) {
    // 驱动器失败不下发 500 之外的信息（避免把内部结构暴露在公开可探测的路径上）。
    console.error('[cron.workflow-tick] failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ ok: false, error: 'workflow tick failed' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle

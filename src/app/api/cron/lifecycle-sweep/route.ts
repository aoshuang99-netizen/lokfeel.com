/**
 * AC-10 · 生命周期清理端点（内部）
 *
 *   POST /api/cron/lifecycle-sweep          —— 按政策清理（**真删**）
 *   POST /api/cron/lifecycle-sweep?dry=1    —— 只统计，不写（默认建议先用这个看一遍）
 *   GET  /api/cron/lifecycle-sweep?...      —— 同上（手工排障）
 *
 * 守卫：`Authorization: Bearer <CRON_SECRET>`（与 `src/app/api/cron/*` 一致）。
 * 由 `netlify/functions/cron-runner.ts` 触发（小时级足够 —— 保留期以天计）。
 *
 * 安全性（为什么敢挂在 cron 上自动跑）：
 *   - 只清**终态**任务（`TERMINAL_JOB_STATUSES`）；PENDING/RUNNING 永不触碰；
 *   - 投递证据窗口默认 2 年，真正每天会被清的主要是"僵死 PENDING"与旧的已读站内信；
 *   - 每个实体单次删除有 `batchSize` 上界（默认 500）；
 *   - `?dry=1` 可以先看数量。
 *
 * 保留期可用环境变量覆盖（`LIFECYCLE_*`，见 `src/lib/lifecycle/policy.ts`）。
 */

import { NextResponse } from 'next/server'
import { policyFromEnv, runLifecycleSweep } from '@/lib/lifecycle'

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
  // 默认**真删**（这是它的职责）；`?dry=1` 变成只统计。
  const apply = url.searchParams.get('dry') !== '1'

  try {
    const report = await runLifecycleSweep({ apply, policy: policyFromEnv() })
    return NextResponse.json({ ok: true, report, wallClockMs: Date.now() - startedAt })
  } catch (err) {
    console.error('[cron.lifecycle-sweep] failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ ok: false, error: 'lifecycle sweep failed' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle

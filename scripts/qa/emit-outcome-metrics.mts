#!/usr/bin/env -S npx tsx
/**
 * T08 · 指标输出器（AC-16 的"被测一侧"）
 *
 * 把 `/api/v1/outcomes/metrics` 会下发的**同一份数字**打到 stdout，作为
 * `outcome-reconcile.mjs` 的输入。两种模式：
 *
 *   1. **service 模式（默认）**：直接调用路由所用的同一个服务函数
 *      `getOutcomeMetrics()` —— 不需要起 dev server，适合本地/CI 反复跑。
 *      它产出的是**路由的响应体形状**（`success()` 信封里的 `data`）。
 *   2. **http 模式**：设 `METRICS_BASE_URL`（可选 `METRICS_COOKIE`）→ 真打一次 HTTP，
 *      取 `body.data`。适合对着已部署的环境取证。
 *
 * 🔴 为什么它是 `.mts` 而不是 `.mjs`：
 *   它要 import `@/lib/...`（路径别名 + TS 类型）。`.mts` 走 `tsx`，且**被 tsc 覆盖**
 *   —— 而 `scripts/**\/*.mjs` 是 tsc 死角（只有 `node --check` 查语法）。
 *   这里的 import 不能被 tsc 漏掉。
 *
 * ⚠️ **动态 import 是刻意的**：`@/lib/db` 在**首次访问**时读 `process.env.DATABASE_URL`。
 *   静态 `import` 会被提升到 env 注入之前 → Prisma `URL_INVALID`（本仓踩过）。
 *   保持"先注入 env、后动态 import"的顺序，别改成静态。
 *
 * 用法:
 *   METRICS_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t08-metrics.db \
 *     npx tsx scripts/qa/emit-outcome-metrics.mts > /tmp/t08-metrics-api.json
 *   METRICS_ORG_ID=org_e2e METRICS_MISSION_ID=mission_t08_metrics DATABASE_URL=... \
 *     npx tsx scripts/qa/emit-outcome-metrics.mts > /tmp/t08-metrics-api-mission.json
 *   METRICS_ORG_ID=org_1 METRICS_BASE_URL=https://app.lokfeel.com METRICS_COOKIE='...' \
 *     npx tsx scripts/qa/emit-outcome-metrics.mts
 */

import type { TenantContext, TenantRole } from '@/lib/tenancy'

const TENANT_ROLES: readonly string[] = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER']

function env(name: string): string {
  return (process.env[name] || '').trim()
}

async function viaService(): Promise<unknown> {
  const organizationId = env('METRICS_ORG_ID')
  if (!organizationId) throw new Error('service 模式需要 METRICS_ORG_ID')

  const roleRaw = env('METRICS_ROLE') || 'ADMIN'
  if (!TENANT_ROLES.includes(roleRaw)) {
    throw new Error(`METRICS_ROLE 非法：${roleRaw}（应为 ${TENANT_ROLES.join(' / ')}）`)
  }

  // ⚠️ env 注入之后才加载（见文件头说明）——不要改成顶部静态 import。
  const { getOutcomeMetrics } = await import('@/lib/outcome/metrics-service')

  const ctx: TenantContext = {
    organizationId,
    userId: env('METRICS_USER_ID') || 'u_reconcile',
    role: roleRaw as TenantRole,
    membershipId: 'ms_reconcile',
  }
  return getOutcomeMetrics(ctx, { missionId: env('METRICS_MISSION_ID') || null })
}

async function viaHttp(): Promise<unknown> {
  const base = env('METRICS_BASE_URL').replace(/\/$/, '')
  const missionId = env('METRICS_MISSION_ID')
  const url = `${base}/api/v1/outcomes/metrics${missionId ? `?missionId=${encodeURIComponent(missionId)}` : ''}`
  const cookie = env('METRICS_COOKIE')

  const res = await fetch(url, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
    signal: AbortSignal.timeout(25000),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url} —— ${text.slice(0, 200)}`)
  }
  const body = JSON.parse(text) as { data?: unknown }
  // `success()` 信封：真正的数据在 `data`（与 reconcile 的输入契约一致）。
  return body.data ?? body
}

async function main(): Promise<void> {
  const payload = env('METRICS_BASE_URL') ? await viaHttp() : await viaService()
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

main().catch((err) => {
  console.error('❌ 指标输出失败：', err?.message || err)
  process.exit(1)
})

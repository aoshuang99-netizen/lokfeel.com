#!/usr/bin/env -S npx tsx
/**
 * T08 · 计费输出器（AC-21 的"被测一侧"）
 *
 * 把 `/api/v1/billing/usage` 与 `/api/v1/billing/subscription` 会下发的**同一份数据**
 * 打到 stdout，作为 `billing-reconcile.mjs` 的输入。
 *
 * 三种模式：
 *   1. **service 模式（默认）**：直接调用路由所用的同一个服务函数
 *      （`collectUsage` → `getUsageSummary` / `getSubscription`）—— 不需要起 dev server。
 *      与"真打 HTTP"相比，它**同样**跑完归集与折叠，只是少了 HTTP 层（能力判定已由
 *      路由测试 `tests/billing/billing-api.test.ts` 覆盖，此处不重复）。
 *   2. **http 模式**：设 `BILLING_BASE_URL`（可选 `BILLING_COOKIE`）→ 真打两次 HTTP，
 *      取 `body.data`。适合对着已部署环境取证。
 *   3. **只读模式**：设 `BILLING_SKIP_COLLECT=1` → 不归集，只读当前账本（用于验证
 *      "归集已经跑过、重复读是稳定的"）。
 *
 * 🔴 输出是**三段**，不是一段：
 *      { collect, usage, subscription }
 *   · `collect.first/second` —— 连续两次归集的结果，用来证明**归集幂等**
 *     （第二次必须 `inserted === 0`）。少了它，"可复算"只证明了"算得对"，没证明"重跑不变"；
 *   · `usage` —— 用量汇总 DTO（含自描述的 `basis`：期次/限额/单元映射）；
 *   · `subscription` —— 订阅状态 DTO（含 `gateway` 诚实块）。
 *
 * 🔴 为什么它是 `.mts` 而不是 `.mjs`：它要 import `@/lib/...`（路径别名 + TS 类型）。
 *    `.mts` 走 `tsx` 且**被 tsc 覆盖**；`scripts/**\/*.mjs` 是 tsc 死角（只有
 *    `node --check` 查语法）—— 本文件的 import 不能被漏掉。
 *
 * ⚠️ **动态 import 是刻意的**：`@/lib/db` 在**首次访问**时读 `process.env.DATABASE_URL`。
 *    静态 `import` 会被提升到 env 注入之前 → Prisma `URL_INVALID`（本仓踩过）。
 *    保持"先注入 env、后动态 import"的顺序，别改成静态。
 *
 * 用法:
 *   BILLING_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t08-billing.db \
 *     npx tsx scripts/qa/emit-billing.mts > /tmp/t08-billing-api.json
 *   BILLING_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t08-billing.db BILLING_PERIOD=2026-09 \
 *     npx tsx scripts/qa/emit-billing.mts > /tmp/t08-billing-api-prev.json
 *   BILLING_ORG_ID=org_1 BILLING_BASE_URL=https://app.lokfeel.com BILLING_COOKIE='...' \
 *     npx tsx scripts/qa/emit-billing.mts
 */

import type { TenantContext, TenantRole } from '@/lib/tenancy'

const TENANT_ROLES: readonly string[] = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER']

function env(name: string): string {
  return (process.env[name] || '').trim()
}

function buildContext(): TenantContext {
  const organizationId = env('BILLING_ORG_ID')
  if (!organizationId) throw new Error('缺少 BILLING_ORG_ID')

  const roleRaw = env('BILLING_ROLE') || 'ADMIN'
  if (!TENANT_ROLES.includes(roleRaw)) {
    throw new Error(`BILLING_ROLE 非法：${roleRaw}（应为 ${TENANT_ROLES.join(' / ')}）`)
  }

  return {
    organizationId,
    userId: env('BILLING_USER_ID') || 'u_reconcile',
    role: roleRaw as TenantRole,
    membershipId: 'ms_reconcile',
  }
}

async function viaService(): Promise<unknown> {
  const ctx = buildContext()
  const periodKey = env('BILLING_PERIOD') || null
  const skipCollect = env('BILLING_SKIP_COLLECT') === '1'

  // ⚠️ env 注入之后才加载（见文件头说明）——不要改成顶部静态 import。
  const { collectUsage, getSubscription, getUsageSummary } = await import('@/lib/billing')

  let collect: unknown = { skipped: true }
  if (!skipCollect) {
    // 连续两次：第二次的 `inserted` 必须为 0（归集幂等）。
    const first = await collectUsage(ctx)
    const second = await collectUsage(ctx)
    collect = { first, second }
  }

  const usage = await getUsageSummary(ctx, { periodKey })
  const subscription = await getSubscription(ctx)
  return { collect, usage, subscription }
}

async function viaHttp(): Promise<unknown> {
  const base = env('BILLING_BASE_URL').replace(/\/$/, '')
  const cookie = env('BILLING_COOKIE')
  const periodKey = env('BILLING_PERIOD')

  const get = async (path: string) => {
    const res = await fetch(`${base}${path}`, {
      headers: cookie ? { cookie } : {},
      redirect: 'manual',
      signal: AbortSignal.timeout(25000),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} ${path} —— ${text.slice(0, 200)}`)
    const body = JSON.parse(text) as { data?: unknown }
    return body.data ?? body
  }

  const usage = await get(`/api/v1/billing/usage${periodKey ? `?periodKey=${encodeURIComponent(periodKey)}` : ''}`)
  const subscription = await get('/api/v1/billing/subscription')
  // http 模式不归集（归集是写操作，须显式走 `POST /usage/collect`）。
  return { collect: { skipped: true, reason: 'http 模式不归集' }, usage, subscription }
}

async function main(): Promise<void> {
  const payload = env('BILLING_BASE_URL') ? await viaHttp() : await viaService()
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

main().catch((err) => {
  console.error('❌ 计费输出失败：', err?.message || err)
  process.exit(1)
})

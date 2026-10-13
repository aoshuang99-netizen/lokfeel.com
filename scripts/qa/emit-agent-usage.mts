#!/usr/bin/env -S npx tsx
/**
 * T09 · Agent 用量输出器（AC-20 的"被测一侧"）
 *
 * 把 `/api/v1/agents/usage` **与** `/api/v1/agents/runs/:id` 会下发的**同一份数据**
 * 打到 stdout，作为 `agent-reconcile.mjs` 的输入。
 *
 * 🔴 为什么是**两段**（`usage` + `runs[]`），而不是只打 usage：
 *    AC-20 的判据是「**每次调用**可归因」。用量汇总只能证明"总数对得上"，
 *    证明不了"每一条调用的 token→金额 推导对得上"。故必须把**逐次调用明细**
 *    （`GET /runs/:id` 的 `calls[]`）一起打出来，让对账脚本能逐条复算。
 *
 * 三种模式：
 *   1. **service 模式（默认）**：直接调用路由所用的同一个服务函数
 *      （`agentUsage` / `listAgentRuns` / `getAgentRun`）—— 不需要起 dev server。
 *      与"真打 HTTP"相比，它**同样**跑完账本装载与 DTO 投影，只少了 HTTP 层
 *      （能力判定已由 `tests/agents/agents-api.test.ts` 覆盖，此处不重复）。
 *   2. **http 模式**：设 `AGENT_BASE_URL`（可选 `AGENT_COOKIE`）→ 真打 HTTP，取 `body.data`。
 *      适合对着已部署环境取证。
 *   3. **只读**：本脚本**不写库**（不发起运行、不审批）—— 它是取证器，不是夹具。
 *      造数据请用 `scripts/qa/seed-t09-agent.mts`（隔离库）。
 *
 * 🔴 为什么它是 `.mts` 而不是 `.mjs`：它要 import `@/lib/...`（路径别名 + TS 类型）。
 *    `.mts` 走 `tsx` 且**被 tsc 覆盖**；`scripts/**\/*.mjs` 是 tsc 死角
 *    （只有 `node --check` 查语法）—— 本文件的 import 不能被漏掉。
 *
 * ⚠️ **动态 import 是刻意的**：`@/lib/db` 在**首次访问**时读 `process.env.DATABASE_URL`。
 *    静态 `import` 会被提升到 env 注入之前 → Prisma `URL_INVALID`（本仓踩过）。
 *
 * 用法:
 *   AGENT_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t09-agent.db \
 *     npx tsx scripts/qa/emit-agent-usage.mts > /tmp/t09-agent-api.json
 *   AGENT_ORG_ID=org_1 AGENT_BASE_URL=https://app.lokfeel.com AGENT_COOKIE='...' \
 *     npx tsx scripts/qa/emit-agent-usage.mts
 */

import type { TenantContext, TenantRole } from '@/lib/tenancy'

const TENANT_ROLES: readonly string[] = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER']

function env(name: string): string {
  return (process.env[name] || '').trim()
}

function buildContext(): TenantContext {
  const organizationId = env('AGENT_ORG_ID')
  if (!organizationId) throw new Error('缺少 AGENT_ORG_ID')

  const roleRaw = env('AGENT_ROLE') || 'ADMIN'
  if (!TENANT_ROLES.includes(roleRaw)) {
    throw new Error(`AGENT_ROLE 非法：${roleRaw}（应为 ${TENANT_ROLES.join(' / ')}）`)
  }

  return {
    organizationId,
    userId: env('AGENT_USER_ID') || 'u_reconcile',
    role: roleRaw as TenantRole,
    membershipId: 'ms_reconcile',
  }
}

function limitOf(): number {
  const raw = Number(env('AGENT_LIMIT') || '100')
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100
}

async function viaService(): Promise<unknown> {
  const ctx = buildContext()
  const limit = limitOf()

  // ⚠️ env 注入之后才加载（见文件头说明）——不要改成顶部静态 import。
  const { agentUsage, getAgentRun, listAgentRuns } = await import('@/lib/agents')

  const usage = await agentUsage(ctx, { env: process.env })
  const listed = await listAgentRuns(ctx, { limit })

  // 列表 DTO **不带 calls**（刻意的：列表是最小可见集）。逐条取详情拿到 calls[]。
  const runs = []
  for (const item of listed.items) {
    runs.push(await getAgentRun(ctx, item.id))
  }

  return { usage, runs }
}

async function viaHttp(): Promise<unknown> {
  const base = env('AGENT_BASE_URL').replace(/\/$/, '')
  const cookie = env('AGENT_COOKIE')
  const limit = limitOf()

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

  const usage = await get('/api/v1/agents/usage')
  const listed = (await get(`/api/v1/agents/runs?limit=${limit}`)) as { items?: Array<{ id: string }> }
  const runs = []
  for (const item of listed.items ?? []) {
    runs.push(await get(`/api/v1/agents/runs/${encodeURIComponent(item.id)}`))
  }
  return { usage, runs }
}

async function main(): Promise<void> {
  const payload = env('AGENT_BASE_URL') ? await viaHttp() : await viaService()
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

main().catch((err) => {
  console.error('❌ Agent 用量输出失败：', err?.message || err)
  process.exit(1)
})

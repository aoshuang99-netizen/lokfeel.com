/**
 * T09 · `/api/v1/agents/runs` —— Agent 运行列表与发起
 *
 *   GET  能力 `agent.run`（OPERATOR+）：列本租户的运行（精简形状，不带逐次调用）
 *   POST 能力 `agent.run`（OPERATOR+）：发起一次运行（**消耗组织额度**，AC-20）
 *
 * 🔴 POST 的三条硬约束：
 *   ① **必须带 `Idempotency-Key`** —— 缺省 → 400，不退化为"非幂等也能用"。
 *      理由：一次运行会产生**真实模型调用**（真花钱）。网络重试若被当成新请求，
 *      就是重复计费 —— 幂等键在这里不是"锦上添花"，是止损。
 *   ② **限额在调用之前判**（服务层 `loadLedger()` → `runSkill({ledger})`）。
 *      不是在事后合计 —— 事后合计只能告诉你"已经超了"。
 *   ③ 产出**可否执行**由内核的执行计划给出（`execution.available`）——
 *      本切片只**读**它，不做任何执行动作。执行走 `/runs/[runId]/execute`（`agent.execute`）。
 *
 * ⚠️ 为什么 `agent.run` 与 `agent.approve` 是**两个**能力：见 capabilities.ts 的
 * 注释 —— 分离是为了让"触发者"与"批准者"不是同一个人（制度层的 AC-08 保证）。
 * 本文件只 gate `agent.run`；批准走 `/runs/[runId]/approve|reject`。
 */

import type { NextRequest } from 'next/server'
import { created, errorResponse, success } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import {
  AGENT_LIMITS,
  createAgentRun,
  listAgentRuns,
  requireSkillKey,
} from '@/lib/agents'
// 内核类型从 `@/lib/agent`（单数）取 —— 服务层与内核的边界按"谁能碰 IO"划，
// 不按"谁更好 import"划。见 src/lib/agents/index.ts 的文件头。
import { AGENT_RUN_STATUSES, type AgentRunStatus } from '@/lib/agent'

/** 解析 `?limit=`（缺省交给服务层；上限 `AGENT_LIMITS.listMax`）。 */
function parseLimit(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw new ValidationError(`limit must be a positive integer, got: ${raw}`, { field: 'limit' })
  }
  return Math.min(n, AGENT_LIMITS.listMax)
}

/** 解析 `?status=` —— 未知值 → 400（**不静默忽略**，否则用户以为过滤生效了）。 */
function parseStatus(raw: string | null): AgentRunStatus | undefined {
  if (raw === null || raw === '') return undefined
  if (!(AGENT_RUN_STATUSES as readonly string[]).includes(raw)) {
    throw new ValidationError(`unknown status: ${raw}`, {
      field: 'status',
      allowed: AGENT_RUN_STATUSES,
    })
  }
  return raw as AgentRunStatus
}

export const GET = withTenant('agent.run')(async (req: NextRequest, tenant) => {
  try {
    const status = parseStatus(req.nextUrl.searchParams.get('status'))
    const skillRaw = req.nextUrl.searchParams.get('skill')
    // 非法 skill → 400（与 status 同口径：写错了就该被指出，而不是返回全量让人以为过滤了）。
    const skill = skillRaw ? requireSkillKey(skillRaw) : undefined
    const limit = parseLimit(req.nextUrl.searchParams.get('limit'))

    const result = await listAgentRuns(tenant, { status, skill, limit })
    return success(result)
  } catch (error) {
    return errorResponse(error)
  }
})

export const POST = withTenant('agent.run')(async (req: NextRequest, tenant) => {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    // 🔴 **从 header 取**幂等键（不是 body）—— 与 contracts/connection.openapi.yaml 一致。
    //    `req.headers.get()` 找不到时返回 null，交给 `requireIdempotencyKey` 抛 400。
    const idempotencyKey = req.headers.get('idempotency-key')

    const result = await createAgentRun(tenant, {
      skill: body.skill,
      input: body.input,
      idempotencyKey,
      subjectLabel: body.subjectLabel,
    })

    // 命中幂等记录时**不**返回 201 —— 本次没有创建资源，返回 200 更诚实。
    if (result.replayed) {
      return success({ run: result.run, replayed: true })
    }
    return created({ run: result.run, replayed: false })
  } catch (error) {
    return errorResponse(error)
  }
})

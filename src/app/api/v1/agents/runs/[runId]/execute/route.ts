/**
 * T09 · `POST /api/v1/agents/runs/{runId}/execute` —— **执行**（Slice 4）
 *
 *   能力 `agent.execute`（**OPERATOR+**，与批准权 `agent.approve`(ADMIN+) 分离 ——
 *   见 capabilities.ts：门槛在**批准**那一环，执行是机械动作）。
 *
 * 🔴 这是 `AgentRunStatus.EXECUTED` 的**唯一**入口。全部判据都在服务层
 *    （`executeAgentRun` → 内核的 `planExecution()`）：状态机 + 真实裁决记录 +
 *    技能是否注册了执行器。本路由只负责"过能力 + 转发 + 把错误翻成 HTTP 语义"。
 *
 * 语义（与服务层一致）：
 *   - 首次执行 → **201**（创建了一条 `AgentExecution`）
 *   - 已经执行过 → **200** + `replayed: true`（**不会**产生第二次投递）
 *   - 状态不允许 / 缺批准记录 / 该技能无执行器 → **409**（带 `code`）
 *   - 角色不足 → 403；运行不存在或跨租户 → 404（复合 where，租户谓词不可省）
 *   - 投递失败 → 原样抛出（500 / 具体错误），**且状态不变**（可重试）
 *
 * ⚠️ 本切片的效果是**内部回执**（站内信给发起人），**不是**对外送达。
 *    对外送达需要 target 身份 + T05 的 `discloseSubject()` 出口，属下一片 ——
 *    这条边界写在 `executor.ts` 的文件头与 `execution.ts` 的真相表里，
 *    不靠"读代码的人自己推断"。
 */

import type { NextRequest } from 'next/server'
import { created, errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { executeAgentRun } from '@/lib/agents'
import { runIdOf } from '../../../_shared/params'

export const POST = withTenant('agent.execute')(async (_req: NextRequest, tenant, params) => {
  try {
    const runId = runIdOf(params)
    const result = await executeAgentRun(tenant, runId)

    // 命中既有执行记录时**不**返回 201 —— 本次没有创建资源（也没有产生副作用）。
    if (result.replayed) {
      return success(result)
    }
    return created(result)
  } catch (error) {
    return errorResponse(error)
  }
})

/**
 * T05 · `/api/v1/connections/proposals`
 *
 *   POST  发起连接提案（**要求 `Idempotency-Key`**，能力 `proposal.create`）
 *   GET   列出与我相关的提案（能力 `proposal.read`，自助）
 *
 * 三点与 T02/T03 一致、值得复述的边界：
 *
 *   1. **`proposal.create` 是运营能力**（T01 定为 OPERATOR+），
 *      `proposal.decide` 才是自助。这是"牵线由社群主理人发起、
 *      被介绍的人自己表态"这一产品语义在权限层的落点 ——
 *      普通成员**不能**替别人发起连接。
 *
 *   2. **读是自助的**：`GET` 只返回"我是发起方或被介绍方"的提案，
 *      谓词写死在服务层（`OR: [proposerId, candidateId]`），不依赖调用方传参。
 *
 *   3. **对外状态含派生的 `EXPIRED`**：库里没有这个值（它由 `expiresAt` 现算），
 *      因此 `?states=` 过滤发生在装配之后，而不是 SQL 里 —— 若有人日后把它
 *      优化进 SQL，`EXPIRED` 会静默变成"过滤不掉"，而不是报错。
 */

import type { NextRequest } from 'next/server'
import { created, errorResponse, success } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { onProposalCreated } from '@/lib/workflow'
import {
  createProposal,
  findProposalById,
  hardDeleteProposal,
  hashRequest,
  listMyProposals,
  parseProposalCreate,
  requireIdempotencyKey,
  withIdempotency,
  type ProposalState,
} from '@/lib/connection'

const ALLOWED_STATES: readonly ProposalState[] = [
  'CONSENT_PENDING',
  'MUTUALLY_ACCEPTED',
  'REJECTED',
  'REVOKED',
  'EXPIRED',
]

export const POST = withTenant('proposal.create')(async (req: NextRequest, tenant) => {
  try {
    // 契约要求：Idempotency-Key 必需。缺失 → 400（**不**退化为"非幂等"）。
    const key = requireIdempotencyKey(req.headers.get('Idempotency-Key'))

    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    const input = parseProposalCreate(body)

    const { resource, replayed } = await withIdempotency({
      organizationId: tenant.organizationId,
      scope: 'proposal.create',
      key,
      requestHash: hashRequest(input),
      resourceType: 'proposal',
      load: (id) => findProposalById(tenant, id),
      create: async () => {
        const proposal = await createProposal(tenant, input)
        return { resourceId: proposal.id, resource: proposal }
      },
      compensate: (id) => hardDeleteProposal(tenant, id),
    })

    const res = created(resource)
    if (replayed) {
      // 与 `/missions` 同口径：用响应头显式区分重放，避免调用方把重放
      // 误判成"又发了一条提案"。
      res.headers.set('Idempotent-Replayed', 'true')
    }

    // T06：把"提案已创建"翻译成工作流任务（建实例 + 通知被介绍方）。
    // 入队是**尽力而为**的非事务操作（理由见 `@/lib/workflow/hooks` 文件头）：
    // 失败只记录进 HookResult.errors，绝不让已成功的提案创建变成 500。
    // 重放路径同样调用 —— 入队幂等，撞 dedupeKey 只会 no-op。
    await onProposalCreated({ id: resource.id, organizationId: tenant.organizationId }).catch(() => {})

    return res
  } catch (error) {
    return errorResponse(error)
  }
})

export const GET = withTenant('proposal.read')(async (req: NextRequest, tenant) => {
  try {
    const limitRaw = req.nextUrl.searchParams.get('limit')
    const limit = limitRaw ? Number(limitRaw) : undefined
    if (limitRaw && (!Number.isFinite(limit) || (limit as number) < 1)) {
      throw new ValidationError('limit must be a positive integer', { field: 'limit' })
    }

    const statesRaw = req.nextUrl.searchParams.get('states')
    let states: ProposalState[] | undefined
    if (statesRaw) {
      const parsed = statesRaw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
      const unknown = parsed.filter((s) => !ALLOWED_STATES.includes(s as ProposalState))
      if (unknown.length > 0) {
        throw new ValidationError(`unknown state(s): ${unknown.join(', ')}`, { field: 'states' })
      }
      states = parsed as ProposalState[]
    }

    const items = await listMyProposals(tenant, { limit, states })
    return success({ proposals: items })
  } catch (error) {
    return errorResponse(error)
  }
})

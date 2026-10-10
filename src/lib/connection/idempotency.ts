/**
 * T02 · 幂等键（Idempotency-Key）
 *
 * 契约对 `POST /missions` 强制要求 `Idempotency-Key` 请求头
 * （contracts/connection.openapi.yaml:12-19）。语义：
 *   - **同一个键** + **同一个请求体** → 返回**首次**结果，不产生第二条资源（`replayed: true`）。
 *   - **同一个键** + **不同请求体** → 409。这是刻意的：键被复用于不同意图时，
 *     静默返回旧资源会让调用方以为新动作成功了 —— 比报错危险得多。
 *   - 键的作用域是 `(organizationId, scope, key)`，跨租户/跨业务动作互不干扰。
 *
 * 并发安全：
 *   两个请求同时带同一把键进来时，都查不到旧记录 → 都执行 create → 第二条
 *   `insert` 撞唯一约束失败。此时**重读并返回胜者的结果**，而不是把 500 抛给调用方
 *   （网络重试场景下这是常态，不是异常）。若重读也拿不到（极端情况），则原样抛错
 *   —— 不吞异常、不伪造成功。
 */

import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { ConflictError, ValidationError } from '@/lib/errors'

/** 键的最大长度（防止把超长串写库；`Idempotency-Key` 是 header，通常很短）。 */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200

/** 稳定序列化：递归按键名排序，使 `{a:1,b:2}` 与 `{b:2,a:1}` 得到同一指纹。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/** 请求体指纹。用于区分「同一把键的不同意图」。 */
export function hashRequest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

/**
 * 校验并规范化幂等键。缺失 → 400（契约要求必需，不因"没传"就退化为非幂等）。
 */
export function requireIdempotencyKey(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ValidationError('Idempotency-Key header is required', {
      field: 'Idempotency-Key',
    })
  }
  const key = raw.trim()
  if (!key) {
    throw new ValidationError('Idempotency-Key header must not be empty', {
      field: 'Idempotency-Key',
    })
  }
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ValidationError(
      `Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      { field: 'Idempotency-Key' }
    )
  }
  return key
}

export interface WithIdempotencyOptions<T> {
  organizationId: string
  /** 业务动作标识，如 `mission.create`。 */
  scope: string
  /** 已规范化的键（调用方先过 `requireIdempotencyKey`）。 */
  key: string
  /** 请求体指纹（调用方先过 `hashRequest`）。 */
  requestHash: string
  resourceType: string
  /** 重放时按 resourceId 取回首次结果；返回 null 表示资源已不存在。 */
  load: (resourceId: string) => Promise<T | null>
  /** 首次执行：创建资源并**同时**返回其 id 与结果。 */
  create: () => Promise<{ resourceId: string; resource: T }>
  /**
   * 补偿：当资源已创建、但幂等记录写入失败且无法判定为并发重放时调用，
   * 用于**回收孤儿资源**。不提供则该场景只能抛错（并留下一条孤儿记录）。
   */
  compensate?: (resourceId: string) => Promise<void>
}

export interface IdempotencyOutcome<T> {
  resource: T
  /** true = 命中历史记录（本次未产生新资源）。 */
  replayed: boolean
}

export async function withIdempotency<T>(
  opts: WithIdempotencyOptions<T>
): Promise<IdempotencyOutcome<T>> {
  const where = {
    organizationId_scope_key: {
      organizationId: opts.organizationId,
      scope: opts.scope,
      key: opts.key,
    },
  }

  const existing = await db.idempotencyRecord.findUnique({ where })
  if (existing) {
    if (existing.requestHash !== opts.requestHash) {
      throw new ConflictError(
        'Idempotency-Key was already used with a different request body'
      )
    }
    const resource = await opts.load(existing.resourceId ?? '')
    if (resource === null) {
      // 记录在、资源没了（被删除）。不能假装成功，也不能造一个新资源
      // —— 那会违背"重试不产生重复资源"的初衷。
      throw new ConflictError('Idempotent replay target no longer exists')
    }
    return { resource, replayed: true }
  }

  const { resourceId, resource } = await opts.create()

  try {
    await db.idempotencyRecord.create({
      data: {
        organizationId: opts.organizationId,
        scope: opts.scope,
        key: opts.key,
        requestHash: opts.requestHash,
        resourceType: opts.resourceType,
        resourceId,
      },
    })
  } catch (err) {
    // 走到这里意味着：**我们已经创建了一个资源**，但幂等记录没写成
    // （唯一键冲突 = 并发重放；其他错误 = 真实故障）。
    // 无论后续如何判定，我们创建的那个资源都是「并发失败者」→ 必须回收，
    // 否则每次并发重试都会留下一条重复资源（静默的数据污染）。
    const winner = await db.idempotencyRecord.findUnique({ where }).catch(() => null)

    if (opts.compensate) {
      await opts.compensate(resourceId).catch((e) => {
        // 回收失败绝不能掩盖原始错误（否则排障会被引向错误方向）。
        console.error('[idempotency] compensate failed:', {
          scope: opts.scope,
          resourceId,
          message: e instanceof Error ? e.message : String(e),
        })
      })
    }

    if (winner) {
      if (winner.requestHash !== opts.requestHash) {
        throw new ConflictError(
          'Idempotency-Key was already used with a different request body'
        )
      }
      const loaded = await opts.load(winner.resourceId ?? '')
      if (loaded === null) {
        throw new ConflictError('Idempotent replay target no longer exists')
      }
      return { resource: loaded, replayed: true }
    }

    throw err
  }

  return { resource, replayed: false }
}

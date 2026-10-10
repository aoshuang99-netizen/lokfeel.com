/**
 * T01 · 租户审计写入
 *
 * 与既有 `AuditLog`（core.prisma 哈希链审计）并存，分工见 tenancy.prisma 注释：
 *   - `AuditLog`          → 产品行为的不可抵赖链（保留 prevHash/entryHash），本次不动。
 *   - `TenantAuditEvent`  → 闭环的**安全事件流**（租户 / 成员 / 授权 / 越权尝试）。
 *
 * 两条硬规则：
 *   1. **写入失败不得改变业务结果**。调用方一律以 `.catch(() => {})` 包裹，
 *      审计是旁路，不是闸门（否则审计库故障会变成全站故障）。
 *   2. **元数据必须脱敏**。`redactMetadata()` 会拦截敏感键；这是纵深防御的第二道，
 *      第一道是调用方不得把 PII 传进来。
 */

import { db } from '@/lib/db'

export interface TenantAuditInput {
  organizationId: string
  /** 触发者。系统触发（迁移/定时任务）时为 null。 */
  actorId?: string | null
  /** 事件类型，规范 `<domain>.<action>`，如 `membership.role_changed`。 */
  eventType: string
  /** 资源类型，如 `membership` / `mission` / `proposal`。 */
  resourceType: string
  resourceId?: string | null
  /** 附加上下文。**禁止**放密码、令牌、完整邮箱等 PII。 */
  safeMetadata?: Record<string, unknown>
}

/** 命中即整值替换为 `[redacted]` 的键名（大小写不敏感、子串匹配）。 */
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token',
  'credential',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'email',
  'phone',
  'ssn',
  'idcard',
  'id_card',
  'creditcard',
  'credit_card',
  'cvv',
]

const REDACTED = '[redacted]'

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[-_]/g, '')
  return SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p.replace(/[-_]/g, '')))
}

/**
 * 递归脱敏：命中敏感键名的值整体替换；其余值原样保留。
 * 深度上限 4 层，避免畸形/自引用结构导致栈溢出。
 */
export function redactMetadata(
  value: unknown,
  depth = 0
): unknown {
  if (depth > 4) return '[truncated]'
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactMetadata(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redactMetadata(v, depth + 1)
    }
    return out
  }
  return value
}

/**
 * 写入一条租户审计事件。
 *
 * 调用约定：**必须**以 `.catch()` 包裹（或依赖本函数自身的容错），
 * 审计失败只记录到 stdout，绝不向调用方抛错。
 */
export async function writeTenantAudit(input: TenantAuditInput): Promise<void> {
  try {
    if (!input.organizationId) return

    const metadata =
      input.safeMetadata === undefined
        ? null
        : JSON.stringify(redactMetadata(input.safeMetadata))

    await db.tenantAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorId ?? null,
        eventType: input.eventType,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        safeMetadata: metadata,
      },
    })
  } catch (err) {
    // 审计是旁路：失败不改变业务结果，但必须可在日志中被发现。
    console.error('[tenancy.audit] write failed:', {
      eventType: input.eventType,
      resourceType: input.resourceType,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

/** 读取某租户的最新审计事件（已按 organizationId 限定，天然租户隔离）。 */
export async function listTenantAudit(
  organizationId: string,
  options: { limit?: number; eventType?: string } = {}
): Promise<
  Array<{
    id: string
    eventType: string
    resourceType: string
    resourceId: string | null
    actorId: string | null
    createdAt: Date
  }>
> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500)
  return db.tenantAuditEvent.findMany({
    where: {
      organizationId,
      ...(options.eventType ? { eventType: options.eventType } : {}),
    },
    select: {
      id: true,
      eventType: true,
      resourceType: true,
      resourceId: true,
      actorId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

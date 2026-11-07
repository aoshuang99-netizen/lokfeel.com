/**
 * 登录结果审计 —— 谁、从哪、成没成。
 *
 * 为什么现在才补：2026-11-07 处理公开仓库里的明文管理员口令时，要回答
 * 「这个账号近期有没有被人异常登录过」，结果发现 `AuditLog` / `AdminAudit`
 * **两张表都是 0 行** —— 系统从来没记录过登录事件。于是最需要取证的那一刻，
 * 取证能力恰好不存在。这不是"监控没做全"，是"出事时无法判断影响面"。
 *
 * 三条硬约束：
 *   1. **绝不阻塞登录**。审计写失败只记 console，不能把用户挡在门外。
 *   2. **绝不记录密码**（连长度也不记）。`details` 里只有结论码。
 *   3. **不记录不存在的邮箱**。没有 user 记录就没有 userId，而 `AuditLog.userId`
 *      是外键 —— 硬塞会写出孤儿行或直接抛错。未知邮箱的尝试只留在服务器日志里，
 *      不落业务表（避免把任意输入变成可写入的持久化面）。
 */

import crypto from 'crypto'
import { db } from '@/lib/db'

export type LoginOutcome = 'succeeded' | 'failed'

/** 失败原因码。刻意收敛成枚举，方便统计与告警，避免自由文本。 */
export type LoginFailureReason =
  | 'unknown_email' // 查不到用户（不落库）
  | 'oauth_only' // 账号只有社交登录，没有密码
  | 'bad_password' // 密码不对
  | 'csrf_rejected' // 跨站请求被拒
  | 'missing_credentials'
  | 'server_misconfigured'

export interface LoginAuditInput {
  userId: string | null
  outcome: LoginOutcome
  reason?: LoginFailureReason
  ip?: string | null
  userAgent?: string | null
}

export interface LoginAuditRecord {
  action: 'login_succeeded' | 'login_failed'
  details: string
  ipAddress: string | null
  userAgent: string | null
  entryHash: string
  prevHash: string
  userId: string
}

/**
 * 纯函数：把一次登录尝试变成待写入的审计行。
 *
 * 抽成纯函数是为了能**穷举断言**"落库内容里不含密码"这件事 ——
 * 如果写在路由里，唯一的验证方式就是真的登录一次再看库，太慢也太脆。
 */
export function buildLoginAuditRecord(input: LoginAuditInput, prevHash: string): LoginAuditRecord | null {
  // 没有 userId 就没有审计主体（AuditLog.userId 是外键）。未知邮箱不落库。
  if (!input.userId) return null

  const action = input.outcome === 'succeeded' ? 'login_succeeded' : 'login_failed'
  // 只放结论码，不放任何凭据、不放邮箱（userId 已能定位）。
  const payload = {
    outcome: input.outcome,
    ...(input.outcome === 'failed' ? { reason: input.reason ?? 'bad_password' } : {}),
  }
  const details = JSON.stringify(payload)

  const entryHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ userId: input.userId, action, details, prevHash }))
    .digest('hex')

  return {
    action,
    details,
    ipAddress: input.ip ?? null,
    // UA 可能很长且由客户端完全控制：截断，避免被塞入超长串撑爆列/日志。
    userAgent: input.userAgent ? input.userAgent.slice(0, 200) : null,
    entryHash,
    prevHash,
    userId: input.userId,
  }
}

/** 从请求头取客户端 IP。只信 `x-forwarded-for` 的**第一跳**（Cloudflare/Netlify 都写这里）。 */
export function clientIpFrom(headers: { get(name: string): string | null }): string | null {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip') || headers.get('cf-connecting-ip') || null
}

/**
 * 写入审计。**永远不抛** —— 登录成功与否不该取决于审计表是否可写。
 * 返回写入的 action 名（便于测试断言真的走了哪条分支）。
 */
export async function recordLoginOutcome(
  input: LoginAuditInput,
  lookupPrevHash: (userId: string) => Promise<string | null> = async (userId) => {
    const last = await db.auditLog.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { entryHash: true },
    })
    return last?.entryHash ?? null
  },
  create: (row: LoginAuditRecord) => Promise<unknown> = (row) => db.auditLog.create({ data: row }),
): Promise<string | null> {
  try {
    if (!input.userId) return null
    const prev = (await lookupPrevHash(input.userId)) ?? 'genesis'
    const row = buildLoginAuditRecord(input, prev)
    if (!row) return null
    await create(row)
    return row.action
  } catch (err) {
    console.error('[login-audit] 写入失败（已忽略，不影响登录）：', (err as Error)?.message ?? err)
    return null
  }
}

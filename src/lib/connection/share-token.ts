/**
 * T02 · 分享令牌（Mission Link 的能力凭证）
 *
 * 分享页 URL 形如 `/m/<shareToken>`。令牌**即能力**——持有即能看到该 Mission 的
 * 公开投影。因此：
 *   1. 必须**高熵**：不可被枚举/爆破。24 字节（192 bit）随机 → base64url 32 字符，
 *      即使攻击者每秒尝试 10^6 次，搜索空间也远超任何现实攻击窗口。
 *   2. 必须**不可预测**：用 CSPRNG（`node:crypto`），不得用自增/时间戳/`cuid()` 之类的
 *      弱可猜标识。
 *   3. 必须 **URL-safe**：不得含需要转义的字符（避免链接被 IM/邮件客户端截断）。
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'

/** 令牌熵（字节）。24B → 32 个 base64url 字符。 */
export const SHARE_TOKEN_BYTES = 24

/** 形状：base64url 字母表，长度 22..128（下界防历史短令牌，上界防超长 Header）。 */
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{22,128}$/

/** 生成一个新的分享令牌。**唯一性由 DB 的唯一约束兜底**（碰撞概率可忽略）。 */
export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString('base64url')
}

/** 形状校验。用于在打 DB 之前快速丢弃明显非法/恶意的 token（避免无谓查询）。 */
export function isShareTokenShaped(value: unknown): value is string {
  return typeof value === 'string' && SHARE_TOKEN_RE.test(value)
}

/**
 * 常量时间比较。用于「令牌是否匹配」这类判断，避免通过响应时间旁路推断。
 *
 * 注：本仓的分享页**不经过**这种比较 —— 它直接用唯一索引查库（由 DB 承担比较）。
 * 该函数保留给需要「在应用层比较令牌」的调用方（例如未来的一次性确认码）。
 */
export function shareTokenEquals(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

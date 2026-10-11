/**
 * T05 · 路由参数提取（`_shared` 前缀 → Next 不把它当路由段）。
 *
 * 契约里的路径参数名是 `connectionId`（历史命名：连接 = 提案 id）。
 * 与 `proposals.ts` 的领域命名（proposal）不同名是**有意保留**的：
 * 对外契约一旦发布，改名就是破坏性变更。转换只在这一层发生。
 */

import { NotFoundError } from '@/lib/errors'

/** 提取 `[connectionId]`。缺失/非法 → 404（而非 400：路径段缺失属于"这个资源不存在"）。 */
export function proposalIdOf(params: unknown): string {
  const id = (params as { connectionId?: string } | undefined)?.connectionId
  if (!id || typeof id !== 'string') throw new NotFoundError('Proposal not found')
  return id
}

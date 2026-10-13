/**
 * T09 · 路由参数提取（`_shared` 前缀 → Next 不把它当路由段）。
 *
 * ⚠️ 相对路径判据见 `outcomes/_shared/params.ts` 的注释：**看文件所在目录到
 * `_shared` 的相对距离**，不是路径段个数。本目录下两条路径：
 *   - `agents/runs/route.ts`               → `../_shared/params`
 *   - `agents/runs/[runId]/approve/route.ts` → `../../../_shared/params`
 */

import { NotFoundError } from '@/lib/errors'

/** 提取 `[runId]`。缺失/非法 → 404（路径段缺失属于"这个资源不存在"）。 */
export function runIdOf(params: unknown): string {
  const id = (params as { runId?: string } | undefined)?.runId
  if (!id || typeof id !== 'string') throw new NotFoundError('Agent run not found')
  return id
}

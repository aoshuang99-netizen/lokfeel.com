/**
 * T06 · 路由参数提取（`_shared` 前缀 → Next 不把它当路由段）。
 *
 * 与 `src/app/api/v1/connections/_shared/params.ts` 同一手法：
 * 参数缺失/非法一律 **404**（路径段缺了 = "这个资源不存在"），
 * 而不是 400 —— 后者会暗示"请求格式有问题"，把排障引向错误方向。
 */

import { NotFoundError } from '@/lib/errors'

/** 提取 `[jobId]`。 */
export function jobIdOf(params: unknown): string {
  const id = (params as { jobId?: string } | undefined)?.jobId
  if (!id || typeof id !== 'string') throw new NotFoundError('Workflow job not found')
  return id
}

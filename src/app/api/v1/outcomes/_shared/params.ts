/**
 * T08 · 路由参数提取（`_shared` 前缀 → Next 不把它当路由段）。
 *
 * ⚠️ 相对路径提醒（T06 的真实踩坑，本轮**又踩了一次**）：
 *   - `outcomes/route.ts`                    → 同级目录 → `./_shared/params`
 *   - `outcomes/[outcomeId]/confirm/route.ts` → 上溯**两级** → `../../_shared/params`
 * 判据是「**文件所在目录**到 `_shared` 的相对距离」，**不是路径段的个数** ——
 * 按"4 段路径就写 3 个 `../`"的直觉写，会得到 `TS2307: Cannot find module`。
 * 这类错误**只有 tsc / E2E 能抓**（API 单测直接 import handler，永远是绿的）。
 */

import { NotFoundError } from '@/lib/errors'

/** 提取 `[outcomeId]`。缺失/非法 → 404（路径段缺失属于"这个资源不存在"）。 */
export function outcomeIdOf(params: unknown): string {
  const id = (params as { outcomeId?: string } | undefined)?.outcomeId
  if (!id || typeof id !== 'string') throw new NotFoundError('Outcome not found')
  return id
}

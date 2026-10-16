/**
 * AC-10 · 删除请求（被遗忘权）
 *
 *   GET   /api/v1/me/erasure          → **只读计划**：会动哪些表、各多少行、留什么
 *   POST  /api/v1/me/erasure?apply=1  → 真执行（匿化 + 状态收窄；**不可逆**）
 *   POST  /api/v1/me/erasure          → 同 GET（返回计划），不写任何东西
 *
 * ## 为什么执行要显式 `?apply=1`
 *
 * 删除**不可逆**（匿化后原邮箱与昵称都回不来）。默认档位必须是"只看不动" ——
 * 一个 `POST` 就顺手把账号消掉，是那种"手滑一次、无法挽回"的设计。
 * `POST` 不带 `apply` 时不报错、返回计划，让调用方**先看到影响面**。
 *
 * 权限：**仅需登录**（`requireAuth`）。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { executeErasure, planErasure } from '@/lib/lifecycle'

export async function GET() {
  try {
    const { user } = await requireAuth()
    return success(await planErasure(user.id))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth()
    const apply = new URL(req.url).searchParams.get('apply') === '1'
    if (!apply) {
      return success(await planErasure(user.id))
    }
    return success(await executeErasure(user.id))
  } catch (error) {
    return errorResponse(error)
  }
}

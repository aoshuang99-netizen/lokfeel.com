/**
 * AC-10 · 数据导出（数据可携带）
 *
 *   GET  /api/v1/me/export   → 导出**当前登录用户**的全部已覆盖数据（JSON）
 *
 * ## 为什么没有 `?userId=`
 *
 * 导出对象只有**一个来源**：服务端会话。任何一个"可以指定导出谁"的参数，
 * 都会把"猜 id 读别人数据"变成一条可尝试的路径 —— 而这条路径本来是 AC-01
 * （多租户隔离）与 AC-02（未授权访问）共同要堵死的东西。
 *
 * 权限：**仅需登录**（`requireAuth`）。导出自己不需要任何租户能力 ——
 * 无组织的普通用户同样有权拿走自己的数据。
 */

import { errorResponse, success } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { exportAccountData } from '@/lib/lifecycle'

export async function GET() {
  try {
    const { user } = await requireAuth()
    return success(await exportAccountData(user.id))
  } catch (error) {
    return errorResponse(error)
  }
}

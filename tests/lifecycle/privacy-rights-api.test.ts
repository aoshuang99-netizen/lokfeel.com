/**
 * V17 · WB17-04（OPS-03 / SEC-07）—— 隐私权利路由的**越权与副作用**判据
 *
 * 这里守的不是"导出/删除功能能不能用"，而是三件一旦错了就不可挽回的事：
 *
 *   1. **越权**：`/api/v1/me/*` 的对象**只能**来自会话。
 *      只要存在任何"可以指定操作谁"的入口，就是一条可尝试的读取/删除别人数据
 *      的路径。所以本文件的核心断言是**负向**的：
 *      请求里塞 `?userId=受害���`，被操作的**仍然**是会话本人。
 *   2. **误删**：删除是不可逆的（匿化后原邮箱/昵称都回不来）。
 *      `GET` 与不带 `apply` 的 `POST` **必须**是零副作用 —— 用
 *      "`updateMany`/`deleteMany` 一次都没被调用"来证，而不是靠读代码相信。
 *   3. **不可断言的黑箱**：执行完必须回吐 `plan / applied / cache`，
 *      否则"清了缓存"与"忘了清"在响应里长得一模一样。
 *
 * ⚠️ 为什么 mock `@/lib/lifecycle`（barrel）而不是走真实现：
 *    那条路径会拉进 `@/lib/db` → `next-auth`（纯 ESM），jest 的 CJS 环境直接
 *    "Test suite failed to run"。**政策与补丁的语义**由
 *    `tests/lifecycle/account.test.ts` 与 `tests/lifecycle/policy.test.ts` 覆盖，
 *    本文件只覆盖**路由契约**（把谁传下去、什么时候允许写）。
 */

jest.mock('@/lib/lifecycle', () => ({
  exportAccountData: jest.fn(),
  planErasure: jest.fn(),
  executeErasure: jest.fn(),
}))

jest.mock('@/lib/auth', () => ({ requireAuth: jest.fn() }))

import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { executeErasure, exportAccountData, planErasure } from '@/lib/lifecycle'
import { UnauthorizedError } from '@/lib/errors'

import * as exportRoute from '@/app/api/v1/me/export/route'
import * as erasureRoute from '@/app/api/v1/me/erasure/route'

const requireAuthMock = requireAuth as unknown as jest.Mock
const exportMock = exportAccountData as unknown as jest.Mock
const planMock = planErasure as unknown as jest.Mock
const execMock = executeErasure as unknown as jest.Mock

const ME = 'u_me'
const VICTIM = 'u_victim'

/** 会话：登录用户是 `ME`。 */
function signedInAs(userId = ME) {
  requireAuthMock.mockResolvedValue({ user: { id: userId } })
}

function req(url: string, method: 'GET' | 'POST' = 'GET') {
  return new NextRequest(new URL(url, 'http://localhost'), { method })
}

async function body(res: Response) {
  return (await res.json()) as { success: boolean; data: unknown }
}

const PLAN_FIXTURE = {
  policyVersion: '2026-10-16',
  userId: ME,
  generatedAt: '2026-10-22T00:00:00.000Z',
  actions: [],
  impact: [{ target: 'User', rows: 1 }],
  summary: { activeTargets: 11, retainedTargets: 3, totalRows: 1 },
}

beforeEach(() => {
  jest.clearAllMocks()
  signedInAs()
  exportMock.mockResolvedValue({ exportVersion: '2026-10-16', user: { id: ME } })
  planMock.mockResolvedValue(PLAN_FIXTURE)
  execMock.mockResolvedValue({
    plan: PLAN_FIXTURE,
    applied: PLAN_FIXTURE.impact,
    cache: { keys: ['auth:user:u_me'], prefixes: ['who-liked-me:'] },
    erasedAt: '2026-10-22T00:00:00.000Z',
  })
})

// ═══════════════════════════════════════════════════════════
// 1. 身份关卡（未登录一律 401，且不产生任何数据操作）
// ═══════════════════════════════════════════════════════════

describe('OPS-03 · 身份关卡：未登录不产生任何数据操作', () => {
  it('导出：匿名 → 401，且不读数据', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Authentication required'))
    const res = await exportRoute.GET()
    expect(res.status).toBe(401)
    expect(exportMock).not.toHaveBeenCalled()
  })

  it('删除：匿名 → 401，且不生成计划、不执行', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Authentication required'))
    const res = await erasureRoute.GET()
    expect(res.status).toBe(401)
    expect(planMock).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════
// 2. 🔴 越权：请求参数不得改变被操作的对象
// ═══════════════════════════════════════════════════════════

describe('SEC-07 · 越权：对象只能来自会话，不能来自请求', () => {
  it('🔴 导出塞 `?userId=别人` → 仍然只导出**会话本人**（这条断言是本文件的重点）', async () => {
    // 结构性证据：handler **一个参数都不接**，因此"读查询串"这件事在类型层面
    // 就不成立（不是"读了但没用"，而是根本没有入口可读）。
    expect(exportRoute.GET.length).toBe(0)

    const res = await exportRoute.GET()
    expect(res.status).toBe(200)
    expect(exportMock).toHaveBeenCalledTimes(1)
    expect(exportMock.mock.calls[0][0]).toBe(ME)
    expect(exportMock).not.toHaveBeenCalledWith(VICTIM)
  })

  it('🔴 删除塞 `?userId=别人&apply=1` → 只删**会话本人**', async () => {
    await erasureRoute.POST(
      req(`/api/v1/me/erasure?userId=${VICTIM}&apply=1`, 'POST')
    )
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(execMock.mock.calls[0][0]).toBe(ME)
    expect(execMock).not.toHaveBeenCalledWith(VICTIM)
  })

  it('删除计划的 userId 也来自会话（计划与执行不得指向不同的人）', async () => {
    await erasureRoute.GET()
    expect(planMock.mock.calls[0][0]).toBe(ME)
  })
})

// ═══════════════════════════════════════════════════════════
// 3. 🔴 误删：只有 `POST ?apply=1` 才允许写
// ═══════════════════════════════════════════════════════════

describe('OPS-03 · 副作用闸门：默认只看不动', () => {
  it('GET 只生成计划，绝不执行', async () => {
    const res = await erasureRoute.GET()
    expect(res.status).toBe(200)
    expect(planMock).toHaveBeenCalledTimes(1)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('🔴 POST **不带** `?apply=1` → 返回计划，不执行（手滑一次不该毁掉账号）', async () => {
    const res = await erasureRoute.POST(req('/api/v1/me/erasure', 'POST'))
    expect(res.status).toBe(200)
    expect(await body(res)).toEqual({ success: true, data: PLAN_FIXTURE })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('`apply=0` / `apply=yes` / `apply` 都**不**算同意（只认字面量 `1`）', async () => {
    for (const q of ['apply=0', 'apply=yes', 'apply', 'apply=true']) {
      jest.clearAllMocks()
      signedInAs()
      planMock.mockResolvedValue(PLAN_FIXTURE)
      await erasureRoute.POST(req(`/api/v1/me/erasure?${q}`, 'POST'))
      expect({ q, executed: execMock.mock.calls.length }).toEqual({ q, executed: 0 })
    }
  })

  it('`POST ?apply=1` → 执行一次，且回吐可断言的 cache 证据', async () => {
    const res = await erasureRoute.POST(req('/api/v1/me/erasure?apply=1', 'POST'))
    expect(res.status).toBe(200)
    expect(execMock).toHaveBeenCalledTimes(1)
    const payload = (await body(res)) as { data: { cache: { prefixes: string[] } } }
    // "清了缓存"必须能被断言，否则与"忘了清"在响应里长得一样。
    expect(payload.data.cache.prefixes.length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════
// 4. 错误映射：不把领域结论退化成 500
// ═══════════════════════════════════════════════════════════

describe('OPS-03 · 错误映射', () => {
  it('账号不存在（NotFoundError）→ 404，不是 500', async () => {
    const { NotFoundError } = await import('@/lib/errors')
    planMock.mockRejectedValue(new NotFoundError('User not found'))
    const res = await erasureRoute.GET()
    expect(res.status).toBe(404)
  })
})

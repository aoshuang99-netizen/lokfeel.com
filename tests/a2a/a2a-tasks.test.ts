/**
 * T11 · A2A 适配层（`/api/v1/a2a/tasks`）单测
 *
 * 与 `tests/mcp/mcp-route.test.ts` 同源：两者共用 `@/lib/interop/tools` 的工具目录，
 * 因此**授权语义必须一致** —— 本文件刻意复用同一批夹具角色，便于将来对照。
 *
 * 钉住的三件事：
 *  ① **形状**：成功返回 `task.status.state='completed'` + `artifacts[].parts[]`；
 *     被业务拒绝返回 `state='failed'` 且 HTTP **仍 200**（任务被受理 ≠ 传输失败）。
 *  ② **授权**：无会话 401 / 能力不足 → failed（不是 500，也不是静默成功）。
 *  ③ **无状态**：`task.id` 每次都不同（不落库 ⇒ 不产生第二套运行记录）。
 */
jest.mock('@/lib/tenancy', () => ({ resolveTenant: jest.fn() }))
jest.mock('@/lib/connection', () => ({ listMissions: jest.fn() }))
jest.mock('@/lib/bridges', () => ({ listBridges: jest.fn(), listBridgeDiscoveries: jest.fn() }))
jest.mock('@/lib/outcome', () => ({ listOutcomes: jest.fn(), reportOutcome: jest.fn() }))

import { NextRequest } from 'next/server'
import { resolveTenant, type TenantContext } from '@/lib/tenancy'
import { listMissions } from '@/lib/connection'
import { listBridges } from '@/lib/bridges'
import { reportOutcome } from '@/lib/outcome'
import { ForbiddenError, UnauthorizedError, ValidationError } from '@/lib/errors'
import type { TenantRole } from '@/lib/tenancy/capabilities'
import { POST } from '@/app/api/v1/a2a/tasks/route'

const mockedResolve = resolveTenant as jest.Mock
const mockedListMissions = listMissions as jest.Mock
const mockedListBridges = listBridges as jest.Mock
const mockedReportOutcome = reportOutcome as jest.Mock

function ctxOf(role: TenantRole, organizationId = 'org-1'): TenantContext {
  return { organizationId, userId: 'user-1', role } as unknown as TenantContext
}

async function call(body: unknown) {
  const req = new NextRequest('http://localhost:3000/api/v1/a2a/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const res = await POST(req)
  const text = await res.text()
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : null }
}

function taskOf(json: Record<string, unknown> | null) {
  return json?.task as
    | { id: string; skillId: string; status: { state: string; message?: string }; artifacts: unknown[] }
    | undefined
}

beforeEach(() => {
  jest.clearAllMocks()
  mockedResolve.mockResolvedValue(ctxOf('OPERATOR'))
  mockedListMissions.mockResolvedValue({ items: [{ id: 'm-1' }], total: 1, page: 1, pageSize: 20 })
  mockedListBridges.mockResolvedValue({ items: [] })
  mockedReportOutcome.mockResolvedValue({ id: 'o-1' })
})

describe('A2A · 请求形状', () => {
  it('非法 JSON → 400 INVALID_ARGUMENT', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/a2a/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: { code: string } }
    expect(json.error.code).toBe('INVALID_ARGUMENT')
  })

  it('缺 skillId → 400 且**列出**可用技能', async () => {
    const { status, json } = await call({ input: {} })
    expect(status).toBe(400)
    expect((json?.error as { message: string }).message).toContain('list_missions')
  })

  it('未知 skillId → 404 SKILL_NOT_FOUND', async () => {
    const { status, json } = await call({ skillId: 'nope', input: {} })
    expect(status).toBe(404)
    expect((json?.error as { code: string }).code).toBe('SKILL_NOT_FOUND')
  })
})

describe('A2A · 授权', () => {
  it('🔴 无会话 → HTTP 401', async () => {
    mockedResolve.mockRejectedValue(new UnauthorizedError('no session'))
    const { status } = await call({ skillId: 'list_missions', input: {} })
    expect(status).toBe(401)
  })

  it('无成员关系 → HTTP 403', async () => {
    mockedResolve.mockRejectedValue(new ForbiddenError('not a member'))
    const { status } = await call({ skillId: 'list_missions', input: {} })
    expect(status).toBe(403)
  })

  it('🔴 能力不足 → HTTP 200 但 state=failed，且**不调**服务层', async () => {
    mockedResolve.mockResolvedValue(ctxOf('MEMBER'))
    const { status, json } = await call({ skillId: 'list_missions', input: {} })
    expect(status).toBe(200)
    const task = taskOf(json)
    expect(task?.status.state).toBe('failed')
    expect(task?.status.message).toContain('mission.read')
    expect(task?.artifacts).toEqual([])
    expect(mockedListMissions).not.toHaveBeenCalled()
  })
})

describe('A2A · 执行', () => {
  it('有权限 → state=completed + artifacts[].parts[].data 带结果', async () => {
    const { status, json } = await call({ skillId: 'list_missions', input: { pageSize: 5 } })
    expect(status).toBe(200)
    const task = taskOf(json)
    expect(task?.status.state).toBe('completed')
    const parts = (task?.artifacts[0] as { parts: { type: string; data: unknown }[] }).parts
    expect(parts[0].type).toBe('data')
    expect(parts[0].data).toEqual({ items: [{ id: 'm-1' }], total: 1, page: 1, pageSize: 20 })
    expect(mockedListMissions.mock.calls[0][1]).toEqual({ status: undefined, pageSize: 5 })
  })

  it('MEMBER 可执行 report_outcome（自助能力）', async () => {
    mockedResolve.mockResolvedValue(ctxOf('MEMBER'))
    const { json } = await call({
      skillId: 'report_outcome',
      input: { proposalId: 'p-1', summary: '已面谈' },
    })
    expect(taskOf(json)?.status.state).toBe('completed')
    expect(mockedReportOutcome).toHaveBeenCalledTimes(1)
  })

  it('服务层 ApiError → state=failed 且回显状态码', async () => {
    mockedListBridges.mockRejectedValue(new ValidationError('limit 不合法'))
    const { status, json } = await call({ skillId: 'list_bridges', input: {} })
    expect(status).toBe(200)
    expect(taskOf(json)?.status.state).toBe('failed')
    expect(taskOf(json)?.status.message).toContain('400')
  })

  it('服务层非 ApiError → failed 且**不泄漏**内部细节', async () => {
    mockedListBridges.mockRejectedValue(new Error('SQLITE_ERROR near "secret_col"'))
    const { json } = await call({ skillId: 'list_bridges', input: {} })
    expect(taskOf(json)?.status.message).not.toContain('secret_col')
    expect(taskOf(json)?.status.message).not.toContain('SQLITE')
  })

  it('🔴 无状态：两次相同请求得到**不同**的 task.id（不落库 ⇒ 不产生第二套运行记录）', async () => {
    const a = await call({ skillId: 'list_bridges', input: {} })
    const b = await call({ skillId: 'list_bridges', input: {} })
    expect(taskOf(a.json)?.id).not.toBe(taskOf(b.json)?.id)
    expect(taskOf(a.json)?.id).toMatch(/^a2a-[0-9a-f-]{36}$/)
  })

  it('organizationId 透传给 resolveTenant', async () => {
    await call({ skillId: 'list_bridges', input: { organizationId: 'org-7' } })
    expect(mockedResolve).toHaveBeenCalledWith({ organizationId: 'org-7' })
  })
})

/**
 * 限流（2026-10-17 补）。用独立 IP，避免把同文件其它用例的桶打满。
 * 桶名 `a2a:task` 与 MCP 的 `mcp:rpc` 分开 —— 一边被刷不该连坐另一边。
 */
describe('限流：120 次/分钟/IP', () => {
  const IP = '198.51.100.202'

  function limitedTask(body: string) {
    return POST(
      new NextRequest('http://localhost:3000/api/v1/a2a/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': IP },
        body,
      }),
    )
  }

  it('第 121 次被拒：429 + 本层错误信封 + Retry-After', async () => {
    const payload = JSON.stringify({ skillId: 'list_bridges', input: {} })
    let res = await limitedTask(payload)
    for (let i = 1; i < 120; i++) res = await limitedTask(payload)
    expect(res.status).toBe(200)

    const blocked = await limitedTask(payload)
    expect(blocked.status).toBe(429)
    const body = JSON.parse(await blocked.text()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('RESOURCE_EXHAUSTED')
    expect(body.task).toBeUndefined()
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
  })

  it('429 发生在解析请求体之前（垃圾请求体同样被限流，不会先 400）', async () => {
    const res = await limitedTask('not-json')
    expect(res.status).toBe(429)
  })
})


/**
 * 登录审计 · 单元测试
 *
 * 这份测试的**主要目的不是覆盖率**，而是把三条硬约束钉死：
 *   1. 审计内容里**不能出现密码**（连长度都不行）；
 *   2. 审计写失败**不能影响登录结果**；
 *   3. 没有 userId 的尝试**不能落库**（`AuditLog.userId` 是外键）。
 *
 * 每条都配了负控 —— 断言"记录了什么"很容易写成一个恒真式，
 * 必须同时有人证明"不该记录的确实没记录"。
 */

jest.mock('@/lib/db', () => ({
  db: {
    auditLog: { create: jest.fn(), findFirst: jest.fn() },
  },
}))

import { db } from '@/lib/db'
import {
  buildLoginAuditRecord,
  clientIpFrom,
  recordLoginOutcome,
  type LoginAuditRecord,
} from '@/lib/auth/login-audit'

const create = db.auditLog.create as unknown as jest.Mock
const findFirst = db.auditLog.findFirst as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  create.mockResolvedValue({ id: 'audit-1' })
})

describe('buildLoginAuditRecord · 纯函数', () => {
  it('成功 → login_succeeded，details 含 outcome', () => {
    const row = buildLoginAuditRecord({ userId: 'u1', outcome: 'succeeded' }, 'genesis')!
    expect(row.action).toBe('login_succeeded')
    expect(JSON.parse(row.details)).toEqual({ outcome: 'succeeded' })
  })

  it('失败 → login_failed，details 含 reason', () => {
    const row = buildLoginAuditRecord(
      { userId: 'u1', outcome: 'failed', reason: 'bad_password' },
      'genesis',
    )!
    expect(row.action).toBe('login_failed')
    expect(JSON.parse(row.details)).toEqual({ outcome: 'failed', reason: 'bad_password' })
  })

  it('成功路径不写 reason（不能给成功记录安一个失败原因）', () => {
    const row = buildLoginAuditRecord(
      { userId: 'u1', outcome: 'succeeded', reason: 'bad_password' },
      'genesis',
    )!
    expect(JSON.parse(row.details)).not.toHaveProperty('reason')
  })

  it('无 userId → 不生成记录（外键约束不容许孤儿行）', () => {
    expect(buildLoginAuditRecord({ userId: null, outcome: 'failed', reason: 'unknown_email' }, 'genesis')).toBeNull()
  })

  it('prevHash 原样进入记录，且参与哈希（改链条会改哈希）', () => {
    const a = buildLoginAuditRecord({ userId: 'u1', outcome: 'succeeded' }, 'genesis')!
    const b = buildLoginAuditRecord({ userId: 'u1', outcome: 'succeeded' }, 'prev-abc')!
    expect(a.prevHash).toBe('genesis')
    expect(b.prevHash).toBe('prev-abc')
    expect(a.entryHash).not.toBe(b.entryHash)
  })

  it('超长 UA 被截断到 200（UA 完全由客户端控制）', () => {
    const row = buildLoginAuditRecord(
      { userId: 'u1', outcome: 'succeeded', userAgent: 'x'.repeat(5000) },
      'genesis',
    )!
    expect(row.userAgent!.length).toBe(200)
  })

  it('记录里没有承载凭据的字段（details 只有 outcome / reason）', () => {
    const row = buildLoginAuditRecord({ userId: 'u1', outcome: 'failed', reason: 'bad_password' }, 'genesis')!
    // 第一版这里写的是 `not.toMatch(/password/i)`，结果被 reason 码 `bad_password`
    // 自己命中 —— 断言写得太粗会误判成"泄漏"。真正要保证的是**字段集合**：
    // details 只允许 outcome / reason，行本身不允许出现任何凭据字段。
    expect(Object.keys(JSON.parse(row.details)).sort()).toEqual(['outcome', 'reason'])
    expect(Object.keys(row).filter((k) => /passw|secret|credential|token/i.test(k))).toEqual([])
  })

  it('即使调用方把密码混进 input，也不会出现在记录里', () => {
    // 负控：故意多塞一个字段（模拟调用方手滑把整个 body 传进来）。
    const row = buildLoginAuditRecord(
      { userId: 'u1', outcome: 'failed', reason: 'bad_password', password: 'hunter2' } as never,
      'genesis',
    )!
    expect(JSON.stringify(row)).not.toContain('hunter2')
  })
})

describe('recordLoginOutcome · 副作用', () => {
  it('成功写入时返回 action 名，并复用上一条的 entryHash', async () => {
    findFirst.mockResolvedValue({ entryHash: 'prev-hash' })
    const action = await recordLoginOutcome({ userId: 'u1', outcome: 'succeeded' })
    expect(action).toBe('login_succeeded')
    const arg = create.mock.calls[0][0].data as LoginAuditRecord
    expect(arg.prevHash).toBe('prev-hash')
    expect(arg.userId).toBe('u1')
  })

  it('首条记录用 genesis 作为链条起点', async () => {
    findFirst.mockResolvedValue(null)
    await recordLoginOutcome({ userId: 'u1', outcome: 'failed', reason: 'bad_password' })
    expect((create.mock.calls[0][0].data as LoginAuditRecord).prevHash).toBe('genesis')
  })

  it('userId 为 null 时不查库也不写库', async () => {
    await recordLoginOutcome({ userId: null, outcome: 'failed', reason: 'unknown_email' })
    expect(findFirst).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('写库抛错时**不抛出**（审计失败不能把用户挡在登录门外）', async () => {
    findFirst.mockResolvedValue(null)
    create.mockRejectedValue(new Error('db down'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordLoginOutcome({ userId: 'u1', outcome: 'succeeded' })).resolves.toBeNull()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('查 prevHash 抛错时也不抛出', async () => {
    findFirst.mockRejectedValue(new Error('timeout'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordLoginOutcome({ userId: 'u1', outcome: 'succeeded' })).resolves.toBeNull()
    spy.mockRestore()
  })
})

describe('clientIpFrom', () => {
  const h = (map: Record<string, string>) => ({ get: (n: string) => map[n] ?? null })

  it('取 x-forwarded-for 的第一跳（代理链里最左才是客户端）', () => {
    expect(clientIpFrom(h({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 10.0.0.2' }))).toBe('1.2.3.4')
  })

  it('没有 xff 时回退 cf-connecting-ip', () => {
    expect(clientIpFrom(h({ 'cf-connecting-ip': '5.6.7.8' }))).toBe('5.6.7.8')
  })

  it('都没有 → null（不要伪造一个 0.0.0.0 掩盖缺失）', () => {
    expect(clientIpFrom(h({}))).toBeNull()
  })
})

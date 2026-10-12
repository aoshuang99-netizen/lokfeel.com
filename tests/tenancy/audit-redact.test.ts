/**
 * T01 · 审计脱敏与租户作用域
 *
 * 两条硬规则的测试：元数据必须脱敏；审计失败不得改变业务结果。
 */

/* eslint-disable @typescript-eslint/no-explicit-any --
   本文件刻意用 `any` 构造"畸形/越界"的元数据来验证脱敏逻辑，
   `unknown` 表达不了这种"故意喂错类型"的测试意图。与 tests/workflow/*.test.ts 同款约定。 */

jest.mock('@/lib/db', () => ({
  db: {
    tenantAuditEvent: { create: jest.fn(), findMany: jest.fn() },
  },
}))

import { db } from '@/lib/db'
import { redactMetadata, writeTenantAudit, listTenantAudit } from '@/lib/tenancy/audit'

const auditCreate = db.tenantAuditEvent.create as unknown as jest.Mock
const auditFindMany = db.tenantAuditEvent.findMany as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('T01 · 审计脱敏 redactMetadata', () => {
  it('拦截敏感键（整值替换，不保留片段）', () => {
    const out = redactMetadata({
      password: 'hunter2',
      token: 'abc.def.ghi',
      email: 'victim@example.com',
      authorization: 'Bearer xyz',
      nested: { apiKey: 'sk_live_123', safe: 'ok' },
    }) as Record<string, any>

    expect(out.password).toBe('[redacted]')
    expect(out.token).toBe('[redacted]')
    expect(out.email).toBe('[redacted]')
    expect(out.authorization).toBe('[redacted]')
    expect(out.nested.apiKey).toBe('[redacted]')
    expect(out.nested.safe).toBe('ok')
  })

  it('键名匹配不区分大小写与分隔符（api_key / apiKey / API-KEY 均命中）', () => {
    const out = redactMetadata({ api_key: 'a', apiKey: 'b', 'API-KEY': 'c' }) as Record<string, any>
    expect(out.api_key).toBe('[redacted]')
    expect(out.apiKey).toBe('[redacted]')
    expect(out['API-KEY']).toBe('[redacted]')
  })

  it('保留非敏感字段（审计需要「发生了什么」）', () => {
    const out = redactMetadata({
      role: 'OPERATOR',
      required: ['org.delete'],
      reason: 'not_a_member_or_tenant_inactive',
    }) as Record<string, any>

    expect(out.role).toBe('OPERATOR')
    expect(out.required).toEqual(['org.delete'])
    expect(out.reason).toBe('not_a_member_or_tenant_inactive')
  })

  it('数组逐项脱敏，且长度上限 50（防止巨额负载入库）', () => {
    const arr = Array.from({ length: 120 }, (_, i) => ({ token: `t${i}`, idx: i }))
    const out = redactMetadata(arr) as Array<any>

    expect(out).toHaveLength(50)
    expect(out[0].token).toBe('[redacted]')
    expect(out[0].idx).toBe(0)
  })

  it('深度上限 4 层，避免畸形结构导致栈溢出', () => {
    const deep = { a: { b: { c: { d: { e: 'x' } } } } }
    const out = JSON.stringify(redactMetadata(deep))
    expect(out).toContain('[truncated]')
  })

  it('null / undefined / 原始值原样返回', () => {
    expect(redactMetadata(null)).toBeNull()
    expect(redactMetadata(undefined)).toBeUndefined()
    expect(redactMetadata('s')).toBe('s')
    expect(redactMetadata(42)).toBe(42)
  })
})

describe('T01 · writeTenantAudit', () => {
  it('写入时元数据已脱敏（纵深防御第二道）', async () => {
    auditCreate.mockResolvedValue({})

    await writeTenantAudit({
      organizationId: 'org_1',
      actorId: 'u_1',
      eventType: 'membership.role_changed',
      resourceType: 'membership',
      resourceId: 'ms_1',
      safeMetadata: { newRole: 'ADMIN', email: 'x@y.com' },
    })

    const data = auditCreate.mock.calls[0][0].data
    const parsed = JSON.parse(data.safeMetadata)
    expect(parsed.newRole).toBe('ADMIN')
    expect(parsed.email).toBe('[redacted]')
  })

  it('不传 safeMetadata 时存 null（不是 "undefined" 字符串）', async () => {
    auditCreate.mockResolvedValue({})
    await writeTenantAudit({
      organizationId: 'org_1',
      eventType: 'x.y',
      resourceType: 'z',
    })
    expect(auditCreate.mock.calls[0][0].data.safeMetadata).toBeNull()
  })

  it('缺 organizationId 时直接跳过（不产生孤儿审计）', async () => {
    await writeTenantAudit({ organizationId: '', eventType: 'x.y', resourceType: 'z' })
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it('🔒 审计写入失败必须被吞掉 —— 否则审计库故障会变成全站故障', async () => {
    auditCreate.mockRejectedValue(new Error('audit db down'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      writeTenantAudit({ organizationId: 'org_1', eventType: 'x.y', resourceType: 'z' })
    ).resolves.toBeUndefined()

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('T01 · listTenantAudit', () => {
  it('查询必须带 organizationId 谓词（租户隔离）', async () => {
    auditFindMany.mockResolvedValue([])
    await listTenantAudit('org_1')

    const where = auditFindMany.mock.calls[0][0].where
    expect(where.organizationId).toBe('org_1')
  })

  it('limit 被钳制在 1..500', async () => {
    auditFindMany.mockResolvedValue([])

    await listTenantAudit('org_1', { limit: 99999 })
    expect(auditFindMany.mock.calls[0][0].take).toBe(500)

    await listTenantAudit('org_1', { limit: -5 })
    expect(auditFindMany.mock.calls[1][0].take).toBe(1)

    await listTenantAudit('org_1')
    expect(auditFindMany.mock.calls[2][0].take).toBe(50)
  })
})

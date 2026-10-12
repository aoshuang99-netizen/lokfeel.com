/**
 * T07 · 组织（社群）档案服务 —— 单测
 *
 * 覆盖三类风险：
 *   1. **写权限**：`org.update` 只在 `OWNER_ONLY` 里 —— OWNER 之外一律拒绝，
 *      且**不得**触碰 DB（先拒绝再查/写，避免"先查了但没写"也留下痕迹的错觉）；
 *   2. **输入校验**：slug 形态、name 长度、空对象、"给了字段但非法"**不**静默跳过；
 *   3. **审计**：`org.updated` 只记"改了哪些字段"，不记新值。
 *
 * 另有两条与界面直接相关的断言：
 *   - `GET` 的读是公共的（MEMBER 也有 `org.read`）；
 *   - `capabilities` 会随 `GET` 下发 —— 设置屏据此决定"渲染表单"还是"渲染说明"。
 */

jest.mock('@/lib/db', () => ({
  db: {
    organization: { findFirst: jest.fn(), update: jest.fn() },
    membership: { count: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
  },
}))

import { db } from '@/lib/db'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import {
  ORG_NAME_MAX,
  getOrganization,
  getOrganizationOverview,
  parseOrganizationUpdate,
  updateOrganization,
} from '@/lib/tenancy/org'
import type { TenantContext } from '@/lib/tenancy'

const ctx = (role: TenantContext['role']): TenantContext => ({
  organizationId: 'org_1',
  userId: 'u_me',
  role,
  membershipId: 'ms_me',
})

const orgFindFirst = db.organization.findFirst as unknown as jest.Mock
const orgUpdate = db.organization.update as unknown as jest.Mock
const memberCount = db.membership.count as unknown as jest.Mock
const auditCreate = db.tenantAuditEvent.create as unknown as jest.Mock

const ORG_ROW = {
  id: 'org_1',
  name: '种子社群',
  slug: 'seed-community',
  status: 'ACTIVE',
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
}

beforeEach(() => {
  jest.clearAllMocks()
  orgFindFirst.mockResolvedValue(null)
  memberCount.mockResolvedValue(0)
  auditCreate.mockResolvedValue({})
})

// ───────────────────────────────────────────────────────────
describe('parseOrganizationUpdate', () => {
  it('非对象（字符串 / null / 数组）→ 400', () => {
    for (const bad of ['x', null, 42, [], true]) {
      expect(() => parseOrganizationUpdate(bad)).toThrow(ValidationError)
    }
  })

  it('空对象 → 400（"成功但什么都没改"是坏契约）', () => {
    expect(() => parseOrganizationUpdate({})).toThrow(/nothing to update/)
  })

  it('name 去首尾空格；空串 / 超长 / 非字符串 → 400', () => {
    expect(parseOrganizationUpdate({ name: '  新名字  ' })).toEqual({ name: '新名字' })
    expect(() => parseOrganizationUpdate({ name: '   ' })).toThrow(ValidationError)
    expect(() => parseOrganizationUpdate({ name: 'x'.repeat(ORG_NAME_MAX + 1) })).toThrow(
      ValidationError
    )
    expect(() => parseOrganizationUpdate({ name: 123 })).toThrow(ValidationError)
  })

  it('slug 只接受小写字母/数字/连字符，必须以字母或数字开头', () => {
    expect(parseOrganizationUpdate({ slug: 'seed-2026' })).toEqual({ slug: 'seed-2026' })
    expect(parseOrganizationUpdate({ slug: '  a1  ' })).toEqual({ slug: 'a1' })

    for (const bad of ['AB', '-lead', 'has_underscore', 'has space', 'a', 'x'.repeat(64)]) {
      expect(() => parseOrganizationUpdate({ slug: bad })).toThrow(ValidationError)
    }
  })

  it('非法字段**不**静默跳过（跳过会让用户以为存上了）', () => {
    expect(() => parseOrganizationUpdate({ name: 'ok', slug: 'BAD' })).toThrow(ValidationError)
  })

  it('未知键忽略（向前兼容：前端多传一个字段不该让老服务端 400）', () => {
    expect(parseOrganizationUpdate({ name: 'ok', status: 'SUSPENDED', id: 'hack' })).toEqual({
      name: 'ok',
    })
  })

  it('status 不是可改字段 —— 传了也不会进入 patch（防自助解封）', () => {
    const out = parseOrganizationUpdate({ name: 'ok', status: 'ACTIVE' })
    expect(out).not.toHaveProperty('status')
  })
})

// ───────────────────────────────────────────────────────────
describe('updateOrganization —— 权限', () => {
  it('MEMBER / OPERATOR / ADMIN 一律 403，且**不**读写 DB', async () => {
    for (const role of ['MEMBER', 'OPERATOR', 'ADMIN'] as const) {
      await expect(updateOrganization(ctx(role), { name: 'x' })).rejects.toBeInstanceOf(
        ForbiddenError
      )
    }
    expect(orgFindFirst).not.toHaveBeenCalled()
    expect(orgUpdate).not.toHaveBeenCalled()
  })

  it('OWNER 通过权限关卡（进入实际的查重 + 写入）', async () => {
    orgUpdate.mockResolvedValue({ ...ORG_ROW, name: '新名字' })
    await updateOrganization(ctx('OWNER'), { name: '新名字' })
    expect(orgUpdate).toHaveBeenCalled()
  })
})

describe('updateOrganization —— slug 冲突', () => {
  it('slug 已被别的社群占用 → 409 且指明字段', async () => {
    orgFindFirst.mockResolvedValue({ id: 'org_other' })

    await expect(updateOrganization(ctx('OWNER'), { slug: 'taken' })).rejects.toMatchObject({
      name: 'ConflictError',
      details: { field: 'slug' },
    })
    expect(orgUpdate).not.toHaveBeenCalled()
  })

  it('查重谓词排除自己（改回自己的 slug 不该算冲突）', async () => {
    orgUpdate.mockResolvedValue(ORG_ROW)
    await updateOrganization(ctx('OWNER'), { slug: 'seed-community' })

    expect(orgFindFirst.mock.calls[0][0].where).toEqual({
      slug: 'seed-community',
      NOT: { id: 'org_1' },
    })
  })

  it('并发抢注：Prisma P2002 被翻成 409（不是 500）', async () => {
    orgUpdate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))

    await expect(updateOrganization(ctx('OWNER'), { slug: 'racy' })).rejects.toBeInstanceOf(
      ConflictError
    )
  })

  it('其它 DB 错误原样抛出（不被误判成冲突）', async () => {
    orgUpdate.mockRejectedValue(new Error('connection lost'))
    await expect(updateOrganization(ctx('OWNER'), { name: 'x' })).rejects.toThrow('connection lost')
  })
})

describe('updateOrganization —— 写入与审计', () => {
  it('只更新本次给到的字段', async () => {
    orgUpdate.mockResolvedValue(ORG_ROW)
    await updateOrganization(ctx('OWNER'), { name: '只改名字' })

    expect(orgUpdate.mock.calls[0][0].data).toEqual({ name: '只改名字' })
    expect(orgUpdate.mock.calls[0][0].where).toEqual({ id: 'org_1' })
  })

  it('返回 DTO 且时间为 ISO 字符串', async () => {
    orgUpdate.mockResolvedValue(ORG_ROW)
    const out = await updateOrganization(ctx('OWNER'), { name: 'x' })

    expect(out).toEqual({
      id: 'org_1',
      name: '种子社群',
      slug: 'seed-community',
      status: 'ACTIVE',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    })
  })

  it('审计只记"改了哪些字段"，**不记新值**', async () => {
    orgUpdate.mockResolvedValue(ORG_ROW)
    await updateOrganization(ctx('OWNER'), { name: '新名字', slug: 'new-slug' })

    const input = auditCreate.mock.calls[0][0].data
    expect(input.eventType).toBe('org.updated')
    expect(input.actorId).toBe('u_me')
    expect(JSON.parse(input.safeMetadata)).toEqual({ changed: ['name', 'slug'] })
    expect(input.safeMetadata).not.toContain('新名字')
    expect(input.safeMetadata).not.toContain('new-slug')
  })

  it('审计失败不影响业务结果（旁路）', async () => {
    auditCreate.mockRejectedValue(new Error('audit down'))
    orgUpdate.mockResolvedValue(ORG_ROW)
    await expect(updateOrganization(ctx('OWNER'), { name: 'x' })).resolves.toBeTruthy()
  })
})

// ───────────────────────────────────────────────────────────
describe('getOrganization / getOrganizationOverview', () => {
  it('组织不存在 → null（GET）/ 抛 NotFound（overview）', async () => {
    expect(await getOrganization(ctx('OWNER'))).toBeNull()
    await expect(getOrganizationOverview(ctx('OWNER'))).rejects.toBeInstanceOf(NotFoundError)
  })

  it('overview 下发 myRole 与 capabilities —— 设置屏据此决定渲染表单还是说明', async () => {
    orgFindFirst.mockResolvedValue(ORG_ROW)
    memberCount.mockResolvedValue(12)

    const owner = await getOrganizationOverview(ctx('OWNER'))
    expect(owner.myRole).toBe('OWNER')
    expect(owner.capabilities).toContain('org.update')
    expect(owner.memberTotal).toBe(12)

    const member = await getOrganizationOverview(ctx('MEMBER'))
    // 读是公共的：MEMBER 也有 org.read
    expect(member.capabilities).toContain('org.read')
    // 写不是：MEMBER 没有 org.update → 界面渲染只读说明
    expect(member.capabilities).not.toContain('org.update')
  })

  it('overview 的成员数按租户统计', async () => {
    orgFindFirst.mockResolvedValue(ORG_ROW)
    await getOrganizationOverview(ctx('OPERATOR'))
    expect(memberCount.mock.calls[0][0].where).toEqual({ organizationId: 'org_1' })
  })
})

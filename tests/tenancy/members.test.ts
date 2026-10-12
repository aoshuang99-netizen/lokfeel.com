/**
 * T07 · 成员目录服务层 —— 单测
 *
 * 覆盖三类风险：
 *   1. **投影边界**：DTO 不得带出鉴权字段（`password` / `tokenVersion` …）；
 *   2. **租户谓词**：查询必须强制带 `organizationId`（这是"只在本社群可见"的唯一保证）；
 *   3. **过滤收敛**：非法 role/status 与过短关键字一律忽略，不能把非法值透传给 DB。
 *
 * 同时覆盖 `displayNameOf` 的回退链 —— 成员目录最常见的数据缺陷就是"名字空白"。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: {
    membership: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      groupBy: jest.fn(),
    },
  },
}))

import { db } from '@/lib/db'
import {
  MEMBERSHIP_STATUSES,
  countMembersByRole,
  displayNameOf,
  getMemberById,
  listMembers,
  parseMemberFilters,
  toMemberDto,
} from '@/lib/tenancy/members'
import type { TenantContext } from '@/lib/tenancy'

const ctx: TenantContext = {
  organizationId: 'org_1',
  userId: 'u_me',
  role: 'ADMIN',
  membershipId: 'ms_me',
}

const countMock = db.membership.count as unknown as jest.Mock
const findManyMock = db.membership.findMany as unknown as jest.Mock
const findFirstMock = db.membership.findFirst as unknown as jest.Mock
const groupByMock = db.membership.groupBy as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  countMock.mockResolvedValue(0)
  findManyMock.mockResolvedValue([])
  findFirstMock.mockResolvedValue(null)
  groupByMock.mockResolvedValue([])
})

// ───────────────────────────────────────────────────────────
describe('parseMemberFilters', () => {
  const parse = (qs: string) => parseMemberFilters(new URLSearchParams(qs))

  it('空查询串 → 全部条件为 null（等于不过滤）', () => {
    expect(parse('')).toEqual({ role: null, status: null, q: null })
  })

  it('role 归一化为大写；小写输入也能接受', () => {
    expect(parse('role=admin').role).toBe('ADMIN')
    expect(parse('role=OWNER').role).toBe('OWNER')
  })

  it('未知 role / status 一律忽略（不透传给 DB）', () => {
    expect(parse('role=SUPERUSER').role).toBeNull()
    expect(parse('status=PENDING').status).toBeNull()
  })

  it('status 只接受 MembershipStatus 的三个取值', () => {
    for (const s of MEMBERSHIP_STATUSES) {
      expect(parse(`status=${s.toLowerCase()}`).status).toBe(s)
    }
  })

  it('关键字 <2 字视为未提供（过短只会全表扫，收益为负）', () => {
    expect(parse('q=a').q).toBeNull()
    expect(parse('q=').q).toBeNull()
    expect(parse('q=  ').q).toBeNull()
  })

  it('关键字 ≥2 字保留，并去掉首尾空格', () => {
    expect(parse('q=%20ab%20').q).toBe('ab')
    expect(parse('q=Alice').q).toBe('Alice')
  })
})

// ───────────────────────────────────────────────────────────
describe('displayNameOf —— 回退链', () => {
  const rowWith = (user: any) => ({ user }) as any

  it('优先取 Profile.displayName', () => {
    expect(
      displayNameOf(rowWith({ name: 'Bob', email: 'b@x.com', profile: { displayName: 'Bobby' } }))
    ).toBe('Bobby')
  })

  it('Profile 缺失 → 回退 User.name', () => {
    expect(displayNameOf(rowWith({ name: 'Bob', email: 'b@x.com', profile: null }))).toBe('Bob')
  })

  it('Profile.displayName 为空白串 → 视为缺失，继续回退', () => {
    expect(
      displayNameOf(rowWith({ name: 'Bob', email: 'b@x.com', profile: { displayName: '   ' } }))
    ).toBe('Bob')
  })

  it('都没有 → 回退邮箱 @ 前缀', () => {
    expect(displayNameOf(rowWith({ name: null, email: 'alice@x.com', profile: null }))).toBe('alice')
  })

  it('用户已被删除（user 为 null）→ 明确占位，不抛异常也不返回空串', () => {
    expect(displayNameOf(rowWith(null))).toBe('（用户已删除）')
  })

  it('邮箱前缀也拿不到 → 兜底占位', () => {
    expect(displayNameOf(rowWith({ name: null, email: '@x.com', profile: null }))).toBe('（未命名成员）')
  })
})

// ───────────────────────────────────────────────────────────
describe('toMemberDto —— 投影边界', () => {
  const row = {
    id: 'ms_1',
    userId: 'u_1',
    role: 'OPERATOR',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    updatedAt: new Date('2026-02-03T04:05:06.000Z'),
    user: {
      name: 'Bob',
      email: 'bob@x.com',
      image: 'https://img/u.png',
      isBot: true,
      profile: { displayName: 'Bobby', avatar: 'https://img/p.png', city: 'Shanghai' },
    },
  }

  it('只投影目录字段 —— 鉴权字段不得出现', () => {
    const keys = Object.keys(toMemberDto(row as any))
    for (const forbidden of ['password', 'tokenVersion', 'accounts', 'sessions', 'emailVerified']) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it('也不投影 Profile 的匹配域字段（那是个人匹配数据，不是目录数据）', () => {
    const keys = Object.keys(toMemberDto(row as any))
    for (const forbidden of ['sexuality', 'gender', 'age', 'boundaries', 'dealbreakers']) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it('头图优先取 Profile.avatar，回退 User.image', () => {
    expect(toMemberDto(row as any).image).toBe('https://img/p.png')
    expect(
      toMemberDto({ ...row, user: { ...row.user, profile: null } } as any).image
    ).toBe('https://img/u.png')
  })

  it('日期序列化为 ISO 字符串', () => {
    const dto = toMemberDto(row as any)
    expect(dto.joinedAt).toBe('2026-01-02T03:04:05.000Z')
    expect(dto.updatedAt).toBe('2026-02-03T04:05:06.000Z')
  })

  it('role / status 原样透出；isBot 透出（运营要能区分数字用户）', () => {
    const dto = toMemberDto(row as any)
    expect(dto.role).toBe('OPERATOR')
    expect(dto.status).toBe('ACTIVE')
    expect(dto.isBot).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────
describe('listMembers —— 租户谓词与分页', () => {
  it('查询与计数都强制带 organizationId（跨租户读的唯一防线）', async () => {
    await listMembers(ctx)
    expect(countMock.mock.calls[0][0].where.organizationId).toBe('org_1')
    expect(findManyMock.mock.calls[0][0].where.organizationId).toBe('org_1')
  })

  it('未给过滤条件时 where 里不含 role / status / user（不做无谓谓词）', async () => {
    await listMembers(ctx)
    const where = findManyMock.mock.calls[0][0].where
    expect(where).not.toHaveProperty('role')
    expect(where).not.toHaveProperty('status')
    expect(where).not.toHaveProperty('user')
  })

  it('role / status 透传为精确匹配谓词', async () => {
    await listMembers(ctx, { role: 'ADMIN', status: 'SUSPENDED' })
    const where = findManyMock.mock.calls[0][0].where
    expect(where.role).toBe('ADMIN')
    expect(where.status).toBe('SUSPENDED')
  })

  it('关键字 → 三条 OR（邮箱 / 姓名 / 展示名）', async () => {
    await listMembers(ctx, { q: 'ali' })
    const or = findManyMock.mock.calls[0][0].where.user.is.OR
    expect(or).toHaveLength(3)
    expect(or[0]).toEqual({ email: { contains: 'ali' } })
    expect(or[2].profile.is.displayName).toEqual({ contains: 'ali' })
  })

  it('分页换算 skip / take；pageSize 收敛到 1..100', async () => {
    await listMembers(ctx, { page: 3, pageSize: 25 })
    expect(findManyMock.mock.calls[0][0].skip).toBe(50)
    expect(findManyMock.mock.calls[0][0].take).toBe(25)

    await listMembers(ctx, { page: 0, pageSize: 9999 })
    expect(findManyMock.mock.calls[1][0].skip).toBe(0)
    expect(findManyMock.mock.calls[1][0].take).toBe(100)
  })

  it('返回 total / page / pageSize 供分页控件使用', async () => {
    countMock.mockResolvedValue(42)
    const res = await listMembers(ctx, { page: 2, pageSize: 20 })
    expect(res).toMatchObject({ total: 42, page: 2, pageSize: 20 })
    expect(res.items).toEqual([])
  })

  it('按加入时间倒序（分页稳定；不用 role 字符串序 —— 它与权限序不一致）', async () => {
    await listMembers(ctx)
    expect(findManyMock.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' })
  })

  it('行数据经 toMemberDto 转换后才返回（不透传 DB 行）', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'ms_9',
        userId: 'u_9',
        role: 'MEMBER',
        status: 'ACTIVE',
        createdAt: new Date('2026-03-03T00:00:00.000Z'),
        updatedAt: new Date('2026-03-03T00:00:00.000Z'),
        user: { name: 'Zoe', email: 'z@x.com', image: null, isBot: false, profile: null },
        password: 'SHOULD_NOT_LEAK',
      },
    ])
    const res = await listMembers(ctx)
    expect(res.items[0].displayName).toBe('Zoe')
    expect(JSON.stringify(res.items[0])).not.toContain('SHOULD_NOT_LEAK')
  })
})

// ───────────────────────────────────────────────────────────
describe('countMembersByRole / getMemberById', () => {
  it('按角色汇总只统计本租户', async () => {
    groupByMock.mockResolvedValue([
      { role: 'OWNER', _count: { _all: 1 } },
      { role: 'MEMBER', _count: { _all: 7 } },
    ])
    const counts = await countMembersByRole(ctx)
    expect(groupByMock.mock.calls[0][0].where.organizationId).toBe('org_1')
    expect(counts).toEqual({ OWNER: 1, MEMBER: 7 })
  })

  it('getMemberById 带租户谓词 —— 跨租户 id 读出来是 null（表现为"不存在"）', async () => {
    await getMemberById(ctx, 'ms_x')
    expect(findFirstMock.mock.calls[0][0].where).toMatchObject({
      id: 'ms_x',
      organizationId: 'org_1',
    })
  })

  it('getMemberById 空 id 直接返回 null，不查库', async () => {
    expect(await getMemberById(ctx, '')).toBeNull()
    expect(findFirstMock).not.toHaveBeenCalled()
  })
})

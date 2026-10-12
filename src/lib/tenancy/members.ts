/**
 * T07 · 成员目录服务层（只读）
 *
 * 职责：列出 / 检索**本租户**的成员。写操作（邀请、改角色、移除）属后续切片，
 * 且分别需要 `member.invite` / `member.update_role` / `member.remove`。
 *
 * 🔴 隐私边界（本文件的硬约束，改前先读）：
 *   1. **只投影目录需要的字段**：`password` / `tokenVersion` / `accounts` / `sessions`
 *      等鉴权字段一律不进 select —— 不是"返回后过滤"，而是**根本不查**。
 *   2. `email` 是运营联系成员所必需，但**只在租户内可见**：所有查询都强制
 *      `organizationId` 谓词，跨租户读表现为"查不到"。
 *   3. **不返回 Profile 的匹配域字段**（性别取向、关系蓝图、边界、雷区等）。
 *      那是"个人匹配"域的数据，与"成员目录"无关 —— 目录只需要名片级信息。
 *
 * 方言无关：不使用 `mode: 'insensitive'`（libSQL/SQLite 不支持该参数；
 * SQLite 的 LIKE 对 ASCII 本就大小写不敏感），迁移 PostgreSQL 时若需
 * 明确语义再补 ilike。见 DIALECT-DIFF.md §6 约束 1。
 */

import { db } from '@/lib/db'
import { TENANT_ROLES, type TenantRole } from './capabilities'
import type { TenantContext } from './resolve'

/** 成员状态取值，与 prisma/schema/tenancy.prisma 的 `MembershipStatus` 一致。 */
export const MEMBERSHIP_STATUSES = ['ACTIVE', 'INVITED', 'SUSPENDED'] as const
export type MembershipStatusValue = (typeof MEMBERSHIP_STATUSES)[number]

/**
 * 成员目录条目（对外 DTO）。
 *
 * ⚠️ 增字段前先问：这是"目录"需要的信息，还是"匹配"需要的信息？
 *    后者不该出现在这里。
 */
export interface MemberDto {
  membershipId: string
  userId: string
  /** 优先取 Profile.displayName，回退 User.name，再回退邮箱前缀 —— 永远非空。 */
  displayName: string
  email: string
  image: string | null
  role: TenantRole
  status: MembershipStatusValue
  city: string | null
  /** 数字用户（种子/模拟）。运营需要能把它们与真人区分开。 */
  isBot: boolean
  joinedAt: string
  updatedAt: string
}

export interface MemberFilters {
  role?: TenantRole | null
  status?: MembershipStatusValue | null
  /** 关键字：匹配 displayName / name / email 的包含（LIKE）。 */
  q?: string | null
}

/** 把查询串收敛为合法过滤条件；**非法值一律忽略**（与 `/api/v1/missions` 的 status 口径一致）。 */
export function parseMemberFilters(params: URLSearchParams): MemberFilters {
  const rawRole = params.get('role')?.toUpperCase()
  const rawStatus = params.get('status')?.toUpperCase()
  const rawQ = params.get('q')?.trim()

  return {
    role: rawRole && (TENANT_ROLES as readonly string[]).includes(rawRole) ? (rawRole as TenantRole) : null,
    status:
      rawStatus && (MEMBERSHIP_STATUSES as readonly string[]).includes(rawStatus)
        ? (rawStatus as MembershipStatusValue)
        : null,
    // 过短的关键字只会全表扫，收益为负 —— 少于 2 个字符视为未提供。
    q: rawQ && rawQ.length >= 2 ? rawQ : null,
  }
}

/** Prisma select —— 这是**唯一**决定哪些字段能被读出来的地方。 */
const MEMBERSHIP_SELECT = {
  id: true,
  userId: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      name: true,
      email: true,
      image: true,
      isBot: true,
      profile: { select: { displayName: true, avatar: true, city: true } },
    },
  },
} as const

interface MembershipRow {
  id: string
  userId: string
  role: string
  status: string
  createdAt: Date
  updatedAt: Date
  user: {
    name: string | null
    email: string
    image: string | null
    isBot: boolean
    profile: { displayName: string; avatar: string | null; city: string | null } | null
  } | null
}

/** 展示名回退链：Profile.displayName → User.name → 邮箱 @ 前缀。导出以便单测。 */
export function displayNameOf(row: Pick<MembershipRow, 'user'>): string {
  const u = row.user
  if (!u) return '（用户已删除）'
  const fromProfile = u.profile?.displayName?.trim()
  if (fromProfile) return fromProfile
  const fromUser = u.name?.trim()
  if (fromUser) return fromUser
  const local = u.email?.split('@')[0]?.trim()
  return local || '（未命名成员）'
}

export function toMemberDto(row: MembershipRow): MemberDto {
  return {
    membershipId: row.id,
    userId: row.userId,
    displayName: displayNameOf(row),
    email: row.user?.email ?? '',
    image: row.user?.profile?.avatar ?? row.user?.image ?? null,
    role: row.role as TenantRole,
    status: row.status as MembershipStatusValue,
    city: row.user?.profile?.city ?? null,
    isBot: row.user?.isBot ?? false,
    joinedAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export interface ListMembersOptions extends MemberFilters {
  page?: number
  pageSize?: number
}

export async function listMembers(
  ctx: TenantContext,
  options: ListMembersOptions = {}
): Promise<{ items: MemberDto[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(options.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 20)))
  const q = options.q ?? null

  const where = {
    // 🔴 租户谓词不可省：这是"只在本社群内可见"的唯一保证。
    organizationId: ctx.organizationId,
    ...(options.role ? { role: options.role } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(q
      ? {
          user: {
            is: {
              OR: [
                { email: { contains: q } },
                { name: { contains: q } },
                { profile: { is: { displayName: { contains: q } } } },
              ],
            },
          },
        }
      : {}),
  }

  const [total, rows] = await Promise.all([
    db.membership.count({ where }),
    db.membership.findMany({
      where,
      select: MEMBERSHIP_SELECT,
      // OWNER 优先 → ADMIN → OPERATOR → MEMBER 由前端不依赖顺序；这里按加入时间倒序，
      // 保证分页稳定（role 的字符串序 ≠ 权限序，用它排序会误导）。
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return {
    items: (rows as unknown as MembershipRow[]).map(toMemberDto),
    total,
    page,
    pageSize,
  }
}

/**
 * 本租户成员按角色的计数（用于成员屏的角色徽章汇总）。
 * 与列表分开是因为它要在**过滤前**统计，口径是"全租户"。
 */
export async function countMembersByRole(
  ctx: TenantContext
): Promise<Record<string, number>> {
  const grouped = await db.membership.groupBy({
    by: ['role'],
    where: { organizationId: ctx.organizationId },
    _count: { _all: true },
  })
  const out: Record<string, number> = {}
  for (const g of grouped) {
    out[g.role as string] = ((g._count as { _all?: number })?._all ?? 0) as number
  }
  return out
}

/** 读取单个成员（详情/审计用）。跨租户 → null（调用方按 404 处理）。 */
export async function getMemberById(
  ctx: TenantContext,
  membershipId: string
): Promise<MemberDto | null> {
  if (!membershipId) return null
  const row = await db.membership.findFirst({
    where: { id: membershipId, organizationId: ctx.organizationId },
    select: MEMBERSHIP_SELECT,
  })
  return row ? toMemberDto(row as unknown as MembershipRow) : null
}

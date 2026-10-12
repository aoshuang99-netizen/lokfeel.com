/**
 * T07 · 组织（社群）档案服务
 *
 * 读写当前租户的 `Organization`。**唯一**允许改的是 `name` 与 `slug`：
 *   - `status` 由计费/风控变更（T08），不是表单字段 —— 允许自助置 `ACTIVE`
 *     就等于让欠费租户自己解封。
 *   - `id` / `createdAt` 不可变。
 *
 * 🔴 权限口径（与能力矩阵对齐，改前先读）：
 *   - 读：`org.read` —— **所有 ACTIVE 成员都有**（连 MEMBER 也在 SELF_SERVICE 里）。
 *     因此 `GET` 返回的字段必须是"成员知道自己社群"的最小集，不含任何成员级信息。
 *   - 写：`org.update` —— **仅 OWNER**（`OWNER_ONLY`）。这一条决定了设置屏的形态：
 *     非所有者看得到设置页（因为读是公共的），但**不渲染编辑表单**，只说明原因。
 *
 * 审计：每次成功修改写一条 `org.updated`，`safeMetadata` 只记**改了哪些字段**，
 * 不记新值 —— 社群名可能含个人色彩，没必要在审计流里留全量副本。
 */

import { db } from '@/lib/db'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { writeTenantAudit } from './audit'
import { can, capabilitiesOf, type TenantCapability, type TenantRole } from './capabilities'
import type { TenantContext } from './resolve'

export const ORG_NAME_MAX = 80
export const ORG_SLUG_MIN = 2
export const ORG_SLUG_MAX = 63

/**
 * slug 形态：小写字母/数字开头，随后可含小写字母、数字、连字符。
 * 刻意**不允许**大写与下划线 —— slug 会出现在 URL 与对外分享里，
 * 放宽形态只会让"同一个社群两个地址"（大小写不敏感的场景）变成排查噩梦。
 */
export const ORG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/

export interface OrganizationDto {
  id: string
  name: string
  slug: string
  status: string
  createdAt: string
  updatedAt: string
}

const ORG_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const

interface OrgRow {
  id: string
  name: string
  slug: string
  status: string
  createdAt: Date
  updatedAt: Date
}

function toDto(row: OrgRow): OrganizationDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function getOrganization(ctx: TenantContext): Promise<OrganizationDto | null> {
  const row = (await db.organization.findFirst({
    where: { id: ctx.organizationId },
    select: ORG_SELECT,
  })) as OrgRow | null
  return row ? toDto(row) : null
}

export interface OrganizationOverview {
  organization: OrganizationDto
  /** 当前用户在**本租户**的角色与能力 —— 供界面做降级展示（不是授权依据）。 */
  myRole: TenantRole
  capabilities: TenantCapability[]
  /** 本社群的成员数（含非 ACTIVE）。只是一个数字，不含任何成员级字段。 */
  memberTotal: number
}

/**
 * 设置屏所需的全部只读信息。
 *
 * ⚠️ `capabilities` 下发给前端**不是**让前端做授权 —— 授权始终由
 *    `withTenant(capability)` 在服务端完成。这里下发的唯一用途是"决定渲染什么"：
 *    没有 `org.update` 就渲染只读视图，而不是渲染一个必然 403 的保存按钮。
 */
export async function getOrganizationOverview(ctx: TenantContext): Promise<OrganizationOverview> {
  const [row, memberTotal] = await Promise.all([
    db.organization.findFirst({ where: { id: ctx.organizationId }, select: ORG_SELECT }) as unknown as Promise<OrgRow | null>,
    db.membership.count({ where: { organizationId: ctx.organizationId } }),
  ])
  if (!row) throw new NotFoundError('Organization not found')

  return {
    organization: toDto(row),
    myRole: ctx.role,
    capabilities: capabilitiesOf(ctx.role),
    memberTotal,
  }
}

export interface UpdateOrganizationInput {
  name?: string
  slug?: string
}

/**
 * 解析并校验 PATCH 请求体。
 *
 * 三条规则：
 *   1. 必须是对象，且**至少**含一个可改字段（空对象 → 400，而不是"成功但没改"）；
 *   2. 未知键**忽略**（向前兼容：将来前端多传一个字段不应让老服务端 400）；
 *   3. 给了字段就必须合法 —— 不做"非法就跳过"的静默处理，否则用户会以为存上了。
 */
export function parseOrganizationUpdate(body: unknown): UpdateOrganizationInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object')
  }
  const raw = body as Record<string, unknown>
  const out: UpdateOrganizationInput = {}

  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string') {
      throw new ValidationError('name must be a string', { field: 'name' })
    }
    const name = raw.name.trim()
    if (name.length < 1 || name.length > ORG_NAME_MAX) {
      throw new ValidationError(`name must be 1-${ORG_NAME_MAX} characters`, { field: 'name' })
    }
    out.name = name
  }

  if (raw.slug !== undefined) {
    if (typeof raw.slug !== 'string') {
      throw new ValidationError('slug must be a string', { field: 'slug' })
    }
    const slug = raw.slug.trim()
    if (!ORG_SLUG_PATTERN.test(slug)) {
      throw new ValidationError(
        `slug must be ${ORG_SLUG_MIN}-${ORG_SLUG_MAX} chars of lowercase letters, digits or hyphens`,
        { field: 'slug' }
      )
    }
    out.slug = slug
  }

  if (out.name === undefined && out.slug === undefined) {
    throw new ValidationError('nothing to update: provide name and/or slug', {
      fields: ['name', 'slug'],
    })
  }
  return out
}

/**
 * 更新社群档案。
 *
 * slug 是 `@unique` —— 冲突必须**显式**报 409 且指明字段，而不是让 Prisma 的
 * P2002 冒到路由层变成 500。先查一次是"检查"，真正的并发安全由唯一约束兜底
 * （查到没冲突、写入时被别人抢先 → 唯一约束会抛，`updateOrganization` 把它翻成 409）。
 */
export async function updateOrganization(
  ctx: TenantContext,
  input: UpdateOrganizationInput
): Promise<OrganizationDto> {
  // 路由层已 gate 过；这里再判一次是**纵深防御**：服务函数可能被脚本/任务直接调用。
  if (!can(ctx.role, 'org.update')) {
    throw new ForbiddenError('Forbidden: updating the organization requires org.update (owner)')
  }

  if (input.slug) {
    const taken = await db.organization.findFirst({
      where: { slug: input.slug, NOT: { id: ctx.organizationId } },
      select: { id: true },
    })
    if (taken) {
      throw new ConflictError(`slug "${input.slug}" is already taken`, { field: 'slug' })
    }
  }

  let updated: OrgRow
  try {
    updated = (await db.organization.update({
      where: { id: ctx.organizationId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
      },
      select: ORG_SELECT,
    })) as OrgRow
  } catch (err) {
    // 唯一约束兜底：并发下"查重"与"写入"之间存在窗口。
    if (isUniqueViolation(err)) {
      throw new ConflictError('slug is already taken', { field: 'slug' })
    }
    throw err
  }

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'org.updated',
    resourceType: 'organization',
    resourceId: ctx.organizationId,
    safeMetadata: {
      changed: [
        ...(input.name !== undefined ? ['name'] : []),
        ...(input.slug !== undefined ? ['slug'] : []),
      ],
    },
  }).catch(() => {})

  return toDto(updated)
}

/** Prisma 唯一约束冲突（P2002）。用 duck-typing 判定，避免为它 import 生成代码。 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

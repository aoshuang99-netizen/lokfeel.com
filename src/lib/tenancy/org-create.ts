/**
 * T07 · 组织创建 —— 创建者**必须**同时成为管理员
 *
 * 为什么把这条做成不可绕过的结构，而不是"记得给创建者加成员关系"：
 *   D-12 的事故形态就是「组织里没有管理员」。当时的成因不是有人把管理员降级了，
 *   而是**组织本来就没有管理员** —— 创建入口只建了 org，没人建 membership。
 *   于是一个"看起来正常"的组织，从诞生第一天起就没有任何人有 `agent.approve`
 *   或 `outcome.verify`。这类缺陷不会报错、不会告警，只会在用户点审批时变成 403。
 *
 * 所以这里的承重结构是：**建 org 与建 OWNER 成员关系在同一个事务里**。
 * 任何一半失败都整体回滚，因此"存在一个没有管理员的新组织"在事务边界上就不可达。
 *
 * 🔴 幂等（重试不产生重复）：
 *   - `Organization.slug` 唯一 ⇒ 同一 slug 重试只会得到一次成功，其余冲突；
 *   - `Membership` 的 `@@unique([organizationId, userId])` ⇒ 即使有人在事务外
 *     重复插入，也不会产生第二条成员关系。
 *   两者都是**数据库约束**，不是应用层的"先查再写"（后者在并发下必然漏）。
 */

import { db } from '@/lib/db'
import { ConflictError, ValidationError, isUniqueViolation } from '@/lib/errors'
import { writeTenantAudit } from './audit'
import { TENANT_TX } from './tx'
import type { TenantRole } from './capabilities'

export const ORG_NAME_MAX = 80
export const ORG_SLUG_MIN = 2
export const ORG_SLUG_MAX = 63
export const ORG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/

/**
 * 保留 slug。这些不是"好名字"的问题，而是会**抢走路由**：
 * `/console`、`/api` 之类若被某个租户占为 slug，分享页与站内导航会撞车。
 */
export const RESERVED_SLUGS: readonly string[] = [
  'admin',
  'api',
  'app',
  'auth',
  'billing',
  'console',
  'dashboard',
  'default',
  'login',
  'logout',
  'preview',
  'register',
  'settings',
  'signup',
  'support',
  'system',
  'workspace',
  'www',
]

export type OrgCreateRejectionCode =
  | 'NAME_REQUIRED'
  | 'NAME_TOO_LONG'
  | 'SLUG_REQUIRED'
  | 'SLUG_TOO_SHORT'
  | 'SLUG_TOO_LONG'
  | 'SLUG_INVALID_CHARS'
  | 'SLUG_RESERVED'

export interface OrgCreateRejection {
  ok: false
  status: 400
  code: OrgCreateRejectionCode
  message: string
}

export type OrgCreatePlan =
  | { ok: true; name: string; slug: string }
  | OrgCreateRejection

/** 把用户输入的名字压成候选 slug（中文名压不出可用 slug，会得到空串 → 由调用方要求手填）。 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, ORG_SLUG_MAX)
}

/** 纯判定：输入能否变成一次创建。所有拒绝码显式列出，可被穷举单测。 */
export function planOrganizationCreate(input: { name?: unknown; slug?: unknown }): OrgCreatePlan {
  const rawName = typeof input.name === 'string' ? input.name.trim() : ''
  if (!rawName) return { ok: false, status: 400, code: 'NAME_REQUIRED', message: '组织名称不能为空' }
  if (rawName.length > ORG_NAME_MAX) {
    return { ok: false, status: 400, code: 'NAME_TOO_LONG', message: `组织名称不能超过 ${ORG_NAME_MAX} 个字符` }
  }

  // 没给 slug 时从名字推；给了就**按原样校验**（不静默改写用户明确输入的值，
  // 否则"我填的 abc 为什么变成了 abd"会变成支持工单）。
  const slugSource = typeof input.slug === 'string' ? input.slug.trim() : slugify(rawName)
  if (!slugSource) {
    return { ok: false, status: 400, code: 'SLUG_REQUIRED', message: '标识不能为空（中文名请手动填写英文标识）' }
  }
  if (slugSource.length < ORG_SLUG_MIN) {
    return { ok: false, status: 400, code: 'SLUG_TOO_SHORT', message: `标识至少 ${ORG_SLUG_MIN} 个字符` }
  }
  if (slugSource.length > ORG_SLUG_MAX) {
    return { ok: false, status: 400, code: 'SLUG_TOO_LONG', message: `标识不能超过 ${ORG_SLUG_MAX} 个字符` }
  }
  if (!ORG_SLUG_PATTERN.test(slugSource)) {
    return {
      ok: false,
      status: 400,
      code: 'SLUG_INVALID_CHARS',
      message: '标识只能包含小写字母、数字与连字符，且不能以连字符开头或结尾',
    }
  }
  if (RESERVED_SLUGS.includes(slugSource)) {
    return { ok: false, status: 400, code: 'SLUG_RESERVED', message: '该标识是系统保留字，请换一个' }
  }

  return { ok: true, name: rawName, slug: slugSource }
}

export interface CreatedOrganization {
  id: string
  name: string
  slug: string
  status: string
  role: TenantRole
  membershipId: string
}

/**
 * 创建组织，并把创建者写成 `OWNER`。
 *
 * 事务的边界就是不变量的边界：`organization.create` 与 `membership.create` 必须同生共死。
 * 事务外只写审计（旁路，失败不影响结果 —— 见 audit.ts 的规则 1）。
 */
export async function createOrganizationWithOwner(input: {
  actorUserId: string
  name: unknown
  slug?: unknown
}): Promise<CreatedOrganization> {
  const plan = planOrganizationCreate({ name: input.name, slug: input.slug })
  if (!plan.ok) throw new ValidationError(plan.message, { code: plan.code })

  let org: { id: string; name: string; slug: string; status: string }
  let membership: { id: string }

  try {
    const result = await db.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { name: plan.name, slug: plan.slug },
        select: { id: true, name: true, slug: true, status: true },
      })
      // 创建者拿到 OWNER 而不是 ADMIN：只有 OWNER 能转让/删除租户，
      // 若第一个成员只是 ADMIN，这个组织将**永远无法**被删除或转让。
      const m = await tx.membership.create({
        data: {
          organizationId: created.id,
          userId: input.actorUserId,
          role: 'OWNER',
          status: 'ACTIVE',
        },
        select: { id: true },
      })
      return { org: created, membership: m }
    }, TENANT_TX)
    org = result.org
    membership = result.membership
  } catch (err) {
    // slug 唯一约束冲突 = **预期内**的失败，说明"同一 slug 只能成功一次"，正是幂等所依赖的那条约束。
    // 判据必须走 isUniqueViolation()：libSQL adapter 下 `err.code` 不是 'P2002'（见 errors.ts）。
    // 2026-11-07 生产路径 E2E 前这里只判 P2002，结果重名请求返回 500 而不是 409。
    if (isUniqueViolation(err, 'Organization.slug')) {
      throw new ConflictError('该标识已被占用，请换一个', { code: 'SLUG_TAKEN', slug: plan.slug })
    }
    throw err
  }

  // 审计两条：组织诞生、所有者产生。放在事务之后是有意的 ——
  // 审计写失败不该把已经提交的组织"回滚掉"（那会让用户看到失败但库里已有数据）。
  await Promise.all([
    writeTenantAudit({
      organizationId: org.id,
      actorId: input.actorUserId,
      eventType: 'organization.created',
      resourceType: 'organization',
      resourceId: org.id,
      safeMetadata: { slug: org.slug },
    }).catch(() => {}),
    writeTenantAudit({
      organizationId: org.id,
      actorId: input.actorUserId,
      eventType: 'membership.created',
      resourceType: 'membership',
      resourceId: membership.id,
      safeMetadata: { role: 'OWNER', reason: 'organization_creator' },
    }).catch(() => {}),
  ])

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    role: 'OWNER',
    membershipId: membership.id,
  }
}

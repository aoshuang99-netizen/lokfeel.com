/**
 * T01 · 多租户底座统一出口
 *
 * 使用约定（详见 docs/implementation/T01/DIALECT-DIFF.md §4）：
 *   - 任何「租户作用域」的路由，都必须先 `resolveTenant()` 拿到 `TenantContext`；
 *   - 任何对该租户资源的读写，**必须**带上 `tenant.organizationId` 作为查询谓词；
 *   - **绝不**从 request body / query / header 直接取 organizationId 当授权依据。
 *
 * @example
 * ```ts
 * import { resolveTenant, assertCapability } from '@/lib/tenancy'
 *
 * export async function POST(req: Request) {
 *   const tenant = await resolveTenant()
 *   assertCapability(tenant, 'mission.create')
 *   return db.mission.create({ data: { ...body, organizationId: tenant.organizationId } })
 * }
 * ```
 */

export {
  TENANT_ROLES,
  TENANT_CAPABILITIES,
  ROLE_CAPABILITIES,
  parseTenantRole,
  can,
  capabilitiesOf,
  type TenantRole,
  type TenantCapability,
} from './capabilities'

export {
  resolveTenant,
  resolveTenantForUser,
  resolveActiveTenant,
  listTenants,
  isMemberOf,
  type TenantContext,
  type TenantSummary,
} from './resolve'

// ── V20.5 Batch 3 · 组织切换（软偏好 cookie） ──
export {
  ACTIVE_ORG_COOKIE,
  ACTIVE_ORG_MAX_AGE,
  activeOrgCookieOptions,
  normalizeActiveOrgId,
  readActiveOrgId,
} from './active-org'

export { assertCapability, hasCapability, withTenant, withTenantAll, withTenantAny } from './guard'

export {
  writeTenantAudit,
  listTenantAudit,
  redactMetadata,
  type TenantAuditInput,
} from './audit'

// ── T07 · 成员目录（只读） ──
export {
  MEMBERSHIP_STATUSES,
  displayNameOf,
  parseMemberFilters,
  listMembers,
  countMembersByRole,
  getMemberById,
  type MemberDto,
  type MemberFilters,
  type MembershipStatusValue,
  type ListMembersOptions,
} from './members'

// ── T07 · 成员角色变更（写）+ 管理员不变量 ──
export {
  ADMIN_EQUIVALENT_ROLES,
  isAdminEquivalent,
  planRoleChange,
  parseMemberRolePatch,
  updateMemberRole,
  auditOrganizationAdmins,
  type RoleChangeDecision,
  type RoleChangeInput,
  type RoleChangeRejection,
  type RoleChangeRejectionCode,
  type RoleChangeTarget,
  type OrgAdminAudit,
} from './member-roles'

// ── T07 · 组织（社群）档案 ──
export {
  ORG_NAME_MAX,
  ORG_SLUG_MAX,
  ORG_SLUG_MIN,
  ORG_SLUG_PATTERN,
  getOrganization,
  getOrganizationOverview,
  parseOrganizationUpdate,
  updateOrganization,
  type OrganizationDto,
  type OrganizationOverview,
  type UpdateOrganizationInput,
} from './org'

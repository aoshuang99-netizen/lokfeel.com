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
  listTenants,
  isMemberOf,
  type TenantContext,
  type TenantSummary,
} from './resolve'

export { assertCapability, hasCapability, withTenant } from './guard'

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

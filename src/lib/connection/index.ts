/**
 * T02 · Connection OS 运行时统一出口
 *
 * 使用约定（与 `src/lib/tenancy/index.ts` 一致的风格）：
 *   - 租户作用域的路由：先 `resolveTenant()` 拿 `TenantContext`，
 *     再 `assertCapability(ctx, 'mission.create')`，最后调本模块的服务函数。
 *   - **绝不**把 `request.body.organizationId` 之类的值当作授权依据。
 *
 * @example
 * ```ts
 * export const POST = withTenant('mission.create')(async (req, tenant) => {
 *   const key = requireIdempotencyKey(req.headers.get('Idempotency-Key'))
 *   const input = parseMissionCreate(await req.json())
 *   const { resource, replayed } = await withIdempotency({
 *     organizationId: tenant.organizationId,
 *     scope: 'mission.create',
 *     key,
 *     requestHash: hashRequest(input),
 *     resourceType: 'mission',
 *     load: (id) => getMissionById(tenant, id),
 *     create: async () => {
 *       const m = await createMission(tenant, input)
 *       return { resourceId: m.id, resource: m }
 *     },
 *     compensate: (id) => hardDeleteMission(tenant, id),
 *   })
 *   return created(resource)
 * })
 * ```
 */

// ── JSON-in-String 单点编解码 ──
export {
  encodeJson,
  decodeJson,
  decodeStringArray,
  normalizeStringArray,
  normalizeObject,
  MAX_ARRAY_ITEM_LENGTH,
  MAX_ARRAY_ITEMS,
} from './json-codec'

// ── 分享令牌 ──
export {
  SHARE_TOKEN_BYTES,
  generateShareToken,
  isShareTokenShaped,
  shareTokenEquals,
} from './share-token'

// ── 幂等 ──
export {
  MAX_IDEMPOTENCY_KEY_LENGTH,
  stableStringify,
  hashRequest,
  requireIdempotencyKey,
  withIdempotency,
  type WithIdempotencyOptions,
  type IdempotencyOutcome,
} from './idempotency'

// ── 输入校验 ──
export {
  LIMITS,
  parseMissionCreate,
  parseMissionPatch,
  parseJoin,
  MISSION_ACTIONS,
  parseMissionAction,
  type ParsedMissionCreate,
  type ParsedMissionPatch,
  type ParsedJoin,
  type MissionAction,
} from './mission-input'

// ── 公开投影（最小披露） ──
export {
  EXCLUDED_PUBLIC_FIELDS,
  evaluateJoinability,
  buildSeats,
  toPublicMissionView,
  type PublicMissionView,
  type PublicSeats,
  type PublicMissionStatus,
  type PublicViewSource,
  type JoinBlockReason,
} from './public-view'

// ── Mission 服务 ──
export {
  toMissionDto,
  getMissionById,
  getMission,
  listMissions,
  createMission,
  updateMission,
  transitionMission,
  hardDeleteMission,
  joinMission,
  withdrawFromMission,
  countParticipants,
  getSharePageData,
  type MissionDto,
  type ListMissionsOptions,
  type JoinResult,
  type SharePageResult,
} from './missions'

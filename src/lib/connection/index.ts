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

// ── T03 · 披露字段目录（单一事实来源）──
export {
  AUDIENCE_OPTIONS,
  AUDIENCE_ORDER,
  CANDIDATE_PROFILE_AUDIENCE,
  DISCLOSURE_AUDIENCES,
  DISCLOSURE_FIELDS,
  DISCLOSURE_FIELD_KEYS,
  EXTERNAL_AUDIENCES,
  IMPORTABLE_FIELD_KEYS,
  PROTECTED_FIELD_KEYS,
  SENSITIVE_FIELD_KEYS,
  MISSING_FIELD_AUDIENCE,
  audienceCanSee,
  audienceRank,
  auditCatalog,
  fieldSpec,
  isAudience,
  isFieldKey,
  suggestedDisclosure,
  type DisclosureAudience,
  type DisclosureFieldKey,
  type ExternalAudience,
  type FieldGroup,
  type FieldSpec,
} from './field-catalog'

// ── T03 · 逐字段披露（AC-03 的唯一执法点）──
export {
  decodeDisclosure,
  describeDisclosure,
  discloseSubject,
  effectiveDisclosure,
  encodeDisclosure,
  fieldsVisibleTo,
  grantedAudience,
  normalizeDisclosure,
  type DisclosedProfile,
  type DisclosureEntry,
  type DisclosureMap,
  type DisclosureSummary,
  type SubjectFieldValue,
  type SubjectProfile,
} from './disclosure'

// ── T03 · 档案导入许可 ──
export {
  MAX_IMPORT_FIELDS,
  assertImportPlanAllAccepted,
  parseImportFields,
  planProfileImport,
  type ImportPlan,
  type ImportRejectReason,
} from './intent-import'

// ── T03 · 意图输入校验 ──
export {
  INTENT_LIMITS,
  INTENT_STATUS_ACTIONS,
  parseIntentCreate,
  parseIntentPatch,
  parseIntentStatusAction,
  parseWithdrawReason,
  type IntentStatusAction,
  type ParsedIntentCreate,
  type ParsedIntentPatch,
} from './intent-input'

// ── T03 · 主体档案（披露投影的数据源）──
export {
  SUBJECT_PROFILE_SELECT,
  loadSubjectProfile,
  loadSubjectProfiles,
  mapProfileRow,
} from './subject-profile'

// ── T03 · Intent 服务 ──
export {
  createIntent,
  deriveIntentStatus,
  getIntent,
  getIntentById,
  getMyIntentByShareToken,
  hardDeleteIntent,
  listMissionIntentsForOrganizer,
  listMyIntents,
  liveDisclosureOf,
  previewDisclosure,
  toIntentDto,
  transitionIntent,
  updateIntent,
  type DisclosurePreview,
  type IntentDto,
  type IntentStatusView,
  type ListIntentsOptions,
  type OrganizerIntentView,
} from './intents'

// ── T04 · 双向互补召回（纯内核）──
export {
  PIPELINE_REASONS,
  RECALL_GATES,
  applyGates,
  buildCandidates,
  explainCandidate,
  markGated,
  overlapTokens,
  recall,
  tokenize,
  type CandidateMatch,
  type CandidateResult,
  type CandidateRow,
  type Gate,
  type GateCode,
  type GateContext,
  type GateOutcome,
  type GatedRow,
  type IntentSide,
  type NoCandidateReason,
  type RecallRow,
  type RecalledCandidate,
  type ReciprocalEvidence,
} from './recall'

// ── T04 · 候选装配（服务层；披露投影的装配点）──
export {
  listCandidates,
  listCandidatesByShareToken,
  type CandidateList,
  type CandidateView,
} from './candidates'

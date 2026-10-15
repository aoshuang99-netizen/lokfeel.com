/**
 * T10 · Community Bridge —— **服务层**出口
 *
 * 🔴 与 `@/lib/bridge`（**单数**）的区别 —— 这是本模块**唯一**需要记住的一条：
 *
 *   `@/lib/bridge`    = 无 IO 的**内核**。三方交集判定（`planBridgeVisibility`）、
 *                       状态机真相表（`planBridgeTransition`）、拒绝码与归因。
 *                       受 `scripts/check-bridge-invariants.mjs` 的 B1/B2/B3/B4/B5 约束：
 *                       不得 import tenancy、不得 import 数据库、不得渲染动态 HTML、
 *                       不得用定时器伪造生效、不得发起网络调用。
 *   `@/lib/bridges`   = **有 IO 的服务层**（读写 CommunityBridge / BridgeMemberOptIn、
 *                       过租户能力、写审计、跨群投影）。它 **import** 内核，反过来不成立。
 *
 * 因此：
 *   - 想落库、过能力、算跨群可见性 → 从**这里** import。
 *   - 只想复用纯判据（状态机 / 交集 / 拒绝码） → 从 `@/lib/bridge` import，
 *     这样不会把数据库依赖带进无 IO 的场景（单测因此不需要起库）。
 *
 * ⚠️ 目录名只差一个字母（`bridge` / `bridges`）是**刻意**的：它与 T09 的
 *    `agent` / `agents` 完全同构（见 `src/lib/agents/index.ts` 的同款注释）。
 *    「内核无 IO」这条保证靠目录边界执法，改名会让门禁的扫描根静默失效。
 */

// ── 协议聚合（发起 / 列表 / 双边审批 / 撤销）──
export {
  BRIDGE_LIMITS,
  BRIDGE_SCOPE,
  allowedFieldKeysForSide,
  bridgeCapabilities,
  createBridge,
  decideBridge,
  findBridgeRow,
  findMyOptInRow,
  findMyOptInRows,
  getBridge,
  isUniqueViolation,
  listBridges,
  parseBridgeLimit,
  parseBridgeStatusView,
  requireBridgeId,
  requireFieldKeys,
  requireMissionKinds,
  requirePurpose,
  requireRecipientOrgId,
  toBridgeView,
  type CreateBridgeInput,
  type CreateBridgeResult,
  type ListBridgesOptions,
  type ListBridgesResult,
} from './bridges'

// ── 成员逐个 opt-in / opt-out ──
export {
  optInBridgeMember,
  optOutBridgeMember,
} from './optins'

// ── 跨群投影（**唯一**的跨群读取路径）──
export {
  listBridgeDiscoveries,
  planMyBridgeVisibility,
  type DiscoveryOptions,
} from './discovery'

// ── DTO 投影（**唯一**的对外形状）──
export {
  counterpartyOf,
  sideOf,
  toBridgeDto,
  toMemberOptInDto,
  type BridgeDiscoveryDto,
  type BridgeDiscoveryMemberDto,
  type BridgeDto,
  type BridgeParty,
  type BridgeRow,
  type BridgeSelfProjectionDto,
  type BridgeViewer,
  type MemberOptInDto,
  type MemberOptInRow,
} from './dto'

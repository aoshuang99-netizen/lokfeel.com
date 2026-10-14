/**
 * Living Connection OS · P2 —— Field 关系网络的**服务端形状镜像**
 *
 * 依据：`DESIGN/02-plan.md` P2「Field 升级为 2.5D 关系网络」、
 *       `DESIGN/01-design-to-api-map.md` §3/§4（`candidate` 节点 ← `connections/candidates`）。
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么这里要放一份"镜像"而不是直接用服务端类型
 * ═══════════════════════════════════════════════════════════════
 *
 *   前端要**在渲染层**按状态码分支（例如"被门控排除的原因"要显示成人话）。
 *   如果直接消费服务端的联合类型，取值域就定义在服务端 —— 一旦服务端新增一个
 *   `GateCode`，前端不会报错，只会**静默少显示一类原因**（正是 P1 踩过的坑：
 *   三处显示枚举全是猜的，真实数据一到就被 `strictObject` 拒绝、页面永久空白且不报错）。
 *
 *   所以：取值域在**前端侧独立声明**，并用 `AssertTrue<Exact<镜像, 服务端>>`
 *   做**编译期双向等价断言** —— 任一侧增删取值即 `tsc` 失败（TS2344）。
 *   镜像的**值**另有硬编码回归（见 `tests/living/field/types.test.ts`），
 *   两者缺一不可：
 *     · 只有守卫 → 两侧一起改（升级服务端类型 + 同步镜像）时全绿，无人察觉语义已变；
 *     · 只有硬编码 → 服务端改了前端不报错，只是测试红了（而且容易被"顺手改绿"）。
 *
 * ⚠️ 这里只引**类型**（`import type` 零运行时）：`@/lib/connection` 的桶文件会
 *    连带引到 `db` 等服务端模块，把它们拖进客户端 bundle 是不允许的。
 */

import type {
  CandidateList,
  ConnectionBucket,
  GateCode,
  IntroductionBlocker,
  NoCandidateReason,
  OrgConnectionsResult,
  ProposalState,
} from '@/lib/connection'

// ─────────────────────────────────────────────────────────────────────────────
// 🟡 漂移守卫的工具（与 `workspace-spec/schema.ts` 同名但**刻意各自持有**）
// ─────────────────────────────────────────────────────────────────────────────
// 共享一份工具会引入跨切片耦合：P1 改工具签名会波及 P2。两个切片各自持有
// 三行代码的代价，远小于"为了消除重复而让两个契约互相牵制"。

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type AssertTrue<T extends true> = T

// ─────────────────────────────────────────────────────────────────────────────
// 镜像一：门控原因码（UI 必须为每一码说出一句话）
// ─────────────────────────────────────────────────────────────────────────────

export const FIELD_GATE_CODES = [
  'cross_tenant',
  'intent_not_active',
  'intent_expired',
  'not_participant',
  'self',
] as const

export type FieldGateCode = (typeof FIELD_GATE_CODES)[number]

/** 门控原因码的**人话**。`Record` 的键类型保证"新增一码就必须补一句文案"。 */
export const FIELD_GATE_LABELS: Record<FieldGateCode, string> = {
  cross_tenant: '跨租户',
  intent_not_active: '对方意图已撤销',
  intent_expired: '对方意图已过期',
  not_participant: '对方不是该任务的参与人',
  self: '你自己',
}

// ─────────────────────────────────────────────────────────────────────────────
// 镜像二：空候选原因（"没有候选"必须能说出口，不许用空列表糊过去）
// ─────────────────────────────────────────────────────────────────────────────

export const FIELD_NO_CANDIDATE_REASONS = [
  'no_own_intent',
  'no_other_intents',
  'all_gated_out',
  'no_reciprocal_overlap',
] as const

export type FieldNoCandidateReason = (typeof FIELD_NO_CANDIDATE_REASONS)[number]

/**
 * 空候选原因的**可执行**说明。
 *
 * 刻意不写"暂无数据"：那等于把四种完全不同的处境（我没提交 / 没人参与 /
 * 全被排除 / 没有双向命中）说成同一件事，用户无从知道下一步该做什么。
 */
export const FIELD_NO_CANDIDATE_LABELS: Record<FieldNoCandidateReason, string> = {
  no_own_intent:
    '你在这条任务上还没有生效中的意图 —— 没有诉求就谈不上互补，所以不会推荐任何人。先提交意图。',
  no_other_intents: '这条任务下目前只有你一条生效中的意图，还没有其他参与者。',
  all_gated_out:
    '有其他意图，但全部被硬门控排除（跨租户 / 已撤销 / 已过期 / 非参与人 / 自己）。',
  no_reciprocal_overlap:
    '过了门控，但没有一条构成双向互补 —— 需要「我的需要 ↔ 他的供给」与「他的需要 ↔ 我的供给」同时命中词元，缺一侧都不算。',
}

// ─────────────────────────────────────────────────────────────────────────────
// 镜像三：运营语义分桶（注意 `PENDING_CONSENT` ≠ `CONSENT_PENDING`）
// ─────────────────────────────────────────────────────────────────────────────

export const FIELD_BUCKETS = [
  'ALL',
  'PENDING_CONSENT',
  'READY_TO_INTRODUCE',
  'INTRODUCED',
  'CLOSED',
] as const

export type FieldBucket = (typeof FIELD_BUCKETS)[number]

/**
 * 分桶的显示文案。
 *
 * 服务端 `operations.ts` 里有一份 `BUCKET_LABELS`，但**不能引**（那个模块 import 了 `db`，
 * 会把服务端依赖拖进客户端 bundle）。因此这里镜像一份，并用测试钉住关键字面 ——
 * 这是本文件唯一无法用编译期守卫覆盖的地方（守卫只能断言取值域，断不了文案值）。
 *
 * ⚠️ 特别注意 `PENDING_CONSENT`（桶）≠ `CONSENT_PENDING`（提案状态）：词序刻意不同。
 *    前者是运营语义（"在等表态"），后者是状态机取值。
 */
export const FIELD_BUCKET_LABELS: Record<FieldBucket, string> = {
  ALL: '全部',
  PENDING_CONSENT: '待表态',
  READY_TO_INTRODUCE: '待介绍',
  INTRODUCED: '已介绍',
  CLOSED: '已结束',
}

// ─────────────────────────────────────────────────────────────────────────────
// 镜像四：提案对外状态（DB 状态 + **派生**的 `EXPIRED`，不落库）
// ─────────────────────────────────────────────────────────────────────────────

export const FIELD_PROPOSAL_STATES = [
  'CONSENT_PENDING',
  'MUTUALLY_ACCEPTED',
  'REJECTED',
  'REVOKED',
  'EXPIRED',
] as const

export type FieldProposalState = (typeof FIELD_PROPOSAL_STATES)[number]

/**
 * 提案对外状态的显示文案。
 *
 * ⚠️ 与分桶文案**不同**：服务端没有为 `ProposalState` 提供文案表（只有码），
 *    所以这一张是界面自撰的**展示层**，不构成契约。测试只把"码"当契约钉住
 *    （含"服务端派生函数的可达输出必须落在镜像内"），不把文案值当契约。
 */
export const FIELD_PROPOSAL_STATE_LABELS: Record<FieldProposalState, string> = {
  CONSENT_PENDING: '等待对方表态',
  MUTUALLY_ACCEPTED: '双方已同意',
  REJECTED: '已被拒绝',
  REVOKED: '已撤销',
  EXPIRED: '已过期',
}

// ─────────────────────────────────────────────────────────────────────────────
// 镜像五：介绍阻断原因（AC-06：能介绍 ≠ 有权限，还要求双方意图**仍然生效**）
// ─────────────────────────────────────────────────────────────────────────────

export const FIELD_INTRODUCE_BLOCKERS = [
  'already_introduced',
  'rejected',
  'revoked',
  'expired',
  'not_mutually_accepted',
  'proposer_intent_not_live',
  'candidate_intent_not_live',
] as const

export type FieldIntroduceBlocker = (typeof FIELD_INTRODUCE_BLOCKERS)[number]

export const FIELD_INTRODUCE_BLOCKER_LABELS: Record<FieldIntroduceBlocker, string> = {
  already_introduced: '已经介绍过了',
  rejected: '提案已被拒绝',
  revoked: '提案已被撤销',
  expired: '提案已过期',
  not_mutually_accepted: '双方尚未都同意',
  proposer_intent_not_live: '发起方的意图已撤销或过期',
  candidate_intent_not_live: '被介绍方的意图已撤销或过期',
}

// ─────────────────────────────────────────────────────────────────────────────
// 编译期双向等价断言（任一侧增删取值 ⇒ TS2344，`tsc` 直接失败）
// ─────────────────────────────────────────────────────────────────────────────

export type _DriftGuardGateCode = AssertTrue<Exact<FieldGateCode, GateCode>>
export type _DriftGuardNoCandidateReason = AssertTrue<Exact<FieldNoCandidateReason, NoCandidateReason>>
export type _DriftGuardBucket = AssertTrue<Exact<FieldBucket, ConnectionBucket>>
export type _DriftGuardProposalState = AssertTrue<Exact<FieldProposalState, ProposalState>>
export type _DriftGuardIntroduceBlocker = AssertTrue<Exact<FieldIntroduceBlocker, IntroductionBlocker>>

// ─────────────────────────────────────────────────────────────────────────────
// 响应形状（只做**读取侧**的窄化声明，字段名逐字抄自服务端）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `GET /api/v1/connections/candidates?missionId=` 的 `data`。
 *
 * ⚠️ 服务端是 `CandidateList`，这里**不重新声明**，直接别名 ——
 * 因为它是"结构"而不是"取值域"，结构的漂移会被 `tsc` 在**消费处**直接暴露
 * （例如有人把 `candidates` 改名，前端读 `.candidates` 会立刻报错）。
 * 真正需要独立声明的是**取值域**（上面三个枚举），因为取值域漂移不会报错。
 */
export type FieldCandidateList = CandidateList

/** 与 `FieldCandidateList` 同理：结构用别名，避免两处定义互相漂移。 */
export type FieldPipeline = OrgConnectionsResult

/** 一个来源的三种状态（`data === null && error === null` = 仍在加载）。 */
export interface FieldSourceState<T> {
  data: T | null
  error: string | null
  isLoading: boolean
}

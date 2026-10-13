/**
 * T01 · 租户角色与能力矩阵（纯逻辑，无 IO）
 *
 * 设计要点：
 *  1. **确定性**：权限判定是查表，不是推理。主指令明确要求
 *     「不得让 LLM/Agent 做最终权限判断」—— 本文件即该规则的落点。
 *  2. **零依赖**：不 import Prisma client，只用字符串字面量 union。
 *     这样既方言无关（见 DIALECT-DIFF.md §6 约束 1），也能被纯单测直接覆盖，
 *     无需起数据库。
 *  3. **默认拒绝**：未知角色 → 空能力集。
 *
 * 角色取值与 prisma/schema/tenancy.prisma 的 MembershipRole 枚举、
 * 以及 contracts/schema.sql:12 的 CHECK 约束逐字一致。
 */

/** 租户角色。必须与 `MembershipRole` 枚举 / 契约 CHECK 保持同步。 */
export type TenantRole = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER'

/** 运行时可枚举的全部角色（用于从 DB 值反查校验）。 */
export const TENANT_ROLES: readonly TenantRole[] = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER'] as const

/**
 * 租户内能力。命名规范 `<domain>.<action>`，与 REUSE_MATRIX.md C1/C7 对齐。
 */
export type TenantCapability =
  // ── 组织 ──
  | 'org.read'
  | 'org.update'
  | 'org.transfer' // 转让所有权
  | 'org.delete'
  // ── 成员 ──
  | 'member.read'
  | 'member.invite'
  | 'member.update_role'
  | 'member.remove'
  // ── Mission / Intent ──
  | 'mission.read'
  | 'mission.create'
  | 'mission.update'
  | 'mission.delete'
  | 'intent.read'
  | 'intent.manage' // 管理「自己」的意图（含他人时需 mission 级权限）
  // ── 连接提案 ──
  | 'proposal.read'
  | 'proposal.create'
  | 'proposal.decide' // 以「本人」身份接受/拒绝/撤销
  // ── 结果 ──
  | 'outcome.read'
  | 'outcome.report'
  | 'outcome.verify' // 对手方确认 / 外部核验
  // ── 计费（T08 / AC-21）──
  | 'billing.read' // 查看组织用量与限额
  | 'billing.manage' // 订阅升降级 / 退订 / 退款（**动钱**，取严）
  // ── 工作流（T06）──
  | 'workflow.read' // 查看任务队列 / 死信 / 停滞阶段（运营可见）
  | 'workflow.manage' // 人工接管 / 手动重试（管理动作，影响"消息是否出街"）
  // ── Agent（T09 / AC-08 / AC-20）──
  | 'agent.run' // 发起一次 Agent 运行（**消耗组织额度**，且 prompt 可能含他人资料 → 取严）
  | 'agent.approve' // 批准高风险产出（= 授权一次**对外可见**的副作用）
  // ── 审计 ──
  | 'audit.read'

export const TENANT_CAPABILITIES: readonly TenantCapability[] = [
  'org.read', 'org.update', 'org.transfer', 'org.delete',
  'member.read', 'member.invite', 'member.update_role', 'member.remove',
  'mission.read', 'mission.create', 'mission.update', 'mission.delete',
  'intent.read', 'intent.manage',
  'proposal.read', 'proposal.create', 'proposal.decide',
  'outcome.read', 'outcome.report', 'outcome.verify',
  'billing.read', 'billing.manage',
  'workflow.read', 'workflow.manage',
  'agent.run', 'agent.approve',
  'audit.read',
] as const

// ── 自助能力：任何 ACTIVE 成员都有（作用于「自己」的资源） ──────────────
const SELF_SERVICE: TenantCapability[] = [
  'org.read',
  'intent.read',
  'intent.manage',
  'proposal.read',
  'proposal.decide',
  'outcome.read',
  'outcome.report',
]

// ── 运营能力：OPERATOR 及以上 ────────────────────────────────────────
const OPERATOR_EXTRA: TenantCapability[] = [
  'member.read',
  'mission.read',
  'mission.create',
  'mission.update',
  'mission.delete',
  'proposal.create',
  // T06：运营需要看见"哪些通知卡住了"，但**不能**替系统决定放不放行。
  'workflow.read',
  // T08：用量与限额是**经营信息**（"额度要用完了"是运营该看见的信号），
  // 但**不含**金额明细以外的东西 —— 动钱的动作在 ADMIN_EXTRA 里。
  'billing.read',
  // T09：运行 Agent 会**消耗组织额度**（AC-20），且草稿类技能的 prompt 可能包含
  // 对手方资料（经 `discloseSubject()` 投影后）。这两条都超出"只操作自己的资源"，
  // 故与 `billing.read` 同一取向：**不**放进 SELF_SERVICE，归 OPERATOR+。
  'agent.run',
]

// ── 管理能力：ADMIN 及以上 ──────────────────────────────────────────
const ADMIN_EXTRA: TenantCapability[] = [
  'member.invite',
  'member.update_role',
  'member.remove',
  'audit.read',
  // 结果核验直接影响计费归因（T08），故归入管理员而非运营 ——
  // 保守取严，后续若要下放给 OPERATOR 需单独评审。
  'outcome.verify',
  // T06：接管/重试会决定"一条消息是否出街"，是管理动作而非日常运营 ——
  // 与 outcome.verify 同一取向：保守取严。
  'workflow.manage',
  // T08：升降级/退订/退款都**直接动钱**（AC-21）。与 outcome.verify / workflow.manage
  // 同一取向取严：归 ADMIN+。特别注意**退款**是资金外流动作，没有任何理由下放给运营。
  'billing.manage',
  // T09：批准 = 授权一次**对外可见**的副作用（发消息 / 披露资料）。
  // 🔴 关键理由不是"技术上门槛够高"，而是**第二双眼睛**：若同一个人既能触发 Agent
  // 又能批准它，AC-08「注入不得绕过审批」在**制度层**就被绕过了 ——
  // 状态机依然正确（AWAITING_APPROVAL → EXECUTED 的边依然不存在），
  // 但"人工审批"退化成了自我盖章。故归 ADMIN+，与触发权（OPERATOR+）**分离**。
  'agent.approve',
]

// ── 所有者专属 ──────────────────────────────────────────────────────
const OWNER_ONLY: TenantCapability[] = [
  'org.update',
  'org.transfer',
  'org.delete',
]

function build(...groups: TenantCapability[][]): ReadonlySet<TenantCapability> {
  return new Set(groups.flat())
}

/**
 * 角色 → 能力集。这是**唯一**的权限事实来源。
 * 修改此处即修改全租户权限模型，因此必须同步更新 tests/tenancy 的断言。
 */
export const ROLE_CAPABILITIES: Record<TenantRole, ReadonlySet<TenantCapability>> = {
  MEMBER: build(SELF_SERVICE),
  OPERATOR: build(SELF_SERVICE, OPERATOR_EXTRA),
  ADMIN: build(SELF_SERVICE, OPERATOR_EXTRA, ADMIN_EXTRA),
  OWNER: build(SELF_SERVICE, OPERATOR_EXTRA, ADMIN_EXTRA, OWNER_ONLY),
}

/** 运行时校验：把 DB 里的字符串收敛为 TenantRole（无法识别 → null，调用方按默认拒绝处理）。 */
export function parseTenantRole(value: unknown): TenantRole | null {
  if (typeof value !== 'string') return null
  return (TENANT_ROLES as readonly string[]).includes(value) ? (value as TenantRole) : null
}

/** 判定角色是否具备某项能力。未知角色 → false（默认拒绝）。 */
export function can(role: TenantRole | null | undefined, capability: TenantCapability): boolean {
  if (!role) return false
  const caps = ROLE_CAPABILITIES[role]
  if (!caps) return false
  return caps.has(capability)
}

/** 列出角色的全部能力（用于前端渲染菜单、以及测试断言）。 */
export function capabilitiesOf(role: TenantRole | null | undefined): TenantCapability[] {
  if (!role) return []
  const caps = ROLE_CAPABILITIES[role]
  return caps ? TENANT_CAPABILITIES.filter((c) => caps.has(c)) : []
}

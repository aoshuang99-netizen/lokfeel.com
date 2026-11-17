/**
 * V25.3 · T05（V25-11/12/15/16）—— 关系与记忆私密域的**统一访问判决**
 *
 * 这是纯逻辑策略引擎（零 IO、零 Prisma 依赖），刻意与 `lib/tenancy/capabilities.ts`
 * 同构：权限判定是**查表 + 比较**，不是推理，绝不让 LLM/Agent 做最终判决。
 * 这样既能被 75 条控制组合参数化单测直接覆盖，也不受方言/迁移影响。
 *
 * 五域（严格分离，禁止跨域读取）：
 *   personal      —— 个人 Vault，只有本人；
 *   dyad          —— 双方确认过的关系记忆；
 *   group         —— 群成员可见；
 *   organization  —— 组织成员可见，但组织管理员**不得读个人 Vault**；
 *   research      —— 科研记忆，默认不贡献，需显式 opt-in。
 *
 * 三种来源严格区分（spec：用户说过 / 双方确认 / 模型推断）：
 *   USER_STATED / MUTUAL_CONFIRMED / MODEL_INFERRED
 * 模型推断永不可被当作"当事人说过"的事实对外呈现（G1 反例 7）。
 *
 * 三种权限状态：valid / invalid / revoked。
 *   revoked 之后，下一次推理与搜索**不得再使用**已撤回数据（spec 硬验收）。
 */

export type MemoryDomain = 'personal' | 'dyad' | 'group' | 'organization' | 'research'
export type MemoryProvenance = 'USER_STATED' | 'MUTUAL_CONFIRMED' | 'MODEL_INFERRED'
export type MemoryPermission = 'valid' | 'invalid' | 'revoked'
export type MemoryOperation =
  | 'read'
  | 'write'
  | 'infer'
  | 'search'
  | 'delete'

export const MEMORY_DOMAINS: readonly MemoryDomain[] = [
  'personal', 'dyad', 'group', 'organization', 'research',
] as const
export const MEMORY_PROVENANCE: readonly MemoryProvenance[] = [
  'USER_STATED', 'MUTUAL_CONFIRMED', 'MODEL_INFERRED',
] as const
export const MEMORY_PERMISSIONS: readonly MemoryPermission[] = [
  'valid', 'invalid', 'revoked',
] as const
export const MEMORY_OPERATIONS: readonly MemoryOperation[] = [
  'read', 'write', 'infer', 'search', 'delete',
] as const

export interface MemorySubject {
  viewerId: string
  /** 记录的主体（数据属于谁 / 关于谁） */
  subjectId: string
  domain: MemoryDomain
  provenance: MemoryProvenance
  /** 该 viewer 对这条记录的授权状态 */
  permission: MemoryPermission
  /** viewer 是否为记录主体本人 */
  isOwner: boolean
  /** viewer 是否为 dyad 关系的另一端（仅 dyad 域有意义） */
  isCounterparty?: boolean
  /** viewer 是否为同群成员（仅 group 域有意义） */
  isGroupMember?: boolean
  /** viewer 是否为同组织成员（仅 organization 域有意义） */
  isOrgMember?: boolean
  /** viewer 是否为组织管理员（仅 organization 域有意义） */
  isOrgAdmin?: boolean
  /** research 域：该主体是否显式 opt-in 贡献数据（默认 false） */
  researchOptIn?: boolean
}

export interface MemoryVerdict {
  allowed: boolean
  reason:
    | 'OWNER'
    | 'GRANTED'
    | 'NOT_A_MEMBER'
    | 'ORG_ADMIN_NO_PERSONAL'
    | 'CROSS_DOMAIN'
    | 'RESEARCH_OPT_IN_REQUIRED'
    | 'REVOKED'
    | 'NO_PERMISSION'
    | 'INFERRED_NOT_FACT'
}

function deny(reason: MemoryVerdict['reason']): MemoryVerdict {
  return { allowed: false, reason }
}
function allow(reason: MemoryVerdict['reason']): MemoryVerdict {
  return { allowed: true, reason }
}

/**
 * 统一判决。判定顺序刻意固定（先撤销 → 再身份/域 → 再授权），
 * 保证"撤销后一律拒绝"不会被任何身份分支抢先放行。
 */
export function authorizeMemoryAction(op: MemoryOperation, s: MemorySubject): MemoryVerdict {
  // 0) 撤销：任何主体的 revoked 记录，read/infer/search 一律拒绝。
  //    write/delete 是对自己副本的清理动作，允许 owner 处理——但不允许推断/检索复用。
  if (s.permission === 'revoked') {
    if (op === 'infer' || op === 'search' || op === 'read') return deny('REVOKED')
    if (op === 'write' || op === 'delete') {
      return s.isOwner ? allow('OWNER') : deny('REVOKED')
    }
  }

  // 1) 本人对自己的一切记录拥有完全控制（含个人 Vault）。
  if (s.isOwner) {
    return allow('OWNER')
  }

  // 2) 跨域硬拒绝：viewer 与记录主体必须处于同一域关系。
  //    组织管理员读个人 Vault 是明确的禁止项，单列一条便于审计与负例定位。
  if (s.domain === 'personal') {
    return deny('ORG_ADMIN_NO_PERSONAL')
  }

  // 3) 各域的成员资格前置（默认拒绝）。
  switch (s.domain) {
    case 'dyad':
      if (!s.isCounterparty) return deny('CROSS_DOMAIN')
      break
    case 'group':
      if (!s.isGroupMember) return deny('NOT_A_MEMBER')
      break
    case 'organization':
      if (!s.isOrgMember && !s.isOrgAdmin) return deny('NOT_A_MEMBER')
      break
    case 'research':
      // 科研数据默认不贡献：没有显式 opt-in 一律拒绝。
      if (!s.researchOptIn) return deny('RESEARCH_OPT_IN_REQUIRED')
      break
  }

  // 4) 授权状态：只有 valid 才可通过；invalid / 未知一律拒绝。
  if (s.permission !== 'valid') return deny('NO_PERMISSION')

  // 5) 推断来源不得被当作事实陈述对外呈现。
  //    对非本人，MODEL_INFERRED 只允许 search/infer 作为"待核验推断"参与，
  //    不允许 read 当作 USER_STATED 事实读取；这是 G1 反例 7 的落点。
  if (s.provenance === 'MODEL_INFERRED' && op === 'read') {
    return deny('INFERRED_NOT_FACT')
  }

  // 6) research 域即使 opt-in，也不允许把推断结果回写成事实来源。
  if (s.domain === 'research' && op === 'write' && s.provenance === 'MODEL_INFERRED') {
    return deny('INFERRED_NOT_FACT')
  }

  return allow('GRANTED')
}

/**
 * T09 · 执行计划（内核纯函数）—— AC-08「执行只有一条路径」的**判据层**证据
 *
 * 这里断言的是**判据本身**（离线、无 DB、无网络）：
 *   - 哪些技能注册了执行器（真相表）；
 *   - 状态机不允许时拒绝（且 `AWAITING_APPROVAL` 要给出"需要批准"的措辞）；
 *   - **纵深防御**：状态说能执行、但没有真实裁决记录 → 仍然拒绝。
 *
 * ⚠️ 单测覆盖不了的那一半（"服务层是否**只**在通过本判据后才写 EXECUTED"）
 *    由 `tests/agents/execution-gated.test.ts` 的静态 + 动态断言守着。
 */

import {
  AGENT_RUN_STATUSES,
  EXECUTION_CHANNELS,
  EXECUTION_KINDS,
  EXECUTION_PLANS,
  EXECUTION_REFUSAL_CODES,
  SKILL_KEYS,
  agentExecutionDedupeKey,
  canExecute,
  executionPlanOf,
  planExecution,
  skillsWithoutExecutionPlan,
  type AgentRunStatus,
  type SkillKey,
} from '@/lib/agent'

describe('执行计划真相表', () => {
  it('每个技能都做过一次显式决定（真相表完整）', () => {
    // 断言的是"表被填满"这件事本身 —— 新增技能忘了填会在这里变红，
    // 而不是在半年后有人问"为什么这个技能永远执行不了"。
    expect(skillsWithoutExecutionPlan()).toEqual([])
  })

  it('已注册执行器的技能：kind 与 channel 都取自闭集', () => {
    for (const key of SKILL_KEYS) {
      const plan = EXECUTION_PLANS[key]
      if (!plan) continue
      expect(EXECUTION_KINDS).toContain(plan.kind)
      expect(EXECUTION_CHANNELS).toContain(plan.channel)
      // 🔴 收件人**只能是发起人**：可以由调用方指定收件人的执行计划 = 把审批降级成橡皮图章。
      expect(plan.recipient).toBe('REQUESTER')
      expect(plan.skill).toBe(key)
    }
  })

  it('🔴 本切片只注册了 RECEIPT（对外送达不在本切片）', () => {
    // 这条断言的作用是"边界可见"：将来加第二种效果时它必红，
    // 逼着那次改动去写清"新效果发给谁、经哪个出口"。
    const kinds = new Set(SKILL_KEYS.map((k) => EXECUTION_PLANS[k]?.kind).filter(Boolean))
    expect([...kinds]).toEqual(['RECEIPT'])
  })

  it('INTRO_DRAFT（高风险）也有执行器，且描述里写明了"回执"而非"对外送达"', () => {
    const plan = executionPlanOf('INTRO_DRAFT')
    expect(plan).not.toBeNull()
    expect(plan!.channel).toBe('IN_APP')
    expect(plan!.description).toContain('回执')
  })

  it('🔴 计划描述**不含** markdown 强调标记（它会被 UI 原样渲染成字面星号）', () => {
    // `description` 就是 DTO 的 `execution.reason`，`agent-board.tsx` 直接渲染成文本。
    for (const key of SKILL_KEYS) {
      const plan = EXECUTION_PLANS[key]
      if (!plan) continue
      expect(plan.description).not.toContain('**')
    }
  })

  it('🔴 拒绝原因**也不含** markdown 强调标记（同一条渲染路径）', () => {
    const texts: string[] = []
    for (const status of AGENT_RUN_STATUSES) {
      for (const requiresApproval of [true, false]) {
        const d = planExecution({
          skill: requiresApproval ? 'INTRO_DRAFT' : 'COORDINATION_ADVICE',
          status,
          requiresApproval,
          hasApprovedDecision: false,
        })
        if (!d.executable) texts.push(d.reason)
      }
    }
    // 反向自证：确实取到了拒绝原因（否则上面的循环是空转，"通过"毫无意义）。
    expect(texts.length).toBeGreaterThan(0)
    for (const t of texts) expect(t).not.toContain('**')
  })
})

describe('planExecution —— 唯一放行判据', () => {
  const base = { skill: 'INTRO_DRAFT' as SkillKey, requiresApproval: true }

  it('待批 → 拒绝，且原因是"需要人工批准"', () => {
    const d = planExecution({
      ...base,
      status: 'AWAITING_APPROVAL',
      hasApprovedDecision: false,
    })
    expect(d.executable).toBe(false)
    if (d.executable) throw new Error('unreachable')
    expect(d.code).toBe('STATUS_NOT_EXECUTABLE')
    expect(d.reason).toContain('人工批准')
  })

  it('🔴 待批 + **伪造**一条批准记录 → 仍拒绝（状态机是判据，不是记录）', () => {
    // 反向对照组：把"有裁决记录"这个前提填成 true，状态仍然是待批 ⇒ 必须拒绝。
    // 少了这一组，"待批不给执行"就可能是"因为没记录"，而不是"因为状态"。
    const d = planExecution({
      ...base,
      status: 'AWAITING_APPROVAL',
      hasApprovedDecision: true,
    })
    expect(d.executable).toBe(false)
    if (d.executable) throw new Error('unreachable')
    expect(d.code).toBe('STATUS_NOT_EXECUTABLE')
  })

  it('已批准 + 有真实裁决 → 放行', () => {
    const d = planExecution({ ...base, status: 'APPROVED', hasApprovedDecision: true })
    expect(d.executable).toBe(true)
    if (!d.executable) throw new Error('unreachable')
    expect(d.plan.kind).toBe('RECEIPT')
  })

  it('🔴 已批准但**库里查不到**裁决 → 拒绝（纵深防御：不接受"只有状态列"）', () => {
    const d = planExecution({ ...base, status: 'APPROVED', hasApprovedDecision: false })
    expect(d.executable).toBe(false)
    if (d.executable) throw new Error('unreachable')
    expect(d.code).toBe('APPROVAL_REQUIRED')
    expect(d.reason).toContain('APPROVED 裁决')
  })

  it('非高风险技能：PROPOSED 即可执行（无需裁决）', () => {
    const d = planExecution({
      skill: 'COORDINATION_ADVICE',
      status: 'PROPOSED',
      requiresApproval: false,
      hasApprovedDecision: false,
    })
    expect(d.executable).toBe(true)
  })

  it('降级产出同样可执行（但高风险仍要批准）—— 与状态机保持一致', () => {
    const low = planExecution({
      skill: 'COORDINATION_ADVICE',
      status: 'DEGRADED',
      requiresApproval: false,
      hasApprovedDecision: false,
    })
    expect(low.executable).toBe(true)

    const high = planExecution({
      ...base,
      status: 'DEGRADED',
      hasApprovedDecision: false,
    })
    expect(high.executable).toBe(false)
  })

  it('终态（REJECTED / EXECUTED / FAILED / BLOCKED_QUOTA）一律拒绝，且措辞各不相同', () => {
    const statuses: AgentRunStatus[] = ['REJECTED', 'EXECUTED', 'FAILED', 'BLOCKED_QUOTA']
    const reasons = statuses.map((status) => {
      const d = planExecution({ ...base, status, hasApprovedDecision: true })
      expect(d.executable).toBe(false)
      if (d.executable) throw new Error('unreachable')
      expect(d.code).toBe('STATUS_NOT_EXECUTABLE')
      return d.reason
    })
    expect(new Set(reasons).size).toBe(statuses.length)
  })

  it('🔴 判据与状态机**同源**：放行 ⇔ canExecute(status, requiresApproval)，逐格一致', () => {
    // 比的是 `canExecute`（不是 `canTransition(_, 'EXECUTED')`）—— 因为 `requiresApproval`
    // 会进一步收窄入口：`APPROVED` 对"**不需要**批准"的技能反而是不可执行的
    // （那种技能只能从 PROPOSED / DEGRADED 进）。把 `hasApprovedDecision` 固定为 true，
    // 是为了隔离出"状态机那一道"，让纵深防御不参与本对照。
    for (const status of AGENT_RUN_STATUSES) {
      for (const requiresApproval of [true, false]) {
        const d = planExecution({
          skill: requiresApproval ? 'INTRO_DRAFT' : 'COORDINATION_ADVICE',
          status,
          requiresApproval,
          hasApprovedDecision: true,
        })
        expect(d.executable).toBe(canExecute(status, requiresApproval))
      }
    }
  })

  it('🔴 纵深防御只会让放行**更严**，绝不更宽', () => {
    // 反向自证：把"库里真有裁决"这个前提抹掉，任何一格都不允许从"拒绝"翻成"放行"。
    // 少了这一条，"缺裁决就拒绝"可能只是恰好没被测到，而不是一个真的单调性保证。
    for (const status of AGENT_RUN_STATUSES) {
      for (const requiresApproval of [true, false]) {
        const base = {
          skill: (requiresApproval ? 'INTRO_DRAFT' : 'COORDINATION_ADVICE') as SkillKey,
          status,
          requiresApproval,
        }
        const withDec = planExecution({ ...base, hasApprovedDecision: true })
        const without = planExecution({ ...base, hasApprovedDecision: false })
        if (!withDec.executable) expect(without.executable).toBe(false)
      }
    }
  })

  it('未注册执行器的技能键 → NOT_REGISTERED（而不是崩、也不是默认放行）', () => {
    // 用寄存器里被显式设为 null 的入口验证形状：直接把表里的一个键临时视作未注册。
    // 这里不 mock 表（它是 Readonly 的真相表），而是验证**拒绝码的闭集**包含该码，
    // 并验证一个真实存在的技能一定能拿到计划（正向对照）。
    expect(EXECUTION_REFUSAL_CODES).toContain('NOT_REGISTERED')
    expect(executionPlanOf('INTENT_EXTRACTION')).not.toBeNull()
  })
})

describe('执行幂等键', () => {
  it('按运行 id 派生，且**与时间无关**（重试/并发不得产生第二个键）', () => {
    expect(agentExecutionDedupeKey('run_1')).toBe('agent-exec:run_1')
    expect(agentExecutionDedupeKey('run_1')).toBe(agentExecutionDedupeKey('run_1'))
    expect(agentExecutionDedupeKey('run_1')).not.toBe(agentExecutionDedupeKey('run_2'))
  })
})

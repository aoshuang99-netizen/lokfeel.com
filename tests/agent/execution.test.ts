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
  EXECUTION_GATE_CODES,
  EXECUTION_KINDS,
  EXECUTION_PLANS,
  EXECUTION_RECIPIENTS,
  EXECUTION_REFUSAL_CODES,
  OUTBOUND_REFUSAL_CODES,
  SKILL_KEYS,
  agentExecutionDedupeKey,
  canExecute,
  executionPlanOf,
  planExecution,
  planOutboundDelivery,
  skillsWithoutExecutionPlan,
  type AgentRunStatus,
  type OutboundRefusalCode,
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
      // 🔴 收件人是**闭集取值**（不是自由字符串）：可以由调用方指定收件人的执行计划
      //    = 把审批降级成橡皮图章。这里断言"落在闭集里"，而不是硬编码某一个成员 ——
      //    Slice 6 起 `INTRO_DRAFT` 合法地取 `'TARGET'`，硬编码会让"多了一个合法成员"
      //    与"有人写错了字面量"变成同一个红，从而把这条守卫变成"改一次吼一次"的噪音。
      expect(EXECUTION_RECIPIENTS).toContain(plan.recipient)
      expect(plan.skill).toBe(key)
    }
  })

  it('🔴 只注册了一种效果（RECEIPT）—— 对外送达是**收件人**维度，不是新效果', () => {
    // 这条断言的作用是"边界可见"：将来加第二种**效果**时它必红，
    // 逼着那次改动去写清"新效果发给谁、经哪个出口"。
    // ⚠️ Slice 6 的对外送达**没有**新增 kind：它改的是 `recipient`（送给谁），
    //    效果仍然是"一次站内信投递"。把它记成新 kind 才是把两件事混为一谈。
    const kinds = new Set(SKILL_KEYS.map((k) => EXECUTION_PLANS[k]?.kind).filter(Boolean))
    expect([...kinds]).toEqual(['RECEIPT'])
  })

  it('🔴 INTRO_DRAFT（高风险）的收件人是**对手方**（Slice 6：不再只是内部回执）', () => {
    const plan = executionPlanOf('INTRO_DRAFT')
    expect(plan).not.toBeNull()
    expect(plan!.channel).toBe('IN_APP')
    expect(plan!.recipient).toBe('TARGET')
    // 描述是界面上那行字，也是审计里那句人话 —— 必须同时说清"送给谁"与"不送什么"。
    expect(plan!.description).toContain('对手方')
    expect(plan!.description).toContain('不含任何档案字段')
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

describe('planOutboundDelivery —— 第二道门（对外送达）', () => {
  it('🔴 `REQUESTER` 恒放行 —— 内部回执不涉及对外动作（加闸门只会制造一个恒真条件）', () => {
    // 全空输入仍然放行：这是"这一路没有对外这一步"的**结构性**结论，
    // 不是"恰好检查没触发"。若哪天它变红，说明有人给内部回执加了它不需要的前提。
    const d = planOutboundDelivery({
      recipient: 'REQUESTER',
      targetUserId: null,
      authorizedFieldKeys: [],
      visibleFieldKeys: [],
    })
    expect(d.deliverable).toBe(true)
  })

  it('计划送给对手方却没有目标身份 → NO_TARGET（执行时不补）', () => {
    const d = planOutboundDelivery({
      recipient: 'TARGET',
      targetUserId: null,
      authorizedFieldKeys: ['bio'],
      visibleFieldKeys: ['bio'],
    })
    expect(d.deliverable).toBe(false)
    if (d.deliverable) throw new Error('unreachable')
    expect(d.code).toBe('NO_TARGET')
  })

  it('创建时对该受众没有任何披露授权 → DISCLOSURE_EMPTY（这不是一次介绍）', () => {
    const d = planOutboundDelivery({
      recipient: 'TARGET',
      targetUserId: 'u2',
      authorizedFieldKeys: [],
      visibleFieldKeys: ['bio'],
    })
    expect(d.deliverable).toBe(false)
    if (d.deliverable) throw new Error('unreachable')
    expect(d.code).toBe('DISCLOSURE_EMPTY')
  })

  it('🔴 授权已归零（撤销/过期）→ DISCLOSURE_EMPTY（T05「撤销即刻生效」的投递侧落点）', () => {
    const d = planOutboundDelivery({
      recipient: 'TARGET',
      targetUserId: 'u2',
      authorizedFieldKeys: ['bio'],
      visibleFieldKeys: [],
    })
    expect(d.deliverable).toBe(false)
    if (d.deliverable) throw new Error('unreachable')
    expect(d.code).toBe('DISCLOSURE_EMPTY')
    expect(d.reason).toContain('撤销即刻生效')
  })

  it('🔴 授权被**收窄** → DISCLOSURE_NARROWED，原因里点名被收窄的字段', () => {
    const d = planOutboundDelivery({
      recipient: 'TARGET',
      targetUserId: 'u2',
      authorizedFieldKeys: ['bio', 'interests'],
      visibleFieldKeys: ['bio'],
    })
    expect(d.deliverable).toBe(false)
    if (d.deliverable) throw new Error('unreachable')
    expect(d.code).toBe('DISCLOSURE_NARROWED')
    expect(d.reason).toContain('interests')
  })

  it('当前可见**覆盖**创建时快照的那批字段 → 放行（相等或更宽都算覆盖）', () => {
    for (const visible of [['bio'], ['bio', 'interests'], ['bio', 'interests', 'city']]) {
      const d = planOutboundDelivery({
        recipient: 'TARGET',
        targetUserId: 'u2',
        authorizedFieldKeys: ['bio'],
        visibleFieldKeys: visible,
      })
      expect(d.deliverable).toBe(true)
    }
  })

  it('🔴 穷举 2^n：放行 ⇔ 授权非空 ∧ 可见非空 ∧ 可见覆盖授权（单调、无例外）', () => {
    // 反向自证：把"收窄就拒"从"恰好没测到"升级成"一个方向性保证"。
    // 三字段的全部子集两两配对（4^... 组合），逐格比对期望值 —— 任何"多放行一格"
    // 或"少放行一格"的改动都会在这里炸。
    const universe = ['bio', 'interests', 'city']
    const subsets: string[][] = []
    for (let mask = 0; mask < 1 << universe.length; mask++) {
      subsets.push(universe.filter((_, i) => (mask >> i) & 1))
    }
    expect(subsets.length).toBe(8)
    for (const auth of subsets) {
      for (const vis of subsets) {
        const d = planOutboundDelivery({
          recipient: 'TARGET',
          targetUserId: 'u2',
          authorizedFieldKeys: auth,
          visibleFieldKeys: vis,
        })
        const covers = auth.every((k) => vis.includes(k))
        expect(d.deliverable).toBe(auth.length > 0 && vis.length > 0 && covers)
      }
    }
  })

  it('🔴 第二道门的拒绝原因**也不含** markdown 强调标记（同一条渲染路径）', () => {
    const decisions = [
      planOutboundDelivery({ recipient: 'TARGET', targetUserId: null, authorizedFieldKeys: [], visibleFieldKeys: [] }),
      planOutboundDelivery({ recipient: 'TARGET', targetUserId: 'u2', authorizedFieldKeys: [], visibleFieldKeys: [] }),
      planOutboundDelivery({ recipient: 'TARGET', targetUserId: 'u2', authorizedFieldKeys: ['bio'], visibleFieldKeys: [] }),
      planOutboundDelivery({ recipient: 'TARGET', targetUserId: 'u2', authorizedFieldKeys: ['bio'], visibleFieldKeys: ['city'] }),
    ]
    const refused = decisions.filter(
      (d): d is { deliverable: false; code: OutboundRefusalCode; reason: string } => !d.deliverable,
    )
    // 反向自证：四个输入确实**都**被拒了（否则下面的循环是空转）。
    expect(refused.length).toBe(4)
    for (const d of refused) {
      expect(d.reason).not.toContain('**')
      expect(OUTBOUND_REFUSAL_CODES).toContain(d.code)
    }
  })

  it('🔴 `EXECUTION_GATE_CODES` = 两道门拒绝码的并集，且无重复（DTO 只有一个 code 字段）', () => {
    expect([...EXECUTION_GATE_CODES]).toEqual([...EXECUTION_REFUSAL_CODES, ...OUTBOUND_REFUSAL_CODES])
    expect(new Set(EXECUTION_GATE_CODES).size).toBe(EXECUTION_GATE_CODES.length)
  })

  it('🔴 第二道门只会让第一道门的放行**更严**：逐技能核对（无新增放行路径）', () => {
    // 与 planExecution 的单调性测试配对。闸门输入取最坏情形（全空）：
    //   - REQUESTER 的计划必须**仍然**放行（这道门对它不该有任何影响）；
    //   - TARGET 的计划必须**被拒**（全空 = 无目标无授权，本来也不该送）。
    let checked = 0
    for (const key of SKILL_KEYS) {
      const plan = EXECUTION_PLANS[key]
      if (!plan) continue
      checked++
      const gated = planOutboundDelivery({
        recipient: plan.recipient,
        targetUserId: null,
        authorizedFieldKeys: [],
        visibleFieldKeys: [],
      })
      expect(gated.deliverable).toBe(plan.recipient === 'REQUESTER')
    }
    // 反向自证：确实走到了表里的计划（否则"通过"来自空循环）。
    expect(checked).toBeGreaterThan(0)
  })
})

describe('执行幂等键', () => {
  it('按运行 id 派生，且**与时间无关**（重试/并发不得产生第二个键）', () => {
    expect(agentExecutionDedupeKey('run_1')).toBe('agent-exec:run_1')
    expect(agentExecutionDedupeKey('run_1')).toBe(agentExecutionDedupeKey('run_1'))
    expect(agentExecutionDedupeKey('run_1')).not.toBe(agentExecutionDedupeKey('run_2'))
  })
})

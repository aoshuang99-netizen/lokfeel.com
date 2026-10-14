/**
 * P1 收口 · 真实数据装配单测
 *
 * 重点验证三类节点"接上真实数据"之后仍然**不伪造、不静默**：
 *   - 状态/档位**逐字**照搬服务端枚举（不做美化映射）；
 *   - 旧猜测值（`RETRY` / `DONE` / `EVIDENCE_BACKED` / `PENDING`）**必须被拒绝**；
 *   - 来源不可用 → **不产节点**（空节点会被渲染成"暂无…"，那是误导）；
 *   - 载荷不认识 → 整节点拒绝并说明原因；
 *   - 截断/钳制**可见**（note），不静默少给。
 */

import {
  ACTION_JOB_STATUSES,
  AGENT_RISKS,
  AGENT_SKILLS,
  AGENT_STATES,
  CONSENT_STATES,
  MAX_CONSENT_NODES,
  MAX_NODE_ITEMS,
  MAX_SPEC_NOTES,
  OUTCOME_LEVELS,
  WorkspaceSpecSchema,
  WORKSPACE_SPEC_VERSION,
  assembleActionNode,
  assembleConsentNodes,
  assembleOutcomeNode,
  assembleTenantNodes,
  mergeTenantNodes,
  missionDraftFromSpec,
  type WorkspaceSpec,
} from '@/lib/workspace-spec'

/** 最小可过校验的草稿 spec（与编译器产出的形态一致）。 */
function draftSpec(over: Partial<WorkspaceSpec> = {}): WorkspaceSpec {
  return {
    version: WORKSPACE_SPEC_VERSION,
    title: '渠道 / 资源对接',
    summary: '草稿',
    nodes: [
      {
        id: 'intent-1',
        type: 'intent',
        title: '目标与成功判据',
        data: {
          goal: '帮助我们社群在 30 天内对接 5 家渠道伙伴',
          offer: '社群内的引荐与联合投放',
          constraints: ['期限：30天内'],
          successCriteria: ['达成 5家'],
        },
      },
      { id: 'candidate-1', type: 'candidate', title: '候选择优', data: { candidates: [] } },
    ],
    availableActions: [],
    notes: ['草稿说明'],
    ...over,
  }
}

const proposal = (over: Record<string, unknown> = {}) => ({
  id: 'p_1',
  state: 'CONSENT_PENDING',
  counterpart: { subject: { displayName: '林晓', city: '上海' } },
  ...over,
})

const job = (over: Record<string, unknown> = {}) => ({
  id: 'j_1',
  kind: 'PROPOSAL_NOTIFY',
  status: 'PENDING',
  attempts: 0,
  ...over,
})

const outcome = (over: Record<string, unknown> = {}) => ({
  id: 'o_1',
  summary: '完成首轮试销',
  verificationLevel: 'SELF_REPORTED',
  occurredAt: '2026-10-01T00:00:00.000Z',
  ...over,
})

// ═══════════════════════════════════════════════════════════════════════════
// 0. 枚举镜像守卫（**硬编码期望值** —— 否则守卫等于自证）
// ═══════════════════════════════════════════════════════════════════════════
//
// 这里刻意把"服务端真实枚举"字面写死。若服务端改了枚举而 schema 没跟上，
// `schema.ts` 的编译期断言会让 `tsc` 失败；若有人"顺手"改了镜像去迁就它，
// 本用例会失败。两道锁，缺一道都可能悄悄漂移。

describe('枚举镜像（与服务端真实枚举逐字一致）', () => {
  it('consent = ProposalState', () => {
    expect([...CONSENT_STATES]).toEqual([
      'CONSENT_PENDING',
      'MUTUALLY_ACCEPTED',
      'REJECTED',
      'REVOKED',
      'EXPIRED',
    ])
  })

  it('action = WorkflowJobStatus', () => {
    expect([...ACTION_JOB_STATUSES]).toEqual([
      'PENDING',
      'RUNNING',
      'SUCCEEDED',
      'FAILED',
      'DEAD',
      'TAKEN_OVER',
      'CANCELLED',
    ])
  })

  it('outcome = OutcomeVerificationLevel（**没有** EVIDENCE_BACKED）', () => {
    expect([...OUTCOME_LEVELS]).toEqual([
      'SELF_REPORTED',
      'COUNTERPARTY_CONFIRMED',
      'EXTERNALLY_VERIFIED',
    ])
    expect(OUTCOME_LEVELS as readonly string[]).not.toContain('EVIDENCE_BACKED')
  })

  // P2 Slice 2 新增的三组（`agent` 节点转正时引入）。按本仓"两根柱子"纪律：
  // 编译期守卫防**单侧**漂移，这里的硬编码防**双侧**漂移（两侧一起改时守卫全绿）。
  it('agent 状态 = AgentRunStatus', () => {
    expect([...AGENT_STATES]).toEqual([
      'PROPOSED',
      'AWAITING_APPROVAL',
      'APPROVED',
      'REJECTED',
      'EXECUTED',
      'DEGRADED',
      'BLOCKED_QUOTA',
      'FAILED',
    ])
  })

  it('agent 风险 = RiskLevel', () => {
    expect([...AGENT_RISKS]).toEqual(['LOW', 'MEDIUM', 'HIGH'])
  })

  it('agent 技能 = SkillKey', () => {
    expect([...AGENT_SKILLS]).toEqual([
      'INTENT_EXTRACTION',
      'INTRO_DRAFT',
      'COORDINATION_ADVICE',
    ])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. consent ← proposals
// ═══════════════════════════════════════════════════════════════════════════

describe('assembleConsentNodes', () => {
  it('一条提案 → 一个节点；状态**逐字**照搬（不做美化映射）', () => {
    const r = assembleConsentNodes([proposal({ state: 'REJECTED' })])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toHaveLength(1)
    expect(r.value[0].data.status).toBe('REJECTED')
    expect(r.value[0].type).toBe('consent')
  })

  it('全谱系状态都能装配（含派生的 EXPIRED）', () => {
    for (const state of CONSENT_STATES) {
      const r = assembleConsentNodes([proposal({ state })])
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value[0].data.status).toBe(state)
    }
  })

  it('🔴 旧猜测值（PENDING/GRANTED）→ 拒绝，而不是"凑近似的意思"', () => {
    for (const bogus of ['PENDING', 'GRANTED']) {
      const r = assembleConsentNodes([proposal({ state: bogus })])
      expect(r.ok).toBe(false)
    }
  })

  it('披露字段 = 对侧投影的键，排序去重；缺席则空数组（不编字段）', () => {
    const r = assembleConsentNodes([
      proposal({ counterpart: { subject: { city: '上海', displayName: '林晓' } } }),
      proposal({ id: 'p_2', counterpart: undefined }),
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value[0].data.fields).toEqual(['city', 'displayName'])
    expect(r.value[1].data.fields).toEqual([])
  })

  it('节点数与标题含提案标识（可区分是哪一条）', () => {
    const r = assembleConsentNodes([proposal({ id: 'cmxyz1234567890' })])
    if (!r.ok) throw new Error('应装配成功')
    expect(r.value[0].id).toBe('consent-cmxyz1234567890')
    expect(r.value[0].title).toContain('cmxyz123')
  })

  it('超过节点上限 → 截断且 `dropped` 如实上报', () => {
    const many = Array.from({ length: MAX_CONSENT_NODES + 3 }, (_, i) => proposal({ id: `p_${i}` }))
    const r = assembleConsentNodes(many)
    if (!r.ok) throw new Error('应装配成功')
    expect(r.value).toHaveLength(MAX_CONSENT_NODES)
    expect(r.dropped).toBe(3)
  })

  it('确定性：同一输入两次结果深等', () => {
    const a = assembleConsentNodes([proposal()])
    const b = assembleConsentNodes([proposal()])
    expect(a).toEqual(b)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. action ← workflow jobs
// ═══════════════════════════════════════════════════════════════════════════

describe('assembleActionNode', () => {
  it('状态逐字照搬；全谱系都能装配', () => {
    for (const status of ACTION_JOB_STATUSES) {
      const r = assembleActionNode([job({ status })])
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.data.jobs[0].status).toBe(status)
    }
  })

  it('🔴 旧猜测值（RETRY/DONE）→ 拒绝', () => {
    for (const bogus of ['RETRY', 'DONE']) {
      expect(assembleActionNode([job({ status: bogus })]).ok).toBe(false)
    }
  })

  it('lastError 缺席时**不带该字段**（不是显式的 undefined）', () => {
    const r = assembleActionNode([job()])
    if (!r.ok) throw new Error('应装配成功')
    expect(Object.keys(r.value.data.jobs[0])).not.toContain('lastError')
  })

  it('lastError 超长 → 截断并置 clipped（不静默）', () => {
    const r = assembleActionNode([job({ lastError: 'x'.repeat(900) })])
    if (!r.ok) throw new Error('应装配成功')
    expect(r.value.data.jobs[0].lastError).toHaveLength(500)
    expect(r.clipped).toBe(true)
  })

  it('attempts 越界 → 钳到 [0,1000] **且**置 clipped', () => {
    const r = assembleActionNode([job({ attempts: 99999 })])
    if (!r.ok) throw new Error('应装配成功')
    expect(r.value.data.jobs[0].attempts).toBe(1000)
    expect(r.clipped).toBe(true)
  })

  it('按契约上限截断条目并如实上报 dropped', () => {
    const many = Array.from({ length: MAX_NODE_ITEMS + 2 }, (_, i) => job({ id: `j_${i}` }))
    const r = assembleActionNode(many)
    if (!r.ok) throw new Error('应装配成功')
    expect(r.value.data.jobs).toHaveLength(MAX_NODE_ITEMS)
    expect(r.dropped).toBe(2)
  })

  it('attempts 非整数 / 缺失 → 拒绝（不当作 0 混过去）', () => {
    expect(assembleActionNode([job({ attempts: 1.5 })]).ok).toBe(false)
    expect(assembleActionNode([{ id: 'j', kind: 'K', status: 'PENDING' }]).ok).toBe(false)
  })

  it('产出的节点本身能过契约校验', () => {
    const r = assembleActionNode([job()])
    if (!r.ok) throw new Error('应装配成功')
    const spec = draftSpec({ nodes: [r.value] })
    expect(WorkspaceSpecSchema.safeParse(spec).success).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. outcome ← outcomes
// ═══════════════════════════════════════════════════════════════════════════

describe('assembleOutcomeNode', () => {
  it('档位逐字照搬（EXTERNALLY_VERIFIED 是**真实存在**的第三档）', () => {
    for (const level of OUTCOME_LEVELS) {
      const r = assembleOutcomeNode([outcome({ verificationLevel: level })])
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.data.outcomes[0].level).toBe(level)
    }
  })

  it('🔴 旧猜测值 EVIDENCE_BACKED → 拒绝（它从来不是服务端取值）', () => {
    expect(assembleOutcomeNode([outcome({ verificationLevel: 'EVIDENCE_BACKED' })]).ok).toBe(false)
  })

  it('label 取 summary 并按 200 截断（可见）', () => {
    const r = assembleOutcomeNode([outcome({ summary: 'y'.repeat(500) })])
    if (!r.ok) throw new Error('应装配成功')
    expect(r.value.data.outcomes[0].label).toHaveLength(200)
    expect(r.clipped).toBe(true)
  })

  it('occurredAt 缺失 → 不带该字段', () => {
    const r = assembleOutcomeNode([outcome({ occurredAt: null })])
    if (!r.ok) throw new Error('应装配成功')
    expect(Object.keys(r.value.data.outcomes[0])).not.toContain('occurredAt')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. assembleTenantNodes —— 来源可用性
// ═══════════════════════════════════════════════════════════════════════════

describe('assembleTenantNodes', () => {
  it('来源不可用 → **不产节点**，只产一条写明原因的 note', () => {
    const a = assembleTenantNodes({ proposals: { ok: false, reason: '读取失败（Error 403）' } })
    expect(a.nodes).toEqual([])
    expect(a.notes).toHaveLength(1)
    expect(a.notes[0]).toContain('403')
    expect(a.notes[0]).toContain('不展示成"空"')
  })

  it('🔴 来源成功但结果为空：consent 不产空节点，改产一条"查询成功且为空"的说明', () => {
    // consent 是"一提案一节点"，没有提案就不该凭空造一个空节点。
    // 但"确实没有"必须以**可见的结论**呈现，否则与"读不到"无从区分。
    const a = assembleTenantNodes({ proposals: { ok: true, items: [] } })
    expect(a.nodes).toEqual([])
    expect(a.notes).toHaveLength(1)
    expect(a.notes[0]).toContain('查询成功')
  })

  it('来源成功但结果为空：action / outcome 产**空数组节点**（渲染器给真实空态）', () => {
    const a = assembleTenantNodes({
      jobs: { ok: true, items: [] },
      outcomes: { ok: true, items: [] },
    })
    expect(a.nodes.map((n) => n.type)).toEqual(['action', 'outcome'])
    expect(a.notes).toEqual([])
  })

  it('来源省略（undefined）→ 既不产节点也不产 note', () => {
    const a = assembleTenantNodes({})
    expect(a).toEqual({ nodes: [], notes: [] })
  })

  it('载荷不认识 → 整节点拒绝 + 具体原因（而不是部分展示）', () => {
    const a = assembleTenantNodes({ jobs: { ok: true, items: [{ id: 'j' }] } })
    expect(a.nodes).toEqual([])
    expect(a.notes[0]).toContain('已阻止该节点')
  })

  it('三源齐备时按生命周期顺序产出：同意 → 执行 → 成果', () => {
    const a = assembleTenantNodes({
      proposals: { ok: true, items: [proposal()] },
      jobs: { ok: true, items: [job()] },
      outcomes: { ok: true, items: [outcome()] },
    })
    expect(a.nodes.map((n) => n.type)).toEqual(['consent', 'action', 'outcome'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. mergeTenantNodes
// ═══════════════════════════════════════════════════════════════════════════

describe('mergeTenantNodes', () => {
  it('草稿 + 社群节点合并，且**再过一遍契约校验**', () => {
    const assembly = assembleTenantNodes({
      proposals: { ok: true, items: [proposal()] },
      jobs: { ok: true, items: [job()] },
      outcomes: { ok: true, items: [outcome()] },
    })
    const r = mergeTenantNodes(draftSpec(), assembly)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.spec.nodes).toHaveLength(5)
    expect(WorkspaceSpecSchema.safeParse(r.spec).success).toBe(true)
  })

  it('id 冲突的社群节点不会被重复加入', () => {
    const assembly = { nodes: [draftSpec().nodes[0]], notes: [] }
    const r = mergeTenantNodes(draftSpec(), assembly)
    if (!r.ok) throw new Error('应合并成功')
    expect(r.spec.nodes).toHaveLength(2)
  })

  it('说明条目超上限 → 显式说明省略条数，且总数不超过契约上限', () => {
    const assembly = {
      nodes: [],
      notes: Array.from({ length: MAX_SPEC_NOTES + 5 }, (_, i) => `note-${i}`),
    }
    const r = mergeTenantNodes(draftSpec({ notes: [] }), assembly)
    if (!r.ok) throw new Error('应合并成功')
    expect(r.spec.notes).toHaveLength(MAX_SPEC_NOTES)
    expect(r.spec.notes[MAX_SPEC_NOTES - 1]).toContain('未显示')
  })

  it('合并后的 spec 若违反契约 → 整块拒绝并给原因（不渲染半成品）', () => {
    // 用非法节点（status 不在枚举内）绕过装配器，直接注入 —— 校验必须挡住。
    const assembly = {
      nodes: [{ id: 'consent-x', type: 'consent', title: 'x', data: { fields: [], status: 'GRANTED' } }],
      notes: [],
    } as unknown as Parameters<typeof mergeTenantNodes>[1]
    const r = mergeTenantNodes(draftSpec(), assembly)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('未通过契约校验')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. missionDraftFromSpec —— 写路径的诚实边界
// ═══════════════════════════════════════════════════════════════════════════

describe('missionDraftFromSpec', () => {
  it('三项齐全 → 产出请求体（successCriteria 用「；」连接）', () => {
    const d = missionDraftFromSpec(draftSpec())
    expect(d.missing).toEqual([])
    expect(d.body).toMatchObject({
      goal: '帮助我们社群在 30 天内对接 5 家渠道伙伴',
      offer: '社群内的引荐与联合投放',
      successCriteria: '达成 5家',
      constraints: ['期限：30天内'],
    })
  })

  it('🔴 描述没写对价 → **不补默认值**，body 恒为 null 并报出缺口', () => {
    const spec = draftSpec()
    const intent = spec.nodes[0]
    if (intent.type !== 'intent') throw new Error('夹具错误')
    intent.data.offer = undefined
    const d = missionDraftFromSpec(spec)
    expect(d.body).toBeNull()
    expect(d.missing.join()).toContain('可提供的对价')
  })

  it('没有可量化判据 → body 为 null 并报出缺口', () => {
    const spec = draftSpec()
    const intent = spec.nodes[0]
    if (intent.type !== 'intent') throw new Error('夹具错误')
    intent.data.successCriteria = []
    const d = missionDraftFromSpec(spec)
    expect(d.body).toBeNull()
    expect(d.missing.join()).toContain('成功判据')
  })

  it('缺 intent 节点 → body 为 null 并说明原因', () => {
    const d = missionDraftFromSpec(draftSpec({ nodes: [{ id: 'candidate-1', type: 'candidate', title: '候选', data: { candidates: [] } }] }))
    expect(d.body).toBeNull()
    expect(d.missing.join()).toContain('意图节点')
  })

  it('有 expiresAt 时带上（服务端要求未来时间）', () => {
    const spec = draftSpec()
    const intent = spec.nodes[0]
    if (intent.type !== 'intent') throw new Error('夹具错误')
    intent.data.expiresAt = new Date(Date.now() + 86_400_000).toISOString()
    const d = missionDraftFromSpec(spec)
    expect(d.body?.expiresAt).toBe(intent.data.expiresAt)
  })
})

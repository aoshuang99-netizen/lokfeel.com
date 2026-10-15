/**
 * P2 · Agent 区 —— 运行面板与用量**装配器**单测
 * （`src/lib/living/agents/board.ts`）
 *
 * 六条纪律逐条钉死：
 *   1. 零 IO / 确定性；
 *   2. **状态机不在前端重写**：装配器不产 `canApprove` 这类前端判据
 *      （本文件用 `Object.keys` 反向自证：行上没有这类字段）；
 *   3. `execution.reason` 原样展示（"点了批准到底会发生什么"的唯一答案）；
 *   4. `provider` 诚实块原样展示（"花 0 分" ≠ "模型免费"）；
 *   5. 不展示 `rawText`，也不展示**列表里根本无从得知**的注入信号条数；
 *   6. 顺序确定（createdAt 降序、同刻 id 升序），且"需要关注"只打标记**不重排**。
 *
 * 另外钉住金额读数的**唯一一处本地表述**：近零显示 `0 分`（见 `formatMicroCents` 注释），
 * 其余一律复用纯内核 `@/lib/agent/cost` 的换算 —— 因此这里可以直接与内核逐值比对。
 */

import { MICRO_CENTS_PER_CENT, formatMicroCents as coreFormatMicroCents } from '@/lib/agent/cost'
import {
  agentDecisionRequest,
  assembleAgentBoard,
  assembleAgentUsage,
  formatMicroCents,
  type LivingAgentBoardModel,
  type LivingAgentUsageModel,
} from '@/lib/living/agents'

// ─────────────────────────────────────────────────────────────────────────────
// 夹具：形状逐字对齐服务端 `AgentRunSummaryDto` / `AgentUsageDto`
// ─────────────────────────────────────────────────────────────────────────────

const executionReason = '该运行已被驳回，不会被交付'

const run = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'run-1',
  skill: 'INTENT_EXTRACTION',
  status: 'PROPOSED',
  risk: 'LOW',
  requiresApproval: false,
  requestedBy: 'user-1',
  subjectLabel: null,
  goal: '把目标文本抽取为结构化规格',
  reason: null,
  degradeCode: null,
  providerKind: 'rules',
  injectionFlagged: false,
  costMicroCents: 0,
  approval: null,
  execution: { available: false, reason: executionReason },
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  callCount: 0,
  ...over,
})

const runsPayload = (items: Record<string, unknown>[], over: Record<string, unknown> = {}) => ({
  items,
  count: items.length,
  filters: { status: null, skill: null, limit: 50 },
  ...over,
})

const usagePayload = (over: Record<string, unknown> = {}): Record<string, unknown> => {
  const base = {
    periodKey: '2026-10',
    totals: {
      calls: 3,
      okCalls: 2,
      failedCalls: 1,
      highCostCalls: 1,
      inputTokens: 1200,
      outputTokens: 300,
      microCents: 0,
    },
    bySkill: [
      { skill: 'INTRO_DRAFT', calls: 1, microCents: 0 },
      { skill: 'INTENT_EXTRACTION', calls: 2, microCents: 0 },
    ],
    runs: { total: 4, byStatus: { PROPOSED: 2, FAILED: 1, AWAITING_APPROVAL: 1 } },
    quota: {
      maxMicroCents: 500 * MICRO_CENTS_PER_CENT,
      maxHighCostCalls: 20,
      usedMicroCents: 0,
      remainingMicroCents: 500 * MICRO_CENTS_PER_CENT,
      highCostCalls: 0,
    },
    assumptions: {
      quota: '占位假设：真实部署须按供应商报价注入',
      price: { inputMicroCentsPerK: 15_000, outputMicroCentsPerK: 60_000 },
      period: '按自然月',
    },
    provider: { provider: 'rules', realCallsEnabled: false, reason: '缺少 OPENAI_API_KEY' },
  }
  return { ...base, ...over }
}

function boardOf(payload: unknown): LivingAgentBoardModel {
  const r = assembleAgentBoard(payload)
  if (!r.ok) throw new Error(`预期装配成功，实际失败：${r.error}`)
  return r.value
}

function usageOf(payload: unknown): LivingAgentUsageModel {
  const r = assembleAgentUsage(payload)
  if (!r.ok) throw new Error(`预期装配成功，实际失败：${r.error}`)
  return r.value
}

const notesOf = (m: { notes: string[] }) => m.notes.join('\n')

// ─────────────────────────────────────────────────────────────────────────────

describe('金额读数：复用纯内核，只有"近零"是本地表述', () => {
  it('四舍五入到 0.0000 时显示 `0 分`（|micro| < 50 恰好等价于内核输出 0.0000）', () => {
    expect(formatMicroCents(0)).toBe('0 分')
    expect(formatMicroCents(1)).toBe('0 分')
    expect(formatMicroCents(49)).toBe('0 分')
    expect(formatMicroCents(-49)).toBe('0 分')
    // 边界另一侧：内核会给 0.0001，本地不再改写
    expect(coreFormatMicroCents(50)).toBe('0.0001 分')
    expect(formatMicroCents(50)).toBe('0.0001 分')
  })

  it('除此之外**逐值等于**内核（不重写算术 ⇒ 没有第二个真相来源）', () => {
    const values = [
      50, 1_234, 15_000, 999_999, 1_000_000, 1_234_567, -1_234_567, 500 * MICRO_CENTS_PER_CENT,
    ]
    for (const v of values) {
      expect(formatMicroCents(v)).toBe(coreFormatMicroCents(v))
    }
  })

  it('进位边界不被漏算（`999_999` 微分 = 0.999999 分 → 1.0000 分，不是 0.10000 分）', () => {
    expect(formatMicroCents(999_999)).toBe('1.0000 分')
  })

  it('整数分与常规值可读', () => {
    expect(formatMicroCents(MICRO_CENTS_PER_CENT)).toBe('1.0000 分')
    expect(formatMicroCents(500 * MICRO_CENTS_PER_CENT)).toBe('500.0000 分')
  })
})

describe('运行面板 · 纪律 3：来源不可用 ≠ 没有数据', () => {
  it('载荷不可用 ⇒ 拒绝并指明位置', () => {
    const r = assembleAgentBoard(null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('顶层形状')

    const r2 = assembleAgentBoard({})
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error).toContain('items')
  })

  it('空列表是**真实结论** ⇒ 明写"不是读不到"', () => {
    const b = boardOf(runsPayload([]))
    expect(b.runs).toEqual([])
    expect(notesOf(b)).toContain('不是"读不到"')
  })

  it('非空列表**不产**那条空态 note', () => {
    expect(notesOf(boardOf(runsPayload([run()])))).not.toContain('不是"读不到"')
  })
})

describe('运行面板 · 纪律 6：顺序确定', () => {
  it('按创建时间降序', () => {
    const b = boardOf(
      runsPayload([
        run({ id: 'a', createdAt: '2026-10-01T00:00:00.000Z' }),
        run({ id: 'b', createdAt: '2026-10-03T00:00:00.000Z' }),
        run({ id: 'c', createdAt: '2026-10-02T00:00:00.000Z' }),
      ]),
    )
    expect(b.runs.map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('同一时刻按 id 升序', () => {
    const at = '2026-10-01T00:00:00.000Z'
    const b = boardOf(runsPayload([run({ id: 'zzz', createdAt: at }), run({ id: 'aaa', createdAt: at })]))
    expect(b.runs.map((r) => r.id)).toEqual(['aaa', 'zzz'])
  })

  it('"需要关注"只打标记，**不重排** —— 最新一条的位置不能漂移', () => {
    const b = boardOf(
      runsPayload([
        run({ id: 'new', status: 'PROPOSED', createdAt: '2026-10-03T00:00:00.000Z' }),
        run({ id: 'urgent', status: 'AWAITING_APPROVAL', createdAt: '2026-10-01T00:00:00.000Z' }),
      ]),
    )
    expect(b.runs.map((r) => r.id)).toEqual(['new', 'urgent'])
    expect(b.runs[0].needsAttention).toBe(false)
    expect(b.runs[1].needsAttention).toBe(true)
  })

  it('同输入两次装配完全相等', () => {
    const p = runsPayload([run({ id: 'a' }), run({ id: 'b', createdAt: '2026-09-01T00:00:00.000Z' })])
    expect(boardOf(p)).toEqual(boardOf(p))
  })
})

describe('运行面板 · 纪律 4：`provider` 诚实块与 `execution` 原样透传', () => {
  const row = boardOf(runsPayload([run()])).runs[0]

  it('`execution` 两个字段都原样带出（不概括成"不可用"）', () => {
    expect(row.execution).toEqual({ available: false, reason: executionReason })
    expect(row.execution.reason).toBe(executionReason)
  })

  it('provider 种类译为中文诚实文案', () => {
    expect(row.provider).toBe('rules')
    expect(row.providerLabel).toBe('规则式兜底（没有调用模型）')
    expect(formatMicroCents(row.costMicroCents)).toBe('0 分')
    // 两个读数必须能区分："花了 0" 与 "没调模型" 是同一件事的两面，都要能看到
    expect(row.callCount).toBe(0)
  })
})

describe('运行面板 · 纪律 2：状态机不在前端重写', () => {
  it('行上**没有**任何前端推导的权限判据（只有服务端下发的原值）', () => {
    const row = boardOf(runsPayload([run()])).runs[0]
    const keys = Object.keys(row)
    for (const forbidden of ['canApprove', 'canReject', 'canExecute', 'allowedActions']) {
      expect(keys).not.toContain(forbidden)
    }
    // 反向自证：原样透传的字段确实在（否则上面那条断言是废话）
    expect(keys).toContain('execution')
    expect(keys).toContain('status')
  })

  it('状态文案 + 含义说明 + 关注标记都由镜像表/集合统一给出', () => {
    const row2 = boardOf(runsPayload([run({ status: 'DEGRADED', risk: 'HIGH' })])).runs[0]
    expect(row2.statusLabel).toBe('降级产出')
    expect(row2.statusHint).toContain('降级')
    expect(row2.needsAttention).toBe(true)
    expect(row2.riskLabel).toContain('对外可见')
  })

  it('`degradeCode` 为空 ⇒ 目录也是 null（不编一个默认原因）', () => {
    expect(rowOfDefault().degradeCode).toBeNull()
    expect(rowOfDefault().degradeLabel).toBeNull()
    const degraded = boardOf(runsPayload([run({ degradeCode: 'PROVIDER_UNAVAILABLE' })])).runs[0]
    expect(degraded.degradeCode).toBe('PROVIDER_UNAVAILABLE')
    expect(degraded.degradeLabel).toContain('未配置或未启用')
  })

  function rowOfDefault() {
    return boardOf(runsPayload([run()])).runs[0]
  }
})

describe('运行面板 · 纪律 5：只展示 DTO 里**确实有**的东西', () => {
  it('注入信号只给布尔；列表形状无从得知条数 ⇒ 行上没有 `injectionCount`', () => {
    const row = boardOf(runsPayload([run({ injectionFlagged: true })])).runs[0]
    expect(row.injectionFlagged).toBe(true)
    expect('injectionCount' in row).toBe(false)
    expect(Object.keys(row)).not.toContain('injectionSignals')
  })

  it('裁决记录为 null 时原样为 null；有记录时给出中文裁决文案', () => {
    expect(boardOf(runsPayload([run()])).runs[0].approval).toBeNull()
    const decided = boardOf(
      runsPayload([
        run({
          approval: {
            decision: 'APPROVED',
            actorId: 'user-9',
            deciderRole: 'ADMIN',
            note: '同意',
            decidedAt: '2026-10-02T00:00:00.000Z',
          },
        }),
      ]),
    ).runs[0]
    expect(decided.approval).toMatchObject({
      decision: 'APPROVED',
      decisionLabel: '已批准',
      deciderRole: 'ADMIN',
      note: '同意',
    })
  })
})

describe('运行面板 · 纪律 1：载荷自洽性自证', () => {
  it('`count` 与实际条数不符 ⇒ 产 note，并按实际条数展示', () => {
    const b = boardOf(runsPayload([run()], { count: 9 }))
    expect(notesOf(b)).toContain('载荷自洽性未通过')
    expect(b.runs).toHaveLength(1)
  })

  it('服务端回显了过滤条件 ⇒ 明说"这不是全量"', () => {
    const b = boardOf(
      runsPayload([run()], { filters: { status: 'FAILED', skill: null, limit: 50 } }),
    )
    expect(notesOf(b)).toContain('过滤后')
    expect(notesOf(b)).toContain('FAILED')
    expect(b.filters.status).toBe('FAILED')
  })

  it('未过滤时**不产**那条 note（否则说明区全是噪音）', () => {
    expect(notesOf(boardOf(runsPayload([run()])))).not.toContain('过滤后')
  })
})

describe('用量与额度：诚实块 + 自洽性 + 排序', () => {
  it('载荷不可用 ⇒ 拒绝', () => {
    expect(assembleAgentUsage(null).ok).toBe(false)
    expect(assembleAgentUsage({}).ok).toBe(false)
  })

  it('🔴 真实调用未启用 ⇒ **必须**产 note 并带上原因（否则"花 0 分"会被读成"模型免费"）', () => {
    const u = usageOf(usagePayload())
    expect(u.provider.realCallsEnabled).toBe(false)
    expect(notesOf(u)).toContain('真实模型调用未启用')
    expect(notesOf(u)).toContain('缺少 OPENAI_API_KEY')
  })

  it('真实调用已启用 ⇒ 不产那条 note', () => {
    const p = usagePayload()
    ;(p.provider as Record<string, unknown>).realCallsEnabled = true
    expect(notesOf(usageOf(p))).not.toContain('真实模型调用未启用')
  })

  it('额度自洽性：已用 + 剩余 ≠ 上限 ⇒ 产 note，但如实展示服务端值', () => {
    const p = usagePayload()
    ;(p.quota as Record<string, unknown>).remainingMicroCents = 1
    const u = usageOf(p)
    expect(notesOf(u)).toContain('额度自洽性未通过')
    expect(u.quota.remainingMicroCents).toBe(1)
  })

  it('额度自洽时**不产** note', () => {
    expect(notesOf(usageOf(usagePayload()))).not.toContain('额度自洽性未通过')
  })

  it('已用占比：常规、上限为 0 时给 null、超过 100% 被夹紧', () => {
    expect(usageOf(usagePayload()).quota.usedPercent).toBe(0)

    const zero = usagePayload()
    ;(zero.quota as Record<string, unknown>).maxMicroCents = 0
    expect(usageOf(zero).quota.usedPercent).toBeNull()

    const over = usagePayload()
    ;(over.quota as Record<string, unknown>).usedMicroCents = 600 * MICRO_CENTS_PER_CENT
    ;(over.quota as Record<string, unknown>).remainingMicroCents = -100 * MICRO_CENTS_PER_CENT
    expect(usageOf(over).quota.usedPercent).toBe(100)
  })

  it('按技能聚合：调用次数降序、同次数按技能升序', () => {
    const u = usageOf(usagePayload())
    expect(u.bySkill.map((s) => s.skill)).toEqual(['INTENT_EXTRACTION', 'INTRO_DRAFT'])
    expect(u.bySkill[0].skillLabel).toBe('意图抽取')
    expect(u.bySkill[0].costLabel).toBe('0 分')
  })

  it('按状态聚合：数量降序、同数量按状态升序，且状态码译为中文', () => {
    const u = usageOf(usagePayload())
    expect(u.runsByStatus.map((s) => s.status)).toEqual([
      'PROPOSED',
      'AWAITING_APPROVAL',
      'FAILED',
    ])
    expect(u.runsByStatus[0].statusLabel).toBe('已产出方案')
    expect(u.runsByStatus[1].count).toBe(1)
  })

  it('假设集随响应下发（额度与单价都是占位假设，不是财务事实）', () => {
    const u = usageOf(usagePayload())
    expect(u.assumptions.quota).toContain('占位假设')
    expect(u.assumptions.price).toContain('输入 0.0150 分 / 1K token')
    expect(u.assumptions.price).toContain('输出 0.0600 分 / 1K token')
    expect(u.assumptions.period).toBe('按自然月')
  })

  it('总量原样带出，并附可读金额', () => {
    const u = usageOf(usagePayload())
    expect(u.totals).toMatchObject({ calls: 3, okCalls: 2, failedCalls: 1, highCostCalls: 1 })
    expect(u.totals.costLabel).toBe('0 分')
    expect(u.periodKey).toBe('2026-10')
  })
})

describe('裁决请求', () => {
  it('批准 / 驳回 各有自己的端点', () => {
    expect(agentDecisionRequest('r1', 'approve').url).toBe('/api/v1/agents/runs/r1/approve')
    expect(agentDecisionRequest('r1', 'reject').url).toBe('/api/v1/agents/runs/r1/reject')
  })

  it('不代用户编造理由：没给 note 就不带 note 字段', () => {
    expect(agentDecisionRequest('r1', 'approve').body).toEqual({})
    expect(agentDecisionRequest('r1', 'reject', '').body).toEqual({})
    expect(agentDecisionRequest('r1', 'reject', '   ').body).toEqual({})
  })

  it('给了 note 则去空格后带上', () => {
    expect(agentDecisionRequest('r1', 'approve', '  同意  ').body).toEqual({ note: '同意' })
  })

  it('运行 id 做 URL 编码', () => {
    expect(agentDecisionRequest('a/b c', 'approve').url).toBe('/api/v1/agents/runs/a%2Fb%20c/approve')
  })
})

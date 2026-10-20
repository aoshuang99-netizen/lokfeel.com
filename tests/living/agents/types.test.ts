/**
 * P2 · Agent 区 —— 镜像取值域回归（硬编码 + 服务端真值比对）
 *
 * `src/lib/living/agents/types.ts` 把五组服务端取值域独立声明了一份。
 * 编译期双向等价断言防"单侧漂移"，本文件防"双侧漂移"。
 *
 * ⚠️ 类型来源是**单数** `@/lib/agent`（零 IO 内核），不是复数 `@/lib/agents`
 *    （有 IO 的服务层）。本文件直接 import 具体模块，避免经 barrel 拉进用不到的实现。
 *
 * 本区的诚实纪律（T09 反复强调的三条）在此被钉住：
 *   ① `execution.reason` 必须原样展示；可否执行由服务端执行计划给出（不再恒 false）—— 见 board 测试；
 *   ② `provider` 诚实块："跑了 3 次花 0 分" ≠ "模型免费"，而是"规则式兜底"；
 *   ③ `rawText`（模型原文）不在 DTO 里 ⇒ 本区无从展示，这是设计不是遗漏。
 */

import { AGENT_RUN_STATUSES, DEGRADE_REASONS, PROVIDER_KINDS, RISK_LEVELS } from '@/lib/agent/types'
import { SKILLS, SKILL_KEYS } from '@/lib/agent/skills'
import {
  LIVING_AGENT_ATTENTION_STATUSES,
  LIVING_AGENT_DECISION_LABELS,
  LIVING_AGENT_DEGRADE_LABELS,
  LIVING_AGENT_DEGRADE_REASONS,
  LIVING_AGENT_PROVIDER_KINDS,
  LIVING_AGENT_PROVIDER_LABELS,
  LIVING_AGENT_RISK_LEVELS,
  LIVING_AGENT_RISK_LABELS,
  LIVING_AGENT_SKILL_KEYS,
  LIVING_AGENT_SKILL_LABELS,
  LIVING_AGENT_STATUS_HINTS,
  LIVING_AGENT_STATUS_LABELS,
  LIVING_AGENT_STATUSES,
  type LivingAgentDegradeReason,
  type LivingAgentProvider,
  type LivingAgentRisk,
  type LivingAgentSkill,
  type LivingAgentStatus,
} from '@/lib/living/agents'

function expectLabelMap<K extends string>(codes: readonly K[], labels: Record<K, string>): void {
  expect(Object.keys(labels).sort()).toEqual([...codes].sort())
  for (const code of codes) {
    expect(typeof labels[code]).toBe('string')
    expect(labels[code].trim().length).toBeGreaterThan(0)
  }
}

describe('镜像一 · 运行状态（8 档）', () => {
  it('逐字钉住，且与服务端 AGENT_RUN_STATUSES 完全同序', () => {
    expect([...LIVING_AGENT_STATUSES]).toEqual([
      'PROPOSED',
      'AWAITING_APPROVAL',
      'APPROVED',
      'REJECTED',
      'EXECUTED',
      'DEGRADED',
      'BLOCKED_QUOTA',
      'FAILED',
    ])
    expect([...LIVING_AGENT_STATUSES]).toEqual([...AGENT_RUN_STATUSES])
  })

  it('状态文案 + 含义说明都完整、无多余键、非空', () => {
    expectLabelMap<LivingAgentStatus>(LIVING_AGENT_STATUSES, LIVING_AGENT_STATUS_LABELS)
    expectLabelMap<LivingAgentStatus>(LIVING_AGENT_STATUSES, LIVING_AGENT_STATUS_HINTS)
  })

  it('两条最容易被误解的状态必须自带解释（否则用户会以为"批准 = 已经执行了"）', () => {
    // APPROVED 本身**不会**产生副作用 —— 执行是独立的一步（须显式触发）
    expect(LIVING_AGENT_STATUS_HINTS.APPROVED).toContain('不会自动')
    // EXECUTED 必须说明"谁才可能到达"（低风险可直接执行 / 高风险先批准）
    expect(LIVING_AGENT_STATUS_HINTS.EXECUTED).toContain('人工批准')
    // REJECTED 不可改判 —— 与服务端 `decideAgentRun` 的 409 语义同源
    expect(LIVING_AGENT_STATUS_HINTS.REJECTED).toContain('不可改判')
    // DEGRADED 必须点明"能力弱于正常路径"
    expect(LIVING_AGENT_STATUS_HINTS.DEGRADED).toContain('降级')
    // BLOCKED_QUOTA 必须点明"没有产生真实花费"（否则会被读成"失败了还花钱"）
    expect(LIVING_AGENT_STATUS_HINTS.BLOCKED_QUOTA).toContain('没有产生真实模型花费')
  })

  it('需要人工关注的档位是状态的子集，且不含"已收尾"的几档', () => {
    for (const s of LIVING_AGENT_ATTENTION_STATUSES) {
      expect(LIVING_AGENT_STATUSES as readonly string[]).toContain(s)
    }
    expect([...LIVING_AGENT_ATTENTION_STATUSES]).toEqual([
      'AWAITING_APPROVAL',
      'FAILED',
      'BLOCKED_QUOTA',
      'DEGRADED',
    ])
    for (const done of ['PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTED']) {
      expect(LIVING_AGENT_ATTENTION_STATUSES as readonly string[]).not.toContain(done)
    }
  })
})

describe('镜像二 · 风险级', () => {
  it('逐字钉住且与服务端 RISK_LEVELS 同集', () => {
    expect([...LIVING_AGENT_RISK_LEVELS]).toEqual(['LOW', 'MEDIUM', 'HIGH'])
    expect([...LIVING_AGENT_RISK_LEVELS]).toEqual([...RISK_LEVELS])
    expectLabelMap<LivingAgentRisk>(LIVING_AGENT_RISK_LEVELS, LIVING_AGENT_RISK_LABELS)
  })

  it('HIGH 的文案点明"对外可见副作用"（这正是它要人工批准的理由）', () => {
    expect(LIVING_AGENT_RISK_LABELS.HIGH).toContain('对外可见')
  })
})

describe('镜像三 · 降级原因码', () => {
  it('逐字钉住且与服务端 DEGRADE_REASONS 同集', () => {
    expect([...LIVING_AGENT_DEGRADE_REASONS]).toEqual([
      'PROVIDER_UNAVAILABLE',
      'PROVIDER_TIMEOUT',
      'PROVIDER_ERROR',
      'OUTPUT_SCHEMA_INVALID',
      'OUTPUT_NOT_PARSEABLE',
      'INPUT_INVALID',
      'NO_DEGRADE_PATH',
    ])
    expect([...LIVING_AGENT_DEGRADE_REASONS]).toEqual([...DEGRADE_REASONS])
    expectLabelMap<LivingAgentDegradeReason>(
      LIVING_AGENT_DEGRADE_REASONS,
      LIVING_AGENT_DEGRADE_LABELS,
    )
  })
})

describe('镜像四 · Provider 种类（诚实块的一半）', () => {
  it('逐字钉住且与服务端 PROVIDER_KINDS 同集', () => {
    expect([...LIVING_AGENT_PROVIDER_KINDS]).toEqual(['openai', 'workbuddy', 'stub', 'rules'])
    expect([...LIVING_AGENT_PROVIDER_KINDS]).toEqual([...PROVIDER_KINDS])
  })

  it('`rules` 的文案**必须**说清"没有调用模型" —— 否则"花 0 分"会被读成"模型免费"', () => {
    expect(LIVING_AGENT_PROVIDER_LABELS.rules).toContain('没有调用模型')
    expect(LIVING_AGENT_PROVIDER_LABELS.stub).toContain('测试')
    expect(LIVING_AGENT_PROVIDER_LABELS.openai).toContain('真实调用')
    // 三种读法必须互相可分（否则"诚实块"就没有信息量）
    const values = Object.values(LIVING_AGENT_PROVIDER_LABELS)
    expect(new Set(values).size).toBe(values.length)
  })

  it('文案表完整且无多余键', () => {
    expectLabelMap<LivingAgentProvider>(LIVING_AGENT_PROVIDER_KINDS, LIVING_AGENT_PROVIDER_LABELS)
  })
})

describe('镜像五 · 技能', () => {
  it('逐字钉住且与服务端 SKILL_KEYS 同集', () => {
    expect([...LIVING_AGENT_SKILL_KEYS]).toEqual([
      'INTENT_EXTRACTION',
      'INTRO_DRAFT',
      'COORDINATION_ADVICE',
    ])
    expect([...LIVING_AGENT_SKILL_KEYS]).toEqual([...SKILL_KEYS])
  })

  it('技能文案与服务端注册表的 label **逐字一致**（同一技能两处叫法不同会让用户以为是两件事）', () => {
    for (const key of LIVING_AGENT_SKILL_KEYS) {
      expect(LIVING_AGENT_SKILL_LABELS[key]).toBe(SKILLS[key].label)
    }
    expectLabelMap<LivingAgentSkill>(LIVING_AGENT_SKILL_KEYS, LIVING_AGENT_SKILL_LABELS)
  })
})

describe('镜像六 · 裁决文案', () => {
  it('两个方向都有文案，且与状态文案不冲突', () => {
    expect(LIVING_AGENT_DECISION_LABELS).toEqual({ APPROVED: '已批准', REJECTED: '已驳回' })
    expect(LIVING_AGENT_DECISION_LABELS.APPROVED).toBe(LIVING_AGENT_STATUS_LABELS.APPROVED)
    expect(LIVING_AGENT_DECISION_LABELS.REJECTED).toBe(LIVING_AGENT_STATUS_LABELS.REJECTED)
  })
})

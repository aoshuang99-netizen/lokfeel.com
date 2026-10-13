/**
 * Living Connection OS · P1 —— Intent-to-UI Compiler 单测
 *
 * 重点验证「不伪造」与「可复现」这两条：
 *   - 原文没写的信息**不会**被补默认值（不编预算、不编期限）；
 *   - 识别不了的目标 → `ok:false` + 原因 + 建议，**不硬凑 spec**；
 *   - 同一输入恒得同一输出（确定性）；
 *   - 任何情况下都**不产 `agent` 节点**（T09 未交付）。
 */

import {
  INTENT_CLASSES,
  MIN_GOAL_LENGTH,
  classifyIntent,
  compileWorkspaceSpec,
  extractDraftFields,
  supportedIntentHints,
} from '@/lib/workspace-spec'
import { RESERVED_NODE_TYPES, WorkspaceSpecSchema } from '@/lib/workspace-spec'

describe('classifyIntent', () => {
  it('识别渠道对接类目标', () => {
    expect(classifyIntent('帮助社群对接 5 家渠道伙伴').intentClass).toBe('PARTNERSHIP')
  })

  it('识别成员招募类目标', () => {
    expect(classifyIntent('本月招募 20 位活跃成员').intentClass).toBe('RECRUITMENT')
  })

  it('无关键词命中时返回 null（不猜）', () => {
    const r = classifyIntent('今天天气不错适合散步')
    expect(r.intentClass).toBeNull()
    expect(r.matchedKeywords).toEqual([])
  })

  it('结果是确定性的（同输入同输出）', () => {
    const a = classifyIntent('招募成员并做一次线下分享会')
    const b = classifyIntent('招募成员并做一次线下分享会')
    expect(a).toEqual(b)
  })
})

describe('extractDraftFields', () => {
  it('抽取期限与数量判据', () => {
    const r = extractDraftFields('30 天内对接 5 家渠道伙伴')
    expect(r.constraints).toContain('期限：30天内')
    expect(r.successCriteria).toContain('达成 5家')
    expect(r.expiresAt).toBeDefined()
  })

  it('期限与预算**同时**存在时都要抽到（回归：首版在期限分支提前 return）', () => {
    const r = extractDraftFields('30 天内完成对接，预算不超过 5000')
    expect(r.constraints).toContain('期限：30天内')
    expect(r.constraints).toContain('预算：5000')
  })

  it('中文数量词也可识别', () => {
    const r = extractDraftFields('两周内招募三位导师')
    expect(r.constraints.some((c) => c.startsWith('期限：'))).toBe(true)
    expect(r.successCriteria).toContain('达成 三位')
  })

  it('原文没写数字时**不补默认值**', () => {
    const r = extractDraftFields('帮我们对接一些渠道伙伴')
    expect(r.constraints).toEqual([])
    expect(r.successCriteria).toEqual([])
    expect(r.expiresAt).toBeUndefined()
  })
})

describe('compileWorkspaceSpec', () => {
  const goal = '帮助我们社群在 30 天内对接 5 家渠道伙伴，完成初步合作洽谈'

  it('合法目标编译出可过契约校验的 spec', () => {
    const r = compileWorkspaceSpec(goal)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.intentClass).toBe('PARTNERSHIP')
    const revalidated = WorkspaceSpecSchema.safeParse(r.spec)
    expect(revalidated.success).toBe(true)
  })

  it('产出 intent 节点；候选节点为空数组（不预填候选）', () => {
    const r = compileWorkspaceSpec(goal)
    if (!r.ok) throw new Error('应当编译成功')
    const intent = r.spec.nodes.find((n) => n.type === 'intent')
    const candidate = r.spec.nodes.find((n) => n.type === 'candidate')
    expect(intent).toBeDefined()
    expect(candidate).toBeDefined()
    if (candidate?.type === 'candidate') {
      expect(candidate.data.candidates).toEqual([])
    }
  })

  it('说明里必须写明"草稿"与"候选为空"的原因（可解释性）', () => {
    const r = compileWorkspaceSpec(goal)
    if (!r.ok) throw new Error('应当编译成功')
    expect(r.spec.notes.join(' ')).toContain('草稿')
    expect(r.spec.notes.join(' ')).toContain('候选')
  })

  it('未就绪动作都带 reason', () => {
    const r = compileWorkspaceSpec(goal)
    if (!r.ok) throw new Error('应当编译成功')
    expect(r.spec.availableActions.length).toBeGreaterThan(0)
    for (const a of r.spec.availableActions) {
      expect(a.ready).toBe(false)
      expect((a.reason ?? '').trim().length).toBeGreaterThan(0)
    }
  })

  it('任何情况下都不产保留节点类型（agent）', () => {
    for (const cls of INTENT_CLASSES) {
      const r = compileWorkspaceSpec(`帮我${cls === 'EVENT' ? '办一场线下活动' : '对接渠道伙伴并招募成员做调研访谈找导师'}`)
      if (r.ok) {
        for (const n of r.spec.nodes) {
          expect(RESERVED_NODE_TYPES as readonly string[]).not.toContain(n.type)
        }
      }
    }
  })

  it('目标过短 → ok:false，并说明长度要求', () => {
    const r = compileWorkspaceSpec('合作')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain(String(MIN_GOAL_LENGTH))
      expect(r.suggestions.length).toBe(INTENT_CLASSES.length)
    }
  })

  it('识别不出类型 → ok:false + 5 条建议（不硬凑 spec）', () => {
    const r = compileWorkspaceSpec('今天天气不错适合散步和发呆')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('没有识别出目标类型')
      expect(r.suggestions).toEqual(supportedIntentHints())
    }
  })

  it('确定性：同一输入两次编译结果一致', () => {
    const a = compileWorkspaceSpec(goal)
    const b = compileWorkspaceSpec(goal)
    expect(a).toEqual(b)
  })

  it('不修改输入（纯函数）', () => {
    const raw = '  帮助我们社群在 30 天内对接 5 家渠道伙伴  '
    const snapshot = String(raw)
    compileWorkspaceSpec(raw)
    expect(raw).toBe(snapshot)
  })
})

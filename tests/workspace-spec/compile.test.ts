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
  missionDraftFromSpec,
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

  // ── V19.8 · 对价抽取（W-08 死路修复的回归守卫）──
  it('写了"提供…"的句子被抽为 offer（句级，含上下文）', () => {
    const r = extractDraftFields('30 天内对接 5 家渠道伙伴。我们提供项目预算与联合品牌支持。')
    expect(r.offer).toContain('提供')
    expect(r.offer).toContain('预算')
  })

  it('没写对价 → offer 为 undefined（不编默认对价）', () => {
    const r = extractDraftFields('30 天内对接 5 家渠道伙伴')
    expect(r.offer).toBeUndefined()
  })

  it('对价关键词在句中但不占整句时，抽的是**整句**（保留可读性）', () => {
    const r = extractDraftFields('希望找到长期伙伴，我们可以承担内容制作成本，两个月内启动')
    expect(r.offer).toContain('我们可以承担内容制作成本')
  })

  it('compileWorkspaceSpec：抽到 offer 时 intent 节点带上它，missionDraft 不再缺对价', () => {
    const r = compileWorkspaceSpec('30 天内促成 20 次渠道合作，我们提供预算与渠道资源作为对价，每周复盘一次进展')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const intent = r.spec.nodes.find((n) => n.type === 'intent')
    expect(intent && 'offer' in intent.data ? (intent.data as { offer?: string }).offer : undefined).toBeDefined()
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

// ── V19-85 · 对价抽取回归（执行令 Batch 附加要求）──────────────────────────
// 五条红线：模糊描述不得误判为明确 offer / 无 offer 不得自动生成虚假对价 /
//          用户修改描述后可以重新编译 / 前后端校验规则一致 / 重复提交不产第二个 Mission
//          （最后一条在 API 层由 v198-agent-consent-outcome.mjs O-01 幂等键覆盖）。
describe('extractDraftFields · 模糊措辞守卫（V19-85）', () => {
  it('模糊意向句（"看情况可以给…"）不得误判为明确 offer', () => {
    const r = extractDraftFields('30 天内对接 5 家渠道伙伴。看情况可以给一些资源。')
    expect(r.offer).toBeUndefined()
  })

  it('含模糊词的"提供"句同样不算 offer（关键词命中≠承诺）', () => {
    const r = extractDraftFields('30 天内对接 5 家渠道伙伴。到时候也许能提供一点支持。')
    expect(r.offer).toBeUndefined()
  })

  it('模糊句在前、具体承诺句在后 → 跳过模糊句、抽中具体句', () => {
    const r = extractDraftFields('看情况可以给一些资源。我们提供项目预算与联合品牌支持。30 天内对接 5 家渠道伙伴')
    expect(r.offer).toContain('联合品牌')
    expect(r.offer).not.toContain('看情况')
  })

  it('明确承诺句仍被正常抽取（守卫不误伤）', () => {
    const r = extractDraftFields('30 天内对接 5 家渠道伙伴。我们愿意承担全部活动经费。')
    expect(r.offer).toContain('经费')
  })
})

describe('missionDraftFromSpec · 修改描述后可重新编译（V19-85）', () => {
  const withOffer = '30 天内促成 20 次渠道合作，我们提供预算与渠道资源作为对价'

  it('无 offer → body 为 null，缺口说明里点名对价（不编虚假对价）', () => {
    const r = compileWorkspaceSpec('30 天内促成 20 次渠道合作')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const draft = missionDraftFromSpec(r.spec)
    expect(draft.body).toBeNull()
    expect(draft.missing.join('；')).toContain('对价')
  })

  it('用户补写对价后重新编译 → offer 出现且 body 可用（不是死路）', () => {
    const before = compileWorkspaceSpec('30 天内促成 20 次渠道合作')
    expect(before.ok).toBe(true)
    if (!before.ok) return
    expect(missionDraftFromSpec(before.spec).body).toBeNull()

    // 用户按缺口提示修改了描述（同一意图、同一编译器）→ 重新编译
    const after = compileWorkspaceSpec(withOffer)
    expect(after.ok).toBe(true)
    if (!after.ok) return
    const intent = after.spec.nodes.find((n) => n.type === 'intent')
    expect(intent && 'offer' in intent.data ? (intent.data as { offer?: string }).offer : undefined).toBeDefined()
    const draft = missionDraftFromSpec(after.spec)
    expect(draft.body).not.toBeNull()
    if (draft.body) {
      expect(draft.body.offer).toContain('预算')
      expect(draft.missing).toEqual([])
    }
  })

  it('重新编译是确定性的：修改前后各自的输出与重复编译一致', () => {
    expect(compileWorkspaceSpec('30 天内促成 20 次渠道合作')).toEqual(compileWorkspaceSpec('30 天内促成 20 次渠道合作'))
    expect(compileWorkspaceSpec(withOffer)).toEqual(compileWorkspaceSpec(withOffer))
  })
})

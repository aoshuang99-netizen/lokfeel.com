/**
 * 技能提示词的**契约骨架守卫**（2026-11-07 生产事故的回归测试）
 *
 * 事故：`INTRO_DRAFT` 的 system prompt 只说了"只使用 allowedFieldKeys"，
 * 没有给输出字段形状。生产上真实模型漏掉了必填的 `counterpartLabel`，
 * `strictObject` 校验失败 → `OUTPUT_SCHEMA_INVALID` → 该技能没有降级路径
 * → 运行 100% FAILED → **审批门在生产永远不可达**（S3 才暴露）。
 *
 * 这类缺陷用"跑一次试试"是抓不住的：它只在真实模型的自由生成下出现。
 * 能稳定抓住它的是**静态断言**：每个技能的必填输出字段，必须出现在它的
 * systemPrompt 里。提示词与 schema 一旦漂移，这里就红。
 */

import { SKILLS, IntroDraftOutputSchema } from '@/lib/agent/skills'

/** 从 zod object schema 里取"必填且非 default"的键（default 字段模型可以省略）。 */
function requiredKeysOf(schema: { shape?: Record<string, unknown> }): string[] {
  const shape = schema.shape ?? {}
  return Object.entries(shape)
    .filter(([, def]) => {
      const d = def as { isOptional?: () => boolean; _def?: { defaultValue?: unknown } }
      const hasDefault = typeof d._def === 'object' && d._def !== null && 'defaultValue' in d._def
      return !hasDefault && !(typeof d.isOptional === 'function' && d.isOptional())
    })
    .map(([k]) => k)
}

describe('技能提示词必须自带输出契约骨架', () => {
  const cases = [
    { key: 'INTRO_DRAFT' as const, schema: IntroDraftOutputSchema },
    // 新增技能时在这里登记 —— 漏登记会让"漂移"重新变得不可见。
  ]

  for (const { key, schema } of cases) {
    it(`${key}：每个必填输出字段都以 JSON 键形式出现在 systemPrompt 骨架里`, () => {
      const prompt = SKILLS[key].systemPrompt
      const required = requiredKeysOf(schema as never)
      expect(required.length).toBeGreaterThan(0)
      for (const field of required) {
        // 必须是骨架里的键（`"field":`），而不是散落在规则句里的同名字符串。
        // 这条区分很重要：只断言 toContain('field') 时，把骨架改成别的键名
        // 仍然会通过（负控实测过），守卫就成了装饰。
        expect(prompt).toMatch(new RegExp(`"${field}"\\s*:`))
      }
    })
  }

  it('INTRO_DRAFT 的必填字段确实是 counterpartLabel / draftMessage（防止 schema 被悄悄放宽）', () => {
    const required = requiredKeysOf(IntroDraftOutputSchema as never)
    expect(required).toEqual(expect.arrayContaining(['counterpartLabel', 'draftMessage']))
    // usedFieldKeys 有 default([])，允许模型省略 —— 它**不**该进必填集合
    expect(required).not.toContain('usedFieldKeys')
  })

  it('INTRO_DRAFT 要求逐字回填 counterpartLabel（防止模型改写标签）', () => {
    const prompt = SKILLS.INTRO_DRAFT.systemPrompt
    expect(prompt).toMatch(/逐字一致/)
  })
})

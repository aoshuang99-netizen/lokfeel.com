/**
 * V21 · C04 —— WorkspaceSpec 字段编辑纯函数（TDD · 先红后绿）
 *
 * WorkspaceSpec v1.2（`src/lib/workspace-spec/schema.ts`）是 strictObject：
 *   intent 节点 data = { goal, offer?, constraints[], successCriteria[], expiresAt? }
 *   —— **没有负责人（owner）字段**。本套件明确钉死「不伪造 owner」。
 */

import { WorkspaceSpecSchema, type WorkspaceSpec } from '@/lib/workspace-spec/schema'
import {
  editableFields,
  applySpecFieldEdit,
  specDiff,
  specRevisionConflict,
  SPEC_VERSION_CONFLICT,
  type EditableField,
} from '@/lib/living/spec/edit'

function baseSpec(): WorkspaceSpec {
  return WorkspaceSpecSchema.parse({
    version: '1.2',
    title: '联合发布合作',
    nodes: [
      {
        id: 'intent-1',
        title: '目标',
        type: 'intent',
        data: {
          goal: '找到一位合作伙伴共同完成一次真实的联合发布',
          offer: '我可以提供发布渠道',
          constraints: ['预算不超过 5000'],
          successCriteria: ['双方签字确认'],
          expiresAt: '2026-12-31T00:00:00.000Z',
        },
      },
    ],
    availableActions: [],
    notes: [],
  })
}

describe('editableFields', () => {
  it('提取 intent 节点的四个可编辑字段', () => {
    const f = editableFields(baseSpec())
    expect(f.offer).toBe('我可以提供发布渠道')
    expect(f.constraints).toEqual(['预算不超过 5000'])
    expect(f.successCriteria).toEqual(['双方签字确认'])
    expect(f.expiresAt).toBe('2026-12-31T00:00:00.000Z')
  })

  it('owner 不伪造：v1.2 无负责人字段，明确返回 null', () => {
    const f = editableFields(baseSpec())
    expect(f.owner).toBeNull()
    // 不许凭空造出 ownerId / assignee 之类的字段
    expect(Object.keys(f)).not.toContain('ownerId')
    expect(Object.keys(f)).not.toContain('assignee')
  })

  it('没有 intent 节点 → 全空 + owner:null，不抛错', () => {
    const f = editableFields({
      version: '1.2',
      title: 'x',
      nodes: [],
      availableActions: [],
      notes: [],
    })
    expect(f.offer).toBeNull()
    expect(f.constraints).toEqual([])
    expect(f.successCriteria).toEqual([])
    expect(f.expiresAt).toBeNull()
    expect(f.owner).toBeNull()
  })
})

describe('applySpecFieldEdit', () => {
  const edits: Array<{
    field: EditableField
    value: unknown
    read: (s: WorkspaceSpec) => unknown
  }> = [
    { field: 'offer', value: '新报价：提供场地与渠道', read: (s) => editableFields(s).offer },
    {
      field: 'successCriteria',
      value: ['双方确认', '完成交付'],
      read: (s) => editableFields(s).successCriteria,
    },
    {
      field: 'constraints',
      value: ['预算 3000', '仅限本地'],
      read: (s) => editableFields(s).constraints,
    },
    {
      field: 'expiresAt',
      value: '2027-01-15T08:00:00.000Z',
      read: (s) => editableFields(s).expiresAt,
    },
  ]

  for (const e of edits) {
    it(`四字段编辑：${e.field} → 新 spec 且通过 WorkspaceSpecSchema`, () => {
      const res = applySpecFieldEdit(baseSpec(), { field: e.field, value: e.value })
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(WorkspaceSpecSchema.safeParse(res.spec).success).toBe(true)
      expect(e.read(res.spec)).toEqual(e.value)
    })
  }

  it('不 mutate 入参，返回的是新对象', () => {
    const before = baseSpec()
    const snapshot = JSON.parse(JSON.stringify(before)) as WorkspaceSpec
    const res = applySpecFieldEdit(before, { field: 'offer', value: '改了的报价' })
    expect(before).toEqual(snapshot)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.spec).not.toBe(before)
    expect(editableFields(before).offer).toBe('我可以提供发布渠道')
    expect(editableFields(res.spec).offer).toBe('改了的报价')
  })

  it('expiresAt 不可解析 → ok:false + reason', () => {
    const res = applySpecFieldEdit(baseSpec(), { field: 'expiresAt', value: '不是日期' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/expiresAt|日期/)
  })

  it('超长文本 → ok:false（offer > 500 / 数组项 > 200）', () => {
    const r1 = applySpecFieldEdit(baseSpec(), { field: 'offer', value: 'x'.repeat(501) })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.reason).toMatch(/offer|校验/)
    const r2 = applySpecFieldEdit(baseSpec(), {
      field: 'successCriteria',
      value: ['y'.repeat(201)],
    })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.reason).toMatch(/successCriteria|校验/)
  })

  it('schema strict：spec 带未知字段（伪造 owner）→ ok:false', () => {
    const tampered = JSON.parse(JSON.stringify(baseSpec())) as {
      nodes: Array<{ data: Record<string, unknown> }>
    }
    tampered.nodes[0].data.owner = '张三'
    const res = applySpecFieldEdit(tampered, { field: 'offer', value: '合法报价' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/校验|owner|未知/)
  })

  it('未知可编辑字段（owner / goal）被拒 —— 不伪造 v1.2 不存在的字段', () => {
    const r1 = applySpecFieldEdit(baseSpec(), { field: 'owner' as EditableField, value: '张三' })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.reason).toMatch(/owner|字段/)
    const r2 = applySpecFieldEdit(baseSpec(), { field: 'goal' as EditableField, value: '改目标' })
    expect(r2.ok).toBe(false)
  })

  it('无 intent 节点 → ok:false + reason', () => {
    const res = applySpecFieldEdit(
      { version: '1.2', title: 'x', nodes: [], availableActions: [], notes: [] },
      { field: 'offer', value: 'x' },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/intent|节点/)
  })
})

describe('specDiff', () => {
  it('产出人话差异数组（字段 / 旧值 / 新值）', () => {
    const before = baseSpec()
    const res = applySpecFieldEdit(before, { field: 'offer', value: '新报价' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const diffs = specDiff(before, res.spec)
    expect(diffs).toHaveLength(1)
    expect(diffs[0].field).toBe('offer')
    expect(diffs[0].label).toMatch(/提议|报价/)
    expect(diffs[0].before).toBe('我可以提供发布渠道')
    expect(diffs[0].after).toBe('新报价')
    expect(diffs[0].text).toContain('我可以提供发布渠道')
    expect(diffs[0].text).toContain('新报价')
  })

  it('空改动 → []', () => {
    const s = baseSpec()
    expect(specDiff(s, s)).toEqual([])
    const res = applySpecFieldEdit(s, { field: 'offer', value: '我可以提供发布渠道' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(specDiff(s, res.spec)).toEqual([])
  })

  it('多字段改动 → 每个人话条目各自对应一个字段', () => {
    const s0 = baseSpec()
    const r1 = applySpecFieldEdit(s0, { field: 'offer', value: '新报价' })
    if (!r1.ok) throw new Error(r1.reason)
    const r2 = applySpecFieldEdit(r1.spec, { field: 'constraints', value: ['新约束'] })
    if (!r2.ok) throw new Error(r2.reason)
    const diffs = specDiff(s0, r2.spec)
    expect(diffs.map((d) => d.field)).toEqual(expect.arrayContaining(['offer', 'constraints']))
    expect(diffs).toHaveLength(2)
    for (const d of diffs) {
      expect(d.text.length).toBeGreaterThan(0)
      expect(d.before).not.toEqual(d.after)
    }
  })
})

describe('specRevisionConflict', () => {
  it('版本一致 → 不冲突', () => {
    const r = specRevisionConflict('1.2', '1.2')
    expect(r.conflict).toBe(false)
    expect(r.code).toBeNull()
  })

  it('版本不一致 → conflict=true + 409 + SPEC_VERSION_CONFLICT', () => {
    const r = specRevisionConflict('1.2', '1.3')
    expect(r.conflict).toBe(true)
    expect(r.code).toBe(SPEC_VERSION_CONFLICT)
    expect(r.status).toBe(409)
    expect(r.message).toMatch(/冲突/)
  })
})

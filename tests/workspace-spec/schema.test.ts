/**
 * Living Connection OS · P1 —— `WorkspaceSpec` 契约单测
 *
 * 这些用例把「安全属性」变成可回归的断言：
 *   - 严格对象：未知字段必须**被拒绝**（而不是被静默忽略）；
 *   - 白名单：`agent` 等保留类型**无法**通过校验；
 *   - 自证依据：候选必须带非空 `rationale`（AC-13）；
 *   - 未就绪动作必须写 `reason`（与 UI 门禁 R4 同源）。
 */

import {
  CandidateNodeSchema,
  NODE_TYPES,
  RESERVED_NODE_TYPES,
  WORKSPACE_SPEC_VERSION,
  WorkspaceActionSchema,
  WorkspaceSpecSchema,
} from '@/lib/workspace-spec'

const validSpec = {
  version: WORKSPACE_SPEC_VERSION,
  title: '渠道 / 资源对接',
  summary: '草稿',
  nodes: [
    {
      id: 'intent-1',
      type: 'intent',
      title: '目标与成功判据',
      data: { goal: '30 天内对接 5 家渠道伙伴', constraints: ['期限：30天内'], successCriteria: ['达成 5家'] },
    },
    { id: 'candidate-1', type: 'candidate', title: '候选择优', data: { candidates: [] } },
  ],
  availableActions: [],
  notes: ['草稿说明'],
}

describe('WorkspaceSpecSchema', () => {
  it('接受最小合法 spec', () => {
    const r = WorkspaceSpecSchema.safeParse(validSpec)
    expect(r.success).toBe(true)
  })

  it('省略 availableActions / notes 时补齐为空数组', () => {
    const { availableActions, notes, ...rest } = validSpec
    void availableActions
    void notes
    const r = WorkspaceSpecSchema.safeParse(rest)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.availableActions).toEqual([])
      expect(r.data.notes).toEqual([])
    }
  })

  it('拒绝顶层未知字段（严格对象）', () => {
    const r = WorkspaceSpecSchema.safeParse({ ...validSpec, html: '<img src=x onerror=alert(1)>' })
    expect(r.success).toBe(false)
  })

  it('拒绝节点上的未知字段（模型无法偷塞 onClick / dangerouslySetInnerHTML）', () => {
    const r = WorkspaceSpecSchema.safeParse({
      ...validSpec,
      nodes: [
        {
          id: 'intent-1',
          type: 'intent',
          title: '目标',
          dangerouslySetInnerHTML: { __html: '<script>alert(1)</script>' },
          data: { goal: '合法目标', constraints: [], successCriteria: [] },
        },
      ],
    })
    expect(r.success).toBe(false)
  })

  it('拒绝不在白名单内的节点类型（agent 属保留类型）', () => {
    expect(RESERVED_NODE_TYPES).toContain('agent')
    expect(NODE_TYPES as readonly string[]).not.toContain('agent')
    const r = WorkspaceSpecSchema.safeParse({
      ...validSpec,
      nodes: [{ id: 'agent-1', type: 'agent', title: '自动执行', data: { anything: true } }],
    })
    expect(r.success).toBe(false)
  })

  it('候选的 rationale 必须非空（AC-13：没有依据的候选不得出现）', () => {
    const ok = CandidateNodeSchema.safeParse({
      id: 'c1',
      type: 'candidate',
      title: '候选',
      data: { candidates: [{ id: 'x', label: '张三', rationale: '共同好友 3 人' }] },
    })
    expect(ok.success).toBe(true)

    const bad = CandidateNodeSchema.safeParse({
      id: 'c1',
      type: 'candidate',
      title: '候选',
      data: { candidates: [{ id: 'x', label: '张三', rationale: '' }] },
    })
    expect(bad.success).toBe(false)
  })

  it('ready=false 的动作必须写 reason', () => {
    const bad = WorkspaceActionSchema.safeParse({
      key: 'create-mission',
      label: '创建连接任务',
      capability: 'mission.create',
      ready: false,
    })
    expect(bad.success).toBe(false)

    const ok = WorkspaceActionSchema.safeParse({
      key: 'create-mission',
      label: '创建连接任务',
      capability: 'mission.create',
      ready: false,
      reason: '需要 ACTIVE 社群成员身份',
    })
    expect(ok.success).toBe(true)
  })

  it('ready=true 时无需 reason', () => {
    const r = WorkspaceActionSchema.safeParse({
      key: 'create-mission',
      label: '创建连接任务',
      capability: 'mission.create',
      ready: true,
    })
    expect(r.success).toBe(true)
  })

  it('节点数量下限为 1（空画布不是合法 spec）', () => {
    const r = WorkspaceSpecSchema.safeParse({ ...validSpec, nodes: [] })
    expect(r.success).toBe(false)
  })
})

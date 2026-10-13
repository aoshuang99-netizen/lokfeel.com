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
  ACTION_JOB_STATUSES,
  ActionNodeSchema,
  CandidateNodeSchema,
  CONSENT_STATES,
  ConsentNodeSchema,
  NODE_TYPES,
  OUTCOME_LEVELS,
  OutcomeNodeSchema,
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

  it('版本号本身被**钉住**：语义变更必须显式升版本，旧版本号一律拒绝', () => {
    // 版本号是"旧前端不得静默误读新 spec"的唯一闸门 ⇒ 必须在此**显式写死**。
    // 若只在别处引用常量（如 agent runtime 的夹具），升版本时全绿、无人察觉语义已变。
    expect(WORKSPACE_SPEC_VERSION).toBe('1.1')

    // 负向：旧版本号 / 未来版本号都必须被拒绝（`z.literal` 不是"任意字符串"）。
    expect(WorkspaceSpecSchema.safeParse({ ...validSpec, version: '1.0' }).success).toBe(false)
    expect(WorkspaceSpecSchema.safeParse({ ...validSpec, version: '2.0' }).success).toBe(false)
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

// ─────────────────────────────────────────────────────────────────────────────
// P1 收口：三类节点的取值域**对齐服务端真实枚举**
// ─────────────────────────────────────────────────────────────────────────────
//
// 为什么值得单独一组用例：首版这三处是**猜的**，而且猜错了三处。契约放宽之后
// 必须同时钉住"新的合法值被接受"与"旧的猜测值仍被拒绝" —— 只钉前者的话，
// 把枚举写回宽集合（例如 `z.string()`）也会"通过"，而那等于放弃了白名单。

describe('consent / action / outcome 的取值域', () => {
  const consent = (status: string) =>
    ConsentNodeSchema.safeParse({ id: 'c', type: 'consent', title: '同意', data: { fields: [], status } })
  const action = (status: string) =>
    ActionNodeSchema.safeParse({
      id: 'a',
      type: 'action',
      title: '执行',
      data: { jobs: [{ id: 'j', kind: 'K', status, attempts: 0 }] },
    })
  const outcome = (level: string) =>
    OutcomeNodeSchema.safeParse({
      id: 'o',
      type: 'outcome',
      title: '成果',
      data: { outcomes: [{ id: 'x', label: 'L', level }] },
    })

  it('consent.status：接受服务端全谱系，拒绝旧猜测值 PENDING/GRANTED', () => {
    for (const s of CONSENT_STATES) expect(consent(s).success).toBe(true)
    expect(consent('PENDING').success).toBe(false)
    expect(consent('GRANTED').success).toBe(false)
  })

  it('action.jobs[].status：接受服务端全谱系，拒绝旧猜测值 RETRY/DONE', () => {
    for (const s of ACTION_JOB_STATUSES) expect(action(s).success).toBe(true)
    expect(action('RETRY').success).toBe(false)
    expect(action('DONE').success).toBe(false)
  })

  it('outcome.level：接受三档真实档位，拒绝从未存在的 EVIDENCE_BACKED', () => {
    for (const l of OUTCOME_LEVELS) expect(outcome(l).success).toBe(true)
    expect(outcome('EVIDENCE_BACKED').success).toBe(false)
  })

  it('取值域是**白名单**而非任意字符串', () => {
    expect(consent('WHATEVER').success).toBe(false)
    expect(action('WHATEVER').success).toBe(false)
    expect(outcome('WHATEVER').success).toBe(false)
  })
})

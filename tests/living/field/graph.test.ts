/**
 * Living Connection OS · P2 —— Field 关系网络**装配器**单测（`src/lib/living/field/graph.ts`）
 *
 * 装配器是**纯函数、零 IO**，所以这里可以直接喂"服务端真实响应形状"的载荷，
 * 把五条纪律逐条钉死：
 *   1. 零 IO / 确定性：同输入恒同输出，位置是整数（否则"同一布局"无法断言）；
 *   2. 不猜、不美化：状态 / 桶 / 原因码一律取自服务端，映射表缺键时回退原始码；
 *   3. **来源不可用 ≠ 没有数据**：读取失败不产节点，也不复用空态文案；
 *   4. 不静默丢：门控计数、considered、受众档位、截断规模都产出 note；
 *   5. 截断可见：超出图容量必须说明"图上的不是全量"。
 *
 * 另有两条本切片特有的诚实点：
 *   · 未授权姓名 ⇒ 用可核对的标识，**不编名字**；
 *   · 提案投影**不含双方身份** ⇒ 提案节点不连向任何候选（连了就是编造关系）。
 */

import type { CandidateList, CandidateView } from '@/lib/connection/candidates'
import type { DisclosedProfile } from '@/lib/connection/disclosure'
import type { OrgConnectionRow, OrgConnectionsResult } from '@/lib/connection/operations'
import {
  FIELD_LIMITS,
  FIELD_LAYOUT,
  FIELD_NO_CANDIDATE_LABELS,
  FIELD_NO_CANDIDATE_REASONS,
  assembleFieldGraph,
  depthToOpacity,
  depthToScale,
  findFieldNode,
  normalizeDepth,
  type FieldGraph,
  type FieldGraphNode,
  type FieldInput,
} from '@/lib/living/field'

// ─────────────────────────────────────────────────────────────────────────────
// 夹具：形状逐字对齐服务端（这样"载荷 → 图"的链路可以在单测里复跑）
// ─────────────────────────────────────────────────────────────────────────────

const candidate = (over: Partial<CandidateView> = {}, i = 0): CandidateView => ({
  intentId: `intent-${i}`,
  userId: `user-${i}`,
  need: `需要 ${i} 号资源`,
  offer: `能提供 ${i} 号能力`,
  evidence: { myNeedTheirsOffer: [`词元A${i}`], theirNeedMyOffer: [`词元B${i}`] },
  matchedTokens: 10,
  subject: { displayName: `候选人${i}` },
  ...over,
})

const candidateList = (
  candidates: CandidateView[],
  over: Partial<CandidateList> = {},
): CandidateList => ({
  missionId: 'mission-1',
  candidates,
  noCandidatesReason: null,
  gatedOut: [],
  considered: candidates.length,
  profileAudience: 'CANDIDATE',
  ...over,
})

const proposal = (over: Partial<OrgConnectionRow> = {}, i = 0): OrgConnectionRow => ({
  proposalId: `prop-${i}`,
  missionId: 'mission-1',
  missionTitle: `任务 ${i}`,
  state: 'CONSENT_PENDING',
  bucket: 'PENDING_CONSENT',
  introduced: false,
  introducedAt: null,
  closedAt: null,
  expiresAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  stage: null,
  stageEnteredAt: null,
  stalled: false,
  canIntroduce: false,
  introduceBlockers: [],
  ...over,
})

const pipeline = (
  items: OrgConnectionRow[],
  over: Partial<OrgConnectionsResult> = {},
): OrgConnectionsResult => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 50,
  scanned: items.length,
  truncated: false,
  summary: {
    ALL: items.length,
    PENDING_CONSENT: 0,
    READY_TO_INTRODUCE: 0,
    INTRODUCED: 0,
    CLOSED: 0,
  },
  ...over,
})

const ok = <T>(value: T) => ({ data: value, error: null, isLoading: false })

function input(over: Partial<FieldInput> = {}): FieldInput {
  return {
    candidates: { data: null, error: null, isLoading: false },
    pipeline: { data: null, error: null, isLoading: false },
    viewerLabel: null,
    ...over,
  }
}

const notesOf = (g: FieldGraph) => g.notes.join('\n')
const candidatesOf = (g: FieldGraph) => g.nodes.filter((n) => n.kind === 'candidate')
const proposalsOf = (g: FieldGraph) => g.nodes.filter((n) => n.kind === 'proposal')
const radiusOf = (n: FieldGraphNode) => Math.hypot(n.position.x, n.position.y)

// ─────────────────────────────────────────────────────────────────────────────

describe('中心节点（viewer）', () => {
  it('恒存在、depth=1、落在原点；未给名字时用中性标签', () => {
    const g = assembleFieldGraph(input())
    expect(g.nodes).toHaveLength(1)
    expect(g.nodes[0]).toMatchObject({
      id: 'viewer',
      kind: 'viewer',
      depth: 1,
      label: '你',
      position: FIELD_LAYOUT.CENTER,
    })
    expect(g.edges).toEqual([])
  })

  it('有名字时用会话里的显示名；纯空白不算名字', () => {
    expect(assembleFieldGraph(input({ viewerLabel: '张三' })).nodes[0].label).toBe('张三')
    expect(assembleFieldGraph(input({ viewerLabel: '   ' })).nodes[0].label).toBe('你')
    expect(assembleFieldGraph(input({ viewerLabel: null })).nodes[0].label).toBe('你')
  })
})

describe('纪律 3：来源不可用 ≠ 没有数据', () => {
  it('候选读取失败 ⇒ 只有中心节点 + 一条写明原因的 note', () => {
    const g = assembleFieldGraph(input({ candidates: { data: null, error: 'HTTP 500', isLoading: false } }))
    expect(candidatesOf(g)).toHaveLength(0)
    expect(notesOf(g)).toContain('候选来源不可用（HTTP 500）')
    // 明说"读不到"与"真的没有"是两件事 —— 不许混用一句话
    expect(notesOf(g)).toContain('两件事')
  })

  it('提案读取失败 ⇒ 不产提案节点 + 一条写明原因的 note', () => {
    const g = assembleFieldGraph(input({ pipeline: { data: null, error: 'network', isLoading: false } }))
    expect(proposalsOf(g)).toHaveLength(0)
    expect(notesOf(g)).toContain('提案来源不可用（network）')
  })

  it('加载中不是结论 ⇒ 不产节点，也不产 note（不许假装"没有数据"）', () => {
    const g = assembleFieldGraph(
      input({
        candidates: { data: null, error: null, isLoading: true },
        pipeline: { data: null, error: null, isLoading: true },
      }),
    )
    expect(candidatesOf(g)).toHaveLength(0)
    expect(proposalsOf(g)).toHaveLength(0)
    expect(g.notes).toEqual([])
  })
})

describe('纪律 2：空候选要说清是哪一种"没有"', () => {
  it('四个原因码各自产出一条可执行的说明（不是"暂无数据"）', () => {
    for (const reason of FIELD_NO_CANDIDATE_REASONS) {
      const g = assembleFieldGraph(
        input({ candidates: ok(candidateList([], { noCandidatesReason: reason })) }),
      )
      expect(candidatesOf(g)).toHaveLength(0)
      expect(g.notes).toContain(FIELD_NO_CANDIDATE_LABELS[reason])
    }
  })

  it('空候选却没有原因码 ⇒ 明说是服务端契约问题，不替它猜原因', () => {
    const g = assembleFieldGraph(
      input({ candidates: ok(candidateList([], { noCandidatesReason: null })) }),
    )
    expect(notesOf(g)).toContain('服务端契约问题')
    expect(notesOf(g)).toContain('不替它猜原因')
  })
})

describe('2.5D：半径 = 关系强度（可复算，不是"看着好看"）', () => {
  const cs = [
    candidate({ matchedTokens: 10 }, 0),
    candidate({ matchedTokens: 30 }, 1),
    candidate({ matchedTokens: 20 }, 2),
  ]
  const g = assembleFieldGraph(input({ candidates: ok(candidateList(cs)) }))
  const byId = (id: string) => candidatesOf(g).find((n) => n.id === id) as FieldGraphNode

  it('depth 做 min-max 归一化：最强=1、最弱=0、中间按比例', () => {
    expect(byId('cand:user-1').depth).toBe(1)
    expect(byId('cand:user-0').depth).toBe(0)
    expect(byId('cand:user-2').depth).toBeCloseTo(0.5, 10)
  })

  it('越强越靠近中心（半径单调递减）', () => {
    expect(radiusOf(byId('cand:user-1'))).toBeLessThan(radiusOf(byId('cand:user-2')))
    expect(radiusOf(byId('cand:user-2'))).toBeLessThan(radiusOf(byId('cand:user-0')))
  })

  it('半径落在声明区间内（near..far）', () => {
    for (const n of candidatesOf(g)) {
      expect(radiusOf(n)).toBeGreaterThanOrEqual(FIELD_LAYOUT.CANDIDATE_R_NEAR - 1)
      expect(radiusOf(n)).toBeLessThanOrEqual(FIELD_LAYOUT.CANDIDATE_R_FAR + 1)
    }
  })

  it('边权是**真实计数**（不做归一化），每个候选一条互补边', () => {
    const edges = g.edges.filter((e) => e.kind === 'reciprocal')
    expect(edges).toHaveLength(3)
    expect(edges.find((e) => e.target === 'cand:user-1')?.weight).toBe(30)
    for (const e of edges) expect(e.source).toBe('viewer')
  })

  it('所有候选强度相同 ⇒ depth 全为 1（无从比较强弱时，都算"最近"）', () => {
    const flat = assembleFieldGraph(
      input({
        candidates: ok(
          candidateList([candidate({ matchedTokens: 7 }, 0), candidate({ matchedTokens: 7 }, 1)]),
        ),
      }),
    )
    expect(candidatesOf(flat).map((n) => n.depth)).toEqual([1, 1])
  })
})

describe('确定性：位置是数据的函数，没有随机 / 力导向', () => {
  const build = () =>
    assembleFieldGraph(
      input({
        candidates: ok(
          candidateList([candidate({ matchedTokens: 5 }, 0), candidate({ matchedTokens: 9 }, 1)]),
        ),
        pipeline: ok(pipeline([proposal({}, 0), proposal({}, 1)])),
        viewerLabel: '张三',
      }),
    )

  it('同输入两次装配结果深度相等（含坐标）', () => {
    expect(build()).toEqual(build())
  })

  it('所有坐标都是整数（round 消掉了浮点尾差，否则"同一布局"无法断言）', () => {
    for (const n of build().nodes) {
      expect(Number.isInteger(n.position.x)).toBe(true)
      expect(Number.isInteger(n.position.y)).toBe(true)
    }
  })

  it('单候选落在起始角（正上方），且用最近半径', () => {
    const g = assembleFieldGraph(input({ candidates: ok(candidateList([candidate()])) }))
    const c = candidatesOf(g)[0]
    expect(c.position.y).toBe(-FIELD_LAYOUT.CANDIDATE_R_NEAR)
    expect(Math.abs(c.position.x)).toBeLessThanOrEqual(1)
  })
})

describe('候选的命名与披露（不编造、不美化）', () => {
  it('未授权任何可命名字段 ⇒ 用可核对的标识，named=false 并给一条 note', () => {
    const anon = candidate({ userId: 'abcdef1234567890', subject: {} }, 0)
    const g = assembleFieldGraph(input({ candidates: ok(candidateList([anon])) }))
    const n = candidatesOf(g)[0]
    expect(n.label).toContain('abcdef12')
    expect(n.detail?.named).toBe(false)
    expect(notesOf(g)).toContain('未授权任何可命名字段')
  })

  it('已授权姓名 ⇒ named=true，且不产那条 note', () => {
    const g = assembleFieldGraph(input({ candidates: ok(candidateList([candidate({}, 0)])) }))
    expect(candidatesOf(g)[0].detail?.named).toBe(true)
    expect(notesOf(g)).not.toContain('未授权任何可命名字段')
  })

  it('取名按优先级：displayName 是空白时退到 occupation（不是"有键就用"）', () => {
    const subject: DisclosedProfile = { displayName: '   ', occupation: '设计师' }
    const g = assembleFieldGraph(input({ candidates: ok(candidateList([candidate({ subject }, 0)])) }))
    expect(candidatesOf(g)[0].label).toBe('设计师')
    expect(candidatesOf(g)[0].detail?.named).toBe(true)
  })

  it('披露字段：键不存在就**不产行**（不是"空值"）；键存在但为空 ⇒ 明确显示（空）', () => {
    const subject: DisclosedProfile = { displayName: '张三', age: 30, selectedTags: ['A', 'B'], email: '' }
    const g = assembleFieldGraph(input({ candidates: ok(candidateList([candidate({ subject }, 0)])) }))
    const rows = candidatesOf(g)[0].detail?.disclosed ?? []
    expect(rows.map((r) => r.key)).toEqual(['displayName', 'age', 'selectedTags', 'email'])
    expect(rows.find((r) => r.key === 'age')?.value).toBe('30')
    expect(rows.find((r) => r.key === 'age')?.label).toBe('年龄')
    expect(rows.find((r) => r.key === 'selectedTags')?.value).toBe('A、B')
    expect(rows.find((r) => r.key === 'email')?.value).toBe('（空）')
    // 未出现在投影里的键一个都不产行（渲染成"城市：—"也是一种编造）
    expect(rows.map((r) => r.key)).not.toContain('city')
  })

  it('正文与互补词元原样带出，供详情面板复算', () => {
    const g = assembleFieldGraph(input({ candidates: ok(candidateList([candidate({}, 3)])) }))
    const d = candidatesOf(g)[0].detail
    expect(d?.need).toBe('需要 3 号资源')
    expect(d?.offer).toBe('能提供 3 号能力')
    expect(d?.evidence.myNeedTheirsOffer).toEqual(['词元A3'])
    expect(d?.evidence.theirNeedMyOffer).toEqual(['词元B3'])
    expect(d?.matchedTokens).toBe(10)
  })
})

describe('纪律 4 / 5：不静默丢、截断可见', () => {
  it('门控损耗、considered 与受众档位都要说清（否则用户读不懂"为什么只有这些"）', () => {
    const g = assembleFieldGraph(
      input({
        candidates: ok(
          candidateList([candidate({}, 0)], {
            gatedOut: [
              { code: 'cross_tenant', count: 2 },
              { code: 'self', count: 1 },
            ],
            considered: 5,
          }),
        ),
      }),
    )
    const notes = notesOf(g)
    expect(notes).toContain('另有 3 条意图被硬门控排除')
    expect(notes).toContain('跨租户 ×2')
    expect(notes).toContain('你自己 ×1')
    expect(notes).toContain('5 条')
    // 受众档位是自描述的 ⇒ 审计能看见"用的是哪一档"，而不是去读代码猜
    expect(notes).toContain('CANDIDATE')
  })

  it('候选超过图容量 ⇒ 截断并被明确说出来（"图上的不是全量"）', () => {
    const many = Array.from({ length: FIELD_LIMITS.maxCandidates + 6 }, (_, i) => candidate({}, i))
    const g = assembleFieldGraph(input({ candidates: ok(candidateList(many)) }))
    expect(candidatesOf(g)).toHaveLength(FIELD_LIMITS.maxCandidates)
    const notes = notesOf(g)
    expect(notes).toContain(`候选共 ${many.length} 条`)
    expect(notes).toContain(`前 ${FIELD_LIMITS.maxCandidates} 条`)
    expect(notes).toContain('图上的不是全量')
  })

  it('提案被扫描窗口截断时，"共 N 条"不得被当成社群全量（AC-09）', () => {
    const g = assembleFieldGraph(
      input({ pipeline: ok(pipeline([proposal({}, 0)], { scanned: 300, truncated: true })) }),
    )
    const notes = notesOf(g)
    expect(notes).toContain('被扫描窗口截断')
    expect(notes).toContain('300')
    expect(notes).toContain('估算')
  })

  it('窗口内分桶计数要写出来（tab 上的数字与过滤无关）', () => {
    const g = assembleFieldGraph(
      input({
        pipeline: ok(
          pipeline([proposal({}, 0)], {
            summary: { ALL: 4, PENDING_CONSENT: 3, READY_TO_INTRODUCE: 1, INTRODUCED: 0, CLOSED: 0 },
          }),
        ),
      }),
    )
    const notes = notesOf(g)
    expect(notes).toContain('PENDING_CONSENT 3')
    expect(notes).toContain('READY_TO_INTRODUCE 1')
    // 计数为 0 的档不写（否则说明里全是噪音）
    expect(notes).not.toContain('CLOSED 0')
  })
})

describe('提案节点：诚实边界', () => {
  it('提案走独立外环、**不连向任何候选**（服务端投影不含双方身份）', () => {
    const g = assembleFieldGraph(
      input({
        candidates: ok(candidateList([candidate({}, 0)])),
        pipeline: ok(pipeline([proposal({}, 0)])),
      }),
    )
    const propEdges = g.edges.filter((e) => e.kind === 'proposal')
    expect(propEdges).toHaveLength(1)
    // 提案边只从中心出发 ⇒ 图上不存在"提案 → 候选"这种凭空关系
    expect(propEdges.every((e) => e.source === 'viewer')).toBe(true)
    expect(g.edges.some((e) => e.kind === 'proposal' && e.source !== 'viewer')).toBe(false)
    expect(notesOf(g)).toContain('刻意不含')
  })

  it('提案的"强度"服务端没给 ⇒ weight 恒 1、深度固定 0.5（不编造强弱）', () => {
    const g = assembleFieldGraph(input({ pipeline: ok(pipeline([proposal({}, 0), proposal({}, 1)])) }))
    expect(proposalsOf(g).map((n) => n.depth)).toEqual([0.5, 0.5])
    expect(g.edges.filter((e) => e.kind === 'proposal').map((e) => e.weight)).toEqual([1, 1])
  })

  it('提案半径在外环（与候选环不重叠）', () => {
    const g = assembleFieldGraph(input({ pipeline: ok(pipeline([proposal({}, 0)])) }))
    expect(radiusOf(proposalsOf(g)[0])).toBeGreaterThan(FIELD_LAYOUT.CANDIDATE_R_FAR)
  })

  it('不可介绍的提案必须带逐条原因文案（AC-18：不可执行要说明为什么）', () => {
    const g = assembleFieldGraph(
      input({
        pipeline: ok(
          pipeline([
            proposal(
              {
                canIntroduce: false,
                introduceBlockers: ['not_mutually_accepted', 'proposer_intent_not_live'],
              },
              0,
            ),
          ]),
        ),
      }),
    )
    const p = proposalsOf(g)[0].proposal
    expect(p?.canIntroduce).toBe(false)
    expect(p?.blockers.map((b) => b.code)).toEqual([
      'not_mutually_accepted',
      'proposer_intent_not_live',
    ])
    for (const b of p?.blockers ?? []) expect(b.label.trim().length).toBeGreaterThan(0)
  })

  it('空提案是真实结果 ⇒ 明写"不是加载失败"', () => {
    const g = assembleFieldGraph(input({ pipeline: ok(pipeline([])) }))
    expect(notesOf(g)).toContain('这是真实结果，不是加载失败')
  })

  it('提案标题缺失 ⇒ 用可核对的短标识，不编标题', () => {
    const g = assembleFieldGraph(
      input({ pipeline: ok(pipeline([proposal({ missionTitle: null, proposalId: 'prop-abcdef123456' }, 0)])) }),
    )
    expect(proposalsOf(g)[0].label).toContain('prop-abc')
  })
})

describe('findFieldNode', () => {
  it('按 id 取节点；null / 未知 id 一律返回 null（不抛）', () => {
    const g = assembleFieldGraph(input({ candidates: ok(candidateList([candidate({}, 0)])) }))
    expect(findFieldNode(g, 'viewer')?.kind).toBe('viewer')
    expect(findFieldNode(g, 'cand:user-0')?.kind).toBe('candidate')
    expect(findFieldNode(g, null)).toBeNull()
    expect(findFieldNode(g, 'nope')).toBeNull()
  })
})

describe('深度 → 视觉参数（映射单点，渲染层不另算一套）', () => {
  it('单调、有界；越界与 NaN 被夹紧', () => {
    expect(depthToScale(0)).toBeCloseTo(0.82, 10)
    expect(depthToScale(1)).toBeCloseTo(1, 10)
    expect(depthToOpacity(0)).toBeCloseTo(0.55, 10)
    expect(depthToOpacity(1)).toBeCloseTo(1, 10)
    expect(depthToScale(0)).toBeLessThan(depthToScale(0.5))
    expect(depthToScale(0.5)).toBeLessThan(depthToScale(1))
    expect(depthToScale(5)).toBe(1)
    expect(depthToScale(-3)).toBeCloseTo(0.82, 10)
    expect(depthToOpacity(Number.NaN)).toBeCloseTo(0.55, 10)
  })

  it('normalizeDepth：空 → 空；全等 → 全 1；否则 min-max 到 [0,1]', () => {
    expect(normalizeDepth([])).toEqual([])
    expect(normalizeDepth([4, 4, 4])).toEqual([1, 1, 1])
    expect(normalizeDepth([0, 5, 10])).toEqual([0, 0.5, 1])
  })
})

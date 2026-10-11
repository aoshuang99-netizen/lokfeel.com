/**
 * T04 · 双向互补召回与可解释排序 —— 固定测试集（AC-13 的证据）
 *
 * AC-13 原文：**硬过滤优先，推荐有依据；无候选时不伪造结果**（证据：固定测试集）。
 * 因此本文件的写法刻意围绕三件事：
 *
 *   ① **固定测试集**：下面 `FIXTURE` 是写死的输入，断言到**具体词元**
 *      （不是"长度 > 0"这种糊得过去的断言）。换实现若改变结果，必红。
 *   ② **硬过滤优先**：用**变异**证明门控真的被执行 —— 把租户/参与人集合改成
 *      "会全数拒绝"的值，断言候选归零且原因码正确。若门控只是装饰，这两条会绿。
 *   ③ **无候选不伪造**：三种"没候选"的原因各自有用例，且断言 `candidates` 为空。
 *
 * 不 import barrel（`@/lib/connection`），避免 ESM 传递依赖（T03 踩过的坑）。
 */
import { CANDIDATE_PROFILE_AUDIENCE } from '@/lib/connection/field-catalog'
import {
  RECALL_GATES,
  applyGates,
  buildCandidates,
  explainCandidate,
  markGated,
  overlapTokens,
  recall,
  tokenize,
  type GateContext,
  type RecallRow,
} from '@/lib/connection/recall'

// ═══════════════════════════════════════════════════════════════
// 固定测试集（写死；改它就必须重算下面每一条断言）
// ═══════════════════════════════════════════════════════════════

const ORG = 'org-1'
const MISSION = 'mission-1'
const ME = 'user-me'

const ME_SIDE = {
  userId: ME,
  need: 'supply chain partner in indonesia',
  offer: 'sourcing agent network',
}

/**
 * 词元预算（供人工核对断言）：
 *   me.need  = [supply, chain, partner, indonesia]        （"in" 只有 2 字符 → 丢弃）
 *   me.offer = [sourcing, agent, network]
 */
const row = (
  userId: string,
  need: string,
  offer: string,
  patch: Partial<RecallRow> = {}
): RecallRow => ({
  intentId: `intent-${userId}`,
  userId,
  organizationId: ORG,
  missionId: MISSION,
  status: 'ACTIVE',
  expiresAt: null,
  need,
  offer,
  ...patch,
})

const FIXTURE_RAW: RecallRow[] = [
  // A：单向偏弱 —— myNeed∩theirOffer 只有 1 个，另一侧 3 个
  row('user-a', 'sourcing agent network', 'indonesia warehouse'),
  // B：双向都强 —— 7 个命中，两侧均衡
  row('user-b', 'sourcing agent network partner', 'indonesia supply chain partner'),
  // C：**单向**（theirNeed∩myOffer 为空）→ 必须被排除
  row('user-c', 'warehouse automation consultant', 'indonesia supply chain partner'),
  // D：已撤销 → 门控
  row('user-d', 'sourcing agent network', 'indonesia supply chain partner', { status: 'WITHDRAWN' }),
  // E：已过期 → 门控
  row('user-e', 'sourcing agent network', 'indonesia supply chain partner', {
    expiresAt: new Date('2026-01-01T00:00:00.000Z'),
  }),
  // F：不是该任务的 ACTIVE 参与人 → 门控
  row('user-f', 'sourcing agent network', 'indonesia supply chain partner'),
  // G：另一个租户 → 门控（应报 cross_tenant，而不是 not_participant）
  row('user-g', 'sourcing agent network', 'indonesia supply chain partner', { organizationId: 'org-2' }),
  // H：自己 → 门控
  row(ME, 'supply chain partner', 'sourcing agent network'),
]

const NOW = new Date('2026-10-11T00:00:00.000Z')

const CTX: GateContext = {
  organizationId: ORG,
  viewerId: ME,
  missionId: MISSION,
  activeParticipantIds: new Set([ME, 'user-a', 'user-b', 'user-c', 'user-d', 'user-e', 'user-g']),
  now: NOW,
}

// ═══════════════════════════════════════════════════════════════
// 词元化
// ═══════════════════════════════════════════════════════════════

describe('T04 · tokenize —— 确定性、无词典依赖', () => {
  test('拉丁：小写化、丢弃短于 3 的词元（in / ID / at 都被丢弃）', () => {
    // 说明：本模块**不内置英文停用词表** —— 那会让"召回结果由词典决定"，
    // 违背"固定测试集可复现"。因此 the 会保留（已知局限，见 risks.md）。
    expect(tokenize('Supply Chain in ID at the Base')).toEqual(['supply', 'chain', 'the', 'base'])
  })

  test('拉丁：标点与符号作为分隔符', () => {
    expect(tokenize('agent-network / sourcing;warehouse')).toEqual(['agent', 'network', 'sourcing', 'warehouse'])
  })

  test('CJK：按 2-gram 滑窗切分（不依赖分词词典）', () => {
    // 东南亚供应链 → 东南 / 南亚 / 亚供 / 供应 / 应链
    expect(tokenize('东南亚供应链')).toEqual(['东南', '南亚', '亚供', '供应', '应链'])
  })

  test('CJK 混排拉丁：两侧互不干扰', () => {
    expect(tokenize('我需要 indonesia 仓库')).toEqual(['我需', '需要', 'indonesia', '仓库'])
  })

  test('去重且保留首次出现顺序（依据列表可复现的前提）', () => {
    expect(tokenize('agent network agent network')).toEqual(['agent', 'network'])
  })

  test('空串与 undefined 安全', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize(undefined as unknown as string)).toEqual([])
  })
})

describe('T04 · overlapTokens', () => {
  test('按左侧首次出现顺序返回交集', () => {
    expect(overlapTokens(['b', 'a', 'c'], ['a', 'b'])).toEqual(['b', 'a'])
  })

  test('任一侧为空 → 空交集（不是"全命中"）', () => {
    expect(overlapTokens([], ['a'])).toEqual([])
    expect(overlapTokens(['a'], [])).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════
// 硬门控
// ═══════════════════════════════════════════════════════════════

describe('T04 · 硬门控（过滤必须发生在召回与排序之前）', () => {
  test('每个门控码都有对应用例，且拒绝原因精确', () => {
    const { allowed, blocked } = applyGates(FIXTURE_RAW, CTX)
    const byCode = Object.fromEntries(blocked.map((b) => [b.row.userId, b.code]))

    expect(byCode['user-a']).toBeUndefined()
    expect(byCode['user-b']).toBeUndefined()
    expect(byCode['user-c']).toBeUndefined()
    expect(byCode['user-d']).toBe('intent_not_active')
    expect(byCode['user-e']).toBe('intent_expired')
    expect(byCode['user-f']).toBe('not_participant')
    expect(byCode['user-g']).toBe('cross_tenant')
    expect(byCode[ME]).toBe('self')

    expect(allowed.map((r) => r.userId).sort()).toEqual(['user-a', 'user-b', 'user-c'])
  })

  test('门控顺序决定**首个**原因码（跨租户优先于"不是参与人"）', () => {
    // user-g 同时违反 cross_tenant 与 not_participant；必须报更根本的那个。
    const ctx = { ...CTX, activeParticipantIds: new Set([ME, 'user-a']) }
    const { blocked } = applyGates(FIXTURE_RAW, ctx)
    expect(blocked.find((b) => b.row.userId === 'user-g')?.code).toBe('cross_tenant')
  })

  test('门控清单的 code 与实现一一对应（防止新增门控忘了登记）', () => {
    expect(RECALL_GATES.map((g) => g.code)).toEqual([
      'cross_tenant',
      'intent_not_active',
      'intent_expired',
      'not_participant',
      'self',
    ])
  })

  test('显式传入门控清单可替换默认行为（管线可插拔，为 T05 的 consent/block 留位）', () => {
    const denyAll = [{ code: 'cross_tenant' as const, blocks: () => true }]
    const { allowed, blocked } = applyGates(FIXTURE_RAW, CTX, denyAll)
    expect(allowed).toHaveLength(0)
    expect(blocked).toHaveLength(FIXTURE_RAW.length)
  })
})

// ═══════════════════════════════════════════════════════════════
// 双向召回
// ═══════════════════════════════════════════════════════════════

describe('T04 · 双向互补召回', () => {
  const gated = markGated(applyGates(FIXTURE_RAW, CTX).allowed)

  test('只有**双向**命中才算候选；单向命中被排除（C 必须不在结果里）', () => {
    const hits = recall(ME_SIDE, gated)
    const ids = hits.map((h) => h.row.userId)
    expect(ids).toEqual(['user-a', 'user-b'])
    expect(ids).not.toContain('user-c')
  })

  test('依据是**具体词元**，不是百分比', () => {
    const hits = recall(ME_SIDE, gated)
    const b = hits.find((h) => h.row.userId === 'user-b')!
    // myNeed ∩ B.offer = supply, chain, partner, indonesia（4）
    expect(b.evidence.myNeedTheirsOffer).toEqual(['supply', 'chain', 'partner', 'indonesia'])
    // B.need ∩ myOffer = sourcing, agent, network（3；partner 不在我的 offer 里）
    expect(b.evidence.theirNeedMyOffer).toEqual(['sourcing', 'agent', 'network'])
    expect(b.matchedTokens).toBe(7)
  })

  test('recall 的入参是 GatedRow —— 未过门控的行无法传入（编译期约束）', () => {
    // @ts-expect-error 原始行不是 GatedRow，必须经 applyGates + markGated
    recall(ME_SIDE, FIXTURE_RAW)
  })
})

// ═══════════════════════════════════════════════════════════════
// 端到端管线：门控 → 召回 → 排序
// ═══════════════════════════════════════════════════════════════

describe('T04 · 管线（AC-13）', () => {
  test('固定测试集 → 候选顺序与依据完全确定', () => {
    const res = buildCandidates(ME_SIDE, FIXTURE_RAW, CTX)

    expect(res.candidates.map((c) => c.userId)).toEqual(['user-b', 'user-a'])
    expect(res.candidates.map((c) => c.matchedTokens)).toEqual([7, 4])
    expect(res.noCandidatesReason).toBeNull()
    expect(res.considered).toBe(3) // A/B/C 过了门控；C 在召回阶段被排除
  })

  test('门控确实是"硬"的：把租户改错 → 候选归零且原因为 all_gated_out', () => {
    const res = buildCandidates(ME_SIDE, FIXTURE_RAW, { ...CTX, organizationId: 'org-other' })
    expect(res.candidates).toEqual([])
    expect(res.noCandidatesReason).toBe('all_gated_out')
  })

  test('门控确实是"硬"的：参与人集合为空 → 候选归零（变异自证，防门控沦为装饰）', () => {
    const res = buildCandidates(ME_SIDE, FIXTURE_RAW, { ...CTX, activeParticipantIds: new Set() })
    expect(res.candidates).toEqual([])
    expect(res.noCandidatesReason).toBe('all_gated_out')
  })

  test('无候选三种原因各自语义正确（且一律返回空数组，不伪造）', () => {
    expect(buildCandidates(ME_SIDE, [], CTX).noCandidatesReason).toBe('no_other_intents')

    // ⚠️ 用 user-a（在参与人集合里）而不是随便编一个 id ——
    // 否则它会先被 not_participant 拦掉，把原因码从 no_reciprocal_overlap
    // 变成 all_gated_out，用例就"绿得没有意义"了。
    const onlyFar = [row('user-a', 'plumbing license renewal', 'garden landscaping')]
    expect(buildCandidates(ME_SIDE, onlyFar, CTX).noCandidatesReason).toBe('no_reciprocal_overlap')

    expect(
      buildCandidates(ME_SIDE, FIXTURE_RAW, { ...CTX, activeParticipantIds: new Set() }).noCandidatesReason
    ).toBe('all_gated_out')
  })

  test('被门控的明细只给原因码与计数，不泄露对方内容', () => {
    const res = buildCandidates(ME_SIDE, FIXTURE_RAW, CTX)
    expect(res.gatedOut).toEqual([
      { code: 'cross_tenant', count: 1 },
      { code: 'intent_expired', count: 1 },
      { code: 'intent_not_active', count: 1 },
      { code: 'not_participant', count: 1 },
      { code: 'self', count: 1 },
    ])
    expect(JSON.stringify(res.gatedOut)).not.toContain('user-')
  })

  test('同分时的顺序由 userId 决定 —— 与输入顺序无关（可复现性的关键）', () => {
    const tieA = row('user-aaa', 'sourcing agent network', 'indonesia supply chain')
    const tieB = row('user-bbb', 'sourcing agent network', 'indonesia supply chain')
    // 两个夹具用户都必须先过门控，否则候选为空、这条断言会"假绿"
    const tieCtx: GateContext = { ...CTX, activeParticipantIds: new Set([ME, 'user-aaa', 'user-bbb']) }

    const forward = buildCandidates(ME_SIDE, [tieA, tieB], tieCtx)
    const reversed = buildCandidates(ME_SIDE, [tieB, tieA], tieCtx)

    expect(forward.candidates).toHaveLength(2)
    expect(forward.candidates.map((c) => c.userId)).toEqual(['user-aaa', 'user-bbb'])
    expect(reversed.candidates.map((c) => c.userId)).toEqual(['user-aaa', 'user-bbb'])
  })

  test('limit 生效且不改变排序', () => {
    const res = buildCandidates(ME_SIDE, FIXTURE_RAW, CTX, { limit: 1 })
    expect(res.candidates.map((c) => c.userId)).toEqual(['user-b'])
  })

  test('🔴 内核不持有档案：返回形状里没有 subject，投影只发生在服务层', () => {
    // 决策 A：披露档位定为 `CANDIDATE`（见 field-catalog.ts）——
    // 候选**能看到档案**，但只限对方显式授权给「同任务的伙伴」那一档的字段。
    // 投影由服务层 `candidates.ts` 经 `discloseSubject()` 完成，**内核不参与**。
    // 所以内核的返回里不该出现任何档案字段：一旦出现，就说明投影被"顺手"
    // 塞进了排序层，AC-03 的"单一出口"就失效了。
    expect(CANDIDATE_PROFILE_AUDIENCE).toBe('CANDIDATE')

    const res = buildCandidates(ME_SIDE, FIXTURE_RAW, CTX)
    expect(res.candidates.length).toBeGreaterThan(0)
    for (const c of res.candidates) {
      // 连 `subject` 这个键都不该存在（类型与运行期双重确认）
      expect(Object.keys(c).sort()).toEqual(['evidence', 'intentId', 'matchedTokens', 'userId'])
    }
    // 整个内核响应里不得出现邮箱形态的字符串（防"顺手把 profile 带出来"）
    expect(JSON.stringify(res)).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i)
  })
})

// ═══════════════════════════════════════════════════════════════
// 解释
// ═══════════════════════════════════════════════════════════════

describe('T04 · 可解释性', () => {
  test('解释行引用实际命中的词元，且分两侧表述', () => {
    const hits = recall(ME_SIDE, markGated(applyGates(FIXTURE_RAW, CTX).allowed))
    const b = hits.find((h) => h.row.userId === 'user-b')!

    const lines = explainCandidate(b.evidence, { me: '你', them: '对方' })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('你需要 ↔ 对方提供：supply、chain、partner、indonesia')
    expect(lines[1]).toBe('对方需要 ↔ 你提供：sourcing、agent、network')
  })

  test('不输出百分比 / 分数（不可复算的数字比没有数字更糟）', () => {
    const hits = recall(ME_SIDE, markGated(applyGates(FIXTURE_RAW, CTX).allowed))
    const text = hits.flatMap((h) => explainCandidate(h.evidence, { me: '你', them: '对方' })).join('\n')
    expect(text).not.toMatch(/%|score|评分|匹配度/i)
  })
})

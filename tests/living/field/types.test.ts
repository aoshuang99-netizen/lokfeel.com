/**
 * Living Connection OS · P2 —— Field 的**服务端形状镜像**回归
 *
 * 为什么这个文件值一整个文件：
 * `src/lib/living/field/types.ts` 把五组服务端取值域**独立声明**了一份（前端要在渲染层
 * 按取值域分支；直接消费服务端联合类型会让"服务端新增一码"变成**静默少显示一类**）。
 * 镜像的正确性靠两根柱子，缺一不可：
 *   ① 编译期双向等价断言（`AssertTrue<Exact<镜像, 服务端>>`）—— 任一侧增删取值即 tsc 失败；
 *   ② 本文件的硬编码回归 —— 只有守卫时，两侧一起改会全绿，无人察觉语义已经变了。
 *
 * 本文件把两条都做满，并且不满足于"钉字符串"：
 *   · 硬编码：逐字钉住五组取值域（顺序也钉住，理由见门控那条）；
 *   · **真值比对**：直接跑服务端的运行期数据与纯函数（`RECALL_GATES`、`CONNECTION_BUCKETS`、
 *     `BUCKET_LABELS`、`deriveProposalState`、`evaluateIntroducibility`），断言镜像与之一致。
 *     这比只钉字符串强一层：它证明钉住的那串字**就是**服务端的行为，而不是我抄错之后
 *     两次抄成一样。
 *
 * 做法沿用 `tests/connection/operations.test.ts`：mock `@/lib/db`，**直接 import 具体模块**
 * （不经 barrel —— barrel 会把服务端依赖与 next-auth 的 ESM 传递链拖进来）。
 */

jest.mock('@/lib/db', () => {
  // 本文件只调用纯函数、只读常量，永不触库 ⇒ 给一个"任何属性都可调用"的桩即可。
  const anyModel = () => new Proxy({}, { get: () => jest.fn() })
  return { db: new Proxy({}, { get: () => anyModel() }) }
})

import { PIPELINE_REASONS, RECALL_GATES } from '@/lib/connection/recall'
import { BUCKET_LABELS, CONNECTION_BUCKETS } from '@/lib/connection/operations'
import { deriveProposalState, evaluateIntroducibility } from '@/lib/connection/proposals'
import type { ProposalStatus } from '@/lib/connection/proposals'
import {
  FIELD_BUCKET_LABELS,
  FIELD_BUCKETS,
  FIELD_GATE_CODES,
  FIELD_GATE_LABELS,
  FIELD_INTRODUCE_BLOCKER_LABELS,
  FIELD_INTRODUCE_BLOCKERS,
  FIELD_NO_CANDIDATE_LABELS,
  FIELD_NO_CANDIDATE_REASONS,
  FIELD_PROPOSAL_STATE_LABELS,
  FIELD_PROPOSAL_STATES,
  type FieldBucket,
  type FieldGateCode,
  type FieldIntroduceBlocker,
  type FieldNoCandidateReason,
  type FieldProposalState,
} from '@/lib/living/field'

const NOW = new Date('2026-10-14T00:00:00.000Z')
const PAST = new Date('2026-01-01T00:00:00.000Z')
const FUTURE = new Date('2027-01-01T00:00:00.000Z')
const INTRODUCED_AT = new Date('2026-05-01T00:00:00.000Z')

/** 文案表的"完整 + 无多余键 + 每条非空"检查（五组共用）。 */
function expectLabelMap<K extends string>(codes: readonly K[], labels: Record<K, string>): void {
  expect(Object.keys(labels).sort()).toEqual([...codes].sort())
  for (const code of codes) {
    expect(typeof labels[code]).toBe('string')
    expect(labels[code].trim().length).toBeGreaterThan(0)
  }
}

describe('镜像一 · 门控原因码', () => {
  it('逐字钉住取值域 —— 顺序也钉住：被记录的"首个原因"取决于门控顺序', () => {
    expect([...FIELD_GATE_CODES]).toEqual([
      'cross_tenant',
      'intent_not_active',
      'intent_expired',
      'not_participant',
      'self',
    ])
  })

  it('与服务端门控清单逐条一致（运行期真值，不是抄写）', () => {
    expect([...FIELD_GATE_CODES]).toEqual(RECALL_GATES.map((g) => g.code))
  })

  it('每一码都有一句人话，且没有多余键', () => {
    expectLabelMap<FieldGateCode>(FIELD_GATE_CODES, FIELD_GATE_LABELS)
  })
})

describe('镜像二 · 空候选原因码', () => {
  it('逐字钉住四种处境', () => {
    expect([...FIELD_NO_CANDIDATE_REASONS]).toEqual([
      'no_own_intent',
      'no_other_intents',
      'all_gated_out',
      'no_reciprocal_overlap',
    ])
  })

  it('服务端管线能产出的原因码是镜像的子集；`no_own_intent` 出自服务层前置，不在管线里', () => {
    const pipelineReasons = [...PIPELINE_REASONS] as string[]
    expect(pipelineReasons.length).toBeGreaterThan(0)
    for (const r of pipelineReasons) {
      expect(FIELD_NO_CANDIDATE_REASONS as readonly string[]).toContain(r)
    }
    // 自我证明：管线确实**不**产 no_own_intent（否则"子集"这句就是废话）
    expect(pipelineReasons).not.toContain('no_own_intent')
    // 但镜像必须含它 —— 它是服务层的一个重要出口（见 candidates.ts 第 ② 步前置）
    expect(FIELD_NO_CANDIDATE_REASONS as readonly string[]).toContain('no_own_intent')
  })

  it('每一码都有一句可执行的说明，且没有多余键', () => {
    expectLabelMap<FieldNoCandidateReason>(FIELD_NO_CANDIDATE_REASONS, FIELD_NO_CANDIDATE_LABELS)
  })

  it('说明里不出现「暂无数据」这类把四种处境混为一谈的话', () => {
    for (const r of FIELD_NO_CANDIDATE_REASONS) {
      expect(FIELD_NO_CANDIDATE_LABELS[r]).not.toContain('暂无')
    }
  })
})

describe('镜像三 · 运营分桶', () => {
  it('逐字钉住（含 ALL 这个"不过滤"档）', () => {
    expect([...FIELD_BUCKETS]).toEqual([
      'ALL',
      'PENDING_CONSENT',
      'READY_TO_INTRODUCE',
      'INTRODUCED',
      'CLOSED',
    ])
  })

  it('与服务端的分桶清单**及文案**完全一致（文案在这一组是可比对的真值）', () => {
    expect([...FIELD_BUCKETS]).toEqual([...CONNECTION_BUCKETS])
    expect(FIELD_BUCKET_LABELS).toEqual(BUCKET_LABELS)
  })

  it('文案表完整且无多余键', () => {
    expectLabelMap<FieldBucket>(FIELD_BUCKETS, FIELD_BUCKET_LABELS)
  })

  it('分桶 PENDING_CONSENT 与提案状态 CONSENT_PENDING 是两个词（词序不同，最容易看串）', () => {
    expect(FIELD_BUCKETS as readonly string[]).toContain('PENDING_CONSENT')
    expect(FIELD_BUCKETS as readonly string[]).not.toContain('CONSENT_PENDING')
    expect(FIELD_PROPOSAL_STATES as readonly string[]).toContain('CONSENT_PENDING')
    expect(FIELD_PROPOSAL_STATES as readonly string[]).not.toContain('PENDING_CONSENT')
  })
})

describe('镜像四 · 提案对外状态', () => {
  it('逐字钉住：DB 四态 + 派生的 EXPIRED（EXPIRED 不落库）', () => {
    expect([...FIELD_PROPOSAL_STATES]).toEqual([
      'CONSENT_PENDING',
      'MUTUALLY_ACCEPTED',
      'REJECTED',
      'REVOKED',
      'EXPIRED',
    ])
  })

  it('服务端派生函数的可达输出**永不越界**，且五态全被覆盖', () => {
    const statuses: ProposalStatus[] = ['CONSENT_PENDING', 'MUTUALLY_ACCEPTED', 'REJECTED', 'REVOKED']
    const reached = new Set<string>()
    for (const status of statuses) {
      for (const introducedAt of [null, INTRODUCED_AT]) {
        for (const expiresAt of [null, PAST, FUTURE]) {
          const state = deriveProposalState({ status, introducedAt, expiresAt }, NOW)
          expect(FIELD_PROPOSAL_STATES as readonly string[]).toContain(state)
          reached.add(state)
        }
      }
    }
    expect([...reached].sort()).toEqual([...FIELD_PROPOSAL_STATES].sort())
  })

  it('文案表完整且无多余键', () => {
    expectLabelMap<FieldProposalState>(FIELD_PROPOSAL_STATES, FIELD_PROPOSAL_STATE_LABELS)
  })
})

describe('镜像五 · 介绍阻断原因', () => {
  it('逐字钉住：纯函数层 5 条 + IO 层追加 2 条（AC-06 的"双方意图是否仍然生效"）', () => {
    expect([...FIELD_INTRODUCE_BLOCKERS]).toEqual([
      'already_introduced',
      'rejected',
      'revoked',
      'expired',
      'not_mutually_accepted',
      'proposer_intent_not_live',
      'candidate_intent_not_live',
    ])
  })

  it('纯函数层的可达阻断原因全在镜像内，且那五条全部可达', () => {
    const rows: { status: ProposalStatus; introducedAt: Date | null; expiresAt: Date | null }[] = [
      { status: 'CONSENT_PENDING', introducedAt: null, expiresAt: null },
      { status: 'CONSENT_PENDING', introducedAt: null, expiresAt: PAST },
      { status: 'MUTUALLY_ACCEPTED', introducedAt: null, expiresAt: null },
      { status: 'MUTUALLY_ACCEPTED', introducedAt: INTRODUCED_AT, expiresAt: null },
      { status: 'REJECTED', introducedAt: null, expiresAt: null },
      { status: 'REVOKED', introducedAt: null, expiresAt: null },
    ]
    const reached = new Set<string>()
    for (const row of rows) {
      const { blockers } = evaluateIntroducibility(row, NOW)
      for (const b of blockers) {
        expect(FIELD_INTRODUCE_BLOCKERS as readonly string[]).toContain(b)
        reached.add(b)
      }
    }
    expect([...reached].sort()).toEqual(
      ['already_introduced', 'expired', 'not_mutually_accepted', 'rejected', 'revoked'].sort(),
    )
    // 反向自证：双方已同意、未介绍、未过期 ⇒ 必须**没有**任何阻断（否则上面那组会虚高）
    expect(evaluateIntroducibility(rows[2], NOW).blockers).toEqual([])
    expect(evaluateIntroducibility(rows[2], NOW).introducible).toBe(true)
  })

  it('IO 层追加的两条在镜像里；且纯函数层永不产出它们（否则这两条就是多余的）', () => {
    expect(FIELD_INTRODUCE_BLOCKERS as readonly string[]).toContain('proposer_intent_not_live')
    expect(FIELD_INTRODUCE_BLOCKERS as readonly string[]).toContain('candidate_intent_not_live')
    const { blockers } = evaluateIntroducibility(
      { status: 'CONSENT_PENDING', introducedAt: null, expiresAt: null },
      NOW,
    )
    const asStrings = blockers as readonly string[]
    expect(asStrings).not.toContain('proposer_intent_not_live')
    expect(asStrings).not.toContain('candidate_intent_not_live')
  })

  it('文案表完整且无多余键（AC-18：不可执行的动作必须写明为什么）', () => {
    expectLabelMap<FieldIntroduceBlocker>(FIELD_INTRODUCE_BLOCKERS, FIELD_INTRODUCE_BLOCKER_LABELS)
  })
})

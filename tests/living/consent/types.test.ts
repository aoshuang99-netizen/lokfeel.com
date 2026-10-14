/**
 * P2 · Consent Gate —— 镜像取值域回归（硬编码 + 服务端真值比对）
 *
 * `src/lib/living/consent/types.ts` 把六组服务端取值域**独立声明**了一份
 * （渲染层要在客户端按取值域分支；直接消费服务端联合类型会让"服务端新增一码"
 * 变成**静默少显示一类**）。镜像的正确性靠两根柱子，缺一不可：
 *
 *   ① 编译期双向等价断言（`AssertTrue<Exact<镜像, 服务端>>`）
 *      —— 任一侧增删取值即 `tsc` 失败（TS2344）；防**单侧**漂移。
 *   ② 本文件的逐字硬编码 + 运行期真值比对
 *      —— 两侧一起改时守卫会全绿，只有硬编码能发现语义已经变了；防**双侧**漂移。
 *
 * 本文件不满足于"钉字符串"：它直接跑服务端的**运行期**数据与纯函数
 * （`DISCLOSURE_AUDIENCES` / `EXTERNAL_AUDIENCES` / `PROTECTED_FIELD_KEYS` /
 *  `audienceRank` / `audienceCanSee`），证明钉住的那串字**就是**服务端的行为，
 * 而不是抄错之后两次抄成一样。
 *
 * 导入方式沿用 `tests/living/field/types.test.ts`：**直接 import 具体模块**
 * （不经 `@/lib/connection` 这个 barrel —— barrel 会把服务端依赖拖进来）。
 */

import {
  AUDIENCE_ORDER,
  DISCLOSURE_AUDIENCES,
  EXTERNAL_AUDIENCES,
  PROTECTED_FIELD_KEYS,
  audienceCanSee,
  audienceRank,
  fieldSpec,
} from '@/lib/connection/field-catalog'
import {
  CONSENT_AUDIENCES,
  CONSENT_AUDIENCE_LABELS,
  CONSENT_DECISION_BODIES,
  CONSENT_DECISION_LABELS,
  CONSENT_EXTERNAL_AUDIENCES,
  CONSENT_EXTERNAL_AUDIENCE_LABELS,
  CONSENT_INTENT_STATUSES,
  CONSENT_INTENT_STATUS_LABELS,
  CONSENT_NO_DECISION_LABEL,
  CONSENT_PARTY_ROLES,
  CONSENT_PARTY_ROLE_LABELS,
  CONSENT_PROPOSAL_ACTIONS,
  CONSENT_PROPOSAL_ACTION_LABELS,
  CONSENT_PROPOSAL_STATES,
  CONSENT_PROPOSAL_STATE_LABELS,
  CONSENT_VISIBILITY_LADDER,
  type ConsentAudience,
  type ConsentExternalAudience,
  type ConsentIntentStatus,
  type ConsentPartyRole,
  type ConsentProposalAction,
  type ConsentProposalState,
} from '@/lib/living/consent'
import { FIELD_PROPOSAL_STATES } from '@/lib/living/field'

/** 文案表的"完整 + 无多余键 + 每条非空"检查（六组共用）。 */
function expectLabelMap<K extends string>(codes: readonly K[], labels: Record<K, string>): void {
  expect(Object.keys(labels).sort()).toEqual([...codes].sort())
  for (const code of codes) {
    expect(typeof labels[code]).toBe('string')
    expect(labels[code].trim().length).toBeGreaterThan(0)
  }
}

describe('镜像一 · 披露档位（顺序即权限）', () => {
  it('逐字钉住，且与服务端 DISCLOSURE_AUDIENCES 完全同序', () => {
    expect([...CONSENT_AUDIENCES]).toEqual(['SELF', 'ORGANIZER', 'COUNTERPARTY', 'CANDIDATE'])
    // 同序不是巧合：服务端的包含式判定 `rank(granted) >= rank(viewer)` 就吃这个次序
    expect([...CONSENT_AUDIENCES]).toEqual([...DISCLOSURE_AUDIENCES])
    expect([...CONSENT_AUDIENCES]).toEqual([...AUDIENCE_ORDER])
  })

  it('外部受众 = 档位去掉 SELF；与 EXTERNAL_AUDIENCES 一致', () => {
    expect([...CONSENT_EXTERNAL_AUDIENCES]).toEqual(['ORGANIZER', 'COUNTERPARTY', 'CANDIDATE'])
    expect([...CONSENT_EXTERNAL_AUDIENCES]).toEqual([...EXTERNAL_AUDIENCES])
    expect(CONSENT_EXTERNAL_AUDIENCES as readonly string[]).not.toContain('SELF')
  })

  it('可见性阶梯与外部受众同序（由窄到宽）', () => {
    expect([...CONSENT_VISIBILITY_LADDER]).toEqual([...CONSENT_EXTERNAL_AUDIENCES])
  })

  it('四档与三档都各有一句人话，且没有多余键', () => {
    expectLabelMap<ConsentAudience>(CONSENT_AUDIENCES, CONSENT_AUDIENCE_LABELS)
    expectLabelMap<ConsentExternalAudience>(
      CONSENT_EXTERNAL_AUDIENCES,
      CONSENT_EXTERNAL_AUDIENCE_LABELS,
    )
  })
})

describe('镜像一 · 包含式语义（本区最容易写反的一处）', () => {
  it('服务端 rank 与镜像的同序声明一致', () => {
    CONSENT_AUDIENCES.forEach((a, i) => expect(audienceRank(a)).toBe(i))
  })

  it('档位越大受众越广：更窄的受众看不到"更宽档"的字段', () => {
    // 本区最要紧的一条 —— 写反就是一次**静默越权展示**
    expect(audienceCanSee('COUNTERPARTY', 'CANDIDATE')).toBe(false)
    expect(audienceCanSee('CANDIDATE', 'COUNTERPARTY')).toBe(true)
    expect(audienceCanSee('ORGANIZER', 'COUNTERPARTY')).toBe(false)
    expect(audienceCanSee('CANDIDATE', 'ORGANIZER')).toBe(true)
  })

  it('SELF 档不披露给任何人（含 SELF 这个"传参"本身）', () => {
    for (const viewer of CONSENT_AUDIENCES) {
      expect(audienceCanSee('SELF', viewer)).toBe(false)
    }
  })

  it('CANDIDATE 必须比 COUNTERPARTY **更宽**（次序写反 = 未同意者看到只给对手方的字段）', () => {
    expect(audienceRank('COUNTERPARTY')).toBeLessThan(audienceRank('CANDIDATE'))
    expect(
      audienceCanSee('CANDIDATE', 'COUNTERPARTY'),
    ).toBe(true)
  })
})

describe('镜像二 · 意图对外状态', () => {
  it('逐字钉住（EXPIRED 是派生值，不落库）', () => {
    expect([...CONSENT_INTENT_STATUSES]).toEqual(['ACTIVE', 'WITHDRAWN', 'EXPIRED'])
    expectLabelMap<ConsentIntentStatus>(CONSENT_INTENT_STATUSES, CONSENT_INTENT_STATUS_LABELS)
  })
})

describe('镜像三 · 提案动作与请求体', () => {
  it('动作取值域与服务端 DecisionKind 同集', () => {
    expect([...CONSENT_PROPOSAL_ACTIONS]).toEqual(['ACCEPT', 'REJECT', 'REVOKE'])
    expectLabelMap<ConsentProposalAction>(CONSENT_PROPOSAL_ACTIONS, CONSENT_PROPOSAL_ACTION_LABELS)
  })

  it('请求体用小写，且**只有**接收/拒绝两个键（撤销走独立端点，不在这里）', () => {
    expect(Object.keys(CONSENT_DECISION_BODIES).sort()).toEqual(['ACCEPT', 'REJECT'])
    expect(CONSENT_DECISION_BODIES.ACCEPT).toEqual({ decision: 'accept' })
    expect(CONSENT_DECISION_BODIES.REJECT).toEqual({ decision: 'reject' })
    expect('REVOKE' in CONSENT_DECISION_BODIES).toBe(false)
  })

  it('我的表态文案覆盖三态，另有独立的"尚未表态"（null 不是取值域成员）', () => {
    expectLabelMap<ConsentProposalAction>(CONSENT_PROPOSAL_ACTIONS, CONSENT_DECISION_LABELS)
    expect(CONSENT_NO_DECISION_LABEL.trim().length).toBeGreaterThan(0)
    expect(Object.values(CONSENT_DECISION_LABELS)).not.toContain(CONSENT_NO_DECISION_LABEL)
  })
})

describe('镜像四 · 当事方角色', () => {
  it('逐字钉住', () => {
    expect([...CONSENT_PARTY_ROLES]).toEqual(['PROPOSER', 'CANDIDATE'])
    expectLabelMap<ConsentPartyRole>(CONSENT_PARTY_ROLES, CONSENT_PARTY_ROLE_LABELS)
  })
})

describe('镜像五 · 提案对外状态', () => {
  it('逐字钉住：DB 四态 + 派生的 EXPIRED', () => {
    expect([...CONSENT_PROPOSAL_STATES]).toEqual([
      'CONSENT_PENDING',
      'MUTUALLY_ACCEPTED',
      'REJECTED',
      'REVOKED',
      'EXPIRED',
    ])
    expectLabelMap<ConsentProposalState>(CONSENT_PROPOSAL_STATES, CONSENT_PROPOSAL_STATE_LABELS)
  })

  it('与 P2 · Field 的第二份镜像必须同集（两份镜像各写各的，因此要交叉钉住）', () => {
    expect([...CONSENT_PROPOSAL_STATES]).toEqual([...FIELD_PROPOSAL_STATES])
  })

  it('文案是**故意不同**的（本区是"当事方在等谁表态"的语境，不是运营分桶）', () => {
    // 只说清"措辞可以有别、取值域必须相同"这件事，避免下一个人把两处强行合并
    expect(CONSENT_PROPOSAL_STATE_LABELS.CONSENT_PENDING).toBe('等待双方表态')
    expect(CONSENT_PROPOSAL_STATE_LABELS.MUTUALLY_ACCEPTED).toBe('双方已同意')
  })
})

describe('结构性不可授权 ≠ 用户没开（镜像与目录必须对齐）', () => {
  it('联系方式类字段在服务端目录里就是 disclosable:false', () => {
    expect([...PROTECTED_FIELD_KEYS]).toEqual(['email'])
    expect(fieldSpec('email')?.disclosable).toBe(false)
    expect(fieldSpec('email')?.importable).toBe(false)
    // 反向自证：可披露字段**不在**受保护清单里（否则"三者分开渲染"就没有对象）
    expect(fieldSpec('displayName')?.disclosable).toBe(true)
    expect(PROTECTED_FIELD_KEYS as readonly string[]).not.toContain('displayName')
  })
})

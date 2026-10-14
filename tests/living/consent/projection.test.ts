/**
 * P2 · Consent Gate —— 逐字段披露投影**装配器**单测（`src/lib/living/consent/projection.ts`）
 *
 * 装配器是**纯函数、零 IO**，因此可以直接喂"服务端真实响应形状"的载荷，
 * 把六条纪律逐条钉死：
 *   1. 零 IO / 确定性：同输入恒同输出（含行序）；
 *   2. **不重算服务端派生值**：受众可见性只读 `visibleTo*` 键列表，不自己实现一遍
 *      `rank(granted) >= rank(viewer)`；行序取自字段目录；
 *   3. **来源不可用 ≠ 没有数据**：形状不认识 → 整块拒绝并写明原因；
 *   4. **结构性不可授权 ≠ 用户没开**：`protectedFields` 与 `withheld` 必须分开；
 *   5. **键的完整性有两条来路**：服务端键（真相）+ 本地目录（文案）；
 *      服务端多出目录没有的键 ⇒ 目录落后，必须**说出来**；
 *   6. 顺序确定（目录序 + 目录外按字母序）。
 *
 * 另有两条本区特有的诚实点：
 *   · 单调性**前端自证**（`cand ⊆ cp ⊆ org`）：倒挂不会报错，只会静默少显示/越权显示；
 *   · 动作**完全照搬**服务端下发的 `actions`，前端不自己算权限。
 */

import {
  actionRequest,
  assembleConsentGate,
  assembleProposalBoard,
  visibleKeysOf,
  type ConsentGateModel,
  type ConsentProposalBoard,
} from '@/lib/living/consent'

// ─────────────────────────────────────────────────────────────────────────────
// 夹具：形状逐字对齐服务端 `DisclosurePreview` / 提案投影
// ─────────────────────────────────────────────────────────────────────────────

const E = (key: string, label: string, sensitive = false) => ({ key, label, sensitive })

function basePayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intentId: 'intent-1',
    status: 'ACTIVE',
    summary: {
      byAudience: {
        ORGANIZER: [E('city', '城市'), E('occupation', '职业')],
        COUNTERPARTY: [E('company', '公司')],
        CANDIDATE: [E('industry', '行业')],
      },
      protectedFields: [E('email', '邮箱', true)],
      // 刻意与 byAudience 对齐（每个键只归一组；可见集合按包含式推出）
      visibleToOrganizer: ['city', 'occupation', 'company', 'industry'],
      visibleToCounterparty: ['company', 'industry'],
      visibleToCandidate: ['industry'],
      withheld: ['displayName', 'mysteryField'],
    },
    preview: {
      organizer: { city: '上海', occupation: '设计师', company: '某公司', industry: '设计' },
      counterparty: { company: '某公司', industry: '设计' },
      candidate: { industry: '设计' },
    },
    ...over,
  }
}

function gateOf(payload: unknown): ConsentGateModel {
  const r = assembleConsentGate(payload)
  if (!r.ok) throw new Error(`预期装配成功，实际失败：${r.error}`)
  return r.value
}

function boardOf(payload: unknown): ConsentProposalBoard {
  const r = assembleProposalBoard(payload)
  if (!r.ok) throw new Error(`预期装配成功，实际失败：${r.error}`)
  return r.value
}

const notesOf = (m: { notes: string[] }) => m.notes.join('\n')
const keysOf = (m: ConsentGateModel) => m.rows.map((r) => r.key)
const rowOf = (m: ConsentGateModel, key: string) => {
  const row = m.rows.find((r) => r.key === key)
  if (!row) throw new Error(`没有字段 ${key}`)
  return row
}

const proposal = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'prop-1',
  state: 'CONSENT_PENDING',
  rationale: '互补',
  myRole: 'PROPOSER',
  myDecision: null,
  counterpartDecision: 'ACCEPT',
  counterpart: { subject: { displayName: 'A', city: 'B' } },
  actions: ['ACCEPT', 'REJECT'],
  canIntroduce: false,
  introducedAt: null,
  expiresAt: null,
  ...over,
})

// ─────────────────────────────────────────────────────────────────────────────

describe('纪律 3：来源不可用 ≠ 没有数据', () => {
  it('载荷不是对象 ⇒ 整块拒绝，且错误指向顶层形状', () => {
    const r = assembleConsentGate(null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('顶层形状')
  })

  it('缺关键字段 ⇒ 报出**具体是哪个字段**（便于定位），不静默降级为空表', () => {
    const r = assembleConsentGate({})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('intentId')
  })

  it('未知的意图状态 ⇒ 拒绝（不是"当成 ACTIVE 处理"）', () => {
    const r = assembleConsentGate(basePayload({ status: 'PAUSED' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('status')
  })

  it('服务端新增字段不会让整块失效（输入侧是 looseObject，只对读到的字段严格）', () => {
    const payload = basePayload()
    ;(payload.summary as Record<string, unknown>).brandNewServerKey = { whatever: 1 }
    expect(() => gateOf(payload)).not.toThrow()
  })
})

describe('纪律 6：行序确定（目录序 + 目录外按字母序）', () => {
  it('行序 = 字段目录顺序；目录里没有的键追加在末尾', () => {
    const m = gateOf(basePayload())
    // 目录序：displayName(0) < city(3) < occupation(5) < company(6) < industry(7) < email(13)
    expect(keysOf(m)).toEqual([
      'displayName',
      'city',
      'occupation',
      'company',
      'industry',
      'email',
      'mysteryField',
    ])
  })

  it('同输入两次装配完全相等（表不会每次刷新重排）', () => {
    expect(gateOf(basePayload())).toEqual(gateOf(basePayload()))
  })

  it('目录外的键按字母序（不是"按服务端给的顺序"）', () => {
    const payload = basePayload()
    ;(payload.summary as Record<string, unknown>).withheld = ['zzz_new', 'aaa_new']
    const m = gateOf(payload)
    expect(keysOf(m).slice(-2)).toEqual(['aaa_new', 'zzz_new'])
  })
})

describe('纪律 5：键的完整性有两条来路（服务端键 = 真相，目录 = 文案）', () => {
  it('服务端给了标签就用服务端的', () => {
    const m = gateOf(basePayload())
    expect(rowOf(m, 'city').label).toBe('城市')
    expect(rowOf(m, 'email').label).toBe('邮箱')
  })

  it('withheld 只有键没有标签 ⇒ 回退到本地目录文案（displayName → 昵称）', () => {
    const m = gateOf(basePayload())
    expect(rowOf(m, 'displayName').label).toBe('昵称')
  })

  it('服务端下发了目录不认识的键 ⇒ 说出来（目录落后），并以原始键显示', () => {
    const m = gateOf(basePayload())
    expect(rowOf(m, 'mysteryField').label).toBe('mysteryField')
    expect(notesOf(m)).toContain('mysteryField')
    expect(notesOf(m)).toContain('目录落后于服务端')
  })

  it('没有目录外的键时**不产**那条 note（否则说明区全是噪音）', () => {
    const payload = basePayload()
    ;(payload.summary as Record<string, unknown>).withheld = ['displayName']
    expect(notesOf(gateOf(payload))).not.toContain('目录落后于服务端')
  })
})

describe('纪律 4：结构性不可授权 ≠ 用户没开', () => {
  const m = gateOf(basePayload())

  it('protectedFields 单列成行，标记 protectedFromDisclosure', () => {
    expect(rowOf(m, 'email').protectedFromDisclosure).toBe(true)
    expect(rowOf(m, 'email').audience).toBe('SELF')
  })

  it('withheld 的字段**不**被标记为结构性不可授权（两者必须分开）', () => {
    expect(rowOf(m, 'displayName').protectedFromDisclosure).toBe(false)
    expect(rowOf(m, 'displayName').audience).toBe('SELF')
    // 同样是"看不到"，但理由不同 —— 若混为一谈，用户会以为"勾上就能披露邮箱"
    expect(rowOf(m, 'email').protectedFromDisclosure).not.toBe(
      rowOf(m, 'displayName').protectedFromDisclosure,
    )
  })

  it('计数三者也分开（受众可见 / 仅自己 / 结构性不可授权）', () => {
    expect(m.totals).toEqual({
      disclosedToOrganizer: 4,
      disclosedToCounterparty: 2,
      disclosedToCandidate: 1,
      withheld: 2,
      protectedFields: 1,
    })
  })
})

describe('纪律 2：不重算服务端派生值', () => {
  it('受众计数**直接取服务端数组长度** —— 服务端说几条就是几条', () => {
    const payload = basePayload()
    const summary = payload.summary as Record<string, unknown>
    // 故意让"键列表长度"与"分组里的键"不一致：前端若自己重算就会给出 4，而不是 9
    summary.visibleToOrganizer = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    expect(gateOf(payload).totals.disclosedToOrganizer).toBe(9)
  })

  it('档位只读服务端分组，不从 `visibleTo*` 反推', () => {
    const payload = basePayload()
    const summary = payload.summary as Record<string, unknown>
    // 把 city 从可见列表里删掉，但保留在 ORGANIZER 分组里 ⇒ 档位仍应是 ORGANIZER
    summary.visibleToOrganizer = ['occupation', 'company', 'industry']
    expect(rowOf(gateOf(payload), 'city').audience).toBe('ORGANIZER')
    expect(rowOf(gateOf(payload), 'city').audienceLabel).toBe('组织者')
  })
})

describe('单调性自证（`cand ⊆ cp ⊆ org`；倒挂是静默的，必须被说出来）', () => {
  it('服务端数据自洽时**不产**倒挂 note', () => {
    expect(notesOf(gateOf(basePayload()))).not.toContain('倒挂')
  })

  it('候选可见项超出对手方 ⇒ 产 note（更窄的受众看到了更多）', () => {
    const payload = basePayload()
    const summary = payload.summary as Record<string, unknown>
    summary.visibleToCandidate = ['industry', 'city'] // city 不在 cp 里
    expect(notesOf(gateOf(payload))).toContain('倒挂')
  })

  it('对手方可见项超出组织者 ⇒ 同样产 note', () => {
    const payload = basePayload()
    const summary = payload.summary as Record<string, unknown>
    // email 不在 visibleToOrganizer 里 —— 少了它这条用例就退化成"没倒挂"，测不出东西
    summary.visibleToCounterparty = ['company', 'industry', 'email']
    expect(notesOf(gateOf(payload))).toContain('倒挂')
  })

  it('即使倒挂，也**如实展示**服务端数据（不是悄悄修正）', () => {
    const payload = basePayload()
    const summary = payload.summary as Record<string, unknown>
    summary.visibleToCandidate = ['industry', 'city']
    const m = gateOf(payload)
    expect(rowOf(m, 'city').audience).toBe('ORGANIZER')
    expect(m.rows).toHaveLength(7)
  })
})

describe('值的字符串化：只做类型转换，不做美化', () => {
  const payload = basePayload()
  ;(payload.summary as Record<string, unknown>).byAudience = {
    ORGANIZER: [E('city', '城市'), E('age', '年龄', true), E('selectedTags', '兴趣标签'), E('bio', '个人简介'), E('avatarUrl', '头像')],
    COUNTERPARTY: [],
    CANDIDATE: [],
  }
  ;(payload.summary as Record<string, unknown>).withheld = []
  ;(payload.summary as Record<string, unknown>).protectedFields = []
  ;(payload.summary as Record<string, unknown>).visibleToOrganizer = []
  ;(payload.summary as Record<string, unknown>).visibleToCounterparty = []
  ;(payload.summary as Record<string, unknown>).visibleToCandidate = []
  ;(payload.preview as Record<string, unknown>).organizer = {
    city: 30,
    age: 30,
    selectedTags: ['A', 'B'],
    bio: '',
    avatarUrl: [],
  }

  const m = gateOf(payload)

  it('数字 → 十进制字符串（不补单位、不加千分位）', () => {
    expect(rowOf(m, 'city').values.ORGANIZER).toBe('30')
  })

  it('数组 → 顿号连接', () => {
    expect(rowOf(m, 'selectedTags').values.ORGANIZER).toBe('A、B')
  })

  it('空字符串 / 空数组 → null（不是"（空）"，那是 Field 那侧的措辞）', () => {
    expect(rowOf(m, 'bio').values.ORGANIZER).toBeNull()
    expect(rowOf(m, 'avatarUrl').values.ORGANIZER).toBeNull()
  })

  it('投影里根本没有这个键 ⇒ 该受众列为 null（不是空串）', () => {
    expect(rowOf(m, 'city').values.CANDIDATE).toBeNull()
    expect(rowOf(m, 'city').values.COUNTERPARTY).toBeNull()
  })
})

describe('visibleKeysOf：直接读服务端的键列表', () => {
  it('三个受众各取各的', () => {
    const p = basePayload()
    expect(visibleKeysOf(p, 'ORGANIZER')).toEqual(['city', 'occupation', 'company', 'industry'])
    expect(visibleKeysOf(p, 'COUNTERPARTY')).toEqual(['company', 'industry'])
    expect(visibleKeysOf(p, 'CANDIDATE')).toEqual(['industry'])
  })

  it('载荷不可用 ⇒ null（由调用方转成"读不到"，而不是"没有"）', () => {
    expect(visibleKeysOf(null, 'ORGANIZER')).toBeNull()
    expect(visibleKeysOf({}, 'CANDIDATE')).toBeNull()
  })
})

describe('提案板：动作照搬服务端，不自算权限', () => {
  it('字段映射与文案正确', () => {
    const b = boardOf([proposal()])
    expect(b.rows[0]).toMatchObject({
      id: 'prop-1',
      state: 'CONSENT_PENDING',
      stateLabel: '等待双方表态',
      myRole: 'PROPOSER',
      myRoleLabel: '我发起的',
      myDecisionLabel: '尚未表态',
      counterpartDecisionLabel: '已接受',
      canIntroduce: false,
      introducedAt: null,
      expiresAt: null,
    })
  })

  it('对侧投影的字段键：去重 + 排序（键存在即"确实授权了"，键不存在则根本不会出现）', () => {
    const b = boardOf([
      proposal({ counterpart: { subject: { city: 'B', displayName: 'A', city2: 'x' } } }),
    ])
    expect(b.rows[0].counterpartFieldKeys).toEqual(['city', 'city2', 'displayName'])
  })

  it('对侧投影缺失 ⇒ 空数组（不是"编一个键"）', () => {
    const b = boardOf([proposal({ counterpart: undefined })])
    expect(b.rows[0].counterpartFieldKeys).toEqual([])
  })

  it('`actions` 原样带出（前端不按状态自己推一遍）', () => {
    const b = boardOf([proposal({ actions: ['REVOKE'] })])
    expect(b.rows[0].availableActions).toEqual(['REVOKE'])
  })

  it('未知动作 / 未知状态 ⇒ 整个载荷被拒（契约是严格的，不做静默过滤）', () => {
    expect(assembleProposalBoard([proposal({ actions: ['ACCEPT', 'EXPLODE'] })]).ok).toBe(false)
    expect(assembleProposalBoard([proposal({ state: 'WHATEVER' })]).ok).toBe(false)
    expect(assembleProposalBoard('not-an-array').ok).toBe(false)
  })

  it('撤销方向的表态也能译出文案', () => {
    const b = boardOf([proposal({ myDecision: 'REVOKE', counterpartDecision: null })])
    expect(b.rows[0].myDecisionLabel).toBe('已撤销')
    expect(b.rows[0].counterpartDecisionLabel).toBe('尚未表态')
  })

  it('空提案是**真实结果** ⇒ 明写"不是读不到"', () => {
    const b = boardOf([])
    expect(b.rows).toEqual([])
    expect(notesOf(b)).toContain('不是"读不到"')
  })

  it('非空提案**不产**那条空态 note', () => {
    expect(notesOf(boardOf([proposal()]))).not.toContain('不是"读不到"')
  })
})

describe('actionRequest：撤销走独立端点', () => {
  it('接受 → POST consent，请求体小写 accept', () => {
    expect(actionRequest('p1', 'ACCEPT')).toEqual({
      url: '/api/v1/connections/p1/consent',
      body: { decision: 'accept' },
    })
  })

  it('拒绝 → 同一端点，请求体 reject', () => {
    expect(actionRequest('p1', 'REJECT')).toEqual({
      url: '/api/v1/connections/p1/consent',
      body: { decision: 'reject' },
    })
  })

  it('撤销 → 独立 `/revoke` 端点，且**不带** decision 字段', () => {
    const r = actionRequest('p1', 'REVOKE')
    expect(r.url).toBe('/api/v1/connections/p1/revoke')
    expect(r.body).toEqual({})
    expect('decision' in (r.body as Record<string, unknown>)).toBe(false)
  })

  it('提案 id 做 URL 编码（id 不是受我们控制的字符集）', () => {
    expect(actionRequest('a/b c', 'ACCEPT').url).toBe('/api/v1/connections/a%2Fb%20c/consent')
  })
})

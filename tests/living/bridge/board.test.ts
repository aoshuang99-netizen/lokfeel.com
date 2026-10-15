/**
 * T10 Slice 4 · Bridge 装配器 —— 行为回归
 *
 * 装配器是"服务端载荷 → 可渲染模型"的唯一通道，因此本文件逐条钉住它的**承诺**：
 *
 *   ① **①环是交集，不是单侧配置**。夹具刻意让单侧配置比交集**宽**（多出 email），
 *      断言卡片上"已同意共享"里**没有** email —— 这条写反就是一次越权展示。
 *   ② **我方可选范围按 side 二选一**（逐侧夹具：INITIATOR / RECIPIENT 各一条）。
 *      这与 ① 是本区最容易混淆的一对，必须各有独立证据。
 *   ③ **交集是上界**：跨群成员的 `subject` 里出现交集外的键 ⇒ 剔除 + 告警。
 *      服务端裁剪失效时，前端**不能**把它渲染出去（那是把泄漏显示在屏幕上）。
 *   ④ **来源不可用 ≠ 没有数据**：载荷形状不认识 → 整块拒绝并给出原因；
 *      "查询成功但为空" → 另一句话。
 *   ⑤ **不重算派生值**：`status` 原样透出（含 EXPIRED），`canX` 完全照搬服务端。
 */

import {
  assembleBridgeDetail,
  assembleBridgeDiscovery,
  assembleBridgeList,
  bridgeDecideRequest,
  bridgeOptInRequest,
  bridgeOptOutRequest,
  fieldLabelOf,
  orderFieldKeys,
  type BridgeAssembly,
} from '@/lib/living/bridge/board'

// ── 断言辅助：把 `{ok:false}` 变成一条带原因的失败，而不是 undefined 崩溃 ──
function expectOk<T>(out: BridgeAssembly<T>): T {
  if (!out.ok) throw new Error(`装配失败：${out.error}`)
  return out.value
}

const ORG_A = 'org_a'
const ORG_B = 'org_b'

/** 一份协议行。默认视角 = 发起方。 */
function bridgeRow(over: Record<string, unknown> = {}) {
  return {
    id: 'br_1',
    status: 'ACTIVE',
    storedStatus: 'ACTIVE',
    initiatorOrgId: ORG_A,
    recipientOrgId: ORG_B,
    side: 'INITIATOR',
    counterpartyOrgId: ORG_B,
    // 🔴 刻意让单侧配置比交集宽：发起方允许 4 个，被邀方只允许 2 个
    initiatorFieldKeys: ['city', 'company', 'displayName', 'email'],
    recipientFieldKeys: ['city', 'displayName'],
    agreedFieldKeys: ['city', 'displayName'],
    shareableMissionKinds: ['渠道合作'],
    purpose: '跨社群渠道撮合',
    initiatorApprovedAt: '2026-10-01T00:00:00.000Z',
    recipientApprovedAt: '2026-10-02T00:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    myOptIn: {
      id: 'oi_1',
      userId: 'u1',
      status: 'ACTIVE',
      disclosedFieldKeys: ['city'],
      optedInAt: '2026-10-03T00:00:00.000Z',
      withdrawnAt: null,
    },
    canApprove: false,
    canRevoke: true,
    canOptIn: true,
    canOptOut: true,
    ...over,
  }
}

// ═══════════════════════════════════════════════════════════
// ① 列表
// ═══════════════════════════════════════════════════════════

describe('assembleBridgeList · 形状与①环', () => {
  it('正常载荷 → 卡片；status/canX 原样透出（不重算）', () => {
    const model = expectOk(
      assembleBridgeList({ bridges: [bridgeRow({ status: 'EXPIRED' })], total: 1 }),
    )
    expect(model.cards).toHaveLength(1)
    expect(model.total).toBe(1)
    const c = model.cards[0]
    // 🔴 EXPIRED 是服务端派生的视图值，前端不得自己拿 expiresAt 再算一遍
    expect(c.status).toBe('EXPIRED')
    expect(c.statusLabel).toBe('已过期')
    expect(c.canApprove).toBe(false)
    expect(c.canRevoke).toBe(true)
    expect(c.canOptIn).toBe(true)
    expect(c.canOptOut).toBe(true)
  })

  it('🔴 已同意共享 = 双边交集，**不含**只有单侧允许的字段', () => {
    const c = expectOk(assembleBridgeList({ bridges: [bridgeRow()], total: 1 })).cards[0]
    // 排序按 DISCLOSURE_FIELDS 的目录顺序（displayName 在前），不是输入顺序 ——
    // 这条确定性排序本身就是契约（见 board.ts 的 orderFieldKeys 说明）。
    expect(c.agreedFieldKeys).toEqual(['displayName', 'city'])
    expect(c.agreedFieldKeys).not.toContain('email')
    expect(c.agreedFieldKeys).not.toContain('company')
    expect(c.agreedFieldLabels).toEqual(['昵称', '城市'])
  })

  it('🔴 我方可选范围按 side 二选一（逐侧夹具）', () => {
    const asInitiator = expectOk(assembleBridgeList({ bridges: [bridgeRow()], total: 1 })).cards[0]
    // 发起方 → 读 initiatorFieldKeys（含 email / company），按目录顺序排列
    expect(asInitiator.myAllowedFieldKeys).toEqual(['displayName', 'city', 'company', 'email'])
    // 同一行、同一份数据，仅 side 不同 ⇒ 必须换成被邀侧那一份
    const asRecipient = expectOk(
      assembleBridgeList({ bridges: [bridgeRow({ side: 'RECIPIENT' })], total: 1 }),
    ).cards[0]
    expect(asRecipient.myAllowedFieldKeys).toEqual(['displayName', 'city'])

    // 🔴 「可选范围 ≠ 交集」这条**不能用被邀侧来证**：本夹具里被邀侧那一份恰好
    //    等于交集（两个字段都对上了），拿它断言 not.toEqual 是**同义反复** ——
    //    换个夹具就会翻。故改用发起侧：单侧 4 项 vs 交集 2 项，差异是结构性的。
    expect(asInitiator.agreedFieldKeys).toEqual(['displayName', 'city'])
    expect(asInitiator.myAllowedFieldKeys).not.toEqual(asInitiator.agreedFieldKeys)
    expect(asInitiator.myAllowedFieldKeys).toHaveLength(4)
    expect(asInitiator.agreedFieldKeys).toHaveLength(2)
  })

  it('🔴 可选范围取自我方单侧配置，交集取自两边 —— 二者的**来源**不同（不是同一份数据换个名字）', () => {
    // 被邀侧夹具：单侧 = recipientFieldKeys（3 项），交集仍是 2 项 ⇒ 两者不同
    const row = bridgeRow({
      side: 'RECIPIENT',
      recipientFieldKeys: ['city', 'displayName', 'bio'],
      agreedFieldKeys: ['city', 'displayName'],
    })
    const c = expectOk(assembleBridgeList({ bridges: [row], total: 1 })).cards[0]
    // 目录顺序：displayName(0) < bio(2) < city(3)
    expect(c.myAllowedFieldKeys).toEqual(['displayName', 'bio', 'city'])
    expect(c.agreedFieldKeys).toEqual(['displayName', 'city'])
    expect(c.myAllowedFieldKeys).not.toEqual(c.agreedFieldKeys)
  })

  it('side 为 null（非当事方）→ 可选范围为空集 + 一条说明（绝不兜默认值）', () => {
    const model = expectOk(
      assembleBridgeList({ bridges: [bridgeRow({ side: null, counterpartyOrgId: null })], total: 1 }),
    )
    expect(model.cards[0].myAllowedFieldKeys).toEqual([])
    expect(model.cards[0].sideLabel).toBe('（非当事方）')
    expect(model.notes.join('\n')).toContain('side 为 null')
  })

  it('myOptIn 投影：状态中文 + 已勾字段的标签', () => {
    const c = expectOk(assembleBridgeList({ bridges: [bridgeRow()], total: 1 })).cards[0]
    expect(c.myOptIn).not.toBeNull()
    expect(c.myOptIn?.status).toBe('ACTIVE')
    expect(c.myOptIn?.statusLabel).toBe('已加入')
    expect(c.myOptIn?.disclosedFieldLabels).toEqual(['城市'])
  })

  it('未加入（myOptIn 为 null）→ 投影为 null，不编造空对象', () => {
    const c = expectOk(assembleBridgeList({ bridges: [bridgeRow({ myOptIn: null })], total: 1 })).cards[0]
    expect(c.myOptIn).toBeNull()
  })
})

describe('assembleBridgeList · 空态 / 截断 / 目录落后', () => {
  it('查询成功但没有协议 → 一句话说清"不是读不到"', () => {
    const model = expectOk(assembleBridgeList({ bridges: [], total: 0 }))
    expect(model.cards).toEqual([])
    expect(model.notes.join('\n')).toContain('没有参与任何跨群协议')
    expect(model.notes.join('\n')).toContain('不是"读不到"')
  })

  it('total 大于本次条数 → 说明发生了截断', () => {
    const model = expectOk(assembleBridgeList({ bridges: [bridgeRow()], total: 9 }))
    expect(model.notes.join('\n')).toContain('共 9 份协议')
    expect(model.notes.join('\n')).toContain('未显示全部')
  })

  it('目录不认识的字段键 → 说出"目录落后"，而不是静默渲染无标签的方框', () => {
    const model = expectOk(
      assembleBridgeList({
        bridges: [bridgeRow({ initiatorFieldKeys: ['city', 'brandNewField'], agreedFieldKeys: ['brandNewField'] })],
        total: 1,
      }),
    )
    expect(model.notes.join('\n')).toContain('brandNewField')
    expect(model.notes.join('\n')).toContain('目录落后')
  })

  it('🔴 载荷形状不认识 → 整块拒绝（而不是当成"没有协议"）', () => {
    const out = assembleBridgeList({ bridges: '不是数组', total: 0 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('不符合契约')
    // 负向对照：连顶层字段都没有也不能过
    expect(assembleBridgeList({}).ok).toBe(false)
    expect(assembleBridgeList(null).ok).toBe(false)
  })

  it('缺少服务端派生字段（如 agreedFieldKeys）也算形状不认识', () => {
    const row = bridgeRow()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (row as any).agreedFieldKeys
    expect(assembleBridgeList({ bridges: [row], total: 1 }).ok).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════
// ② 详情 + 本人视角
// ═══════════════════════════════════════════════════════════

function detailPayload(over: { bridge?: Record<string, unknown>; myProjection?: Record<string, unknown> } = {}) {
  return {
    bridge: bridgeRow(over.bridge ?? {}),
    myProjection: {
      bridgeId: 'br_1',
      status: 'ACTIVE',
      organizationId: ORG_A,
      counterpartyOrgId: ORG_B,
      bridgeRefusalCode: null,
      sharedFieldKeys: ['city'],
      narrowed: [{ key: 'displayName', by: 'MEMBER_POLICY', owner: 'MEMBER' }],
      myOptIn: {
        id: 'oi_1',
        userId: 'u1',
        status: 'ACTIVE',
        disclosedFieldKeys: ['city'],
        optedInAt: '2026-10-03T00:00:00.000Z',
        withdrawnAt: null,
      },
      profileAudience: 'CANDIDATE',
      ...over.myProjection,
    },
  }
}

describe('assembleBridgeDetail · 本人视角与归因', () => {
  it('正常载荷 → 卡片 + 我的可见字段 + 归因（带人话与归属）', () => {
    const d = expectOk(assembleBridgeDetail(detailPayload()))
    expect(d.mySharedFieldKeys).toEqual(['city'])
    expect(d.mySharedFieldLabels).toEqual(['城市'])
    expect(d.narrowed).toEqual([
      {
        key: 'displayName',
        label: '昵称',
        reason: 'MEMBER_POLICY',
        reasonLabel: '成员未选择共享该字段',
        owner: 'MEMBER',
        ownerLabel: '需要成员本人调整选择',
      },
    ])
    expect(d.bridgeRefusalCode).toBeNull()
    expect(d.bridgeRefusalLabel).toBeNull()
    expect(d.profileAudienceLabel.trim().length).toBeGreaterThan(0)
  })

  it('协议层拒绝码 → 有中文说明', () => {
    const d = expectOk(
      assembleBridgeDetail(
        detailPayload({ myProjection: { bridgeRefusalCode: 'BRIDGE_PENDING', sharedFieldKeys: [] } }),
      ),
    )
    expect(d.bridgeRefusalLabel).toBe('等待对方群主批准，暂不能共享')
  })

  it('归因行序按字段目录顺序（确定性）', () => {
    const d = expectOk(
      assembleBridgeDetail(
        detailPayload({
          myProjection: {
            narrowed: [
              { key: 'email', by: 'GROUP_POLICY', owner: 'ORGANIZER' },
              { key: 'city', by: 'MEMBER_POLICY', owner: 'MEMBER' },
              { key: 'displayName', by: 'INTENT_DISCLOSURE', owner: 'MEMBER' },
            ],
          },
        }),
      ),
    )
    // 目录顺序：displayName(0) < city(3) < email(13)
    expect(d.narrowed.map((n) => n.key)).toEqual(['displayName', 'city', 'email'])
  })

  it('🔴 owner 与领域层写死的归属不一致 → 如实展示 + 产出告警（找错人会白跑一趟）', () => {
    const d = expectOk(
      assembleBridgeDetail(
        detailPayload({
          myProjection: {
            // 伪造：GROUP_POLICY 本该归 ORGANIZER，服务端却说 MEMBER
            narrowed: [{ key: 'company', by: 'GROUP_POLICY', owner: 'MEMBER' }],
          },
        }),
      ),
    )
    expect(d.narrowed[0].ownerLabel).toBe('需要成员本人调整选择')
    expect(d.notes.join('\n')).toContain('归因归属出现不一致')
    expect(d.notes.join('\n')).toContain('company')
  })

  it('opt-in 勾选项来自**我方单侧配置**（不是交集），并带上服务端已勾状态', () => {
    const d = expectOk(assembleBridgeDetail(detailPayload()))
    // 发起方单侧 4 项（含 email —— 结构性不可授权的也要如实呈现 disclosable:false）
    expect(d.optInOptions.map((o) => o.key)).toEqual(['displayName', 'city', 'company', 'email'])
    expect(d.optInOptions.find((o) => o.key === 'city')?.selected).toBe(true)
    expect(d.optInOptions.find((o) => o.key === 'company')?.selected).toBe(false)
    // email 在服务端目录里 disclosable:false —— 本区不据此隐藏，但要标出来
    expect(d.optInOptions.find((o) => o.key === 'email')?.disclosable).toBe(false)
    expect(d.optInOptions.find((o) => o.key === 'email')?.sensitive).toBe(true)
  })

  it('已退出（WITHDRAWN）→ 说明保留的是上次选择', () => {
    const d = expectOk(
      assembleBridgeDetail(
        detailPayload({
          bridge: { myOptIn: { id: 'oi_1', userId: 'u1', status: 'WITHDRAWN', disclosedFieldKeys: ['city'], optedInAt: '2026-10-03T00:00:00.000Z', withdrawnAt: '2026-10-04T00:00:00.000Z' } },
        }),
      ),
    )
    expect(d.card.myOptIn?.statusLabel).toBe('已退出')
    expect(d.notes.join('\n')).toContain('你已退出这份协议')
  })

  it('载荷缺 myProjection → 整块拒绝（详情页不能"装作只有协议信息"）', () => {
    const out = assembleBridgeDetail({ bridge: bridgeRow() })
    expect(out.ok).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════
// ③ 跨群投影
// ═══════════════════════════════════════════════════════════

function discoveryPayload(over: Record<string, unknown> = {}) {
  return {
    bridgeId: 'br_1',
    status: 'ACTIVE',
    organizationId: ORG_A,
    counterpartyOrgId: ORG_B,
    bridgeRefusalCode: null,
    members: [
      {
        userId: 'u9',
        sharedFieldKeys: ['city', 'displayName'],
        subject: { displayName: '张三', city: '上海' },
        optedInAt: '2026-10-03T00:00:00.000Z',
      },
    ],
    visibleCount: 1,
    optedInCount: 2,
    gatedOut: [{ code: 'MEMBER_NOT_OPTED_IN', count: 1 }],
    profileAudience: 'CANDIDATE',
    ...over,
  }
}

describe('assembleBridgeDiscovery · 跨群可见成员', () => {
  it('正常载荷 → 成员字段按目录顺序、带中文标签', () => {
    const m = expectOk(assembleBridgeDiscovery(discoveryPayload()))
    expect(m.visibleCount).toBe(1)
    expect(m.optedInCount).toBe(2)
    expect(m.members).toHaveLength(1)
    // 目录顺序：displayName(0) < city(3)
    expect(m.members[0].fields.map((f) => f.key)).toEqual(['displayName', 'city'])
    expect(m.members[0].fields.map((f) => f.label)).toEqual(['昵称', '城市'])
    expect(m.members[0].fields.map((f) => f.value)).toEqual(['张三', '上海'])
    expect(m.gatedOut).toEqual([
      { code: 'MEMBER_NOT_OPTED_IN', label: '该成员尚未选择加入', count: 1 },
    ])
  })

  it('🔴 交集是上界：subject 里出现交集外的键 ⇒ 剔除 + 告警（不得渲染出去）', () => {
    const m = expectOk(
      assembleBridgeDiscovery(
        discoveryPayload({
          members: [
            {
              userId: 'u9',
              sharedFieldKeys: ['displayName'],
              // 服务端裁剪失效：多给了 email 与 city
              subject: { displayName: '张三', email: 'zhang@example.com', city: '上海' },
              optedInAt: '2026-10-03T00:00:00.000Z',
            },
          ],
        }),
      ),
    )
    const rendered = m.members[0].fields.map((f) => f.key)
    expect(rendered).toEqual(['displayName'])
    expect(rendered).not.toContain('email')
    expect(JSON.stringify(m.members[0].fields)).not.toContain('zhang@example.com')
    expect(m.notes.join('\n')).toContain('不在三方交集内')
    expect(m.notes.join('\n')).toContain('裁剪失效')
  })

  it('交集里有、投影里没有的键 ⇒ 计数说明（不是错误，但会让人以为少了一块）', () => {
    const m = expectOk(
      assembleBridgeDiscovery(
        discoveryPayload({
          members: [
            {
              userId: 'u9',
              sharedFieldKeys: ['city', 'displayName', 'company'],
              subject: { displayName: '张三' },
              optedInAt: '2026-10-03T00:00:00.000Z',
            },
          ],
        }),
      ),
    )
    expect(m.members[0].fields.map((f) => f.key)).toEqual(['displayName'])
    expect(m.notes.join('\n')).toContain('2 个字段在交集内、但投影里没有对应值')
  })

  it('数组值按顿号连成一行（不美化，只做类型转换）', () => {
    const m = expectOk(
      assembleBridgeDiscovery(
        discoveryPayload({
          members: [
            {
              userId: 'u9',
              sharedFieldKeys: ['selectedTags'],
              subject: { selectedTags: ['跑步', '读书'] },
              optedInAt: '2026-10-03T00:00:00.000Z',
            },
          ],
        }),
      ),
    )
    expect(m.members[0].fields[0].value).toBe('跑步、读书')
  })

  it('空数组 / 空串 → 「（该字段无值）」而不是空白', () => {
    const m = expectOk(
      assembleBridgeDiscovery(
        discoveryPayload({
          members: [
            {
              userId: 'u9',
              sharedFieldKeys: ['selectedTags', 'bio'],
              subject: { selectedTags: [], bio: '' },
              optedInAt: '2026-10-03T00:00:00.000Z',
            },
          ],
        }),
      ),
    )
    for (const f of m.members[0].fields) expect(f.value).toBe('（该字段无值）')
  })

  it('🔴 visibleCount 与成员条数不一致 ⇒ 以实际条数为准 + 告警', () => {
    const m = expectOk(assembleBridgeDiscovery(discoveryPayload({ visibleCount: 3 })))
    expect(m.visibleCount).toBe(1)
    expect(m.notes.join('\n')).toContain('可见人数（3）与实际返回的成员条数（1）不一致')
  })

  it('🔴 optedInCount 少于可见人数 ⇒ 授权模型上不应发生，必须告警', () => {
    const m = expectOk(assembleBridgeDiscovery(discoveryPayload({ optedInCount: 0 })))
    expect(m.notes.join('\n')).toContain('不应发生')
  })

  it('协议层不可用 + 对方已有人加入 ⇒ 说清是协议状态问题而非成员设置问题', () => {
    const m = expectOk(
      assembleBridgeDiscovery(
        discoveryPayload({ status: 'PENDING', bridgeRefusalCode: 'BRIDGE_PENDING', members: [], visibleCount: 0 }),
      ),
    )
    expect(m.bridgeRefusalLabel).toBe('等待对方群主批准，暂不能共享')
    expect(m.notes.join('\n')).toContain('协议状态问题')
    expect(m.notes.join('\n')).toContain('不是成员设置问题')
  })

  it('查询成功但没有可见成员 → 不产出告警（空是正常结论）', () => {
    const m = expectOk(
      assembleBridgeDiscovery(discoveryPayload({ members: [], visibleCount: 0, optedInCount: 0, gatedOut: [] })),
    )
    expect(m.members).toEqual([])
    expect(m.notes.filter((n) => n.includes('不一致'))).toEqual([])
  })

  it('载荷形状不认识 → 整块拒绝', () => {
    expect(assembleBridgeDiscovery({ members: [] }).ok).toBe(false)
    expect(assembleBridgeDiscovery({ ...discoveryPayload(), profileAudience: 'NOT_AN_AUDIENCE' }).ok).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════
// ④ 请求形状
// ═══════════════════════════════════════════════════════════

describe('动作请求形状', () => {
  it('批准 / 撤销走**各自的端点**（不是一个端点两用）', () => {
    expect(bridgeDecideRequest('br_1', 'APPROVE')).toEqual({
      url: '/api/v1/bridges/br_1/approve',
      body: {},
    })
    expect(bridgeDecideRequest('br_1', 'REVOKE')).toEqual({
      url: '/api/v1/bridges/br_1/revoke',
      body: {},
    })
  })

  it('opt-in 的请求体就是勾选框里的字段键（原样、不去重、不排序）', () => {
    expect(bridgeOptInRequest('br_1', ['city', 'displayName'])).toEqual({
      url: '/api/v1/bridges/br_1/opt-in',
      body: { disclosedFieldKeys: ['city', 'displayName'] },
    })
    // 空选择是**合法**的（"我加入但不给任何字段"），不能被悄悄改成有值
    expect(bridgeOptInRequest('br_1', [])).toEqual({
      url: '/api/v1/bridges/br_1/opt-in',
      body: { disclosedFieldKeys: [] },
    })
  })

  it('opt-out 无请求体', () => {
    expect(bridgeOptOutRequest('br_1')).toEqual({ url: '/api/v1/bridges/br_1/opt-out', body: {} })
  })

  it('id 会被 URL 编码（id 不是可控输入，但编码是免费的）', () => {
    expect(bridgeOptOutRequest('a b/c').url).toBe('/api/v1/bridges/a%20b%2Fc/opt-out')
  })
})

// ═══════════════════════════════════════════════════════════
// ⑤ 排序与标签工具
// ═══════════════════════════════════════════════════════════

describe('orderFieldKeys / fieldLabelOf', () => {
  it('目录内按目录顺序，目录外按字母序追加（确定性）', () => {
    expect(orderFieldKeys(['email', 'displayName', 'zzz', 'aaa'])).toEqual([
      'displayName',
      'email',
      'aaa',
      'zzz',
    ])
  })

  it('去重且不改动入参', () => {
    const src = ['city', 'city', 'displayName']
    const out = orderFieldKeys(src)
    expect(out).toEqual(['displayName', 'city'])
    expect(src).toEqual(['city', 'city', 'displayName'])
  })

  it('目录查不到 → **原样返回键**（不隐藏、不编造标签）', () => {
    expect(fieldLabelOf('displayName')).toBe('昵称')
    expect(fieldLabelOf('unknownKey')).toBe('unknownKey')
  })

  it('两次调用同一输入 ⇒ 同一输出（否则每次刷新都重排）', () => {
    const keys = ['company', 'city', 'email', 'displayName', 'bio']
    expect(orderFieldKeys(keys)).toEqual(orderFieldKeys([...keys].reverse()))
  })
})

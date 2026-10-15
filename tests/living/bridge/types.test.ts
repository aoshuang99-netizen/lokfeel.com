/**
 * T10 Slice 4 · Bridge 展示层 —— 取值域钉死 + **内核行为取证**
 *
 * ── 为什么这个文件与 `tests/living/consent/types.test.ts` 的写法不同 ──────
 *   Consent 那侧要"抄一份镜像 + 双向等价断言"，是因为它的源模块是**服务端**桶
 *   （值导入会拖进 Prisma）。T10 的取值域住在 `@/lib/bridge`（**零 import** 的纯内核），
 *   展示层**直接值导入**它 ⇒ 只有一份，不存在镜像漂移。
 *
 *   于是本文件的职责变了：不再是"证明两份抄件一致"，而是
 *     ① **逐字钉死**展示层所依赖的每一个取值（防"顺手改了一个字"）；
 *     ② 直接跑**内核的真实纯函数**，证明钉住的那串字**就是**运行时的行为，
 *        而不是两次抄成一样（这正是 consent 那侧"不满足于钉字符串"的同一取向）。
 *
 * ── 本文件最重要的两组 ────────────────────────────────────────────
 *   · 「三环一票否决」：AC-19 的可执行定义。任缺一环该字段必须**不可见** ——
 *     这是"无跨群默认共享"这条铁律在**行为**上的取证点。
 *   · 「单调性」：下层只能收窄。若哪天有人把交集改成并集，这一组会立刻红，
 *     而界面上不会有任何报错（症状是"多显示了几个字段"，看起来还挺正常）。
 *
 * 导入方式：**走深路径**（不经 `@/lib/bridges` 服务层 barrel —— 那会把 db 拖进来）。
 */

import {
  BRIDGE_ACTION_REFUSALS,
  BRIDGE_NARROW_LABELS,
  BRIDGE_NARROW_OWNER,
  BRIDGE_NARROW_REASONS,
  BRIDGE_OPT_IN_STATUSES,
  BRIDGE_OPT_IN_STATUS_LABELS,
  BRIDGE_REFUSAL_CODES,
  BRIDGE_REFUSAL_LABELS,
  BRIDGE_STATUSES,
  BRIDGE_STATUS_LABELS,
  BRIDGE_STATUS_VIEWS,
  bridgeStatusView,
  bridgeUsableReason,
  normalizeFieldKeys,
  planBridgeTransition,
  planBridgeVisibility,
  planBridgeVisibilityBatch,
  type BridgeStatusView,
  type BridgeView,
  type MemberOptInView,
} from '@/lib/bridge'
import {
  BRIDGE_NARROW_OWNER_LABELS,
  BRIDGE_PARTY_LABELS,
  type BridgeCard,
} from '@/lib/living/bridge/types'

/** 文案表的"完整 + 无多余键 + 每条非空"检查。 */
function expectLabelMap<K extends string>(codes: readonly K[], labels: Record<K, string>): void {
  expect(Object.keys(labels).sort()).toEqual([...codes].sort())
  for (const code of codes) {
    expect(typeof labels[code]).toBe('string')
    expect(labels[code].trim().length).toBeGreaterThan(0)
  }
}

// ═══════════════════════════════════════════════════════════
// 夹具
// ═══════════════════════════════════════════════════════════

const NOW = new Date('2026-10-15T00:00:00.000Z')

/** 三方都齐全的一份输入（每个字段都能被改一处来单独验证那一环）。 */
function input(over: {
  bridge?: Partial<BridgeView>
  optIn?: MemberOptInView | null
  intent?: readonly string[] | null
  now?: Date
}): Parameters<typeof planBridgeVisibility>[0] {
  return {
    bridge: {
      status: 'ACTIVE',
      initiatorFieldKeys: ['displayName', 'city', 'company'],
      recipientFieldKeys: ['displayName', 'city', 'company'],
      expiresAt: null,
      ...over.bridge,
    },
    optIn:
      over.optIn === undefined
        ? { status: 'ACTIVE', disclosedFieldKeys: ['displayName', 'city', 'company'] }
        : over.optIn,
    intentVisibleFieldKeys:
      over.intent === undefined ? ['displayName', 'city', 'company'] : over.intent,
    now: over.now ?? NOW,
  }
}

// ═══════════════════════════════════════════════════════════
// 一 · 取值域逐字钉死
// ═══════════════════════════════════════════════════════════

describe('取值域 · 协议状态', () => {
  it('落库只有三态（刻意没有 DRAFT、没有 EXPIRED）', () => {
    expect([...BRIDGE_STATUSES]).toEqual(['PENDING', 'ACTIVE', 'REVOKED'])
    expect(BRIDGE_STATUSES as readonly string[]).not.toContain('DRAFT')
    expect(BRIDGE_STATUSES as readonly string[]).not.toContain('EXPIRED')
  })

  it('对外视图 = 三态 + 派生的 EXPIRED', () => {
    expect([...BRIDGE_STATUS_VIEWS]).toEqual(['PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED'])
  })

  it('🔴 双向对照：EXPIRED 在视图里、在枚举外（两条断言同时成立）', () => {
    expect(BRIDGE_STATUS_VIEWS as readonly string[]).toContain('EXPIRED')
    expect(BRIDGE_STATUSES as readonly string[]).not.toContain('EXPIRED')
    // 视图必须**恰好**是"枚举 ∪ {EXPIRED}"，不多不少
    expect([...BRIDGE_STATUS_VIEWS].sort()).toEqual([...BRIDGE_STATUSES, 'EXPIRED'].sort())
  })

  it('四态各有一句人话，无多余键', () => {
    expectLabelMap<BridgeStatusView>(BRIDGE_STATUS_VIEWS, BRIDGE_STATUS_LABELS)
  })
})

describe('取值域 · 成员 opt-in 与拒绝码', () => {
  it('opt-in 两态（WITHDRAWN 保留行，不删行）', () => {
    expect([...BRIDGE_OPT_IN_STATUSES]).toEqual(['ACTIVE', 'WITHDRAWN'])
    expectLabelMap(BRIDGE_OPT_IN_STATUSES, BRIDGE_OPT_IN_STATUS_LABELS)
  })

  it('可见性拒绝码逐字钉死（顺序 = 闸门早退顺序）', () => {
    expect([...BRIDGE_REFUSAL_CODES]).toEqual([
      'BRIDGE_PENDING',
      'BRIDGE_REVOKED',
      'BRIDGE_EXPIRED',
      'MEMBER_NOT_OPTED_IN',
      'MEMBER_OPTED_OUT',
      'NO_INTENT_DISCLOSURE',
      'NOTHING_SHARED',
    ])
    expectLabelMap(BRIDGE_REFUSAL_CODES, BRIDGE_REFUSAL_LABELS)
  })

  it('动作拒绝码是**另一张表**（回答的是不同问题，合并会让审计答非所问）', () => {
    expect([...BRIDGE_ACTION_REFUSALS]).toEqual([
      'BRIDGE_REVOKED',
      'BRIDGE_EXPIRED',
      'ALREADY_ACTIVE',
      'NOT_A_PARTY',
      'WRONG_SIDE',
    ])
    // 两张表刻意不同：可见性码里的成员维度在动作码里不存在
    expect(BRIDGE_ACTION_REFUSALS as readonly string[]).not.toContain('MEMBER_NOT_OPTED_IN')
    expect(BRIDGE_REFUSAL_CODES as readonly string[]).not.toContain('WRONG_SIDE')
  })

  it('归因三环 + 「该找谁」写死在领域层（不是 UI 各自猜一份）', () => {
    expect([...BRIDGE_NARROW_REASONS]).toEqual([
      'GROUP_POLICY',
      'MEMBER_POLICY',
      'INTENT_DISCLOSURE',
    ])
    expectLabelMap(BRIDGE_NARROW_REASONS, BRIDGE_NARROW_LABELS)
    expect(BRIDGE_NARROW_OWNER).toEqual({
      GROUP_POLICY: 'ORGANIZER',
      MEMBER_POLICY: 'MEMBER',
      INTENT_DISCLOSURE: 'MEMBER',
    })
    // 展示层的人话版必须与领域层同键
    expect(Object.keys(BRIDGE_NARROW_OWNER_LABELS).sort()).toEqual(['MEMBER', 'ORGANIZER'])
    // 只有"群主配置"这一环该找群主 —— 写反了会让人白跑一趟
    const organizers = BRIDGE_NARROW_REASONS.filter((r) => BRIDGE_NARROW_OWNER[r] === 'ORGANIZER')
    expect(organizers).toEqual(['GROUP_POLICY'])
  })

  it('立场两态各有中文，且两个字面量就是 DTO 那两个', () => {
    expect(Object.keys(BRIDGE_PARTY_LABELS).sort()).toEqual(['INITIATOR', 'RECIPIENT'])
    expect(BRIDGE_PARTY_LABELS.INITIATOR.trim().length).toBeGreaterThan(0)
    expect(BRIDGE_PARTY_LABELS.RECIPIENT.trim().length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════
// 二 · 内核行为取证：钉住的那串字就是运行时的行为
// ═══════════════════════════════════════════════════════════

describe('内核行为 · 派生状态与 fail-closed', () => {
  const active: BridgeView = {
    status: 'ACTIVE',
    initiatorFieldKeys: [],
    recipientFieldKeys: [],
    expiresAt: null,
  }

  it('未过期的 ACTIVE 就是 ACTIVE', () => {
    expect(bridgeStatusView(active, NOW)).toBe('ACTIVE')
    expect(bridgeStatusView({ ...active, expiresAt: '2026-10-16T00:00:00.000Z' }, NOW)).toBe('ACTIVE')
  })

  it('过期的 ACTIVE 派生成 EXPIRED（落库值没变）', () => {
    const expired = { ...active, expiresAt: '2026-10-14T00:00:00.000Z' }
    expect(bridgeStatusView(expired, NOW)).toBe('EXPIRED')
    expect(expired.status).toBe('ACTIVE')
  })

  it('边界：恰好等于 now 算已过期（<= 而非 <）', () => {
    expect(bridgeStatusView({ ...active, expiresAt: NOW.toISOString() }, NOW)).toBe('EXPIRED')
  })

  it('🔴 不可解析的 expiresAt 一律 fail-closed 视为已过期', () => {
    expect(bridgeStatusView({ ...active, expiresAt: 'not-a-date' }, NOW)).toBe('EXPIRED')
    expect(bridgeUsableReason({ ...active, expiresAt: 'not-a-date' }, NOW)).toEqual({
      ok: false,
      code: 'BRIDGE_EXPIRED',
    })
  })

  it('PENDING / REVOKED 不会被过期派生覆盖（它们本就不可用）', () => {
    expect(bridgeStatusView({ ...active, status: 'PENDING', expiresAt: '2020-01-01T00:00:00.000Z' }, NOW)).toBe(
      'PENDING',
    )
    expect(bridgeStatusView({ ...active, status: 'REVOKED' }, NOW)).toBe('REVOKED')
  })
})

describe('内核行为 · 三环一票否决（AC-19 的可执行定义）', () => {
  it('三环齐全 ⇒ 三个字段全部可见', () => {
    const plan = planBridgeVisibility(input({}))
    expect(plan.ok).toBe(true)
    expect(plan.code).toBeNull()
    expect(plan.sharedFieldKeys).toEqual(['city', 'company', 'displayName'])
    expect(plan.narrowed).toEqual([])
  })

  it('① 群主配置缺一（被邀方未允许 company）⇒ company 不可见，其余仍可见', () => {
    const plan = planBridgeVisibility(
      input({ bridge: { recipientFieldKeys: ['displayName', 'city'] } }),
    )
    expect(plan.sharedFieldKeys).toEqual(['city', 'displayName'])
    expect(plan.narrowed).toEqual([{ key: 'company', by: 'GROUP_POLICY' }])
  })

  it('① 反向：发起方未允许也算缺（双边都允许才生效）', () => {
    const plan = planBridgeVisibility(
      input({ bridge: { initiatorFieldKeys: ['displayName', 'city'] } }),
    )
    expect(plan.sharedFieldKeys).toEqual(['city', 'displayName'])
    expect(plan.narrowed).toEqual([{ key: 'company', by: 'GROUP_POLICY' }])
  })

  it('② 成员 opt-in 没勾 company ⇒ company 不可见', () => {
    const plan = planBridgeVisibility(
      input({ optIn: { status: 'ACTIVE', disclosedFieldKeys: ['displayName', 'city'] } }),
    )
    expect(plan.sharedFieldKeys).toEqual(['city', 'displayName'])
    expect(plan.narrowed).toEqual([{ key: 'company', by: 'MEMBER_POLICY' }])
  })

  it('③ 成员意图披露没覆盖 company ⇒ company 不可见', () => {
    const plan = planBridgeVisibility(input({ intent: ['displayName', 'city'] }))
    expect(plan.sharedFieldKeys).toEqual(['city', 'displayName'])
    expect(plan.narrowed).toEqual([{ key: 'company', by: 'INTENT_DISCLOSURE' }])
  })

  it('🔴 归因取**最上游**被砍的那一环（上游不改，下游怎么改都没用）', () => {
    // 三环同时缺 company ⇒ 必须归因到群主，而不是成员
    const plan = planBridgeVisibility(
      input({
        bridge: { recipientFieldKeys: ['displayName', 'city'] },
        optIn: { status: 'ACTIVE', disclosedFieldKeys: ['displayName'] },
        intent: ['displayName'],
      }),
    )
    expect(plan.narrowed.find((n) => n.key === 'company')?.by).toBe('GROUP_POLICY')
    // 群主放开了、成员没勾 ⇒ 归因降到成员
    const plan2 = planBridgeVisibility(
      input({ optIn: { status: 'ACTIVE', disclosedFieldKeys: ['displayName'] }, intent: ['displayName'] }),
    )
    expect(plan2.narrowed.find((n) => n.key === 'city')?.by).toBe('MEMBER_POLICY')
    // 群主与成员都放开、意图没覆盖 ⇒ 归因到意图
    const plan3 = planBridgeVisibility(input({ intent: ['displayName'] }))
    expect(plan3.narrowed.find((n) => n.key === 'city')?.by).toBe('INTENT_DISCLOSURE')
  })

  it('🔴 单调性：下层比上层**更宽**时也只能被收窄，绝不能放宽', () => {
    // 成员 opt-in 与意图都比群主配置宽（多出 email）—— 交集必须**不含** email
    const plan = planBridgeVisibility(
      input({
        bridge: { initiatorFieldKeys: ['displayName'], recipientFieldKeys: ['displayName'] },
        optIn: { status: 'ACTIVE', disclosedFieldKeys: ['displayName', 'email'] },
        intent: ['displayName', 'email'],
      }),
    )
    expect(plan.sharedFieldKeys).toEqual(['displayName'])
    expect(plan.sharedFieldKeys).not.toContain('email')
    expect(plan.narrowed).toEqual([{ key: 'email', by: 'GROUP_POLICY' }])
  })
})

describe('内核行为 · 闸门早退顺序（用户从最外层的问题开始修）', () => {
  const codesOf = (over: Parameters<typeof input>[0]) => {
    const p = planBridgeVisibility(input(over))
    return { ok: p.ok, code: p.code }
  }

  it('协议 PENDING ⇒ 先报协议层（而不是先报"这个人没加入"）', () => {
    expect(codesOf({ bridge: { status: 'PENDING' }, optIn: null, intent: null })).toEqual({
      ok: false,
      code: 'BRIDGE_PENDING',
    })
  })

  it('协议 REVOKED ⇒ BRIDGE_REVOKED', () => {
    expect(codesOf({ bridge: { status: 'REVOKED' }, optIn: null, intent: null }).code).toBe(
      'BRIDGE_REVOKED',
    )
  })

  it('协议可用但成员从未 opt-in ⇒ MEMBER_NOT_OPTED_IN', () => {
    expect(codesOf({ optIn: null, intent: null }).code).toBe('MEMBER_NOT_OPTED_IN')
  })

  it('成员已退出 ⇒ MEMBER_OPTED_OUT（与"从未加入"是两件事）', () => {
    expect(codesOf({ optIn: { status: 'WITHDRAWN', disclosedFieldKeys: [] }, intent: null }).code).toBe(
      'MEMBER_OPTED_OUT',
    )
  })

  it('成员没有生效中的意图 ⇒ NO_INTENT_DISCLOSURE（没有披露依据，保守不共享）', () => {
    expect(codesOf({ intent: null }).code).toBe('NO_INTENT_DISCLOSURE')
  })

  it('闸门都过了但交集为空 ⇒ NOTHING_SHARED，且**仍带出归因**', () => {
    const plan = planBridgeVisibility(
      input({
        bridge: { initiatorFieldKeys: ['city'], recipientFieldKeys: ['city'] },
        optIn: { status: 'ACTIVE', disclosedFieldKeys: ['company'] },
        intent: ['company'],
      }),
    )
    expect(plan.ok).toBe(false)
    expect(plan.code).toBe('NOTHING_SHARED')
    expect(plan.sharedFieldKeys).toEqual([])
    // 🔴 归因不能丢：否则用户只看到"无字段可共享"，不知道是哪一环没配
    expect(plan.narrowed.length).toBeGreaterThan(0)
  })

  it('交集为空时每一条候选都被归因，一个不漏', () => {
    const plan = planBridgeVisibility(
      input({
        bridge: { initiatorFieldKeys: ['a'], recipientFieldKeys: ['a'] },
        optIn: { status: 'ACTIVE', disclosedFieldKeys: ['b'] },
        intent: ['c'],
      }),
    )
    const attributed = plan.narrowed.map((n) => n.key).sort()
    expect(attributed).toEqual(['a', 'b', 'c'])
  })
})

describe('内核行为 · 批量版与逐个调用等价', () => {
  it('planBridgeVisibilityBatch 的每一条都与单次调用逐字相同', () => {
    const base = input({})
    const members = [
      { optIn: { status: 'ACTIVE' as const, disclosedFieldKeys: ['displayName'] }, intentVisibleFieldKeys: ['displayName'] },
      { optIn: null, intentVisibleFieldKeys: ['city'] },
      { optIn: { status: 'WITHDRAWN' as const, disclosedFieldKeys: [] }, intentVisibleFieldKeys: null },
    ]
    const batch = planBridgeVisibilityBatch(
      { bridge: base.bridge, now: base.now },
      members,
    )
    expect(batch).toHaveLength(members.length)
    members.forEach((m, i) => {
      const single = planBridgeVisibility({ ...base, ...m })
      expect(batch[i]).toEqual(single)
    })
  })
})

describe('内核行为 · 状态迁移真相表（双边批准的落点）', () => {
  const pending: BridgeView = {
    status: 'PENDING',
    initiatorFieldKeys: [],
    recipientFieldKeys: [],
    expiresAt: null,
  }

  it('🔴 只有被邀方能批准（发起方在创建时已自动批准）', () => {
    expect(planBridgeTransition(pending, 'APPROVE', 'RECIPIENT', NOW)).toEqual({
      ok: true,
      from: 'PENDING',
      to: 'ACTIVE',
    })
    expect(planBridgeTransition(pending, 'APPROVE', 'INITIATOR', NOW)).toEqual({
      ok: false,
      reason: 'WRONG_SIDE',
    })
  })

  it('已是 ACTIVE 再批准 ⇒ ALREADY_ACTIVE（不是静默成功）', () => {
    expect(planBridgeTransition({ ...pending, status: 'ACTIVE' }, 'APPROVE', 'RECIPIENT', NOW)).toEqual({
      ok: false,
      reason: 'ALREADY_ACTIVE',
    })
  })

  it('撤销：任一方、PENDING 与 ACTIVE 都可', () => {
    expect(planBridgeTransition(pending, 'REVOKE', 'INITIATOR', NOW)).toEqual({
      ok: true,
      from: 'PENDING',
      to: 'REVOKED',
    })
    expect(planBridgeTransition({ ...pending, status: 'ACTIVE' }, 'REVOKE', 'RECIPIENT', NOW)).toEqual({
      ok: true,
      from: 'ACTIVE',
      to: 'REVOKED',
    })
  })

  it('已 REVOKED / 已过期 ⇒ 任何动作都不行（终态无出边）', () => {
    expect(planBridgeTransition({ ...pending, status: 'REVOKED' }, 'REVOKE', 'INITIATOR', NOW)).toEqual({
      ok: false,
      reason: 'BRIDGE_REVOKED',
    })
    expect(
      planBridgeTransition({ ...pending, expiresAt: '2020-01-01T00:00:00.000Z' }, 'APPROVE', 'RECIPIENT', NOW),
    ).toEqual({ ok: false, reason: 'BRIDGE_EXPIRED' })
  })
})

describe('内核行为 · 字段键归一化是契约的一部分', () => {
  it('去空白、丢空串、去重、稳定排序', () => {
    expect(normalizeFieldKeys([' city ', 'displayName', '', 'city', '  ', 'company'])).toEqual([
      'city',
      'company',
      'displayName',
    ])
  })

  it('同一份配置不同顺序 ⇒ 同一结果（否则对账没法 diff）', () => {
    const a = normalizeFieldKeys(['city', 'displayName'])
    const b = normalizeFieldKeys(['displayName', 'city'])
    expect(a).toEqual(b)
  })
})

// ═══════════════════════════════════════════════════════════
// 三 · 展示模型的最小约定
// ═══════════════════════════════════════════════════════════

describe('展示模型约定', () => {
  it('`BridgeCard.side` 允许 null（非当事方），且两个取值就是 DTO 的那两个', () => {
    const sides: BridgeCard['side'][] = ['INITIATOR', 'RECIPIENT', null]
    expect(sides.filter((s) => s !== null).sort()).toEqual(['INITIATOR', 'RECIPIENT'])
  })

  it('本区文案里不得出现 markdown 强调标记（会被原样渲染成星号）', () => {
    const all = [
      ...Object.values(BRIDGE_STATUS_LABELS),
      ...Object.values(BRIDGE_REFUSAL_LABELS),
      ...Object.values(BRIDGE_NARROW_LABELS),
      ...Object.values(BRIDGE_NARROW_OWNER_LABELS),
      ...Object.values(BRIDGE_PARTY_LABELS),
      ...Object.values(BRIDGE_OPT_IN_STATUS_LABELS),
    ]
    for (const text of all) expect(text).not.toContain('**')
  })
})

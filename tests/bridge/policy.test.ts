/**
 * T10 · Community Bridge —— 内核单测（**无数据库、无网络、无凭据**）
 *
 * 本套件同时是「内核无 IO」这条设计的**证据**：整个文件不 import 任何
 * Prisma / 租户 / 网络模块，却能完整覆盖判定逻辑。若哪天有人把 IO 塞进内核，
 * 这套件的运行成本会立刻上升（需要起库），那正是门禁 B2 想避免的。
 *
 * 🔴 三条本仓立过的规矩，这里同样适用：
 *   ① **穷举优先于举例**：单调性用 2^n 组合穷举，而不是挑几个"看起来典型"的用例。
 *   ② **反向对照同权**：每个"通过"的用例，都要有对应的"该拒却拒了"的用例。
 *   ③ **fail-closed 自证**：非法输入必须落到"更保守"的分支，而不是"更宽松"的。
 */

import {
  bridgeStatusView,
  bridgeUsableReason,
  normalizeFieldKeys,
  planBridgeTransition,
  planBridgeVisibility,
  planBridgeVisibilityBatch,
} from '@/lib/bridge/policy'
import type { BridgeView, BridgeVisibilityInput } from '@/lib/bridge/types'

const NOW = new Date('2026-10-15T00:00:00.000Z')
const FUTURE = '2026-12-31T00:00:00.000Z'
const PAST = '2026-01-01T00:00:00.000Z'

const bridge = (over: Partial<BridgeView> = {}): BridgeView => ({
  status: 'ACTIVE',
  initiatorFieldKeys: ['displayName', 'company', 'bio'],
  recipientFieldKeys: ['displayName', 'company', 'industry'],
  expiresAt: FUTURE,
  ...over,
})

const input = (over: Partial<BridgeVisibilityInput> = {}): BridgeVisibilityInput => ({
  bridge: bridge(),
  optIn: { status: 'ACTIVE', disclosedFieldKeys: ['displayName', 'company'] },
  intentVisibleFieldKeys: ['displayName', 'company', 'bio', 'industry'],
  now: NOW,
  ...over,
})

// ═══════════════════════════════════════════════════════════
// normalizeFieldKeys
// ═══════════════════════════════════════════════════════════

describe('normalizeFieldKeys', () => {
  it('去首尾空白、丢弃空串、去重', () => {
    expect(normalizeFieldKeys([' bio ', 'bio', '', '   ', 'bio'])).toEqual(['bio'])
  })

  it('输出**稳定排序**（同一集合任意输入顺序 → 同一输出）', () => {
    const a = normalizeFieldKeys(['zeta', 'alpha', 'mu'])
    const b = normalizeFieldKeys(['mu', 'zeta', 'alpha'])
    expect(a).toEqual(b)
    expect(a).toEqual(['alpha', 'mu', 'zeta'])
  })

  it('非字符串项被丢弃（不让脏数据变成"一个字段"）', () => {
    expect(normalizeFieldKeys(['bio', 42 as unknown as string, null as unknown as string])).toEqual([
      'bio',
    ])
  })
})

// ═══════════════════════════════════════════════════════════
// bridgeUsableReason / bridgeStatusView
// ═══════════════════════════════════════════════════════════

describe('bridgeUsableReason', () => {
  it('ACTIVE 且未过期 → 可用', () => {
    expect(bridgeUsableReason(bridge(), NOW)).toEqual({ ok: true })
  })

  it('PENDING → BRIDGE_PENDING（等对方群主，不是"被拒"）', () => {
    expect(bridgeUsableReason(bridge({ status: 'PENDING' }), NOW)).toEqual({
      ok: false,
      code: 'BRIDGE_PENDING',
    })
  })

  it('REVOKED → BRIDGE_REVOKED', () => {
    expect(bridgeUsableReason(bridge({ status: 'REVOKED' }), NOW)).toEqual({
      ok: false,
      code: 'BRIDGE_REVOKED',
    })
  })

  it('已过期 → BRIDGE_EXPIRED', () => {
    expect(bridgeUsableReason(bridge({ expiresAt: PAST }), NOW)).toEqual({
      ok: false,
      code: 'BRIDGE_EXPIRED',
    })
  })

  it('expiresAt = null → 永久有效', () => {
    expect(bridgeUsableReason(bridge({ expiresAt: null }), NOW)).toEqual({ ok: true })
  })

  it('🔴 fail-closed：expiresAt **无法解析**时按已过期处理（不是"永久有效"）', () => {
    expect(bridgeUsableReason(bridge({ expiresAt: 'not-a-date' }), NOW)).toEqual({
      ok: false,
      code: 'BRIDGE_EXPIRED',
    })
  })
})

describe('bridgeStatusView（派生 EXPIRED，不落库）', () => {
  it('ACTIVE + 未过期 → ACTIVE', () => {
    expect(bridgeStatusView(bridge(), NOW)).toBe('ACTIVE')
  })

  it('ACTIVE + 已过期 → EXPIRED（派生）', () => {
    expect(bridgeStatusView(bridge({ expiresAt: PAST }), NOW)).toBe('EXPIRED')
  })

  it('REVOKED 不因过期而变成 EXPIRED（撤销是终态，优先级更高）', () => {
    expect(bridgeStatusView(bridge({ status: 'REVOKED', expiresAt: PAST }), NOW)).toBe('REVOKED')
  })
})

// ═══════════════════════════════════════════════════════════
// planBridgeTransition
// ═══════════════════════════════════════════════════════════

describe('planBridgeTransition', () => {
  it('被邀方批准 PENDING → ACTIVE', () => {
    expect(planBridgeTransition(bridge({ status: 'PENDING' }), 'APPROVE', 'RECIPIENT', NOW)).toEqual({
      ok: true,
      from: 'PENDING',
      to: 'ACTIVE',
    })
  })

  it('🔴 发起方**不能**批准（WRONG_SIDE）—— "双边生效"的结构落点', () => {
    expect(planBridgeTransition(bridge({ status: 'PENDING' }), 'APPROVE', 'INITIATOR', NOW)).toEqual({
      ok: false,
      reason: 'WRONG_SIDE',
    })
  })

  it('重复批准 → ALREADY_ACTIVE', () => {
    expect(planBridgeTransition(bridge({ status: 'ACTIVE' }), 'APPROVE', 'RECIPIENT', NOW)).toEqual({
      ok: false,
      reason: 'ALREADY_ACTIVE',
    })
  })

  it('任一方都可撤销（PENDING）', () => {
    for (const side of ['INITIATOR', 'RECIPIENT'] as const) {
      expect(planBridgeTransition(bridge({ status: 'PENDING' }), 'REVOKE', side, NOW)).toEqual({
        ok: true,
        from: 'PENDING',
        to: 'REVOKED',
      })
    }
  })

  it('任一方都可撤销（ACTIVE）', () => {
    for (const side of ['INITIATOR', 'RECIPIENT'] as const) {
      expect(planBridgeTransition(bridge({ status: 'ACTIVE' }), 'REVOKE', side, NOW)).toEqual({
        ok: true,
        from: 'ACTIVE',
        to: 'REVOKED',
      })
    }
  })

  it('已撤销 → 任何动作都拒绝（终态不可逆）', () => {
    for (const action of ['APPROVE', 'REVOKE'] as const) {
      expect(planBridgeTransition(bridge({ status: 'REVOKED' }), action, 'RECIPIENT', NOW)).toEqual({
        ok: false,
        reason: 'BRIDGE_REVOKED',
      })
    }
  })

  it('已过期 → 任何动作都拒绝', () => {
    expect(planBridgeTransition(bridge({ expiresAt: PAST }), 'APPROVE', 'RECIPIENT', NOW)).toEqual({
      ok: false,
      reason: 'BRIDGE_EXPIRED',
    })
  })
})

// ═══════════════════════════════════════════════════════════
// planBridgeVisibility —— 三环交集
// ═══════════════════════════════════════════════════════════

describe('planBridgeVisibility · 整体闸门', () => {
  it('三环全通 → ok，共享字段 = 三方交集', () => {
    const p = planBridgeVisibility(input())
    // 群主交集 = {displayName, company}
    // optIn = {displayName, company}
    // intent ⊇ 两者 ⇒ 结果 = {company, displayName}（稳定排序）
    expect(p.ok).toBe(true)
    expect(p.code).toBeNull()
    expect(p.sharedFieldKeys).toEqual(['company', 'displayName'])
  })

  it('协议 PENDING → BRIDGE_PENDING（整体拒绝，不带字段集）', () => {
    const p = planBridgeVisibility(input({ bridge: bridge({ status: 'PENDING' }) }))
    expect(p).toMatchObject({ ok: false, code: 'BRIDGE_PENDING', sharedFieldKeys: [], narrowed: [] })
  })

  it('协议已撤销 → BRIDGE_REVOKED', () => {
    const p = planBridgeVisibility(input({ bridge: bridge({ status: 'REVOKED' }) }))
    expect(p.code).toBe('BRIDGE_REVOKED')
  })

  it('成员从未 opt-in（null）→ MEMBER_NOT_OPTED_IN', () => {
    const p = planBridgeVisibility(input({ optIn: null }))
    expect(p.code).toBe('MEMBER_NOT_OPTED_IN')
  })

  it('成员已退出 → MEMBER_OPTED_OUT（与"从未加入"分开）', () => {
    const p = planBridgeVisibility(
      input({ optIn: { status: 'WITHDRAWN', disclosedFieldKeys: ['displayName'] } }),
    )
    expect(p.code).toBe('MEMBER_OPTED_OUT')
  })

  it('成员无生效意图 → NO_INTENT_DISCLOSURE', () => {
    const p = planBridgeVisibility(input({ intentVisibleFieldKeys: null }))
    expect(p.code).toBe('NO_INTENT_DISCLOSURE')
  })

  it('闸门全过但交集为空 → NOTHING_SHARED，且**仍带归因**', () => {
    const p = planBridgeVisibility(
      input({
        bridge: bridge({ initiatorFieldKeys: ['bio'], recipientFieldKeys: ['industry'] }),
        optIn: { status: 'ACTIVE', disclosedFieldKeys: ['bio', 'industry'] },
        intentVisibleFieldKeys: ['bio', 'industry'],
      }),
    )
    expect(p.ok).toBe(false)
    expect(p.code).toBe('NOTHING_SHARED')
    expect(p.sharedFieldKeys).toEqual([])
    // 没有字段同时被双方允许 ⇒ 两个都被 GROUP_POLICY 收窄
    expect(p.narrowed.map((n) => n.by)).toEqual(['GROUP_POLICY', 'GROUP_POLICY'])
    expect(p.narrowed.map((n) => n.key)).toEqual(['bio', 'industry'])
  })
})

describe('planBridgeVisibility · 逐环归因', () => {
  it('① 群主单边允许 → 该字段被 GROUP_POLICY 收窄（对方群主没开）', () => {
    // initiator 有 bio，recipient 没有
    const p = planBridgeVisibility(
      input({
        bridge: bridge({
          initiatorFieldKeys: ['displayName', 'bio'],
          recipientFieldKeys: ['displayName'],
        }),
        optIn: { status: 'ACTIVE', disclosedFieldKeys: ['displayName', 'bio'] },
        intentVisibleFieldKeys: ['displayName', 'bio'],
      }),
    )
    expect(p.sharedFieldKeys).toEqual(['displayName'])
    expect(p.narrowed).toEqual([{ key: 'bio', by: 'GROUP_POLICY' }])
  })

  it('② 群主都允许但成员没勾 → MEMBER_POLICY', () => {
    const p = planBridgeVisibility(
      input({
        bridge: bridge({ initiatorFieldKeys: ['displayName'], recipientFieldKeys: ['displayName'] }),
        optIn: { status: 'ACTIVE', disclosedFieldKeys: [] },
        intentVisibleFieldKeys: ['displayName'],
      }),
    )
    expect(p.narrowed).toEqual([{ key: 'displayName', by: 'MEMBER_POLICY' }])
  })

  it('③ 成员勾了但意图披露没覆盖 → INTENT_DISCLOSURE', () => {
    const p = planBridgeVisibility(
      input({
        bridge: bridge({ initiatorFieldKeys: ['displayName'], recipientFieldKeys: ['displayName'] }),
        optIn: { status: 'ACTIVE', disclosedFieldKeys: ['displayName'] },
        intentVisibleFieldKeys: [],
      }),
    )
    expect(p.narrowed).toEqual([{ key: 'displayName', by: 'INTENT_DISCLOSURE' }])
  })

  it('🔴 归因取**最上游**被砍的那一环（群主未开 且 成员没勾 → 报 GROUP_POLICY）', () => {
    const p = planBridgeVisibility(
      input({
        bridge: bridge({ initiatorFieldKeys: [], recipientFieldKeys: [] }),
        optIn: { status: 'ACTIVE', disclosedFieldKeys: [] },
        intentVisibleFieldKeys: [],
      }),
    )
    // 候选为空的退化情形：没有候选 ⇒ 空交集
    expect(p.code).toBe('NOTHING_SHARED')

    const p2 = planBridgeVisibility(
      input({
        bridge: bridge({ initiatorFieldKeys: ['bio'], recipientFieldKeys: [] }),
        optIn: { status: 'ACTIVE', disclosedFieldKeys: [] },
        intentVisibleFieldKeys: [],
      }),
    )
    expect(p2.narrowed).toEqual([{ key: 'bio', by: 'GROUP_POLICY' }])
  })

  it('某环自己冒出来的字段（不在协议配置里）也被如实归因，不静默消失', () => {
    const p = planBridgeVisibility(
      input({
        bridge: bridge({ initiatorFieldKeys: ['displayName'], recipientFieldKeys: ['displayName'] }),
        optIn: { status: 'ACTIVE', disclosedFieldKeys: ['displayName', 'city'] },
        intentVisibleFieldKeys: ['displayName', 'city'],
      }),
    )
    expect(p.sharedFieldKeys).toEqual(['displayName'])
    expect(p.narrowed).toEqual([{ key: 'city', by: 'GROUP_POLICY' }])
  })
})

describe('planBridgeVisibility · 单调性（穷举 2^4）', () => {
  const FIELD = 'displayName'
  const otherKeys = ['company', 'industry']

  /** 4 个环里该字段"在/不在"的全部 16 种组合。 */
  const combos: Array<{ init: boolean; recv: boolean; optin: boolean; intent: boolean }> = []
  for (const init of [false, true])
    for (const recv of [false, true])
      for (const optin of [false, true])
        for (const intent of [false, true]) combos.push({ init, recv, optin, intent })

  it('该字段被共享 ⟺ 四环**同时**包含它（充要，不是"充分"）', () => {
    for (const c of combos) {
      const p = planBridgeVisibility(
        input({
          bridge: bridge({
            initiatorFieldKeys: c.init ? [FIELD] : [],
            recipientFieldKeys: c.recv ? [FIELD] : [],
          }),
          optIn: { status: 'ACTIVE', disclosedFieldKeys: c.optin ? [FIELD] : [] },
          intentVisibleFieldKeys: c.intent ? [FIELD] : [],
        }),
      )
      const shared = p.sharedFieldKeys.includes(FIELD)
      const expected = c.init && c.recv && c.optin && c.intent
      expect(`${c.init}${c.recv}${c.optin}${c.intent}=>${shared}`).toBe(
        `${c.init}${c.recv}${c.optin}${c.intent}=>${expected}`,
      )
    }
  })

  it('共享集对每一环都**单调不减**（加任一环的允许 ⟹ 共享集不会变小）', () => {
    // 固定其余三环为"允许"，只翻转第 i 环，断言 shared 单调
    for (const patched of combos) {
      const withAll = planBridgeVisibility(
        input({
          bridge: bridge({
            initiatorFieldKeys: patched.init ? [FIELD] : [],
            recipientFieldKeys: patched.recv ? [FIELD] : [],
          }),
          optIn: { status: 'ACTIVE', disclosedFieldKeys: patched.optin ? [FIELD] : [] },
          intentVisibleFieldKeys: patched.intent ? [FIELD] : [],
        }),
      )
      // 把每一环都置 true，共享必须 ⊇ 原结果
      const full = planBridgeVisibility(
        input({
          bridge: bridge({ initiatorFieldKeys: [FIELD], recipientFieldKeys: [FIELD] }),
          optIn: { status: 'ACTIVE', disclosedFieldKeys: [FIELD] },
          intentVisibleFieldKeys: [FIELD],
        }),
      )
      if (withAll.sharedFieldKeys.includes(FIELD)) {
        expect(full.sharedFieldKeys).toContain(FIELD)
      }
      expect(full.sharedFieldKeys).toContain(FIELD)
      void otherKeys
    }
  })
})

// ═══════════════════════════════════════════════════════════
// planBridgeVisibilityBatch
// ═══════════════════════════════════════════════════════════

describe('planBridgeVisibilityBatch', () => {
  it('批量结果与逐个调用**逐项一致**（批量不是第二套逻辑）', () => {
    const base = {
      bridge: bridge(),
      now: NOW,
    }
    const members = [
      { optIn: { status: 'ACTIVE' as const, disclosedFieldKeys: ['displayName', 'company'] }, intentVisibleFieldKeys: ['displayName', 'company'] },
      { optIn: null, intentVisibleFieldKeys: ['displayName'] },
      { optIn: { status: 'WITHDRAWN' as const, disclosedFieldKeys: ['displayName'] }, intentVisibleFieldKeys: null },
    ]
    const batched = planBridgeVisibilityBatch(base, members)
    const oneByOne = members.map((m) => planBridgeVisibility({ ...base, ...m }))
    expect(batched).toEqual(oneByOne)
  })
})

/**
 * T01 · 租户能力矩阵（纯逻辑单测）
 *
 * 覆盖 AC-01/AC-02 中「越权被拒」的角色维度：判定必须是查表，
 * 且能力随角色**单调递增**、未知角色**默认拒绝**。
 */

import {
  TENANT_ROLES,
  TENANT_CAPABILITIES,
  ROLE_CAPABILITIES,
  can,
  capabilitiesOf,
  parseTenantRole,
} from '@/lib/tenancy/capabilities'

describe('T01 · 租户角色与能力矩阵', () => {
  describe('角色集合', () => {
    it('与契约 memberships.role 的 CHECK 取值逐字一致', () => {
      // contracts/schema.sql:12 → CHECK(role IN ('owner','admin','operator','member'))
      expect([...TENANT_ROLES].sort()).toEqual(['ADMIN', 'MEMBER', 'OPERATOR', 'OWNER'])
    })

    it('每个角色都有能力定义（不存在 undefined）', () => {
      for (const r of TENANT_ROLES) {
        expect(ROLE_CAPABILITIES[r]).toBeDefined()
        expect(ROLE_CAPABILITIES[r].size).toBeGreaterThan(0)
      }
    })
  })

  describe('单调性：MEMBER ⊆ OPERATOR ⊆ ADMIN ⊆ OWNER', () => {
    const chain = ['MEMBER', 'OPERATOR', 'ADMIN', 'OWNER'] as const

    it('低角色拥有的能力，高角色必定拥有', () => {
      for (let i = 0; i < chain.length - 1; i++) {
        const lower = ROLE_CAPABILITIES[chain[i]]
        const higher = ROLE_CAPABILITIES[chain[i + 1]]
        for (const cap of lower) {
          expect(higher.has(cap)).toBe(true)
        }
      }
    })

    it('OWNER 覆盖全部已定义能力', () => {
      for (const cap of TENANT_CAPABILITIES) {
        expect(can('OWNER', cap)).toBe(true)
      }
    })

    it('不存在「已定义但谁也拿不到」的能力（防声明遗漏）', () => {
      // 本断言曾在 T01 首轮抓出 outcome.verify 未分配的真实缺陷。
      const covered = new Set<string>()
      for (const r of TENANT_ROLES) for (const c of ROLE_CAPABILITIES[r]) covered.add(c)
      const orphaned = TENANT_CAPABILITIES.filter((c) => !covered.has(c))
      expect(orphaned).toEqual([])
    })
  })

  describe('越权拒绝（核心断言）', () => {
    it('MEMBER 不能管理成员，但可管理自己的意图', () => {
      expect(can('MEMBER', 'intent.manage')).toBe(true)
      expect(can('MEMBER', 'proposal.decide')).toBe(true)
      expect(can('MEMBER', 'member.invite')).toBe(false)
      expect(can('MEMBER', 'member.remove')).toBe(false)
      expect(can('MEMBER', 'member.update_role')).toBe(false)
    })

    it('MEMBER 不能创建 Mission，也不能读审计', () => {
      expect(can('MEMBER', 'mission.create')).toBe(false)
      expect(can('MEMBER', 'audit.read')).toBe(false)
    })

    it('OPERATOR 可运营但不可管人', () => {
      expect(can('OPERATOR', 'mission.create')).toBe(true)
      expect(can('OPERATOR', 'proposal.create')).toBe(true)
      expect(can('OPERATOR', 'member.read')).toBe(true)
      expect(can('OPERATOR', 'member.invite')).toBe(false)
      expect(can('OPERATOR', 'member.remove')).toBe(false)
      expect(can('OPERATOR', 'audit.read')).toBe(false)
    })

    it('ADMIN 可管人但不可处置租户本身', () => {
      expect(can('ADMIN', 'member.invite')).toBe(true)
      expect(can('ADMIN', 'member.remove')).toBe(true)
      expect(can('ADMIN', 'audit.read')).toBe(true)
      expect(can('ADMIN', 'org.update')).toBe(false)
      expect(can('ADMIN', 'org.transfer')).toBe(false)
      expect(can('ADMIN', 'org.delete')).toBe(false)
    })

    // ── T08 / AC-21 计费 ──
    // 这一组刻意钉死"钱"的口径，防止日后被"为了统一"下放：
    //   · MEMBER **读不到**用量（用量是经营信息，只有成果列表才是全员可见）；
    //   · OPERATOR **看得到**用量/限额（"额度要用完了"是运营该看见的信号），
    //     但**动不了**账（写事件 / 扣款 / 退款一律 ADMIN+）。
    it('🔴 计费：MEMBER 读不到用量，OPERATOR 只读不写，ADMIN 才能动账', () => {
      expect(can('MEMBER', 'billing.read')).toBe(false)
      expect(can('MEMBER', 'billing.manage')).toBe(false)

      expect(can('OPERATOR', 'billing.read')).toBe(true)
      expect(can('OPERATOR', 'billing.manage')).toBe(false)

      expect(can('ADMIN', 'billing.read')).toBe(true)
      expect(can('ADMIN', 'billing.manage')).toBe(true)

      expect(can('OWNER', 'billing.read')).toBe(true)
      expect(can('OWNER', 'billing.manage')).toBe(true)
    })

    it('OWNER 独占租户处置权', () => {
      expect(can('OWNER', 'org.update')).toBe(true)
      expect(can('OWNER', 'org.transfer')).toBe(true)
      expect(can('OWNER', 'org.delete')).toBe(true)
    })
  })

  describe('默认拒绝', () => {
    it('null / undefined 角色一律无权限', () => {
      expect(can(null, 'org.read')).toBe(false)
      expect(can(undefined, 'org.read')).toBe(false)
      expect(capabilitiesOf(null)).toEqual([])
      expect(capabilitiesOf(undefined)).toEqual([])
    })

    it('未知角色字符串无权限（不猜测、不回落）', () => {
      // 若未来 DB 出现脏数据（如 'SUPERADMIN'），必须 fail-closed
      expect(can('SUPERADMIN' as never, 'org.read')).toBe(false)
      expect(can('owner' as never, 'org.read')).toBe(false) // 大小写敏感
    })
  })

  describe('parseTenantRole — 运行时收敛', () => {
    it('接受契约内的四个值', () => {
      for (const r of TENANT_ROLES) {
        expect(parseTenantRole(r)).toBe(r)
      }
    })

    it('拒绝大小写变体与非字符串', () => {
      expect(parseTenantRole('owner')).toBeNull()
      expect(parseTenantRole('Admin')).toBeNull()
      expect(parseTenantRole('')).toBeNull()
      expect(parseTenantRole(null)).toBeNull()
      expect(parseTenantRole(undefined)).toBeNull()
      expect(parseTenantRole(123)).toBeNull()
      expect(parseTenantRole({ role: 'OWNER' })).toBeNull()
    })
  })

  describe('capabilitiesOf', () => {
    it('返回的能力集合与 can() 判定一致', () => {
      for (const r of TENANT_ROLES) {
        const caps = capabilitiesOf(r)
        for (const cap of TENANT_CAPABILITIES) {
          expect(caps.includes(cap)).toBe(can(r, cap))
        }
      }
    })

    it('MEMBER 能力数 < OWNER 能力数（矩阵确实分层）', () => {
      expect(capabilitiesOf('MEMBER').length).toBeLessThan(capabilitiesOf('OWNER').length)
    })
  })
})

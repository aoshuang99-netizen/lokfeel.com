/**
 * V25.3 · T05 —— 记忆域隔离策略的 75 条控制组合 + 负例
 *
 * 参数化矩阵：5 主体 × 5 操作 × 3 权限状态 = 75。
 * 再加 spec 点名的硬负例：组织管理员读个人 Vault、撤销后推理/搜索、
 * research 默认不贡献、模型推断不得当事实、跨域读取。
 */

import {
  authorizeMemoryAction,
  MEMORY_DOMAINS,
  MEMORY_OPERATIONS,
  MEMORY_PERMISSIONS,
  MEMORY_PROVENANCE,
  type MemoryDomain,
  type MemoryOperation,
  type MemoryPermission,
  type MemorySubject,
} from '@/lib/memory/domain-policy'

const BASE: Omit<MemorySubject, 'domain' | 'permission' | 'isOwner'> = {
  viewerId: 'v',
  subjectId: 's',
  provenance: 'USER_STATED',
}

function forDomain(domain: MemoryDomain): MemorySubject {
  return {
    ...BASE,
    domain,
    isOwner: false,
    permission: 'valid',
    isCounterparty: domain === 'dyad',
    isGroupMember: domain === 'group',
    isOrgMember: domain === 'organization',
    researchOptIn: domain === 'research',
  }
}

describe('T05 · 75 条控制组合（5 域 × 5 操作 × 3 权限状态）', () => {
  const combos: Array<[MemoryDomain, MemoryOperation, MemoryPermission]> = []
  for (const domain of MEMORY_DOMAINS) {
    for (const op of MEMORY_OPERATIONS) {
      for (const permission of MEMORY_PERMISSIONS) {
        combos.push([domain, op, permission])
      }
    }
  }

  it('矩阵规模恰为 75', () => {
    expect(combos).toHaveLength(75)
  })

  // 对每条组合断言三个不变量：
  //  1. 撤销态下 read/infer/search 恒拒绝；
  //  2. 非 valid/invalid 态下非本人恒拒绝；
  //  3. personal 域对非本人恒拒绝（含组织管理员）。
  for (const [domain, op, permission] of combos) {
    it(`${domain} × ${op} × ${permission}`, () => {
      const v = authorizeMemoryAction(op, { ...forDomain(domain), permission })
      if (permission === 'revoked' && ['read', 'infer', 'search'].includes(op)) {
        expect(v.allowed).toBe(false)
      }
      if (permission !== 'valid') {
        expect(v.allowed).toBe(false)
      }
      if (domain === 'personal') {
        expect(v.allowed).toBe(false)
      }
    })
  }
})

describe('T05 · spec 点名硬负例', () => {
  it('🔒 组织管理员不得读个人 Vault', () => {
    const v = authorizeMemoryAction('read', {
      ...BASE,
      domain: 'personal',
      permission: 'valid',
      isOwner: false,
      isOrgAdmin: true,
      isOrgMember: true,
    })
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('ORG_ADMIN_NO_PERSONAL')
  })

  it('🔒 撤销后下一次推理不得使用已撤回数据', () => {
    const v = authorizeMemoryAction('infer', {
      ...BASE,
      domain: 'group',
      permission: 'revoked',
      isOwner: false,
      isGroupMember: true,
    })
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('REVOKED')
  })

  it('🔒 撤销后下一次搜索不得使用已撤回数据', () => {
    const v = authorizeMemoryAction('search', {
      ...BASE,
      domain: 'organization',
      permission: 'revoked',
      isOwner: false,
      isOrgMember: true,
    })
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('REVOKED')
  })

  it('🔒 research 默认不贡献：无 opt-in 一律拒绝', () => {
    const v = authorizeMemoryAction('read', {
      ...BASE,
      domain: 'research',
      permission: 'valid',
      isOwner: false,
      researchOptIn: false,
    })
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('RESEARCH_OPT_IN_REQUIRED')
  })

  it('🔒 模型推断不得被当事人当作"用户说过"的事实读取', () => {
    const v = authorizeMemoryAction('read', {
      ...BASE,
      domain: 'dyad',
      permission: 'valid',
      isOwner: false,
      isCounterparty: true,
      provenance: 'MODEL_INFERRED',
    })
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('INFERRED_NOT_FACT')
  })

  it('🔒 跨域读取：dyad 记录不可被普通群成员越域读', () => {
    const v = authorizeMemoryAction('read', {
      ...BASE,
      domain: 'dyad',
      permission: 'valid',
      isOwner: false,
      isCounterparty: false,
      isGroupMember: true,
    })
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('CROSS_DOMAIN')
  })

  it('本人对自己的个人 Vault 拥有完全控制（含删除）', () => {
    for (const op of MEMORY_OPERATIONS) {
      const v = authorizeMemoryAction(op, {
        ...BASE,
        domain: 'personal',
        permission: 'valid',
        isOwner: true,
      })
      expect(v.allowed).toBe(true)
      expect(v.reason).toBe('OWNER')
    }
  })

  it('本人撤销态下仍可删除自己的副本（清理权），但不能推理', () => {
    expect(authorizeMemoryAction('delete', {
      ...BASE, domain: 'personal', permission: 'revoked', isOwner: true,
    }).allowed).toBe(true)
    expect(authorizeMemoryAction('infer', {
      ...BASE, domain: 'personal', permission: 'revoked', isOwner: true,
    }).allowed).toBe(false)
  })

  it('valid + 正确成员资格 → 放行（正控，避免全拒绝假绿）', () => {
    expect(authorizeMemoryAction('read', forDomain('group')).allowed).toBe(true)
    expect(authorizeMemoryAction('read', forDomain('dyad')).allowed).toBe(true)
    expect(authorizeMemoryAction('read', forDomain('organization')).allowed).toBe(true)
    expect(authorizeMemoryAction('read', forDomain('research')).allowed).toBe(true)
  })

  it('三种来源均纳入矩阵（USER_STATED / MUTUAL_CONFIRMED / MODEL_INFERRED）', () => {
    for (const provenance of MEMORY_PROVENANCE) {
      const v = authorizeMemoryAction('search', { ...forDomain('group'), provenance })
      expect(v.allowed).toBe(true)
    }
  })
})

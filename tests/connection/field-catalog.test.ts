/**
 * T03 · 披露字段目录测试
 *
 * 目录是 AC-03 的**事实来源**：它一旦出错（重复键、非法档位、受保护字段被误标为可授权），
 * 上层的投影再正确也救不回来。因此这里的断言偏"元"性质：不只是测某个字段的值，
 * 而是测**整张目录的一致性**。
 */

import {
  AUDIENCE_ORDER,
  DISCLOSURE_AUDIENCES,
  DISCLOSURE_FIELDS,
  DISCLOSURE_FIELD_KEYS,
  IMPORTABLE_FIELD_KEYS,
  MISSING_FIELD_AUDIENCE,
  PROTECTED_FIELD_KEYS,
  SENSITIVE_FIELD_KEYS,
  audienceCanSee,
  audienceRank,
  auditCatalog,
  fieldSpec,
  isAudience,
  isFieldKey,
  suggestedDisclosure,
} from '@/lib/connection/field-catalog'

describe('T03 · 披露字段目录', () => {
  it('目录自检无问题（键唯一、档位合法、受保护字段不被标为可导入）', () => {
    expect(auditCatalog()).toEqual([])
  })

  it('声明的键与字段规格一一对应（不多不少）', () => {
    expect(DISCLOSURE_FIELDS.map((f) => f.key).sort()).toEqual([...DISCLOSURE_FIELD_KEYS].sort())
    expect(new Set(DISCLOSURE_FIELD_KEYS).size).toBe(DISCLOSURE_FIELD_KEYS.length)
  })

  it('每个字段都有中文标签与非空分组（前端直接渲染，不能出现空标签）', () => {
    for (const f of DISCLOSURE_FIELDS) {
      expect(f.label.trim().length).toBeGreaterThan(0)
      expect(f.group.trim().length).toBeGreaterThan(0)
    }
  })

  it('🔒 受保护字段（联系方式类）不得可授权、不得可导入、缺省必须是 SELF', () => {
    expect(PROTECTED_FIELD_KEYS.length).toBeGreaterThan(0)
    for (const key of PROTECTED_FIELD_KEYS) {
      const spec = fieldSpec(key)
      expect(spec).not.toBeNull()
      expect(spec!.disclosable).toBe(false)
      expect(spec!.importable).toBe(false)
      expect(spec!.defaultAudience).toBe('SELF')
    }
  })

  it('email 在受保护清单里（逐字段开关不得成为联系方式外泄通道）', () => {
    expect(PROTECTED_FIELD_KEYS).toContain('email')
  })

  it('🔒 敏感字段的表单建议档位一律 SELF（必须由用户显式选择才扩大披露面）', () => {
    for (const key of SENSITIVE_FIELD_KEYS) {
      expect(fieldSpec(key)!.defaultAudience).toBe('SELF')
    }
  })

  it('可导入字段是受保护字段的补集之外的真子集（不能出现"可导入但不可披露"的怪状态）', () => {
    for (const key of IMPORTABLE_FIELD_KEYS) {
      expect(fieldSpec(key)!.disclosable).toBe(true)
    }
  })

  it('API 缺省档位是 SELF（缺失字段 = 未授权）', () => {
    expect(MISSING_FIELD_AUDIENCE).toBe('SELF')
  })

  it('audienceRank 单调且非法值退化为 SELF 的序号（fail-closed）', () => {
    expect(audienceRank('SELF')).toBe(0)
    expect(audienceRank('ORGANIZER')).toBe(1)
    expect(audienceRank('COUNTERPARTY')).toBe(2)
    expect(audienceRank('NOPE' as never)).toBe(0)
    expect(AUDIENCE_ORDER).toEqual([...DISCLOSURE_AUDIENCES])
  })

  it('audienceCanSee 表达的是**包含式**受众（档位越高看到的人越多）', () => {
    // 投影受众里**没有** SELF：本人不走投影机制（否则就是"传 SELF 即全量"）
    expect(audienceCanSee('SELF', 'SELF')).toBe(false)
    expect(audienceCanSee('ORGANIZER', 'SELF')).toBe(false)
    expect(audienceCanSee('COUNTERPARTY', 'SELF')).toBe(false)
    // SELF 档只给自己
    expect(audienceCanSee('SELF', 'ORGANIZER')).toBe(false)
    expect(audienceCanSee('SELF', 'COUNTERPARTY')).toBe(false)
    // ORGANIZER 档 = 本人 + 组织者（对手方看不到）
    expect(audienceCanSee('ORGANIZER', 'ORGANIZER')).toBe(true)
    expect(audienceCanSee('ORGANIZER', 'COUNTERPARTY')).toBe(false)
    // COUNTERPARTY 档 = 最宽（本人 + 组织者 + 对手方）
    expect(audienceCanSee('COUNTERPARTY', 'COUNTERPARTY')).toBe(true)
    expect(audienceCanSee('COUNTERPARTY', 'ORGANIZER')).toBe(true)
  })

  it('isAudience 严格匹配大小写（"organizer" 必须被拒绝）', () => {
    expect(isAudience('ORGANIZER')).toBe(true)
    expect(isAudience('organizer')).toBe(false)
    expect(isAudience(1)).toBe(false)
    expect(isAudience(null)).toBe(false)
  })

  it('isFieldKey / fieldSpec 对未知键一致地返回否定', () => {
    expect(isFieldKey('displayName')).toBe(true)
    expect(isFieldKey('nope')).toBe(false)
    expect(fieldSpec('nope')).toBeNull()
    expect(fieldSpec('displayName')!.label).toBe('昵称')
  })

  it('suggestedDisclosure 覆盖全部字段（前端"采用建议"不会漏项）', () => {
    const s = suggestedDisclosure()
    expect(Object.keys(s).sort()).toEqual([...DISCLOSURE_FIELD_KEYS].sort())
    expect(s.displayName).toBe('ORGANIZER')
    expect(s.email).toBe('SELF')
  })
})

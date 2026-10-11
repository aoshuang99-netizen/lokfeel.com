/**
 * T03 · 披露字段目录测试
 *
 * 目录是 AC-03 的**事实来源**：它一旦出错（重复键、非法档位、受保护字段被误标为可授权），
 * 上层的投影再正确也救不回来。因此这里的断言偏"元"性质：不只是测某个字段的值，
 * 而是测**整张目录的一致性**。
 */

import {
  AUDIENCE_OPTIONS,
  AUDIENCE_ORDER,
  CANDIDATE_PROFILE_AUDIENCE,
  DISCLOSURE_AUDIENCES,
  DISCLOSURE_FIELDS,
  DISCLOSURE_FIELD_KEYS,
  EXTERNAL_AUDIENCES,
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
    expect(audienceRank('CANDIDATE')).toBe(3)
    expect(audienceRank('NOPE' as never)).toBe(0)
    expect(AUDIENCE_ORDER).toEqual([...DISCLOSURE_AUDIENCES])
  })

  it('🔒 档位次序不变量：CANDIDATE 是最宽的一档，且已存在档位的相对次序未被动过', () => {
    // 这条不变量是 T04 引入 CANDIDATE 时**唯一**必须守住的东西。写反了就是一次
    // 静默的越权披露，而且不会有任何运行期报错来提醒你：
    //   记 C = 已同意的对手方，P = 同任务的互补伙伴。事实是 **C ⊆ P**
    //   （任何对手方在同意之前本来就是候选伙伴），所以
    //   "给已同意者看" ⊂ "给伙伴看" → CANDIDATE 更宽，必须追加在末尾。
    //   若写成 CANDIDATE 更窄（插在 COUNTERPARTY 之前），
    //   `rank(COUNTERPARTY) >= rank(CANDIDATE)` 成立 →
    //   尚未同意的人会看到用户只授权给已同意对手方的字段。
    expect(audienceRank('COUNTERPARTY')).toBeLessThan(audienceRank('CANDIDATE'))
    // 已存在档位的相对次序（历史数据的可见性靠它，不得被新档位挤动）
    expect(audienceRank('SELF')).toBeLessThan(audienceRank('ORGANIZER'))
    expect(audienceRank('ORGANIZER')).toBeLessThan(audienceRank('COUNTERPARTY'))
  })

  it('audienceCanSee 真相表（档位 = 我允许看到它的最宽人群）', () => {
    // 投影受众里**没有** SELF：本人不走投影机制（否则就是"传 SELF 即全量"）
    expect(audienceCanSee('SELF', 'SELF')).toBe(false)
    expect(audienceCanSee('ORGANIZER', 'SELF')).toBe(false)
    expect(audienceCanSee('COUNTERPARTY', 'SELF')).toBe(false)
    expect(audienceCanSee('CANDIDATE', 'SELF')).toBe(false)

    // SELF 档只给自己
    expect(audienceCanSee('SELF', 'ORGANIZER')).toBe(false)
    expect(audienceCanSee('SELF', 'COUNTERPARTY')).toBe(false)
    expect(audienceCanSee('SELF', 'CANDIDATE')).toBe(false)

    // ORGANIZER 档 = 本人 + 组织者（其余外部受众都看不到）
    expect(audienceCanSee('ORGANIZER', 'ORGANIZER')).toBe(true)
    expect(audienceCanSee('ORGANIZER', 'COUNTERPARTY')).toBe(false)
    expect(audienceCanSee('ORGANIZER', 'CANDIDATE')).toBe(false)

    // 🔴 COUNTERPARTY 档 = 本人 + 组织者 + 已同意对手方，**候选看不到**。
    //    这一行是本模型里最要紧的一条：用户写了"只给已配对的对手方看"，
    //    那么还没配对成功的人就不该看到。
    expect(audienceCanSee('COUNTERPARTY', 'ORGANIZER')).toBe(true)
    expect(audienceCanSee('COUNTERPARTY', 'COUNTERPARTY')).toBe(true)
    expect(audienceCanSee('COUNTERPARTY', 'CANDIDATE')).toBe(false)

    // CANDIDATE 档 = 最宽（本人 + 组织者 + 已同意者 + 任意互补伙伴）
    expect(audienceCanSee('CANDIDATE', 'ORGANIZER')).toBe(true)
    expect(audienceCanSee('CANDIDATE', 'COUNTERPARTY')).toBe(true)
    expect(audienceCanSee('CANDIDATE', 'CANDIDATE')).toBe(true)
  })

  it('CANDIDATE_PROFILE_AUDIENCE 是候选通道的投影目标，且必须是外部受众', () => {
    // 候选页的浏览者身份就是"同任务的伙伴"，因此投影档位是 CANDIDATE。
    // 用 COUNTERPARTY 会把"只授权给已同意对手方"的字段提前给到还没同意的人。
    expect(CANDIDATE_PROFILE_AUDIENCE).toBe('CANDIDATE')
    expect(EXTERNAL_AUDIENCES).toContain(CANDIDATE_PROFILE_AUDIENCE)
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

  it('表单档位清单与档位声明完全一致（少一项 = 用户无从授权该档）', () => {
    // 这是"界面没有开关、数据却能往外走"的镜像版本：若前端清单少了 CANDIDATE，
    // 用户就无法把字段开给同任务的伙伴，而后端投影已经支持这一档。
    expect(AUDIENCE_OPTIONS.map((o) => o.value)).toEqual([...DISCLOSURE_AUDIENCES])
    expect(AUDIENCE_OPTIONS.every((o) => o.label.trim().length > 0)).toBe(true)
    // EXTERNAL_AUDIENCES 是档位声明去掉 SELF 后的原序子集
    expect(EXTERNAL_AUDIENCES).toEqual(DISCLOSURE_AUDIENCES.filter((a) => a !== 'SELF'))
  })
})

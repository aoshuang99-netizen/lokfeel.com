/**
 * T03 · 逐字段披露测试 —— **AC-03 的主要证据**
 *
 * AC-03（BLOCKER）：「未授权字段不进入 Agent prompt、检索结果、消息」。
 * 本文件用两种互补的方式证明：
 *   ① **结构断言** —— 未授权字段的键在投影对象上**根本不存在**（而非值为 undefined）；
 *   ② **值级断言** —— 未授权字段的**值**不出现在序列化结果里。
 *
 * ⚠️ 为什么 ② 针对"值"而不是"键名"：
 *   披露说明（summary）本来就要列出字段**清单**（用户有权知道"有哪些字段、
 *   哪些会被披露"）。对键名做否定断言会把这份正当的说明也判成泄露，
 *   从而逼着实现去删掉用户真正需要的信息。断言必须打在**值**上。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { ValidationError } from '@/lib/errors'
import {
  decodeDisclosure,
  describeDisclosure,
  discloseSubject,
  effectiveDisclosure,
  encodeDisclosure,
  fieldsVisibleTo,
  grantedAudience,
  normalizeDisclosure,
  type DisclosureMap,
  type SubjectProfile,
} from '@/lib/connection/disclosure'

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** 一份"什么都有"的档案：用来验证"有值 ≠ 会披露"。 */
const profile: SubjectProfile = {
  displayName: '林晓',
  avatarUrl: 'https://cdn.example.com/a.png',
  bio: '做了 8 年跨境供应链',
  city: '上海',
  country: 'CN',
  occupation: '供应链负责人',
  company: '启航贸易',
  industry: '跨境贸易',
  selectedTags: ['跨境', '供应链'],
  lifePriorities: ['Family', 'Career'],
  age: 32,
  genderIdentity: '非二元',
  relationshipGoal: 'LONG_TERM',
  email: 'lin@example.com',
}

describe('T03 · 逐字段披露 —— 结构安全', () => {
  it('🔒 未授权字段在投影对象上**根本不存在**（不是 undefined）', () => {
    const out = discloseSubject(profile, { displayName: 'ORGANIZER' }, 'ORGANIZER')

    expect(out.displayName).toBe('林晓')
    expect(has(out, 'email')).toBe(false)
    expect(has(out, 'bio')).toBe(false)
    expect(has(out, 'age')).toBe(false)
    // 键集合必须**恰好**等于被授权且有值的字段 —— 多一个都算泄露
    expect(Object.keys(out).sort()).toEqual(['displayName'])
  })

  it('🔒 序列化后不含任何未授权字段的值（端到端泄露断言）', () => {
    const out = discloseSubject(profile, { displayName: 'ORGANIZER' }, 'ORGANIZER')
    const json = JSON.stringify(out)

    // 值级断言：这些内容一个字都不该出现
    expect(json).not.toContain('lin@example.com')
    expect(json).not.toContain('非二元')
    expect(json).not.toContain('八年跨境')
    expect(json).not.toContain('启航贸易')
    expect(json).not.toContain('上海')
    // 结构断言：键名也不该出现（这里没有 summary，所以键名断言是安全的）
    for (const forbidden of ['email', 'age', 'genderIdentity', 'bio', 'city', 'company']) {
      expect(json).not.toContain(`"${forbidden}"`)
    }
  })

  it('🔒 email 的结构性保护：即使披露表被脏数据塞了它，任何受众都拿不到', () => {
    // 绕过写路径直接构造（模拟历史脏数据 / 手工改库）
    const dirty = { email: 'COUNTERPARTY', displayName: 'ORGANIZER' } as unknown as DisclosureMap

    for (const viewer of ['ORGANIZER', 'COUNTERPARTY'] as const) {
      const out = discloseSubject(profile, dirty, viewer)
      expect(has(out, 'email')).toBe(false)
    }
    // 且它不会被算进"可见清单"
    expect(fieldsVisibleTo(dirty, 'COUNTERPARTY')).not.toContain('email')
    expect(grantedAudience(dirty, 'email')).toBe('SELF')
  })

  it('缺省 = 不披露：空披露表下任何外部受众都拿不到字段', () => {
    for (const viewer of ['ORGANIZER', 'COUNTERPARTY'] as const) {
      expect(discloseSubject(profile, {}, viewer)).toEqual({})
    }
  })

  it('🔒 投影受众不含 SELF：避免"传 SELF 即全量"的危险形状', () => {
    // 空披露表 + viewer=SELF 曾经会返回**整份档案**（所有字段档位都 >= 0）。
    // 现在 SELF 不是合法投影受众，这条路径在运行期返回空、并在类型上被排除。
    expect(discloseSubject(profile, {}, 'SELF' as never)).toEqual({})
    expect(fieldsVisibleTo({}, 'SELF' as never)).toEqual([])
  })

  it('没有值的字段不出现（授权了 ≠ 会有内容）', () => {
    const sparse: SubjectProfile = { displayName: '林晓', bio: null, city: undefined }
    const out = discloseSubject(
      sparse,
      { displayName: 'ORGANIZER', bio: 'ORGANIZER', city: 'ORGANIZER' },
      'ORGANIZER'
    )
    expect(Object.keys(out)).toEqual(['displayName'])
  })

  it('空数组不出现（避免前端把空标签渲染成"有数据"）', () => {
    const empty: SubjectProfile = { selectedTags: [], displayName: '林晓' }
    const out = discloseSubject(empty, { selectedTags: 'ORGANIZER', displayName: 'ORGANIZER' }, 'ORGANIZER')
    expect(has(out, 'selectedTags')).toBe(false)
  })
})

describe('T03 · 逐字段披露 —— 受众语义（包含式：档位越高，看到的人越多）', () => {
  // 目录的正式口径：
  //   SELF          → 仅本人（= 不披露）
  //   ORGANIZER     → 本人 + 组织者
  //   COUNTERPARTY  → 本人 + 组织者 + 对手方（**最宽**）
  // 推论：组织者视角 ⊇ 对手方视角 —— 与"组织者管整个任务"的产品语义一致。
  const map: DisclosureMap = {
    displayName: 'ORGANIZER', // 本人 + 组织者
    bio: 'ORGANIZER',
    age: 'COUNTERPARTY', // 本人 + 组织者 + 对手方
    company: 'SELF', // 仅本人（= 不披露）
  }

  it('组织者看到 ORGANIZER 档与更宽的 COUNTERPARTY 档，看不到 SELF 档', () => {
    const out = discloseSubject(profile, map, 'ORGANIZER')
    expect(Object.keys(out).sort()).toEqual(['age', 'bio', 'displayName'])
    expect(has(out, 'company')).toBe(false)
  })

  it('对手方**只**看得到最宽的 COUNTERPARTY 档（ORGANIZER 档对他不可见）', () => {
    const out = discloseSubject(profile, map, 'COUNTERPARTY')
    expect(Object.keys(out)).toEqual(['age'])
    expect(has(out, 'bio')).toBe(false)
    expect(has(out, 'displayName')).toBe(false)
    expect(has(out, 'company')).toBe(false)
  })

  it('fieldsVisibleTo 按目录顺序稳定输出，且组织者视角包含对手方视角', () => {
    expect(fieldsVisibleTo(map, 'ORGANIZER')).toEqual(['displayName', 'bio', 'age'])
    expect(fieldsVisibleTo(map, 'COUNTERPARTY')).toEqual(['age'])
    const org = fieldsVisibleTo(map, 'ORGANIZER')
    const cp = fieldsVisibleTo(map, 'COUNTERPARTY')
    expect(cp.every((k) => org.includes(k))).toBe(true)
  })
})

describe('T03 · 披露编解码', () => {
  it('encodeDisclosure：空表编码为 null（不落一坨 "{}"）', () => {
    expect(encodeDisclosure({})).toBeNull()
    expect(encodeDisclosure({ displayName: 'ORGANIZER' })).toBe('{"displayName":"ORGANIZER"}')
  })

  it('decodeDisclosure：合法文本正常解析', () => {
    expect(decodeDisclosure('{"displayName":"ORGANIZER"}')).toEqual({ displayName: 'ORGANIZER' })
  })

  it('decodeDisclosure：脏数据一律静默收敛，**绝不抛异常**', () => {
    // 一行脏数据不该打挂整个列表/整张页面
    expect(decodeDisclosure('{ this is not json')).toEqual({})
    expect(decodeDisclosure('[1,2,3]')).toEqual({})
    expect(decodeDisclosure('"a string"')).toEqual({})
    expect(decodeDisclosure(null)).toEqual({})
    expect(decodeDisclosure(undefined)).toEqual({})
    // 未知键与非法档位被丢弃，合法项保留
    expect(decodeDisclosure('{"nope":"ORGANIZER","displayName":"organizer","bio":"SELF"}')).toEqual({
      bio: 'SELF',
    })
    // 受保护字段即使出现在历史数据里也不认
    expect(decodeDisclosure('{"email":"COUNTERPARTY"}')).toEqual({})
  })

  it('normalizeDisclosure：合法输入原样通过（含显式 SELF）', () => {
    expect(normalizeDisclosure({ displayName: 'ORGANIZER', bio: 'SELF' })).toEqual({
      displayName: 'ORGANIZER',
      bio: 'SELF',
    })
    expect(normalizeDisclosure(undefined)).toEqual({})
    expect(normalizeDisclosure(null)).toEqual({})
  })

  it('🔒 normalizeDisclosure fail loud：未知字段 / 受保护字段 / 非法档位一律 400', () => {
    expect(() => normalizeDisclosure({ nope: 'ORGANIZER' })).toThrow(ValidationError)

    // 受保护字段：明确说明"走同意流程"，而不是含糊的"非法"
    try {
      normalizeDisclosure({ email: 'COUNTERPARTY' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError)
      expect((e as ValidationError).statusCode).toBe(400)
      expect((e as ValidationError).details).toMatchObject({ protectedField: 'email' })
    }

    // 大小写错误必须被拒（否则落库成"谁都不认识的档位"）
    expect(() => normalizeDisclosure({ displayName: 'organizer' })).toThrow(ValidationError)
    expect(() => normalizeDisclosure([])).toThrow(ValidationError)
    expect(() => normalizeDisclosure('x')).toThrow(ValidationError)
  })

  it('effectiveDisclosure 补齐缺省为 SELF（供前端渲染"每个字段当前是什么档"）', () => {
    const eff = effectiveDisclosure({ displayName: 'ORGANIZER' })
    expect(eff.displayName).toBe('ORGANIZER')
    expect(eff.email).toBe('SELF')
    expect(eff.age).toBe('SELF')
    expect(Object.keys(eff).length).toBeGreaterThan(10)
  })
})

describe('T03 · 披露说明（"即将披露给谁哪些信息"）', () => {
  it('按外部受众分组；未授权的走 withheld；受保护字段单列', () => {
    const summary = describeDisclosure({ displayName: 'ORGANIZER', age: 'COUNTERPARTY' })

    expect(summary.byAudience.ORGANIZER.map((e) => e.key)).toEqual(['displayName'])
    expect(summary.byAudience.COUNTERPARTY.map((e) => e.key)).toEqual(['age'])
    // 组织者视角 = ORGANIZER ∪ COUNTERPARTY 两档（包含式的直接推论）
    expect(summary.visibleToOrganizer).toEqual(['displayName', 'age'])
    // 对手方视角 = 仅最宽档
    expect(summary.visibleToCounterparty).toEqual(['age'])

    // SELF 档不构成"受众"，而是归入 withheld
    expect(summary.withheld).toContain('bio')
    expect(summary.withheld).not.toContain('displayName')
    expect(Object.keys(summary.byAudience).sort()).toEqual(['COUNTERPARTY', 'ORGANIZER'])

    // 受保护字段单独一组（前端展示原因而非开关）
    expect(summary.protectedFields.map((e) => e.key)).toContain('email')
    expect(summary.withheld).not.toContain('email')
  })

  it('敏感字段在说明中标出 sensitive（前端据此做视觉提示）', () => {
    const summary = describeDisclosure({ age: 'ORGANIZER' })
    const age = summary.byAudience.ORGANIZER.find((e) => e.key === 'age')
    expect(age?.sensitive).toBe(true)
    const name = describeDisclosure({ displayName: 'ORGANIZER' }).byAudience.ORGANIZER.find(
      (e) => e.key === 'displayName'
    )
    expect(name?.sensitive).toBe(false)
  })

  it('空披露表下 withheld 覆盖全部可披露字段（用户能一眼看出"什么都没给"）', () => {
    const summary = describeDisclosure({})
    expect(summary.visibleToOrganizer).toEqual([])
    expect(summary.visibleToCounterparty).toEqual([])
    expect(summary.byAudience.ORGANIZER).toEqual([])
    expect(summary.byAudience.COUNTERPARTY).toEqual([])
    expect(summary.withheld.length).toBeGreaterThan(10)
  })
})

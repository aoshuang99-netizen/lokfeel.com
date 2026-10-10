/**
 * T03 · 意图输入校验测试
 *
 * 重点覆盖三条与任务卡直接对应的规则：
 *   - 字段校验（need/offer/约束/有效期长度与形状）
 *   - **用户主动授权**（disclosure 必须显式且受保护字段被拒）
 *   - **导入许可**（开关 + 清单 + 同意三件齐全，缺一件即 400）
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { ValidationError } from '@/lib/errors'
import {
  INTENT_LIMITS,
  INTENT_STATUS_ACTIONS,
  parseIntentCreate,
  parseIntentPatch,
  parseIntentStatusAction,
  parseWithdrawReason,
} from '@/lib/connection/intent-input'

const base = {
  missionId: 'm_1',
  need: '我需要东南亚的落地渠道',
  offer: '我可以提供样品与培训',
}

function fieldOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    return (e as ValidationError).details?.field
  }
  return undefined
}

describe('T03 · parseIntentCreate', () => {
  it('最小合法输入 → 解析成功，disclosure 缺省为空表（= 不披露任何字段）', () => {
    const out = parseIntentCreate(base)
    expect(out.missionId).toBe('m_1')
    expect(out.need).toBe(base.need)
    expect(out.offer).toBe(base.offer)
    expect(out.constraints).toEqual([])
    expect(out.disclosure).toEqual({})
    expect(out.expiresAt).toBeNull()
    expect(out.importPlan.accepted).toEqual([])
    expect(out.importConsentGiven).toBe(false)
  })

  it('missionId 必填且 trim', () => {
    expect(fieldOf(() => parseIntentCreate({ ...base, missionId: '   ' }))).toBe('missionId')
    expect(fieldOf(() => parseIntentCreate({ ...base, missionId: undefined }))).toBe('missionId')
    expect(parseIntentCreate({ ...base, missionId: ' m_9 ' }).missionId).toBe('m_9')
  })

  it('need/offer 长度边界', () => {
    expect(fieldOf(() => parseIntentCreate({ ...base, need: 'ab' }))).toBe('need')
    expect(fieldOf(() => parseIntentCreate({ ...base, need: 'x'.repeat(INTENT_LIMITS.needMax + 1) }))).toBe('need')
    expect(fieldOf(() => parseIntentCreate({ ...base, offer: '' }))).toBe('offer')
    expect(fieldOf(() => parseIntentCreate({ ...base, offer: 'x'.repeat(INTENT_LIMITS.offerMax + 1) }))).toBe('offer')
  })

  it('constraints 走归一化（去重/去空/截断），非数组 → 空数组', () => {
    expect(parseIntentCreate({ ...base, constraints: ['A', 'A', ' ', 'B'] }).constraints).toEqual(['A', 'B'])
    expect(parseIntentCreate({ ...base, constraints: 'A' }).constraints).toEqual([])
  })

  it('未知顶层字段被显式丢弃（不进入领域逻辑）', () => {
    const out = parseIntentCreate({ ...base, organizationId: 'org_attacker', userId: 'u_evil' } as any)
    expect(out).not.toHaveProperty('organizationId')
    expect((out as any).userId).toBeUndefined()
  })

  it('🔒 disclosure 里的受保护字段（email）→ 400 且带 protectedField', () => {
    try {
      parseIntentCreate({ ...base, disclosure: { displayName: 'ORGANIZER', email: 'COUNTERPARTY' } })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError)
      expect((e as ValidationError).details).toMatchObject({ protectedField: 'email' })
    }
  })

  it('disclosure 未知字段 / 非法档位 → 400', () => {
    expect(() => parseIntentCreate({ ...base, disclosure: { nope: 'SELF' } })).toThrow(ValidationError)
    expect(() => parseIntentCreate({ ...base, disclosure: { displayName: 'EVERYONE' } })).toThrow(ValidationError)
  })

  it('expiresAt：必须是未来；非法日期 → 400', () => {
    const now = new Date('2026-10-10T00:00:00.000Z')
    expect(fieldOf(() => parseIntentCreate({ ...base, expiresAt: '2026-10-09T00:00:00.000Z' }, now))).toBe('expiresAt')
    expect(fieldOf(() => parseIntentCreate({ ...base, expiresAt: 'not-a-date' }, now))).toBe('expiresAt')
    expect(parseIntentCreate({ ...base, expiresAt: '2026-11-01T00:00:00.000Z' }, now).expiresAt).toBeInstanceOf(Date)
  })

  it('🔒 导入三件套：缺 importFromProfile 时给了清单/同意 → 400（防止"以为导入了"）', () => {
    expect(fieldOf(() => parseIntentCreate({ ...base, importFields: ['bio'] }))).toBe('importFromProfile')
    expect(fieldOf(() => parseIntentCreate({ ...base, importConsent: true }))).toBe('importFromProfile')
  })

  it('🔒 importFromProfile=true 但未显式同意 → 400', () => {
    const field = fieldOf(() =>
      parseIntentCreate({ ...base, importFromProfile: true, importFields: ['bio'] })
    )
    expect(field).toBe('importConsent')
    // 且不得接受"模糊的真值"
    expect(
      fieldOf(() => parseIntentCreate({ ...base, importFromProfile: true, importFields: ['bio'], importConsent: 'true' }))
    ).toBe('importConsent')
  })

  it('🔒 importFromProfile=true 但清单为空 → 400', () => {
    expect(
      fieldOf(() => parseIntentCreate({ ...base, importFromProfile: true, importFields: [], importConsent: true }))
    ).toBe('importFields')
  })

  it('三件齐全 → 解析成功，且同意被记录', () => {
    const out = parseIntentCreate({
      ...base,
      importFromProfile: true,
      importFields: ['displayName', 'occupation'],
      importConsent: true,
    })
    expect(out.importConsentGiven).toBe(true)
    expect(out.importPlan.accepted).toEqual(['displayName', 'occupation'])
  })
})

describe('T03 · parseIntentPatch', () => {
  it('部分字段更新；未给出的字段不出现在结果里', () => {
    const patch = parseIntentPatch({ need: '换个说法描述我的需求' })
    expect(Object.keys(patch)).toEqual(['need'])
  })

  it('空 patch / 非对象 → 400', () => {
    expect(() => parseIntentPatch({})).toThrow(ValidationError)
    expect(() => parseIntentPatch([])).toThrow(ValidationError)
  })

  it('🔒 不可变字段：missionId / userId / status / importFields 出现即 400（不静默忽略）', () => {
    for (const k of ['missionId', 'userId', 'status', 'importFields'] as const) {
      expect(fieldOf(() => parseIntentPatch({ [k]: 'x' }))).toBe(k)
    }
  })

  it('disclosure 是**整体替换**：可以表达"取消某字段授权"（通过省略该键）', () => {
    const patch = parseIntentPatch({ disclosure: { displayName: 'ORGANIZER' } })
    expect(patch.disclosure).toEqual({ displayName: 'ORGANIZER' })
    const cleared = parseIntentPatch({ disclosure: {} })
    expect(cleared.disclosure).toEqual({})
  })

  it('expiresAt 允许改到过去（表示立即失效）', () => {
    const now = new Date('2026-10-10T00:00:00.000Z')
    const patch = parseIntentPatch({ expiresAt: '2026-01-01T00:00:00.000Z' }, now)
    expect(patch.expiresAt).toBeInstanceOf(Date)
  })

  it('constraints 归一化同样生效', () => {
    expect(parseIntentPatch({ constraints: ['A', 'A'] }).constraints).toEqual(['A'])
  })
})

describe('T03 · 状态动作', () => {
  it('只接受 withdraw / reactivate', () => {
    expect(INTENT_STATUS_ACTIONS).toEqual(['withdraw', 'reactivate'])
    expect(parseIntentStatusAction('withdraw')).toBe('withdraw')
    expect(parseIntentStatusAction('reactivate')).toBe('reactivate')
    expect(fieldOf(() => parseIntentStatusAction('delete'))).toBe('action')
    expect(fieldOf(() => parseIntentStatusAction(undefined))).toBe('action')
  })

  it('撤销原因是可选短文本', () => {
    expect(parseWithdrawReason('暂时不需要了')).toBe('暂时不需要了')
    expect(parseWithdrawReason('  ')).toBeNull()
    expect(parseWithdrawReason(undefined)).toBeNull()
    expect(() => parseWithdrawReason('x'.repeat(201))).toThrow(ValidationError)
  })
})

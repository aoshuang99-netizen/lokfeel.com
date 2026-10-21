/**
 * AC-10 · 账号级数据生命周期（纯函数）
 *
 * 这里守的是**删除政策本身**，而不是"代码能不能跑"：
 *   - 销号邮箱**必须**唯一且不可投递（`User.email` 有 `@unique`，撞了就是写库失败）；
 *   - 导出物**必须**剔掉凭据（落到用户手里的东西不能再当口令用）；
 *   - 删除动作清单**必须**把"保留项"与"动数据项"分开（否则"删了什么"会变成两份说法）。
 *
 * ⚠️ 不 import `@/lib/lifecycle`（barrel）—— 那条路径会拉进 `@/lib/db` → `next-auth`（纯 ESM），
 *    在 jest 的 CJS 环境下会 "Test suite failed to run"。纯函数测试一律走**深路径**。
 */

import {
  ACCOUNT_EXPORT_VERSION,
  ERASURE_ACTIONS,
  ERASED_DISPLAY_NAME,
  ERASED_EMAIL_DOMAIN,
  EXPORT_ROW_LIMIT,
  PROFILE_REDACTED_FIELDS,
  USER_REDACTED_FIELDS,
  activeErasureActions,
  erasedEmailFor,
  erasedProfilePatch,
  redactProfileForExport,
  redactUserForExport,
} from '@/lib/lifecycle/account'
import {
  CACHE_KEYS,
  USER_REFERENCING_CACHE_PREFIXES,
  userScopedCacheKeys,
} from '@/lib/cache-keys'
import fs from 'node:fs'
import path from 'node:path'

describe('AC-10 · 销号邮箱', () => {
  it('唯一（含 userId）且落在 RFC 2606 保留域（不可投递）', () => {
    const a = erasedEmailFor('user_abc')
    const b = erasedEmailFor('user_xyz')
    expect(a).not.toBe(b)
    expect(a).toContain('user_abc')
    expect(a.endsWith(`@${ERASED_EMAIL_DOMAIN}`)).toBe(true)
    expect(ERASED_EMAIL_DOMAIN).toBe('erased.invalid')
  })

  it('同一 userId 稳定（重放不会生成第二个邮箱）', () => {
    expect(erasedEmailFor('u1')).toBe(erasedEmailFor('u1'))
  })
})

describe('AC-10 · 导出脱敏', () => {
  it('凭据字段被剔除，其余字段原样保留', () => {
    const row = {
      id: 'u1',
      email: 'a@b.com',
      name: '甲',
      password: 'hash',
      tokenVersion: 7,
      botConfig: '{"x":1}',
      createdAt: '2026-01-01',
    }
    const out = redactUserForExport(row)
    for (const k of USER_REDACTED_FIELDS) expect(k in out).toBe(false)
    expect(out.id).toBe('u1')
    expect(out.email).toBe('a@b.com')
    expect(out.name).toBe('甲')
    // 不改原对象
    expect(row.password).toBe('hash')
  })

  it('档案里的内部运营备注不进导出', () => {
    const row = { id: 'p1', displayName: '甲', adminNotes: '内部备注' }
    const out = redactProfileForExport(row)
    for (const k of PROFILE_REDACTED_FIELDS) expect(k in out).toBe(false)
    expect(out.displayName).toBe('甲')
  })

  it('单表上限是正数（0 会让导出恒空）', () => {
    expect(EXPORT_ROW_LIMIT).toBeGreaterThan(0)
    expect(ACCOUNT_EXPORT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('AC-10 · 销号后的档案补丁', () => {
  const patch = erasedProfilePatch()

  it('🔴 profileStatus=DEACTIVATED + isApproved=false —— 这是各查询面的实际闸门', () => {
    expect(patch.profileStatus).toBe('DEACTIVATED')
    expect(patch.isApproved).toBe(false)
    expect(patch.isVerified).toBe(false)
  })

  it('PII 字段被清空', () => {
    expect(patch.displayName).toBe(ERASED_DISPLAY_NAME)
    expect(patch.bio).toBeNull()
    expect(patch.avatar).toBeNull()
    expect(patch.city).toBeNull()
    expect(patch.occupation).toBeNull()
    expect(patch.company).toBeNull()
    expect(patch.adminNotes).toBeNull()
    expect(patch.personalityData).toBeNull()
    expect(patch.galleryPhotos).toBe('[]')
  })
})

describe('AC-10 · 删除动作清单', () => {
  it('「动数据」与「保留」必须分开，且两栏都非空', () => {
    const active = activeErasureActions()
    expect(active.length).toBeGreaterThan(0)
    expect(active.every((a) => a.action !== 'retain')).toBe(true)

    const retained = ERASURE_ACTIONS.filter((a) => a.action === 'retain')
    expect(retained.length).toBeGreaterThan(0)
  })

  it('🔴 对方侧的记录与审计**必须**保留（裸删会破坏引用与合规证据）', () => {
    for (const target of ['Membership', 'AuditLog / TenantAuditEvent']) {
      const row = ERASURE_ACTIONS.find((a) => a.target === target)
      expect(row?.action).toBe('retain')
    }
    const proposalRow = ERASURE_ACTIONS.find((a) => a.target.startsWith('ConnectionProposal'))
    expect(proposalRow?.action).toBe('retain')
  })

  it('账号凭据必须走 anonymize（不是 retain）', () => {
    const userRows = ERASURE_ACTIONS.filter((a) => a.target === 'User')
    expect(userRows.some((a) => a.action === 'anonymize')).toBe(true)
  })
})

describe('AC-10 · 销号补丁：非空列必须用中性哨兵', () => {
  const patch = erasedProfilePatch()

  it('🔴 非空列不得留原值（留原值 = 留下一份粗粒度画像）', () => {
    expect(patch.age).toBe(0)
    expect(patch.gender).toBe('PREFER_NOT_TO_SAY')
    expect(patch.sexuality).toBe('')
    expect(patch.relationshipGoal).toBe('NOT_SURE')
  })

  it('可空字段全部清空（含风格与匹配偏好）', () => {
    const nullable = [
      patch.country,
      patch.attachmentStyle,
      patch.communicationStyle,
      patch.conflictResolution,
      patch.loveLanguage,
      patch.emotionalAvailability,
      patch.domSubRole,
      patch.preferredRole,
      patch.kinkExperienceLevel,
      patch.preferredAgeMin,
      patch.preferredAgeMax,
      patch.preferredGender,
      patch.preferredDistance,
      patch.preferredLocation,
      patch.compatibilityScore,
    ]
    expect(nullable).toHaveLength(15)
    expect(nullable.every((v) => v === null)).toBe(true)
  })
})

describe('AC-10 · 缓存键：单一来源', () => {
  it('本人键逐字匹配（顺序固定，改一处即红）', () => {
    expect(userScopedCacheKeys('u1')).toEqual([
      'auth:user:u1',
      'settings:u1',
      'discover:profile:u1',
      'discover:exclude:u1',
    ])
  })

  it('🔴 值里含**他人**快照的键单独归到前缀，且不混进本人键', () => {
    expect(USER_REFERENCING_CACHE_PREFIXES).toEqual(['who-liked-me:'])
    expect(userScopedCacheKeys('u1')).not.toContain(CACHE_KEYS.whoLikedMe('u1'))
  })

  it('🔴 写入侧只许引用 CACHE_KEYS —— 全仓不得再有裸键模板串（漂移防线）', () => {
    const files = [
      'src/lib/auth/auth.ts',
      'src/app/api/discover/route.ts',
      'src/app/api/who-liked-me/route.ts',
      'src/app/api/settings/route.ts',
      'src/app/api/matches/react/route.ts',
    ]
    // 只匹配**带插值的模板串**（形如 `auth:user:${...}`）；注释里写的 `auth:user:<id>` 不在此列。
    const rawKeyForms = [
      'auth:user:',
      'settings:',
      'discover:profile:',
      'discover:exclude:',
      'who-liked-me:',
    ].map((k) => '`' + k + '${')
    for (const rel of files) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
      for (const form of rawKeyForms) {
        const hits = src.split(form).length - 1
        expect({ file: rel, form, hits }).toEqual({ file: rel, form, hits: 0 })
      }
    }
  })
})

describe('AC-10 · 动作清单必须点名缓存', () => {
  it('🔴 AC-10 原文点名「缓存」—— 清缓存没有对应动作，等于没做', () => {
    const row = ERASURE_ACTIONS.find((a) => a.target.startsWith('Cache'))
    expect(row?.action).toBe('purge')
  })
})

/**
 * V17（WB17-04）：状态值的**单一真相源**。
 *
 * 起因是一个真实的不一致：动作清单原先写 `SocialIntent.status → CANCELLED`，
 * 而 `IntentStatus` 枚举只有 `ACTIVE | WITHDRAWN` —— 这个值**不存在**，
 * 照清单写代码会直接触发 Prisma 校验错误；`erasure.ts` 实际写的是 `WITHDRAWN`。
 * 清单自称"单一真相源"，却与实现两份说法，这正是最该被门禁钉住的东西。
 */
describe('AC-10 · 销号状态值不得与 schema 枚举漂移', () => {
  const lifecycleSrc = (rel: string) =>
    fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

  it('清单里点名的状态值必须是 schema 真实存在的（WITHDRAWN，不是 CANCELLED）', () => {
    const stateRows = ERASURE_ACTIONS.filter(
      (a) => a.target === 'SocialIntent' || a.target === 'MissionParticipation' || a.target === 'BridgeMemberOptIn'
    )
    // 前置非空：少一条这条断言就变成空集恒真
    expect(stateRows.length).toBe(3)
    for (const row of stateRows) {
      expect(row.detail).toContain('WITHDRAWN')
      expect(row.detail).not.toContain('CANCELLED')
    }
  })

  it('🔴 erasure.ts 不得再硬编码状态字面量（否则常量化只是摆设）', () => {
    const src = lifecycleSrc('src/lib/lifecycle/erasure.ts')
    // 反例对照：先证明"如果硬编码，这条检测能抓到"
    const antiPattern = /status:\s*'WITHDRAWN'/
    expect(antiPattern.test("data: { status: 'WITHDRAWN' }")).toBe(true)
    expect(antiPattern.test(src)).toBe(false)
    // 正向：确实用的是共用常量
    expect((src.match(/ERASED_STATUS\./g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})

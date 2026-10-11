/**
 * T04 · 候选服务层测试 —— AC-13 的装配证据 + 披露边界的**负向验证**
 *
 * 这里测的不是排序算法（那是 `recall.test.ts` 的职责），而是**装配**：
 *   ① 内核的"谁值得推荐" 与 披露层的"谁能看到什么" 是否真的接对了；
 *   ② 候选这条**新通道**是否真的走了唯一披露出口（`discloseSubject`）；
 *   ③ 档位方向有没有写反 —— 用**变异**证明：把候选的投影档位换成
 *      `COUNTERPARTY`，用例必须变红（否则等于没测到）。
 *
 * 做法与 `intents.test.ts` 同源：mock `@/lib/db`，直接 import 具体模块
 * （不经 barrel，避免 next-auth 的 ESM 传递依赖）。
 */

jest.mock('@/lib/db', () => ({
  db: {
    mission: { findFirst: jest.fn(), findUnique: jest.fn() },
    membership: { findFirst: jest.fn() },
    socialIntent: { findFirst: jest.fn(), findMany: jest.fn() },
    missionParticipation: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  },
}))

import { db } from '@/lib/db'
import { NotFoundError } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy'
import { listCandidates, listCandidatesByShareToken } from '@/lib/connection/candidates'
import { CANDIDATE_PROFILE_AUDIENCE } from '@/lib/connection/field-catalog'

const missionFindFirst = db.mission.findFirst as unknown as jest.Mock
const missionFindUnique = db.mission.findUnique as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const intentFindFirst = db.socialIntent.findFirst as unknown as jest.Mock
const intentFindMany = db.socialIntent.findMany as unknown as jest.Mock
const partFindMany = db.missionParticipation.findMany as unknown as jest.Mock
const userFindMany = db.user.findMany as unknown as jest.Mock

const ORG = 'org_1'
const MISSION = 'm_1'
const ME = 'u_me'
const NOW = new Date('2026-10-11T12:00:00.000Z')

const ctx: TenantContext = {
  organizationId: ORG,
  userId: ME,
  role: 'MEMBER',
  membershipId: 'ms_1',
}

// ═══════════════════════════════════════════════════════════════
// 固定夹具（写死；改它就必须重算下面每一条断言）
// ═══════════════════════════════════════════════════════════════
//
// 词元是刻意选的：我的 need 与对方的 offer 有 4 个共同词元，
// 对方的 need 与我的 offer 有 3 个 —— 双向都非空，才构成"互惠"。

const MY_NEED = 'need supply chain partner indonesia'
const MY_OFFER = 'offer sourcing agent network'

function intentRow(over: Record<string, unknown> = {}) {
  return {
    id: 'i_x',
    organizationId: ORG,
    missionId: MISSION,
    userId: 'u_x',
    need: '',
    offer: '',
    disclosure: null,
    status: 'ACTIVE',
    expiresAt: null,
    ...over,
  }
}

/** u_b：双向互补，且授权了 displayName / city 给「同任务的伙伴」。 */
const ROW_B = intentRow({
  id: 'i_b',
  userId: 'u_b',
  need: 'need sourcing agent network',
  offer: 'offer supply chain partner indonesia',
  disclosure: JSON.stringify({ displayName: 'CANDIDATE', city: 'CANDIDATE', age: 'COUNTERPARTY' }),
})

/** u_c：过了门控但**不构成双向**（它的 offer 命中我，但它的 need 与我无交集）。 */
const ROW_C = intentRow({
  id: 'i_c',
  userId: 'u_c',
  need: 'need greenhouse irrigation scheduling',
  offer: 'offer supply chain partner indonesia',
  disclosure: JSON.stringify({ displayName: 'CANDIDATE' }),
})

/**
 * 被门控拒绝的三行共用一个**独有标记串**。
 *
 * 为什么必须"独有"：如果被拒行的 need/offer 与候选行**逐字相同**，
 * 那么"响应里不含被拒行的内容"这条断言就会**恒真**（内容早被候选行自己带进来了），
 * 于是它其实什么都没测到。加一个只出现在被拒行里的词，断言才有判别力。
 */
const GATED_MARKER = 'gatedmarkeronly'

/** u_d：已撤销 —— 必须被门控拦掉，哪怕它本来双向互补。 */
const ROW_D = intentRow({
  id: 'i_d',
  userId: 'u_d',
  need: `need ${GATED_MARKER} sourcing agent network`,
  offer: `offer ${GATED_MARKER} supply chain partner indonesia`,
  status: 'WITHDRAWN',
  disclosure: JSON.stringify({ displayName: 'CANDIDATE' }),
})

/** u_e：意图活跃、双向互补，但**已不是**该任务的参与人。 */
const ROW_E = intentRow({
  id: 'i_e',
  userId: 'u_e',
  need: `need ${GATED_MARKER} sourcing agent network`,
  offer: `offer ${GATED_MARKER} supply chain partner indonesia`,
  disclosure: JSON.stringify({ displayName: 'CANDIDATE' }),
})

/** u_f：跨租户 —— 哪怕内容完全互补也不得进入候选。 */
const ROW_F = intentRow({
  id: 'i_f',
  organizationId: 'org_other',
  userId: 'u_f',
  need: `need ${GATED_MARKER} sourcing agent network`,
  offer: `offer ${GATED_MARKER} supply chain partner indonesia`,
  disclosure: JSON.stringify({ displayName: 'CANDIDATE' }),
})

const MY_ROW = intentRow({ id: 'i_me', userId: ME, need: MY_NEED, offer: MY_OFFER })

/** 🔴 标记串：任何一条出现在响应里都算泄露。 */
const LEAK_AGE = 47
const LEAK_BIO = 'SECRET-BIO-MARKER-DO-NOT-LEAK'
const LEAK_EMAIL = 'leak.marker@example.test'

function userRow(id: string) {
  return {
    id,
    email: LEAK_EMAIL,
    profile: {
      displayName: `NAME-${id}`,
      city: `CITY-${id}`,
      age: LEAK_AGE,
      bio: LEAK_BIO,
      // 其余字段留空，断言才不会被无关内容干扰
      avatar: null,
      country: null,
      occupation: null,
      company: null,
      industry: null,
      genderIdentity: null,
      relationshipGoal: null,
      selectedTags: null,
      lifePriorities: null,
    },
  }
}

/** 默认"一切正常"的 mock 布置。各个用例再按需覆盖。 */
function arrangeHappyPath() {
  missionFindFirst.mockResolvedValue({ id: MISSION, status: 'ACTIVE' })
  intentFindFirst.mockResolvedValue(MY_ROW)
  intentFindMany.mockResolvedValue([ROW_B, ROW_C, ROW_D, ROW_E, ROW_F])
  partFindMany.mockResolvedValue([{ userId: ME }, { userId: 'u_b' }, { userId: 'u_c' }, { userId: 'u_d' }])
  userFindMany.mockResolvedValue(['u_b', 'u_c'].map(userRow))
}

beforeEach(() => {
  jest.clearAllMocks()
  arrangeHappyPath()
})

// ═══════════════════════════════════════════════════════════════
// 主路径：双向互补 + 披露投影
// ═══════════════════════════════════════════════════════════════

describe('T04 · 候选装配（AC-13）', () => {
  test('只返回**双向**互补的候选，并附带实际命中的词元', async () => {
    const res = await listCandidates(ctx, MISSION, {}, NOW)

    expect(res.candidates.map((c) => c.userId)).toEqual(['u_b'])
    expect(res.noCandidatesReason).toBeNull()

    const b = res.candidates[0]
    expect(b.need).toBe(ROW_B.need)
    expect(b.offer).toBe(ROW_B.offer)
    // 依据是**具体词元**，不是分数
    expect(b.evidence.myNeedTheirsOffer).toEqual(['supply', 'chain', 'partner', 'indonesia'])
    expect(b.evidence.theirNeedMyOffer).toEqual(['sourcing', 'agent', 'network'])
    expect(b.matchedTokens).toBe(7)
  })

  test('被门控拒绝的行**只贡献计数与原因码**，不贡献内容', async () => {
    const res = await listCandidates(ctx, MISSION, {}, NOW)

    // 过门控的是 u_b 与 u_c（u_c 因不构成双向而未成为候选）
    expect(res.considered).toBe(2)
    const codes = res.gatedOut.map((g) => g.code)
    expect(codes).toEqual(['cross_tenant', 'intent_not_active', 'not_participant'])
    expect(res.gatedOut.every((g) => g.count === 1)).toBe(true)
    // 被拒行的 need/offer **不得**出现在响应里。标记串只存在于被拒行中，
    // 因此这条断言真的有判别力（详见 GATED_MARKER 的说明）。
    expect(JSON.stringify(res)).not.toContain(GATED_MARKER)
  })

  test('🔴 投影用 CANDIDATE 档，且响应自描述该档位（可审计）', async () => {
    const res = await listCandidates(ctx, MISSION, {}, NOW)

    expect(res.profileAudience).toBe('CANDIDATE')
    expect(res.profileAudience).toBe(CANDIDATE_PROFILE_AUDIENCE)
  })
})

// ═══════════════════════════════════════════════════════════════
// 披露边界（AC-03 在 T04 的落点）
// ═══════════════════════════════════════════════════════════════

describe('T04 · 候选通道的披露边界', () => {
  test('🔒 候选只看到授权给「同任务的伙伴」的字段；键不存在而非 null', async () => {
    const res = await listCandidates(ctx, MISSION, {}, NOW)
    const subject = res.candidates[0].subject as Record<string, unknown>

    // 授权到 CANDIDATE 的两项可见
    expect(subject.displayName).toBe('NAME-u_b')
    expect(subject.city).toBe('CITY-u_b')
    // 🔴 授权到 COUNTERPARTY 的 age **不可见** —— 用户写的是"只给已配对对手方看"，
    //    还没配对成功的人就不该看到。这一条正是不变量方向的可观测形式。
    expect(Object.prototype.hasOwnProperty.call(subject, 'age')).toBe(false)
    // 未出现在披露表里的字段（bio）缺省 SELF → 不可见
    expect(Object.prototype.hasOwnProperty.call(subject, 'bio')).toBe(false)
    // 结构性不可授权的 email 永不出现
    expect(Object.prototype.hasOwnProperty.call(subject, 'email')).toBe(false)
  })

  test('🔴 值级泄露扫描：年龄 / 简介 / 邮箱的**值**都不出现在响应里', async () => {
    const res = await listCandidates(ctx, MISSION, {}, NOW)
    const text = JSON.stringify(res)

    expect(text).not.toContain(String(LEAK_AGE))
    expect(text).not.toContain(LEAK_BIO)
    expect(text).not.toContain(LEAK_EMAIL)
    expect(text).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i)
  })

  test('🔴 变异自证：把投影档位换成 COUNTERPARTY 就会越权（证明档位没写反）', async () => {
    // 这不是在测实现，而是在证明**前面那条断言有意义**：
    // 我们手算一遍"若错误地用 COUNTERPARTY 投影"会看到什么 ——
    // 若两者结果相同，说明 age 那条断言是空转的。
    const { discloseSubject } = await import('@/lib/connection/disclosure')
    const map = { displayName: 'CANDIDATE', city: 'CANDIDATE', age: 'COUNTERPARTY' } as const
    const profile = { displayName: 'N', city: 'C', age: 47 }

    const asCandidate = discloseSubject(profile, map, 'CANDIDATE')
    const asCounterparty = discloseSubject(profile, map, 'COUNTERPARTY')

    expect(Object.keys(asCandidate).sort()).toEqual(['city', 'displayName'])
    // 换档位后 age 就漏出来了 —— 这就是"档位写反"的后果
    expect(Object.keys(asCounterparty).sort()).toEqual(['age', 'city', 'displayName'])

    // 且真实服务产出必须等于 asCandidate（而不是 asCounterparty）
    const res = await listCandidates(ctx, MISSION, {}, NOW)
    const subject = res.candidates[0].subject as Record<string, unknown>
    expect(Object.keys(subject).sort()).toEqual(Object.keys(asCandidate).sort())
  })
})

// ═══════════════════════════════════════════════════════════════
// 前置条件与"无候选"的原因码
// ═══════════════════════════════════════════════════════════════

describe('T04 · 前置条件与无候选原因', () => {
  test('自己还没提交意图 → no_own_intent（不报错，给可解释原因）', async () => {
    intentFindFirst.mockResolvedValue(null)
    const res = await listCandidates(ctx, MISSION, {}, NOW)
    expect(res.candidates).toEqual([])
    expect(res.noCandidatesReason).toBe('no_own_intent')
  })

  test('自己的意图已撤销 / 已过期 → 同样 no_own_intent', async () => {
    intentFindFirst.mockResolvedValue(intentRow({ userId: ME, status: 'WITHDRAWN' }))
    expect((await listCandidates(ctx, MISSION, {}, NOW)).noCandidatesReason).toBe('no_own_intent')

    intentFindFirst.mockResolvedValue(
      intentRow({ userId: ME, expiresAt: new Date('2026-01-01T00:00:00.000Z') })
    )
    expect((await listCandidates(ctx, MISSION, {}, NOW)).noCandidatesReason).toBe('no_own_intent')
  })

  test('任务下没有其他人的意图 → no_other_intents', async () => {
    intentFindMany.mockResolvedValue([])
    const res = await listCandidates(ctx, MISSION, {}, NOW)
    expect(res.noCandidatesReason).toBe('no_other_intents')
  })

  test('其他意图全被门控拦掉 → all_gated_out（含"没人参与"的变异）', async () => {
    intentFindMany.mockResolvedValue([ROW_D])
    expect((await listCandidates(ctx, MISSION, {}, NOW)).noCandidatesReason).toBe('all_gated_out')

    // 变异：把参与人集合清空 → 所有行都被 not_participant 拦掉。
    // 若门控只是装饰，这里仍会返回 u_b 候选 → 断言会红。
    intentFindMany.mockResolvedValue([ROW_B])
    partFindMany.mockResolvedValue([])
    const res = await listCandidates(ctx, MISSION, {}, NOW)
    expect(res.candidates).toEqual([])
    expect(res.noCandidatesReason).toBe('all_gated_out')
    expect(res.gatedOut).toEqual([{ code: 'not_participant', count: 1 }])
  })

  test('过了门控但没有双向互补 → no_reciprocal_overlap', async () => {
    intentFindMany.mockResolvedValue([ROW_C])
    const res = await listCandidates(ctx, MISSION, {}, NOW)
    expect(res.noCandidatesReason).toBe('no_reciprocal_overlap')
    expect(res.considered).toBe(1)
  })

  test('🔒 跨租户 / 草稿任务一律表现为"不存在"（不泄露"存在"这一事实）', async () => {
    missionFindFirst.mockResolvedValue(null)
    await expect(listCandidates(ctx, MISSION, {}, NOW)).rejects.toBeInstanceOf(NotFoundError)

    missionFindFirst.mockResolvedValue({ id: MISSION, status: 'DRAFT' })
    await expect(listCandidates(ctx, MISSION, {}, NOW)).rejects.toBeInstanceOf(NotFoundError)
  })

  test('🔒 任务查询必须同时带 organizationId 谓词（防回归锁）', async () => {
    await listCandidates(ctx, MISSION, {}, NOW)
    expect(missionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: MISSION, organizationId: ORG } })
    )
    // 拉他人意图时同样带租户谓词，且排除自己
    expect(intentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG, missionId: MISSION }),
      })
    )
  })
})

// ═══════════════════════════════════════════════════════════════
// 分享令牌入口（页面路径）
// ═══════════════════════════════════════════════════════════════

describe('T04 · 分享令牌入口（/m/<token>/matches 用）', () => {
  test('令牌无效 / 草稿任务 → null（页面按 notFound 处理）', async () => {
    missionFindUnique.mockResolvedValue(null)
    expect(await listCandidatesByShareToken('tok', ME, {}, NOW)).toBeNull()

    missionFindUnique.mockResolvedValue({ id: MISSION, status: 'DRAFT', organizationId: ORG })
    expect(await listCandidatesByShareToken('tok', ME, {}, NOW)).toBeNull()
  })

  test('🔒 非本社群成员 → null（令牌只证明"拿到了链接"）', async () => {
    missionFindUnique.mockResolvedValue({ id: MISSION, status: 'ACTIVE', organizationId: ORG })
    membershipFindFirst.mockResolvedValue(null)
    expect(await listCandidatesByShareToken('tok', ME, {}, NOW)).toBeNull()
    // 成员校验必须同时约束 userId 与 organizationId
    expect(membershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: ME, organizationId: ORG, status: 'ACTIVE' }),
      })
    )
  })

  test('成员校验通过 → 与 missionId 入口结果一致', async () => {
    missionFindUnique.mockResolvedValue({ id: MISSION, status: 'ACTIVE', organizationId: ORG })
    membershipFindFirst.mockResolvedValue({ id: 'ms_1' })

    const viaToken = await listCandidatesByShareToken('tok', ME, {}, NOW)
    const viaMission = await listCandidates(ctx, MISSION, {}, NOW)

    expect(viaToken?.candidates.map((c) => c.userId)).toEqual(
      viaMission.candidates.map((c) => c.userId)
    )
    expect(viaToken?.profileAudience).toBe('CANDIDATE')
  })
})

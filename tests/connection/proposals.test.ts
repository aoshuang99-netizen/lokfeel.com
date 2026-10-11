/**
 * T05 · 双边同意（Consent & Trust）测试
 *
 * 三条验收标准在这一层的落点：
 *   **AC-04 单方同意不介绍** —— `resolveStatusAfterDecision()` 的纯函数断言，
 *        外加"一方 accept 之后 `introduceConnection` 必须 409"的服务层断言。
 *   **AC-05 拒绝关闭 / 撤销阻止后续** —— reject 后任何表态 409；revoke 后 introduce 409。
 *   **AC-06 执行时再校验** —— 同意之后、介绍之前，一方**撤销意图**或提案**过期**，
 *        介绍必须失败。这是本文件最重要的两条用例。
 *
 * 做法与 `intents.test.ts` / `candidates.test.ts` 同源：mock `@/lib/db`，
 * 直接 import 具体模块（不经 barrel）。**不 mock 状态机本身** —— 下面的
 * `proposalFindFirst/update/upsert` 共同维护一个内存 store，让"读改写"的
 * 真实顺序被走到，而不是被几个 `mockResolvedValue` 假装成两步。
 */

jest.mock('@/lib/db', () => ({
  db: {
    mission: { findFirst: jest.fn() },
    membership: { findFirst: jest.fn() },
    missionParticipation: { findMany: jest.fn() },
    connectionProposal: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    proposalDecision: { findMany: jest.fn(), upsert: jest.fn() },
    socialIntent: { findFirst: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}))

import { db } from '@/lib/db'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy'
import {
  availableActions,
  createProposal,
  decideProposal,
  deriveProposalState,
  evaluateIntroducibility,
  findProposalById,
  introduceConnection,
  isClosed,
  listIntroductions,
  partyRoleOf,
  resolveStatusAfterDecision,
  revokeProposal,
} from '@/lib/connection/proposals'
import {
  CANDIDATE_PROFILE_AUDIENCE,
  COUNTERPARTY_PROFILE_AUDIENCE,
} from '@/lib/connection/field-catalog'

// ── mock 句柄 ──
const missionFindFirst = db.mission.findFirst as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const partFindMany = db.missionParticipation.findMany as unknown as jest.Mock
const proposalFindFirst = db.connectionProposal.findFirst as unknown as jest.Mock
const proposalFindMany = db.connectionProposal.findMany as unknown as jest.Mock
const proposalCreate = db.connectionProposal.create as unknown as jest.Mock
const proposalUpdate = db.connectionProposal.update as unknown as jest.Mock
const proposalUpdateMany = db.connectionProposal.updateMany as unknown as jest.Mock
const decisionFindMany = db.proposalDecision.findMany as unknown as jest.Mock
const decisionUpsert = db.proposalDecision.upsert as unknown as jest.Mock
const intentFindFirst = db.socialIntent.findFirst as unknown as jest.Mock
const intentFindMany = db.socialIntent.findMany as unknown as jest.Mock
const userFindUnique = db.user.findUnique as unknown as jest.Mock
const userFindMany = db.user.findMany as unknown as jest.Mock
const transaction = db.$transaction as unknown as jest.Mock

// ── 常量 ──
const ORG = 'org_1'
const MISSION = 'm_1'
const PROPOSER = 'u_owner'
const CANDIDATE = 'u_cand'
const BYSTANDER = 'u_other'
const NOW = new Date('2026-10-11T12:00:00.000Z')
const LATER = new Date('2026-10-12T12:00:00.000Z')

const OWNER_CTX: TenantContext = {
  organizationId: ORG,
  userId: PROPOSER,
  role: 'OWNER',
  membershipId: 'ms_owner',
}
const CAND_CTX: TenantContext = {
  organizationId: ORG,
  userId: CANDIDATE,
  role: 'MEMBER',
  membershipId: 'ms_cand',
}
const BYSTANDER_CTX: TenantContext = {
  organizationId: ORG,
  userId: BYSTANDER,
  role: 'MEMBER',
  membershipId: 'ms_other',
}

// ═══════════════════════════════════════════════════════════════
// 内存 store：让"读 → 改 → 再读"走到真实顺序
// ═══════════════════════════════════════════════════════════════

/** 测试内的 store 行形状（刻意**不**从实现导入内部行类型：那是私有细节）。 */
interface StoreRow {
  id: string
  organizationId: string
  missionId: string
  proposerId: string
  candidateId: string
  status: string
  rationale: string
  expiresAt: Date | null
  introducedAt: Date | null
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** `where` 的最小形状 —— 只覆盖本文件里真正会被断言的谓词。 */
interface FindWhere {
  id?: string
  organizationId?: string
  introducedAt?: { not: null }
  OR?: Array<{ proposerId?: string; candidateId?: string }>
}

let store: StoreRow | null
let decisions: { personId: string; decision: string }[]

function seedProposal(over: Partial<StoreRow> = {}) {
  store = {
    id: 'p_1',
    organizationId: ORG,
    missionId: MISSION,
    proposerId: PROPOSER,
    candidateId: CANDIDATE,
    status: 'CONSENT_PENDING',
    rationale: 'complementary expertise in supply chain',
    expiresAt: null,
    introducedAt: null,
    closedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  store = null
  decisions = []

  // 默认：任务存在、可牵线；双方都加入了任务；双方都是 ACTIVE 成员
  missionFindFirst.mockResolvedValue({ id: MISSION, status: 'ACTIVE' })
  membershipFindFirst.mockResolvedValue({ id: 'ms_x' })
  partFindMany.mockResolvedValue([{ userId: PROPOSER }, { userId: CANDIDATE }])

  // ⚠️ mock **必须尊重 where 条件**。第一版这里写的是 `async () => store`，
  // 于是"查一个不存在的 id"也会返回现有行 —— 跨租户 → 404、不存在 → null
  // 这两类用例全部**假通过**（返回的是别人的数据，只是恰好触发了 403 分支）。
  proposalFindFirst.mockImplementation(async ({ where }: { where?: FindWhere }) => {
    if (!store) return null
    if (where?.id && where.id !== store.id) return null
    if (where?.organizationId && where.organizationId !== store.organizationId) return null
    return store
  })
  proposalFindMany.mockImplementation(async ({ where }: { where?: FindWhere } = {}) => {
    if (!store) return []
    if (where?.organizationId && where.organizationId !== store.organizationId) return []
    if (where?.introducedAt?.not === null && store.introducedAt === null) return []
    if (Array.isArray(where?.OR)) {
      const me = where.OR
      const hit = me.some((c) => c.proposerId === store!.proposerId || c.candidateId === store!.candidateId)
      if (!hit) return []
    }
    return [store]
  })
  proposalCreate.mockImplementation(async ({ data }: { data: Partial<StoreRow> }) => {
    seedProposal(data)
    return store
  })
  proposalUpdate.mockImplementation(async ({ data }: { data: Partial<StoreRow> }) => {
    store = { ...(store as StoreRow), ...data }
    return store
  })
  // CAS 写入：只有 introducedAt 仍为 null 且状态仍为 MUTUALLY_ACCEPTED 才算成功。
  proposalUpdateMany.mockImplementation(async ({ data }: { data: Partial<StoreRow> }) => {
    if (!store || store.introducedAt !== null || store.status !== 'MUTUALLY_ACCEPTED') {
      return { count: 0 }
    }
    store = { ...store, ...data }
    return { count: 1 }
  })
  decisionFindMany.mockImplementation(async () => decisions)
  decisionUpsert.mockImplementation(
    async ({ create }: { create: { personId: string; decision: string } }) => {
      const existing = decisions.find((d) => d.personId === create.personId)
      if (existing) existing.decision = create.decision
      else decisions.push({ personId: create.personId, decision: create.decision })
      return {}
    }
  )
  transaction.mockImplementation(async (ops: unknown[]) => {
    const resolved = await Promise.all(ops as Promise<unknown>[])
    return resolved
  })

  // 对侧档案：displayName / city 授权给 CANDIDATE，bio / age 授权给 COUNTERPARTY
  const disclosure = JSON.stringify({
    displayName: 'CANDIDATE',
    city: 'CANDIDATE',
    bio: 'COUNTERPARTY',
    age: 'COUNTERPARTY',
  })
  intentFindFirst.mockResolvedValue({ disclosure, status: 'ACTIVE', expiresAt: null })
  intentFindMany.mockResolvedValue([
    { missionId: MISSION, userId: CANDIDATE, disclosure, status: 'ACTIVE', expiresAt: null },
    { missionId: MISSION, userId: PROPOSER, disclosure, status: 'ACTIVE', expiresAt: null },
  ])
  userFindUnique.mockResolvedValue({
    email: 'peer@example.test',
    profile: {
      displayName: '林晓',
      bio: 'BIO_SECRET_VALUE',
      city: '杭州',
      age: 47,
    },
  })
  userFindMany.mockResolvedValue([
    {
      id: CANDIDATE,
      email: 'peer@example.test',
      profile: { displayName: '林晓', bio: 'BIO_SECRET_VALUE', city: '杭州', age: 47 },
    },
    {
      id: PROPOSER,
      email: 'peer@example.test',
      profile: { displayName: '林晓', bio: 'BIO_SECRET_VALUE', city: '杭州', age: 47 },
    },
  ])
  db.tenantAuditEvent.create = jest.fn()
})

// ═══════════════════════════════════════════════════════════════
// 1. 纯函数内核
// ═══════════════════════════════════════════════════════════════

describe('T05 · 纯内核：状态派生', () => {
  it('未过期、待决 → CONSENT_PENDING', () => {
    expect(deriveProposalState({ status: 'CONSENT_PENDING', introducedAt: null, expiresAt: null }, NOW)).toBe(
      'CONSENT_PENDING'
    )
  })

  it('已过期 → EXPIRED（派生，不落库）', () => {
    const past = new Date('2026-10-10T00:00:00.000Z')
    expect(deriveProposalState({ status: 'CONSENT_PENDING', introducedAt: null, expiresAt: past }, NOW)).toBe(
      'EXPIRED'
    )
  })

  it('🔒 已介绍时状态**固定**为 MUTUALLY_ACCEPTED，即便已过期或已关闭', () => {
    const past = new Date('2026-10-10T00:00:00.000Z')
    // 介绍是已完成的事实：不该因为之后过期而显示成 EXPIRED
    expect(
      deriveProposalState({ status: 'MUTUALLY_ACCEPTED', introducedAt: NOW, expiresAt: past }, LATER)
    ).toBe('MUTUALLY_ACCEPTED')
  })

  it('终态优先：REJECTED / REVOKED 不受过期影响', () => {
    const past = new Date('2026-10-10T00:00:00.000Z')
    expect(deriveProposalState({ status: 'REJECTED', introducedAt: null, expiresAt: past }, NOW)).toBe('REJECTED')
    expect(deriveProposalState({ status: 'REVOKED', introducedAt: null, expiresAt: past }, NOW)).toBe('REVOKED')
  })
})

describe('T05 · AC-04 的核心规则：单方同意不产生 mutual', () => {
  it('🔴 只有发起方 accept → 仍是 CONSENT_PENDING（**不是** ACCEPTED）', () => {
    expect(resolveStatusAfterDecision('proposer', 'ACCEPT', { proposer: 'ACCEPT', candidate: null })).toBe(
      'CONSENT_PENDING'
    )
  })

  it('🔴 只有被介绍方 accept → 仍是 CONSENT_PENDING', () => {
    expect(
      resolveStatusAfterDecision('candidate', 'ACCEPT', { proposer: null, candidate: 'ACCEPT' })
    ).toBe('CONSENT_PENDING')
  })

  it('双方 accept → MUTUALLY_ACCEPTED（唯一可介绍状态）', () => {
    expect(
      resolveStatusAfterDecision('candidate', 'ACCEPT', { proposer: 'ACCEPT', candidate: 'ACCEPT' })
    ).toBe('MUTUALLY_ACCEPTED')
  })

  it('reject → REJECTED；revoke → REVOKED（两者都立刻关闭）', () => {
    expect(resolveStatusAfterDecision('candidate', 'REJECT', { proposer: 'ACCEPT', candidate: 'REJECT' })).toBe(
      'REJECTED'
    )
    expect(resolveStatusAfterDecision('proposer', 'REVOKE', { proposer: 'REVOKE', candidate: 'ACCEPT' })).toBe(
      'REVOKED'
    )
  })

  it('🔴 自证：pair 与 decision 不一致时必须抛错（防静默算出错状态）', () => {
    expect(() =>
      resolveStatusAfterDecision('proposer', 'ACCEPT', { proposer: null, candidate: 'ACCEPT' })
    ).toThrow(/out of sync/)
  })
})

describe('T05 · 可介绍性（AC-06 第①层，纯函数）', () => {
  it('MUTUALLY_ACCEPTED + 未过期 + 未介绍 → introducible', () => {
    const r = evaluateIntroducibility({ status: 'MUTUALLY_ACCEPTED', introducedAt: null, expiresAt: null }, NOW)
    expect(r.introducible).toBe(true)
    expect(r.blockers).toEqual([])
  })

  it('单方同意（CONSENT_PENDING）→ 不可介绍', () => {
    const r = evaluateIntroducibility({ status: 'CONSENT_PENDING', introducedAt: null, expiresAt: null }, NOW)
    expect(r.introducible).toBe(false)
    expect(r.blockers).toContain('not_mutually_accepted')
  })

  it('过期 → 不可介绍（即便双方都同意了）', () => {
    const past = new Date('2026-10-10T00:00:00.000Z')
    const r = evaluateIntroducibility({ status: 'MUTUALLY_ACCEPTED', introducedAt: null, expiresAt: past }, NOW)
    expect(r.blockers).toContain('expired')
  })

  it('已介绍 → already_introduced（不可重复介绍）', () => {
    const r = evaluateIntroducibility({ status: 'MUTUALLY_ACCEPTED', introducedAt: NOW, expiresAt: null }, LATER)
    expect(r.blockers).toContain('already_introduced')
  })

  it('revoked → 同时给出 revoked 与 not_mutually_accepted', () => {
    const r = evaluateIntroducibility({ status: 'REVOKED', introducedAt: null, expiresAt: null }, NOW)
    expect(r.blockers).toContain('revoked')
  })
})

describe('T05 · 参与方可执行动作', () => {
  it('待决未过期 → 可接受 / 拒绝 / 撤销', () => {
    expect(availableActions({ status: 'CONSENT_PENDING', introducedAt: null, expiresAt: null }, NOW)).toEqual([
      'ACCEPT',
      'REJECT',
      'REVOKE',
    ])
  })

  it('🔴 过期后只剩下「撤销」——既不能再接受（无意义），也不再给拒绝（语义重叠）', () => {
    const past = new Date('2026-10-10T00:00:00.000Z')
    const actions = availableActions({ status: 'CONSENT_PENDING', introducedAt: null, expiresAt: past }, NOW)
    expect(actions).toEqual(['REVOKE'])
  })

  it('已关闭 / 已介绍 → 无任何动作', () => {
    expect(availableActions({ status: 'REJECTED', introducedAt: null, expiresAt: null }, NOW)).toEqual([])
    expect(availableActions({ status: 'MUTUALLY_ACCEPTED', introducedAt: NOW, expiresAt: null }, NOW)).toEqual([])
  })

  it('isClosed：终态与已介绍都算"合上"', () => {
    expect(isClosed({ status: 'REJECTED', introducedAt: null })).toBe(true)
    expect(isClosed({ status: 'REVOKED', introducedAt: null })).toBe(true)
    expect(isClosed({ status: 'MUTUALLY_ACCEPTED', introducedAt: NOW })).toBe(true)
    expect(isClosed({ status: 'CONSENT_PENDING', introducedAt: null })).toBe(false)
  })

  it('partyRoleOf：第三方 → null', () => {
    expect(partyRoleOf({ proposerId: PROPOSER, candidateId: CANDIDATE }, PROPOSER)).toBe('PROPOSER')
    expect(partyRoleOf({ proposerId: PROPOSER, candidateId: CANDIDATE }, CANDIDATE)).toBe('CANDIDATE')
    expect(partyRoleOf({ proposerId: PROPOSER, candidateId: CANDIDATE }, BYSTANDER)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════
// 2. 服务层：发起提案
// ═══════════════════════════════════════════════════════════════

describe('T05 · createProposal', () => {
  it('成功 → CONSENT_PENDING，且对侧档案按 CANDIDATE 档投影', async () => {
    const dto = await createProposal(
      OWNER_CTX,
      { missionId: MISSION, candidateId: CANDIDATE, rationale: 'complementary expertise' },
      NOW
    )
    expect(dto.state).toBe('CONSENT_PENDING')
    expect(dto.myRole).toBe('PROPOSER')
    expect(dto.counterpart.userId).toBe(CANDIDATE)
    // displayName / city 授权到 CANDIDATE；bio / age 只在 COUNTERPARTY —— 此时键不存在
    expect(Object.keys(dto.counterpart.subject).sort()).toEqual(['city', 'displayName'])
    expect(dto.counterpart.audience).toBe(CANDIDATE_PROFILE_AUDIENCE)
    expect(dto.introducedAt).toBeNull()
  })

  it('🔴 对侧档案的**值级**扫描：未授权的 bio / age 值不得出现', async () => {
    const dto = await createProposal(
      OWNER_CTX,
      { missionId: MISSION, candidateId: CANDIDATE, rationale: 'complementary expertise' },
      NOW
    )
    const json = JSON.stringify(dto)
    expect(json).not.toContain('BIO_SECRET_VALUE')
    expect(json).not.toContain('47')
    expect(json).not.toContain('peer@example.test')
  })

  it('跨租户任务 → 404（不泄露"存在"这一事实）', async () => {
    missionFindFirst.mockResolvedValue(null)
    await expect(
      createProposal(OWNER_CTX, { missionId: MISSION, candidateId: CANDIDATE, rationale: 'complementary expertise' }, NOW)
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('草稿 / 已关闭任务 → 409', async () => {
    missionFindFirst.mockResolvedValue({ id: MISSION, status: 'DRAFT' })
    await expect(
      createProposal(OWNER_CTX, { missionId: MISSION, candidateId: CANDIDATE, rationale: 'complementary expertise' }, NOW)
    ).rejects.toBeInstanceOf(ConflictError)

    missionFindFirst.mockResolvedValue({ id: MISSION, status: 'CLOSED' })
    await expect(
      createProposal(OWNER_CTX, { missionId: MISSION, candidateId: CANDIDATE, rationale: 'complementary expertise' }, NOW)
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('被介绍方不是本租户 ACTIVE 成员 → 409', async () => {
    membershipFindFirst.mockResolvedValue(null)
    await expect(
      createProposal(OWNER_CTX, { missionId: MISSION, candidateId: CANDIDATE, rationale: 'complementary expertise' }, NOW)
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('🔴 被介绍方未加入该任务 → 409（CANDIDATE 档投影的前提）', async () => {
    partFindMany.mockResolvedValue([{ userId: PROPOSER }])
    await expect(
      createProposal(OWNER_CTX, { missionId: MISSION, candidateId: CANDIDATE, rationale: 'complementary expertise' }, NOW)
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('给自己提案 → 409', async () => {
    await expect(
      createProposal(OWNER_CTX, { missionId: MISSION, candidateId: PROPOSER, rationale: 'complementary expertise' }, NOW)
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('同一对搭档重复提案 → 409', async () => {
    proposalFindFirst.mockResolvedValue({ id: 'p_existing' })
    await expect(
      createProposal(OWNER_CTX, { missionId: MISSION, candidateId: CANDIDATE, rationale: 'complementary expertise' }, NOW)
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('🔒 防回归锁：唯一性预检与成员校验都带 organizationId 谓词', async () => {
    await createProposal(
      OWNER_CTX,
      { missionId: MISSION, candidateId: CANDIDATE, rationale: 'complementary expertise' },
      NOW
    )
    expect(missionFindFirst.mock.calls[0][0].where).toEqual({ id: MISSION, organizationId: ORG })
    expect(membershipFindFirst.mock.calls[0][0].where.organizationId).toBe(ORG)
    expect(partFindMany.mock.calls[0][0].where.organizationId).toBe(ORG)
  })
})

// ═══════════════════════════════════════════════════════════════
// 3. 服务层：表态
// ═══════════════════════════════════════════════════════════════

describe('T05 · decideProposal（AC-04 / AC-05）', () => {
  it('🔴 单方 accept 之后仍是 CONSENT_PENDING，且**没有** introducedAt（AC-04）', async () => {
    seedProposal()
    const dto = await decideProposal(OWNER_CTX, 'p_1', 'ACCEPT', null, NOW)
    expect(dto.state).toBe('CONSENT_PENDING')
    expect(dto.myDecision).toBe('ACCEPT')
    expect(dto.counterpartDecision).toBeNull()
    expect(dto.introducedAt).toBeNull()
    expect(store?.status).toBe('CONSENT_PENDING')
  })

  it('双方 accept → MUTUALLY_ACCEPTED', async () => {
    seedProposal()
    await decideProposal(OWNER_CTX, 'p_1', 'ACCEPT', null, NOW)
    const dto = await decideProposal(CAND_CTX, 'p_1', 'ACCEPT', null, NOW)
    expect(dto.state).toBe('MUTUALLY_ACCEPTED')
    expect(store?.status).toBe('MUTUALLY_ACCEPTED')
  })

  it('🔴 reject → REJECTED + closedAt；之后任何人再表态 → 409（不是幂等成功）', async () => {
    seedProposal()
    const rejected = await decideProposal(CAND_CTX, 'p_1', 'REJECT', 'not a fit', NOW)
    expect(rejected.state).toBe('REJECTED')
    expect(store?.closedAt).toEqual(NOW)

    await expect(decideProposal(OWNER_CTX, 'p_1', 'ACCEPT', null, LATER)).rejects.toBeInstanceOf(ConflictError)
  })

  it('🔴 revoke → REVOKED，且**阻止后续介绍**（AC-05）', async () => {
    seedProposal()
    await decideProposal(OWNER_CTX, 'p_1', 'ACCEPT', null, NOW)
    await decideProposal(CAND_CTX, 'p_1', 'ACCEPT', null, NOW)
    expect(store?.status).toBe('MUTUALLY_ACCEPTED')

    const revoked = await revokeProposal(CAND_CTX, 'p_1', null, LATER)
    expect(revoked.state).toBe('REVOKED')

    await expect(introduceConnection(OWNER_CTX, 'p_1', LATER)).rejects.toMatchObject({
      details: { blockers: expect.arrayContaining(['revoked']) },
    })
  })

  it('非参与方表态 → 403（契约的 403 = Not a participant）', async () => {
    seedProposal()
    await expect(decideProposal(BYSTANDER_CTX, 'p_1', 'ACCEPT', null, NOW)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('跨租户 → 404', async () => {
    seedProposal()
    await expect(decideProposal(BYSTANDER_CTX, 'p_missing', 'ACCEPT', null, NOW)).rejects.toBeInstanceOf(
      NotFoundError
    )
  })

  it('🔴 已介绍之后再表态 → 409（介绍是不可逆的既成事实）', async () => {
    seedProposal({ status: 'MUTUALLY_ACCEPTED', introducedAt: NOW })
    await expect(decideProposal(CAND_CTX, 'p_1', 'REVOKE', null, LATER)).rejects.toBeInstanceOf(ConflictError)
  })

  it('过期之后不能 accept（但可以 revoke 来合上它）', async () => {
    const past = new Date('2026-10-10T00:00:00.000Z')
    seedProposal({ expiresAt: past })
    await expect(decideProposal(CAND_CTX, 'p_1', 'ACCEPT', null, NOW)).rejects.toBeInstanceOf(ConflictError)

    const closed = await revokeProposal(CAND_CTX, 'p_1', null, NOW)
    expect(closed.state).toBe('REVOKED')
  })

  it('🔴 拒绝理由（note）**不回流**给对侧', async () => {
    seedProposal()
    const CAND_NOTE = 'CANDIDATE_PRIVATE_REASON'
    await decideProposal(CAND_CTX, 'p_1', 'REJECT', CAND_NOTE, NOW)

    // 发起方读同一条提案：能看到"对方已拒绝"，但**看不到理由**
    const dto = await findProposalById(OWNER_CTX, 'p_1', NOW)
    expect(dto?.counterpartDecision).toBe('REJECT')
    expect(Object.keys(dto ?? {})).not.toContain('note')
    expect(JSON.stringify(dto)).not.toContain(CAND_NOTE)
  })
})

// ═══════════════════════════════════════════════════════════════
// 4. 服务层：介绍执行点（AC-06 的主战场）
// ═══════════════════════════════════════════════════════════════

describe('T05 · introduceConnection（AC-04 负测 + AC-06 执行时校验）', () => {
  it('🔴 AC-04：只有一方同意时介绍 → 409 not_mutually_accepted', async () => {
    seedProposal()
    await decideProposal(OWNER_CTX, 'p_1', 'ACCEPT', null, NOW)
    await expect(introduceConnection(OWNER_CTX, 'p_1', NOW)).rejects.toMatchObject({
      details: { blockers: expect.arrayContaining(['not_mutually_accepted']) },
    })
  })

  it('双方同意后介绍成功 → introducedAt 写入，状态 MUTUALLY_ACCEPTED', async () => {
    seedProposal()
    await decideProposal(OWNER_CTX, 'p_1', 'ACCEPT', null, NOW)
    await decideProposal(CAND_CTX, 'p_1', 'ACCEPT', null, NOW)

    const dto = await introduceConnection(OWNER_CTX, 'p_1', NOW)
    expect(dto.introducedAt).toEqual(NOW.toISOString())
    expect(dto.state).toBe('MUTUALLY_ACCEPTED')
  })

  it('🔴 AC-06（撤回）：同意之后一方撤销意图 → 介绍必须失败且指明是哪一方', async () => {
    seedProposal()
    await decideProposal(OWNER_CTX, 'p_1', 'ACCEPT', null, NOW)
    await decideProposal(CAND_CTX, 'p_1', 'ACCEPT', null, NOW)

    // 同意之后、介绍之前：被介绍方撤销了意图
    intentFindMany.mockResolvedValue([
      { userId: PROPOSER, status: 'ACTIVE', expiresAt: null },
      { userId: CANDIDATE, status: 'WITHDRAWN', expiresAt: null },
    ])

    await expect(introduceConnection(OWNER_CTX, 'p_1', LATER)).rejects.toMatchObject({
      details: { blockers: expect.arrayContaining(['candidate_intent_not_live']) },
    })
    // 关键：**没有写入** introducedAt —— 失败必须是"什么都没发生"
    expect(store?.introducedAt).toBeNull()
  })

  it('🔴 AC-06（过期）：同意之后意图过期 → 介绍失败', async () => {
    seedProposal()
    await decideProposal(OWNER_CTX, 'p_1', 'ACCEPT', null, NOW)
    await decideProposal(CAND_CTX, 'p_1', 'ACCEPT', null, NOW)

    const past = new Date('2026-10-10T00:00:00.000Z')
    intentFindMany.mockResolvedValue([
      { userId: PROPOSER, status: 'ACTIVE', expiresAt: past },
      { userId: CANDIDATE, status: 'ACTIVE', expiresAt: null },
    ])

    await expect(introduceConnection(OWNER_CTX, 'p_1', LATER)).rejects.toMatchObject({
      details: { blockers: expect.arrayContaining(['proposer_intent_not_live']) },
    })
  })

  it('🔴 AC-06（提案自身过期）：双方同意后提案过期 → 介绍失败', async () => {
    seedProposal()
    await decideProposal(OWNER_CTX, 'p_1', 'ACCEPT', null, NOW)
    await decideProposal(CAND_CTX, 'p_1', 'ACCEPT', null, NOW)
    store!.expiresAt = new Date('2026-10-11T13:00:00.000Z')

    await expect(introduceConnection(OWNER_CTX, 'p_1', LATER)).rejects.toMatchObject({
      details: { blockers: expect.arrayContaining(['expired']) },
    })
  })

  it('🔴 CAS：并发写入时只有一次成功（updateMany 返回 0 → 409）', async () => {
    seedProposal({ status: 'MUTUALLY_ACCEPTED' })
    // 模拟"另一个请求抢先写下 introducedAt"
    proposalUpdateMany.mockResolvedValueOnce({ count: 0 })
    await expect(introduceConnection(OWNER_CTX, 'p_1', NOW)).rejects.toBeInstanceOf(ConflictError)
  })

  it('无 proposal.create 能力 → 403（介绍是运营动作）', async () => {
    seedProposal({ status: 'MUTUALLY_ACCEPTED' })
    await expect(introduceConnection(CAND_CTX, 'p_1', NOW)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('重复介绍 → 409 already_introduced', async () => {
    seedProposal({ status: 'MUTUALLY_ACCEPTED', introducedAt: NOW })
    await expect(introduceConnection(OWNER_CTX, 'p_1', LATER)).rejects.toMatchObject({
      details: { blockers: expect.arrayContaining(['already_introduced']) },
    })
  })
})

// ═══════════════════════════════════════════════════════════════
// 5. 关键：档位随阶段升级（COUNTERPARTY 的唯一读路径）
// ═══════════════════════════════════════════════════════════════

describe('T05 · 披露档位升级（介绍前 CANDIDATE → 介绍后 COUNTERPARTY）', () => {
  it('🔴 同一个对方，介绍前看不到的 bio / age，介绍后能看到', async () => {
    // 介绍前
    seedProposal({ status: 'MUTUALLY_ACCEPTED' })
    const before = await findProposalById(OWNER_CTX, 'p_1', NOW)
    expect(before?.counterpart.audience).toBe(CANDIDATE_PROFILE_AUDIENCE)
    expect(Object.keys(before!.counterpart.subject).sort()).toEqual(['city', 'displayName'])

    // 介绍后
    seedProposal({ status: 'MUTUALLY_ACCEPTED', introducedAt: NOW })
    const after = await findProposalById(OWNER_CTX, 'p_1', NOW)
    expect(after?.counterpart.audience).toBe(COUNTERPARTY_PROFILE_AUDIENCE)
    expect(Object.keys(after!.counterpart.subject).sort()).toEqual([
      'age',
      'bio',
      'city',
      'displayName',
    ])
  })

  it('🔴 listIntroductions 用 COUNTERPARTY 档投影，且自描述', async () => {
    seedProposal({ status: 'MUTUALLY_ACCEPTED', introducedAt: NOW })
    const list = await listIntroductions(OWNER_CTX, {}, NOW)
    expect(list).toHaveLength(1)
    expect(list[0].audience).toBe(COUNTERPARTY_PROFILE_AUDIENCE)
    expect(Object.keys(list[0].subject)).toContain('bio')
  })

  it('🔴 对方撤销意图后，已介绍关系的投影**当场归零**（不留副本）', async () => {
    seedProposal({ status: 'MUTUALLY_ACCEPTED', introducedAt: NOW })
    intentFindMany.mockResolvedValue([
      { missionId: MISSION, userId: CANDIDATE, disclosure: null, status: 'WITHDRAWN', expiresAt: null },
    ])
    const list = await listIntroductions(OWNER_CTX, {}, NOW)
    expect(list[0].subject).toEqual({})
  })

  it('findProposalById：不存在或非参与方 → null（不抛错，供幂等层使用）', async () => {
    seedProposal()
    expect(await findProposalById(BYSTANDER_CTX, 'p_1', NOW)).toBeNull()
    expect(await findProposalById(OWNER_CTX, 'no_such', NOW)).toBeNull()
  })
})

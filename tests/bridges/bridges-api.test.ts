/**
 * T10 · `/api/v1/bridges/*` —— HTTP 层 + **跨群投影**（AC-19 的单元级取证）
 *
 * ⚠️ 本层证不了"生产可达性"（路由形状、Cloudflare 层、cookie 的同源问题）。
 *    那是 **Slice 4** 的 `scripts/qa/verify-ac19-bridge-e2e.mjs`（真实 Chrome + 隔离库）的职责。
 *    本文件的职责是**判据**：把 AC-19 的两半（"明确 opt-in" / "双边群主配置生效"）
 *    与四条铁律（无跨群默认共享 / 不得直查对方私有行 / 双边配置生效 / 撤销即刻生效）
 *    钉在**没有浏览器、没有真实库**的条件下也能复跑。
 *
 * ── 本文件里最有价值的一条断言（#14）─────────────────────────────
 *   跨群投影里 `subject` 的键**必须是两把锁的交集**：
 *     ① `discloseSubject(profile, live, 'CANDIDATE')` 的白名单；
 *     ② 三方交集（内核）+ 二次裁剪（`restrictToKeys`）。
 *   夹具刻意让 `displayName` **同时**满足 ①（成员在意图里授权了它）
 *   但**不满足**②（双方群主都没在协议里开它）—— 于是
 *   `hasOwnProperty('displayName') === false` **只能**由 ② 解释。
 *   如果哪天有人删掉 `restrictToKeys`，这条断言是**唯一**会红的东西。
 *
 * ── 为什么用 `jest.mock('@/lib/db')` 而不是隔离库 ──────────────────
 *   与 `tests/tenancy/org-api.test.ts` 同一手法：把 DB 换成显式 mock，
 *   才能**逐个断言**"查询谓词里到底有没有租户约束"（这是最有价值的一类断言 ——
 *   一个漏掉 `organizationId` 的 where 在真实库里往往照样返回数据，
 *   只有在**断言谓词**时才会暴露）。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: {
    organization: { findFirst: jest.fn() },
    membership: { findFirst: jest.fn() },
    communityBridge: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    bridgeMemberOptIn: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    socialIntent: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
    idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { UnauthorizedError } from '@/lib/errors'

import * as listCreate from '@/app/api/v1/bridges/route'
import * as detail from '@/app/api/v1/bridges/[bridgeId]/route'
import * as approve from '@/app/api/v1/bridges/[bridgeId]/approve/route'
import * as revoke from '@/app/api/v1/bridges/[bridgeId]/revoke/route'
import * as optIn from '@/app/api/v1/bridges/[bridgeId]/opt-in/route'
import * as optOut from '@/app/api/v1/bridges/[bridgeId]/opt-out/route'
import * as discovery from '@/app/api/v1/bridges/[bridgeId]/discovery/route'

const requireAuthMock = requireAuth as unknown as jest.Mock
const orgFindFirst = db.organization.findFirst as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const bridgeFindFirst = db.communityBridge.findFirst as unknown as jest.Mock
const bridgeFindMany = db.communityBridge.findMany as unknown as jest.Mock
const bridgeCount = db.communityBridge.count as unknown as jest.Mock
const bridgeCreate = db.communityBridge.create as unknown as jest.Mock
const bridgeUpdateMany = db.communityBridge.updateMany as unknown as jest.Mock
const optInFindFirst = db.bridgeMemberOptIn.findFirst as unknown as jest.Mock
const optInFindMany = db.bridgeMemberOptIn.findMany as unknown as jest.Mock
const optInUpsert = db.bridgeMemberOptIn.upsert as unknown as jest.Mock
const optInUpdate = db.bridgeMemberOptIn.update as unknown as jest.Mock
const intentFindMany = db.socialIntent.findMany as unknown as jest.Mock
const userFindMany = db.user.findMany as unknown as jest.Mock
const auditCreate = (db as any).tenantAuditEvent.create as jest.Mock
const idemFindUnique = (db as any).idempotencyRecord.findUnique as jest.Mock
const idemCreate = (db as any).idempotencyRecord.create as jest.Mock

const ORG_A = 'org_a'
const ORG_B = 'org_b'
const ME = 'u_me'
const PARTNER = 'u_partner'
const QUIET = 'u_quiet'
const BRIDGE_ID = 'br_1'

/** 协议夹具：①环 = `initiator ∩ recipient` = `{city, email}`（`displayName` 刻意只在发起侧）。 */
const BRIDGE_ROW = {
  id: BRIDGE_ID,
  initiatorOrgId: ORG_A,
  recipientOrgId: ORG_B,
  status: 'ACTIVE',
  initiatorFieldKeys: JSON.stringify(['city', 'email', 'displayName']),
  recipientFieldKeys: JSON.stringify(['city', 'email']),
  shareableMissionKinds: JSON.stringify(['RECRUITING']),
  purpose: '跨社群人才互认',
  initiatorApprovedAt: new Date('2026-10-01T00:00:00.000Z'),
  recipientApprovedAt: new Date('2026-10-02T00:00:00.000Z'),
  expiresAt: null,
  revokedAt: null,
  createdBy: ME,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-02T00:00:00.000Z'),
}

/** 对方成员 `u_partner` 的意图：**授权了 displayName**（但协议①环没开它 —— 见文件头 #14）。 */
const PARTNER_INTENT = {
  userId: PARTNER,
  organizationId: ORG_B,
  disclosure: JSON.stringify({ city: 'CANDIDATE', company: 'CANDIDATE', displayName: 'CANDIDATE' }),
  status: 'ACTIVE',
  expiresAt: null,
  createdAt: new Date('2026-10-03T00:00:00.000Z'),
}

const PARTNER_PROFILE = {
  id: PARTNER,
  email: 'partner@example.test',
  profile: { displayName: '张三', city: '上海', company: 'ACME', avatar: null },
}

function asRole(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER', orgId = ORG_A) {
  requireAuthMock.mockResolvedValue({ user: { id: ME } })
  membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: orgId, role })
}

function req(method: string, url: string, opts: { body?: unknown; key?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.key) headers['idempotency-key'] = opts.key
  return new NextRequest(new URL(url, 'http://localhost'), {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  })
}

async function body(res: Response) {
  return (await res.json()) as any
}

const P = { bridgeId: BRIDGE_ID }

beforeEach(() => {
  jest.clearAllMocks()
  orgFindFirst.mockResolvedValue({ id: ORG_B })
  membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG_A, role: 'ADMIN' })
  bridgeFindMany.mockResolvedValue([])
  bridgeCount.mockResolvedValue(0)
  bridgeCreate.mockResolvedValue({ ...BRIDGE_ROW, status: 'PENDING', recipientApprovedAt: null })
  bridgeUpdateMany.mockResolvedValue({ count: 1 })
  optInFindFirst.mockResolvedValue(null)
  optInFindMany.mockResolvedValue([])
  optInUpsert.mockResolvedValue({
    id: 'oi_1',
    bridgeId: BRIDGE_ID,
    organizationId: ORG_A,
    userId: ME,
    status: 'ACTIVE',
    disclosedFieldKeys: JSON.stringify(['city']),
    optedInAt: new Date('2026-10-05T00:00:00.000Z'),
    withdrawnAt: null,
  })
  optInUpdate.mockResolvedValue({
    id: 'oi_1',
    bridgeId: BRIDGE_ID,
    organizationId: ORG_A,
    userId: ME,
    status: 'WITHDRAWN',
    disclosedFieldKeys: JSON.stringify(['city']),
    optedInAt: new Date('2026-10-05T00:00:00.000Z'),
    withdrawnAt: new Date('2026-10-06T00:00:00.000Z'),
  })
  auditCreate.mockResolvedValue({})
  idemFindUnique.mockResolvedValue(null)
  idemCreate.mockResolvedValue({ id: 'idem_1' })
  intentFindMany.mockResolvedValue([])
  userFindMany.mockResolvedValue([])
  // `findBridgeRow` 带"当事方"谓词（`OR: [{initiatorOrgId: 观察者}, {recipientOrgId: 观察者}]`），
  // 因此 mock 从**谓词本身**取出观察者组织，而不是全局写死 —— 否则"跨租户 → 404"那条断言
  // 会被一个过于宽松的 mock 悄悄放过（那种绿是没有意义的）。
  // 不带 `id` 的调用是 `createBridge` 的"是否已存在"检查。
  bridgeFindFirst.mockImplementation(async ({ where }: any) => {
    if (!where?.id) return null
    if (where.id !== BRIDGE_ID) return null
    const viewer = where.OR?.[0]?.initiatorOrgId
    return viewer === ORG_A || viewer === ORG_B ? { ...BRIDGE_ROW } : null
  })
  intentFindMany.mockImplementation(async ({ where }: any) => {
    const ids: string[] = where?.userId?.in ?? []
    return [PARTNER_INTENT].filter((r) => ids.includes(r.userId))
  })
})

// ═══════════════════════════════════════════════════════════
// 1. 能力关卡（两层：身份 + 能力）
// ═══════════════════════════════════════════════════════════

describe('T10 · 能力关卡', () => {
  it('匿名 → 401，且**不查库**（未通过身份就不该产生任何查询）', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Authentication required'))
    const res = await listCreate.GET(req('GET', '/api/v1/bridges'))
    expect(res.status).toBe(401)
    expect(bridgeFindMany).not.toHaveBeenCalled()
  })

  it('🔴 MEMBER **能**列协议（bridge.read 在 SELF_SERVICE）', async () => {
    asRole('MEMBER')
    const res = await listCreate.GET(req('GET', '/api/v1/bridges'))
    expect(res.status).toBe(200)
    expect(bridgeFindMany).toHaveBeenCalledTimes(1)
  })

  it('🔴 MEMBER **不能**发起协议（bridge.manage 在 ADMIN+）→ 403，并写 capability_denied 审计', async () => {
    asRole('MEMBER')
    const res = await listCreate.POST(req('POST', '/api/v1/bridges', { key: 'k1', body: {} }))
    expect(res.status).toBe(403)
    expect(bridgeCreate).not.toHaveBeenCalled()
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'tenant.capability_denied' }),
      }),
    )
  })

  it('🔴 MEMBER **能** opt-in（bridge.optin 在 SELF_SERVICE）—— AC-19 的"成员自己决定"', async () => {
    asRole('MEMBER')
    const res = await optIn.POST(
      req('POST', `/api/v1/bridges/${BRIDGE_ID}/opt-in`, { body: { disclosedFieldKeys: ['city'] } }),
      { params: Promise.resolve(P) })
    expect(res.status).toBe(200)
    const payload = await body(res)
    expect(payload.data.optIn.status).toBe('ACTIVE')
  })

  it('🔴 OPERATOR **不能**批准（bridge.manage 不在 OPERATOR_EXTRA）', async () => {
    asRole('OPERATOR')
    const res = await approve.POST(req('POST', `/api/v1/bridges/${BRIDGE_ID}/approve`), { params: Promise.resolve(P) })
    expect(res.status).toBe(403)
    expect(bridgeUpdateMany).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════
// 2. 发起（幂等 + 校验）
// ═══════════════════════════════════════════════════════════

describe('T10 · 发起协议 POST /api/v1/bridges', () => {
  const valid = {
    recipientOrgId: ORG_B,
    initiatorFieldKeys: ['city', 'email'],
    recipientFieldKeys: ['city'],
    shareableMissionKinds: ['RECRUITING'],
    purpose: '跨社群人才互认',
  }

  it('缺 Idempotency-Key → 400（**不**退化为"非幂等也能用"）', async () => {
    asRole('ADMIN')
    const res = await listCreate.POST(req('POST', '/api/v1/bridges', { body: valid }))
    expect(res.status).toBe(400)
    expect(bridgeCreate).not.toHaveBeenCalled()
  })

  it('首次创建 → 201，且落库即 `PENDING` + `recipientApprovedAt` 为 null（单边发起不能生效）', async () => {
    asRole('ADMIN')
    // 让 mock **回声**本次请求写入的值（而不是复用夹具行）：否则下面的 `agreedFieldKeys`
    // 断言测的是夹具的字段集，而不是"这次请求真的按输入算出了交集"。
    bridgeCreate.mockResolvedValue({
      ...BRIDGE_ROW,
      status: 'PENDING',
      recipientApprovedAt: null,
      initiatorFieldKeys: JSON.stringify(['city', 'email']),
      recipientFieldKeys: JSON.stringify(['city']),
      shareableMissionKinds: JSON.stringify(['RECRUITING']),
    })
    const res = await listCreate.POST(
      req('POST', '/api/v1/bridges', { key: 'k1', body: valid }),
    )
    expect(res.status).toBe(201)
    const payload = await body(res)
    expect(payload.data.replayed).toBe(false)
    expect(payload.data.bridge.status).toBe('PENDING')
    expect(payload.data.bridge.storedStatus).toBe('PENDING')
    expect(payload.data.bridge.recipientApprovedAt).toBeNull()
    // ①环 = 双边交集：initiator{city,email} ∩ recipient{city} = {city}
    expect(payload.data.bridge.agreedFieldKeys).toEqual(['city'])

    const created = bridgeCreate.mock.calls[0][0].data
    expect(created.status).toBe('PENDING')
    expect(created.initiatorApprovedAt).toBeInstanceOf(Date)
    expect(created.recipientApprovedAt).toBeNull()
    expect(created.initiatorOrgId).toBe(ORG_A)
  })

  it('同键同体重放 → 200 + replayed:true，且**不再创建**（幂等优先于"已存在"的 409）', async () => {
    asRole('ADMIN')
    const first = await listCreate.POST(
      req('POST', '/api/v1/bridges', { key: 'k1', body: valid }),
    )
    expect(first.status).toBe(201)
    const requestHash = idemCreate.mock.calls[0][0].data.requestHash
    expect(typeof requestHash).toBe('string')

    // 🔴 第二次之前，必须把库改到「首次**确实成功了**」之后的样子：一对组织之间已经有那份协议。
    //    这一步就是本用例的**牙齿** —— `bridgeFindFirst` 对**任何** where 都返回那一行，
    //    于是 `createBridge` 的"是否已存在"预检查会**真的命中**。
    //    若有人把该预检查挪回函数开头（即放到幂等查找**之前**），重试会在到达幂等分支前
    //    就被 409 拦下 ⇒ 本断言立刻变红。
    //
    // ⚠️ v1 的写法（不设 `bridgeFindFirst`，让它保持 beforeEach 的"无 id 调用返回 null"）
    //    是**假绿**：mock 让预检查永不命中，于是它测的是一个**在生产上不可达**的分支 ——
    //    真实的第二次请求必然"已存在"，永远走不到那里。这正是
    //    `scripts/qa/verify-ac19-bridge-e2e.mjs` 在真实链路上抓到的缺陷（见 `T10/slice-4.md` §5）。
    bridgeFindFirst.mockResolvedValue({ ...BRIDGE_ROW, status: 'PENDING', recipientApprovedAt: null })
    idemFindUnique.mockResolvedValue({ requestHash, resourceId: BRIDGE_ID })
    bridgeCreate.mockClear()

    const second = await listCreate.POST(
      req('POST', '/api/v1/bridges', { key: 'k1', body: valid }),
    )
    expect(second.status).toBe(200)
    expect((await body(second)).data.replayed).toBe(true)
    expect(bridgeCreate).not.toHaveBeenCalled()
  })

  it('同键**不同体** → 409（否则"重试"会静默变成"改配置"）', async () => {
    asRole('ADMIN')
    idemFindUnique.mockResolvedValue({ requestHash: 'hash-of-something-else', resourceId: BRIDGE_ID })
    const res = await listCreate.POST(
      req('POST', '/api/v1/bridges', { key: 'k1', body: valid }),
    )
    expect(res.status).toBe(409)
    expect(bridgeCreate).not.toHaveBeenCalled()
  })

  it('自邀 → 400（自建协议会让①环的双边退化成单边）', async () => {
    asRole('ADMIN')
    const res = await listCreate.POST(
      req('POST', '/api/v1/bridges', { key: 'k1', body: { ...valid, recipientOrgId: ORG_A } }),
    )
    expect(res.status).toBe(400)
    expect(orgFindFirst).not.toHaveBeenCalled()
  })

  it('被邀方组织不存在/未启用 → 400', async () => {
    asRole('ADMIN')
    orgFindFirst.mockResolvedValue(null)
    const res = await listCreate.POST(
      req('POST', '/api/v1/bridges', { key: 'k1', body: valid }),
    )
    expect(res.status).toBe(400)
    expect(bridgeCreate).not.toHaveBeenCalled()
  })

  it('已存在协议 → 409，且**不**新建（一对组织只能有一份协议）', async () => {
    asRole('ADMIN')
    bridgeFindFirst.mockImplementation(async ({ where }: any) =>
      where?.id ? null : { id: 'br_existing' },
    )
    const res = await listCreate.POST(
      req('POST', '/api/v1/bridges', { key: 'k1', body: valid }),
    )
    expect(res.status).toBe(409)
    expect(bridgeCreate).not.toHaveBeenCalled()
  })

  it('字段键不在 T03 目录里 → 400 并**列出**违规值（不静默丢弃）', async () => {
    asRole('ADMIN')
    const res = await listCreate.POST(
      req('POST', '/api/v1/bridges', {
        key: 'k1',
        body: { ...valid, initiatorFieldKeys: ['city', 'bankPassword'] },
      }),
    )
    expect(res.status).toBe(400)
    expect((await body(res)).error.details.unknown).toEqual(['bankPassword'])
  })

  it('🔴 `shareableMissionKinds` 含 `*` → 400（"什么都允许"不是合法取值）', async () => {
    asRole('ADMIN')
    const res = await listCreate.POST(
      req('POST', '/api/v1/bridges', { key: 'k1', body: { ...valid, shareableMissionKinds: ['*'] } }),
    )
    expect(res.status).toBe(400)
    expect(bridgeCreate).not.toHaveBeenCalled()
  })

  it('缺 purpose → 400（purpose limitation：跨群共享必须有可陈述的目的）', async () => {
    asRole('ADMIN')
    // 显式重建（而不是 `const { purpose, ...rest } = valid`）：后者会触发
    // `no-unused-vars`，而"为省略一个键而制造一个未使用变量"本身也不够直白。
    const noPurpose = {
      recipientOrgId: valid.recipientOrgId,
      initiatorFieldKeys: valid.initiatorFieldKeys,
      recipientFieldKeys: valid.recipientFieldKeys,
      shareableMissionKinds: valid.shareableMissionKinds,
    }
    const res = await listCreate.POST(
      req('POST', '/api/v1/bridges', { key: 'k1', body: noPurpose }),
    )
    expect(res.status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════
// 3. 双边审批 / 撤销
// ═══════════════════════════════════════════════════════════

describe('T10 · 双边审批：ACTIVE 的唯一入口是被邀方批准', () => {
  it('🔴 发起方调用 approve → 403 WRONG_SIDE（发起方在创建时已自动批准）', async () => {
    asRole('ADMIN', ORG_A)
    bridgeFindFirst.mockImplementation(async () => ({
      ...BRIDGE_ROW,
      status: 'PENDING',
      recipientApprovedAt: null,
    }))
    const res = await approve.POST(req('POST', `/api/v1/bridges/${BRIDGE_ID}/approve`), { params: Promise.resolve(P) })
    expect(res.status).toBe(403)
    expect(bridgeUpdateMany).not.toHaveBeenCalled()
  })

  it('🔴 被邀方调用 approve → 200，落 `ACTIVE` + `recipientApprovedAt`（双边配置此刻才生效）', async () => {
    asRole('ADMIN', ORG_B)
    bridgeFindFirst.mockImplementation(async ({ where }: any) =>
      where?.id ? { ...BRIDGE_ROW, status: 'PENDING', recipientApprovedAt: null } : null,
    )
    const res = await approve.POST(req('POST', `/api/v1/bridges/${BRIDGE_ID}/approve`), { params: Promise.resolve(P) })
    expect(res.status).toBe(200)
    const cas = bridgeUpdateMany.mock.calls[0][0]
    // CAS 谓词：只允许从 `PENDING` 迁走。
    // V17（WB17-01）：再加一条"我是当事方"——状态对但不是当事方的行，不得被我改成 ACTIVE。
    // 用 `toEqual`（精确相等）而非 `objectContaining`：这条断言的职责就是钉住**完整**谓词，
    // 宽松匹配会让将来"悄悄删掉 OR"的改动照样变绿。
    expect(cas.where).toEqual({
      id: BRIDGE_ID,
      status: 'PENDING',
      OR: [{ initiatorOrgId: ORG_B }, { recipientOrgId: ORG_B }],
    })
    expect(cas.data.status).toBe('ACTIVE')
    expect(cas.data.recipientApprovedAt).toBeInstanceOf(Date)
  })

  it('🔴 已经 ACTIVE 再批准 → 409（重复批准不是"幂等成功"，而是状态不对）', async () => {
    asRole('ADMIN', ORG_B)
    const res = await approve.POST(req('POST', `/api/v1/bridges/${BRIDGE_ID}/approve`), { params: Promise.resolve(P) })
    expect(res.status).toBe(409)
    expect(bridgeUpdateMany).not.toHaveBeenCalled()
  })

  it('🔴 CAS 失败（并发下状态已变）→ 409，而不是把非法状态写进去', async () => {
    asRole('ADMIN', ORG_B)
    bridgeFindFirst.mockImplementation(async ({ where }: any) =>
      where?.id ? { ...BRIDGE_ROW, status: 'PENDING', recipientApprovedAt: null } : null,
    )
    bridgeUpdateMany.mockResolvedValue({ count: 0 })
    const res = await approve.POST(req('POST', `/api/v1/bridges/${BRIDGE_ID}/approve`), { params: Promise.resolve(P) })
    expect(res.status).toBe(409)
  })

  it('撤销后不可再批准（`REVOKED` 是终态，真相表里没有出边）', async () => {
    asRole('ADMIN', ORG_B)
    bridgeFindFirst.mockImplementation(async ({ where }: any) =>
      where?.id ? { ...BRIDGE_ROW, status: 'REVOKED', revokedAt: new Date() } : null,
    )
    const res = await approve.POST(req('POST', `/api/v1/bridges/${BRIDGE_ID}/approve`), { params: Promise.resolve(P) })
    expect(res.status).toBe(409)
    expect(bridgeUpdateMany).not.toHaveBeenCalled()
  })

  it('撤销：任一方都可，且落 `revokedBy`（审计要能回答"是谁关的"）', async () => {
    asRole('ADMIN', ORG_A)
    const res = await revoke.POST(req('POST', `/api/v1/bridges/${BRIDGE_ID}/revoke`), { params: Promise.resolve(P) })
    expect(res.status).toBe(200)
    const cas = bridgeUpdateMany.mock.calls[0][0]
    // 同 approve：CAS 谓词 = 起始状态 + 当事方，缺一不可。
    expect(cas.where).toEqual({
      id: BRIDGE_ID,
      status: 'ACTIVE',
      OR: [{ initiatorOrgId: ORG_A }, { recipientOrgId: ORG_A }],
    })
    expect(cas.data.status).toBe('REVOKED')
    expect(cas.data.revokedBy).toBe(ME)
  })

  it('跨租户访问协议 → 404（谓词写进 WHERE，连"存在"这一事实都不泄露）', async () => {
    asRole('ADMIN', 'org_other')
    const res = await detail.GET(req('GET', `/api/v1/bridges/${BRIDGE_ID}`), { params: Promise.resolve(P) })
    expect(res.status).toBe(404)
  })
})

// ═══════════════════════════════════════════════════════════
// 4. 成员 opt-in / opt-out（fail loud）
// ═══════════════════════════════════════════════════════════

describe('T10 · 成员 opt-in：越界字段 fail loud', () => {
  it('🔴 成员勾了**本侧协议没开**的字段 → 400 + `bridge.optin_rejected` 审计（不静默收窄）', async () => {
    asRole('MEMBER', ORG_A)
    // 本侧（发起方）开了 city/email/displayName；成员勾了 company → 越界
    const res = await optIn.POST(
      req('POST', `/api/v1/bridges/${BRIDGE_ID}/opt-in`, {
        body: { disclosedFieldKeys: ['city', 'company'] },
      }),
      { params: Promise.resolve(P) })
    expect(res.status).toBe(400)
    expect((await body(res)).error.details.offending).toEqual(['company'])
    expect(optInUpsert).not.toHaveBeenCalled()
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'bridge.optin_rejected' }),
      }),
    )
  })

  it('本侧允许集内的字段 → 落库（并只记**计数**，不记字段值）', async () => {
    asRole('MEMBER', ORG_A)
    const res = await optIn.POST(
      req('POST', `/api/v1/bridges/${BRIDGE_ID}/opt-in`, {
        body: { disclosedFieldKeys: ['city', 'email'] },
      }),
      { params: Promise.resolve(P) })
    expect(res.status).toBe(200)
    const up = optInUpsert.mock.calls[0][0]
    expect(JSON.parse(up.create.disclosedFieldKeys)).toEqual(['city', 'email'])
    expect(up.create.organizationId).toBe(ORG_A) // 组织来自租户上下文，不是请求体
    const audit = auditCreate.mock.calls.find((c) => c[0].data.eventType === 'member.opted_in')
    // ⚠️ `writeTenantAudit` 把 metadata **序列化成 JSON 文本**再落库 —— 因此断言的是
    //    **持久化后的形态**（这也是合规读者真正会看到的东西），而不是调用时的对象。
    expect(JSON.parse(audit![0].data.safeMetadata)).toEqual({
      bridgeId: BRIDGE_ID,
      status: 'ACTIVE',
      disclosedCount: 2,
    })
    // 🔴 审计面最小化：字段键的**值**不得进审计（只留计数）。
    expect(audit![0].data.safeMetadata).not.toContain('city')
    expect(audit![0].data.safeMetadata).not.toContain('email')
  })

  it('🔴 协议已撤销 → opt-in 409（那时的加入是一个会误导用户的死动作）', async () => {
    asRole('MEMBER', ORG_A)
    bridgeFindFirst.mockImplementation(async ({ where }: any) =>
      where?.id ? { ...BRIDGE_ROW, status: 'REVOKED' } : null,
    )
    const res = await optIn.POST(
      req('POST', `/api/v1/bridges/${BRIDGE_ID}/opt-in`, { body: { disclosedFieldKeys: ['city'] } }),
      { params: Promise.resolve(P) })
    expect(res.status).toBe(409)
    expect(optInUpsert).not.toHaveBeenCalled()
  })

  it('🔴 `PENDING` 时**可以** opt-in（提前表态无害：协议不 ACTIVE 时投影恒为空）', async () => {
    asRole('MEMBER', ORG_A)
    bridgeFindFirst.mockImplementation(async ({ where }: any) =>
      where?.id ? { ...BRIDGE_ROW, status: 'PENDING', recipientApprovedAt: null } : null,
    )
    const res = await optIn.POST(
      req('POST', `/api/v1/bridges/${BRIDGE_ID}/opt-in`, { body: { disclosedFieldKeys: ['city'] } }),
      { params: Promise.resolve(P) })
    expect(res.status).toBe(200)
    expect(optInUpsert).toHaveBeenCalledTimes(1)
  })

  it('从未加入就 opt-out → 404（静默成功会掩盖"我以为我还加入着"的错觉）', async () => {
    asRole('MEMBER', ORG_A)
    optInFindFirst.mockResolvedValue(null)
    const res = await optOut.POST(req('POST', `/api/v1/bridges/${BRIDGE_ID}/opt-out`), { params: Promise.resolve(P) })
    expect(res.status).toBe(404)
  })

  it('opt-out → 置 `WITHDRAWN` 并**保留行**（"谁曾加入过"是审计问题，删行就答不了）', async () => {
    asRole('MEMBER', ORG_A)
    optInFindFirst.mockResolvedValue({
      id: 'oi_1',
      bridgeId: BRIDGE_ID,
      organizationId: ORG_A,
      userId: ME,
      status: 'ACTIVE',
      disclosedFieldKeys: JSON.stringify(['city']),
      optedInAt: new Date('2026-10-05T00:00:00.000Z'),
      withdrawnAt: null,
    })
    const res = await optOut.POST(req('POST', `/api/v1/bridges/${BRIDGE_ID}/opt-out`), { params: Promise.resolve(P) })
    expect(res.status).toBe(200)
    expect((await body(res)).data.optIn.status).toBe('WITHDRAWN')
    expect(optInUpdate.mock.calls[0][0].data.status).toBe('WITHDRAWN')
  })
})

// ═══════════════════════════════════════════════════════════
// 5. 跨群投影（AC-19 的核心取证）
// ═══════════════════════════════════════════════════════════

describe('T10 · 跨群投影 GET /discovery', () => {
  it('🔴 `PENDING` → 200 + 空列表 + `BRIDGE_PENDING`（"等对方批准"是正常状态，不是错误）', async () => {
    asRole('MEMBER', ORG_A)
    bridgeFindFirst.mockImplementation(async ({ where }: any) =>
      where?.id ? { ...BRIDGE_ROW, status: 'PENDING', recipientApprovedAt: null } : null,
    )
    const res = await discovery.GET(req('GET', `/api/v1/bridges/${BRIDGE_ID}/discovery`), { params: Promise.resolve(P) })
    expect(res.status).toBe(200)
    const payload = await body(res)
    expect(payload.data.bridgeRefusalCode).toBe('BRIDGE_PENDING')
    expect(payload.data.members).toEqual([])
    // 协议不可用时**连对方 opt-in 都不查** —— 早退在查询之前。
    expect(optInFindMany).not.toHaveBeenCalled()
  })

  it('🔴 跨群查询的谓词只有 `bridgeId + organizationId(=对方) + status`', async () => {
    asRole('MEMBER', ORG_A)
    optInFindMany.mockResolvedValue([])
    await discovery.GET(req('GET', `/api/v1/bridges/${BRIDGE_ID}/discovery`), { params: Promise.resolve(P) })
    const where = optInFindMany.mock.calls[0][0].where
    expect(where).toEqual({ bridgeId: BRIDGE_ID, organizationId: ORG_B, status: 'ACTIVE' })
    // 没有任何以档案字段为条件的过滤（"找出符合某画像的人"这种形状**不存在**）
    expect(JSON.stringify(where)).not.toMatch(/city|email|displayName|company/)
  })

  it('🔴🔴 三方交集 + 两把锁：`displayName` 成员已授权、但双方群主都没开 → 键**不存在**', async () => {
    asRole('MEMBER', ORG_A)
    optInFindMany.mockResolvedValue([
      {
        userId: PARTNER,
        status: 'ACTIVE',
        disclosedFieldKeys: JSON.stringify(['city', 'email', 'displayName', 'company']),
        optedInAt: new Date('2026-10-04T00:00:00.000Z'),
      },
    ])
    userFindMany.mockResolvedValue([PARTNER_PROFILE])

    const res = await discovery.GET(req('GET', `/api/v1/bridges/${BRIDGE_ID}/discovery`), { params: Promise.resolve(P) })
    expect(res.status).toBe(200)
    const data = (await body(res)).data

    expect(data.profileAudience).toBe('CANDIDATE')
    expect(data.visibleCount).toBe(1)
    expect(data.optedInCount).toBe(1)
    expect(data.gatedOut).toEqual([])

    const m = data.members[0]
    expect(m.userId).toBe(PARTNER)
    // ①环 = {city,email}；②成员 opt-in ⊇ ①环；③成员披露 {city,company,displayName}
    // ⇒ 交集 = {city}
    expect(m.sharedFieldKeys).toEqual(['city'])
    expect(m.subject.city).toBe('上海')

    // 🔴 以下四条各自钉住一把锁：
    expect(Object.prototype.hasOwnProperty.call(m.subject, 'displayName')).toBe(false) // ②锁：①环没开
    expect(Object.prototype.hasOwnProperty.call(m.subject, 'company')).toBe(false) // ②锁：①环没开
    expect(Object.prototype.hasOwnProperty.call(m.subject, 'email')).toBe(false) // ③锁：意图没授权
    expect(Object.prototype.hasOwnProperty.call(m.subject, 'avatarUrl')).toBe(false) // 从未授权
    // 对方私有行的**键**一个都不该出现（"看起来有这个字段"的痕迹也不行）
    expect(Object.keys(m.subject)).toEqual(['city'])
  })

  it('🔴 未 opt-in 的成员**根本不在**（查询谓词就没有他）', async () => {
    asRole('MEMBER', ORG_A)
    optInFindMany.mockResolvedValue([]) // 只有 PARTNER 参与，但它没 opt-in ⇒ 查询返回空
    const res = await discovery.GET(req('GET', `/api/v1/bridges/${BRIDGE_ID}/discovery`), { params: Promise.resolve(P) })
    const data = (await body(res)).data
    expect(data.members).toEqual([])
    expect(data.optedInCount).toBe(0)
  })

  it('🔴 已 opt-in 但无披露依据 → 只进 `gatedOut` 计数，**不给** userId、不给字段键', async () => {
    asRole('MEMBER', ORG_A)
    optInFindMany.mockResolvedValue([
      {
        userId: PARTNER,
        status: 'ACTIVE',
        disclosedFieldKeys: JSON.stringify(['city']),
        optedInAt: new Date('2026-10-04T00:00:00.000Z'),
      },
      {
        userId: QUIET,
        status: 'ACTIVE',
        disclosedFieldKeys: JSON.stringify(['city']),
        optedInAt: new Date('2026-10-04T00:00:00.000Z'),
      },
    ])
    userFindMany.mockResolvedValue([PARTNER_PROFILE])
    intentFindMany.mockImplementation(async ({ where }: any) => {
      const ids: string[] = where?.userId?.in ?? []
      // `u_quiet` 没有意图 ⇒ NO_INTENT_DISCLOSURE
      return [PARTNER_INTENT].filter((r) => ids.includes(r.userId))
    })

    const res = await discovery.GET(req('GET', `/api/v1/bridges/${BRIDGE_ID}/discovery`), { params: Promise.resolve(P) })
    const data = (await body(res)).data
    expect(data.visibleCount).toBe(1)
    expect(data.optedInCount).toBe(2)
    expect(data.gatedOut).toEqual([{ code: 'NO_INTENT_DISCLOSURE', count: 1 }])
    // 🔴 元数据泄漏防线：被门控的成员身份**绝不出现在响应里**。
    expect(JSON.stringify(data)).not.toContain(QUIET)
    expect(JSON.stringify(data)).not.toContain('narrowed')
  })

  it('🔴 撤销后**立即**为空（投影实时读库，不缓存"上次可见的集合"）', async () => {
    asRole('MEMBER', ORG_A)
    bridgeFindFirst.mockImplementation(async ({ where }: any) =>
      where?.id ? { ...BRIDGE_ROW, status: 'REVOKED', revokedAt: new Date() } : null,
    )
    const res = await discovery.GET(req('GET', `/api/v1/bridges/${BRIDGE_ID}/discovery`), { params: Promise.resolve(P) })
    const data = (await body(res)).data
    expect(data.bridgeRefusalCode).toBe('BRIDGE_REVOKED')
    expect(data.members).toEqual([])
  })

  it('本人视角（`/bridges/[id]`）**才**带逐字段归因与"该找谁"', async () => {
    asRole('MEMBER', ORG_A)
    optInFindFirst.mockResolvedValue({
      id: 'oi_1',
      bridgeId: BRIDGE_ID,
      organizationId: ORG_A,
      userId: ME,
      status: 'ACTIVE',
      disclosedFieldKeys: JSON.stringify(['city']),
      optedInAt: new Date('2026-10-05T00:00:00.000Z'),
      withdrawnAt: null,
    })
    intentFindMany.mockResolvedValue([
      {
        userId: ME,
        organizationId: ORG_A,
        disclosure: JSON.stringify({ city: 'CANDIDATE', email: 'CANDIDATE' }),
        status: 'ACTIVE',
        expiresAt: null,
        createdAt: new Date('2026-10-05T00:00:00.000Z'),
      },
    ])

    const res = await detail.GET(req('GET', `/api/v1/bridges/${BRIDGE_ID}`), { params: Promise.resolve(P) })
    expect(res.status).toBe(200)
    const data = (await body(res)).data
    // 我只勾了 city、我的意图覆盖 city/email ⇒ 交集 = {city}
    expect(data.myProjection.sharedFieldKeys).toEqual(['city'])
    const byKey = Object.fromEntries(
      (data.myProjection.narrowed as any[]).map((n) => [n.key, n]),
    )
    // email 被**我自己**的 opt-in 挡住 → 找自己
    expect(byKey.email).toEqual({ key: 'email', by: 'MEMBER_POLICY', owner: 'MEMBER' })
    // displayName 被**群主协议**挡住 → 找群主
    expect(byKey.displayName).toEqual({ key: 'displayName', by: 'GROUP_POLICY', owner: 'ORGANIZER' })
  })
})

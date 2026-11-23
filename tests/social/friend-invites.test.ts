/**
 * P0-1 · 真人邀请完整闭环 —— 领域层测试
 *
 * 守的是用户点名的那条断链：「生成邀请码却不能建立真实连接」。
 * 判据（一条都不放宽）：
 *   1. 邀请码**持久化**（VerificationToken）：服务重启 = 新的模块实例，仍可查回；
 *   2. 过期拒绝；重复接受拒绝；撤回后拒绝；伪造 token 拒绝；
 *   3. 越权（非受邀人）拒绝；未同意（未显式 accept）绝不自动建联；
 *   4. accept 成功后**真的**写 Match(ACCEPTED) + Conversation + 两条 participant；
 *   5. 幂等：同一 token 第二次 accept 不产生第二条关系/会话。
 *
 * 领域函数走依赖注入（db 形参），因此"服务重启"用两个独立构造的 fake db
 * 共享同一底层 store 来模拟：进程内 Map 会被新实例丢掉，只有写进 store 的才留下。
 */

import {
  createFriendInvite,
  findInviteByCode,
  acceptFriendInvite,
  revokeFriendInvite,
  normalizeInviteCode,
  INVITE_PREFIX,
  FriendInviteError,
  type FriendInviteDb,
} from '@/lib/social/friend-invites'

// ── 内存持久化 store：模拟"重启后仍在"的 DB ─────────────────────────
interface TokenRow {
  id: string
  identifier: string
  token: string
  expires: Date
  userId: string | null
  used: boolean
  useCount: number
  maxUses: number
  createdAt: Date
}
interface MatchRow {
  id: string
  senderId: string
  receiverId: string
  status: string
  matchScore: number
  matchReason: string
  createdAt: Date
}
interface ConvRow {
  id: string
  userAId: string
  userBId: string
  initiatorId: string
  matchId: string | null
  state: string
  participants: { userId: string }[]
}
interface Store {
  tokens: TokenRow[]
  matches: MatchRow[]
  conversations: ConvRow[]
  seq: number
}

type TokenWhere = { identifier?: string; token?: string; id?: string; used?: boolean }
type TokenCreateData = {
  identifier: string
  token: string
  expires: Date
  userId: string
  maxUses?: number
}
type MatchWhere = { id?: string; OR?: { senderId: string; receiverId: string }[] }
type ConvUpsertArgs = {
  where: { userAId_userBId: { userAId: string; userBId: string } }
  create: {
    userAId: string
    userBId: string
    initiatorId: string
    matchId?: string
    state?: string
    participants?: { create: { userId: string }[] }
  }
  update: Record<string, unknown>
}

function newStore(): Store {
  return { tokens: [], matches: [], conversations: [], seq: 0 }
}

/** 每次调用返回一个**全新的 db 实例**，但共享 store —— 模拟进程重启后重连 DB。 */
function makeDb(store: Store): FriendInviteDb {
  const nextId = (p: string) => `${p}${++store.seq}`
  const db: FriendInviteDb = {
    verificationToken: {
      findFirst: async ({ where }: { where: TokenWhere }) =>
        store.tokens.find(
          (t) => t.identifier === where.identifier && t.token === where.token
        ) ?? null,
      create: async ({ data }: { data: TokenCreateData }) => {
        const row: TokenRow = {
          id: nextId('tok_'),
          identifier: data.identifier,
          token: data.token,
          expires: data.expires,
          userId: data.userId,
          used: false,
          useCount: 0,
          maxUses: data.maxUses ?? 1,
          createdAt: new Date(),
        }
        store.tokens.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = store.tokens.find((t) => t.id === where.id)
        if (!row) throw new Error('token not found')
        Object.assign(row, data)
        return row
      },
      updateMany: async ({ where, data }: { where: TokenWhere; data: Record<string, unknown> }) => {
        let count = 0
        for (const t of store.tokens) {
          if (where.id && t.id !== where.id) continue
          if (where.used !== undefined && t.used !== where.used) continue
          Object.assign(t, data)
          count++
        }
        return { count }
      },
    },
    match: {
      findFirst: async ({ where }: { where: MatchWhere }) => {
        const or = where.OR ?? []
        return (
          store.matches.find((m) => {
            if (or.length) {
              return or.some(
                (o) =>
                  (o.senderId === m.senderId && o.receiverId === m.receiverId) ||
                  (o.senderId === m.receiverId && o.receiverId === m.senderId)
              )
            }
            return m.id === where.id
          }) ?? null
        )
      },
      create: async ({
        data,
      }: {
        data: { senderId: string; receiverId: string; status: string; matchScore: number; matchReason: string }
      }) => {
        const row: MatchRow = {
          id: nextId('match_'),
          senderId: data.senderId,
          receiverId: data.receiverId,
          status: data.status,
          matchScore: data.matchScore,
          matchReason: data.matchReason,
          createdAt: new Date(),
        }
        store.matches.push(row)
        return row
      },
    },
    conversation: {
      upsert: async ({ where, create, update }: ConvUpsertArgs) => {
        const key = where.userAId_userBId
        let row = store.conversations.find(
          (c) => c.userAId === key.userAId && c.userBId === key.userBId
        )
        if (row) {
          Object.assign(row, update)
          return row
        }
        row = {
          id: nextId('conv_'),
          userAId: create.userAId,
          userBId: create.userBId,
          initiatorId: create.initiatorId,
          matchId: create.matchId ?? null,
          state: create.state ?? 'ACTIVE',
          participants: (create.participants?.create ?? []).map((p) => ({ userId: p.userId })),
        }
        store.conversations.push(row)
        return row
      },
    },
    $transaction: async (fn: (tx: FriendInviteDb) => Promise<unknown>) => fn(db),
  }
  return db
}

const INVITER = 'user-A-inviter'
const INVITEE = 'user-B-invitee'
const STRANGER = 'user-C-stranger'
const NOW = new Date('2026-11-23T12:00:00.000Z')

describe('P0-1 · 真人邀请完整闭环', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime())
  })
  afterEach(() => jest.restoreAllMocks())

  it('normalizeInviteCode：大小写/空白归一，非法形状拒绝', () => {
    expect(normalizeInviteCode('  ab12cd  ')).toBe('AB12CD')
    expect(normalizeInviteCode('AB-12-CD')).toBe('AB12CD')
    expect(() => normalizeInviteCode('')).toThrow()
    expect(() => normalizeInviteCode('!!!!')).toThrow()
    expect(() => normalizeInviteCode('a'.repeat(64))).toThrow()
  })

  it('邀请码持久化：写入后即使换一个 db 实例（=重启）仍可查回', async () => {
    const store = newStore()
    const dbBeforeRestart = makeDb(store)
    const invite = await createFriendInvite(dbBeforeRestart, INVITER)

    expect(invite.code).toBeTruthy()
    expect(invite.code).toMatch(new RegExp(`^${INVITE_PREFIX}`))

    // 模拟进程重启：丢弃旧 db 对象，用新实例连同一个 store
    const dbAfterRestart = makeDb(store)
    const found = await findInviteByCode(dbAfterRestart, invite.code)
    expect(found).not.toBeNull()
    expect(found?.inviterId).toBe(INVITER)
    expect(found?.status).toBe('PENDING')
  })

  it('过期邀请：拒绝接受，且状态记为 EXPIRED', async () => {
    const store = newStore()
    const db = makeDb(store)
    const invite = await createFriendInvite(db, INVITER)
    // 把 expires 拨到过去
    store.tokens[0].expires = new Date(NOW.getTime() - 1000)

    await expect(
      acceptFriendInvite(db, { code: invite.code, accepterId: INVITEE })
    ).rejects.toMatchObject({ code: 'EXPIRED' })
    const found = await findInviteByCode(db, invite.code)
    expect(found?.status).toBe('EXPIRED')
    // 未同意 → 不得建任何关系
    expect(store.matches).toHaveLength(0)
    expect(store.conversations).toHaveLength(0)
  })

  it('伪造 token：INVALID_CODE 拒绝，不建关系', async () => {
    const store = newStore()
    const db = makeDb(store)
    await expect(
      acceptFriendInvite(db, { code: 'ZZ9999', accepterId: INVITEE })
    ).rejects.toMatchObject({ code: 'INVALID_CODE' })
    expect(store.matches).toHaveLength(0)
    expect(store.conversations).toHaveLength(0)
  })

  it('越权：接受者不能是邀请人自己（SELF_INVITE）', async () => {
    const store = newStore()
    const db = makeDb(store)
    const invite = await createFriendInvite(db, INVITER)
    await expect(
      acceptFriendInvite(db, { code: invite.code, accepterId: INVITER })
    ).rejects.toMatchObject({ code: 'SELF_INVITE' })
    expect(store.matches).toHaveLength(0)
  })

  it('撤回后：INVITE_REVOKED 拒绝，不建关系', async () => {
    const store = newStore()
    const db = makeDb(store)
    const invite = await createFriendInvite(db, INVITER)
    await revokeFriendInvite(db, { code: invite.code, actorId: INVITER })
    await expect(
      acceptFriendInvite(db, { code: invite.code, accepterId: INVITEE })
    ).rejects.toMatchObject({ code: 'INVITE_REVOKED' })
    expect(store.matches).toHaveLength(0)
  })

  it('撤回越权：非邀请人不能撤回（FORBIDDEN）', async () => {
    const store = newStore()
    const db = makeDb(store)
    const invite = await createFriendInvite(db, INVITER)
    await expect(
      revokeFriendInvite(db, { code: invite.code, actorId: STRANGER })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('未同意绝不自动建联：仅 create + find 不产生任何 Match/Conversation', async () => {
    const store = newStore()
    const db = makeDb(store)
    await createFriendInvite(db, INVITER)
    await findInviteByCode(db, (store.tokens[0] as TokenRow).token.replace(INVITE_PREFIX, ''))
    expect(store.matches).toHaveLength(0)
    expect(store.conversations).toHaveLength(0)
  })

  it('明确接受：写 Match(ACCEPTED) + Conversation + 两条 participant，双方可聊', async () => {
    const store = newStore()
    const db = makeDb(store)
    const invite = await createFriendInvite(db, INVITER)

    const result = await acceptFriendInvite(db, { code: invite.code, accepterId: INVITEE })

    expect(result.inviterId).toBe(INVITER)
    expect(result.accepterId).toBe(INVITEE)
    expect(result.matchId).toBeTruthy()
    expect(result.conversationId).toBeTruthy()

    expect(store.matches).toHaveLength(1)
    expect(store.matches[0]).toMatchObject({
      senderId: INVITER,
      receiverId: INVITEE,
      status: 'ACCEPTED',
    })
    expect(store.conversations).toHaveLength(1)
    expect(store.conversations[0].matchId).toBe(result.matchId)
    expect(store.conversations[0].participants.map((p) => p.userId).sort()).toEqual(
      [INVITER, INVITEE].sort()
    )
    // token 被消费：maxUses=1
    expect(store.tokens[0].used).toBe(true)
    expect(store.tokens[0].useCount).toBe(1)
  })

  it('重复接受：ALREADY_ACCEPTED 拒绝，且幂等返回同一 conversation（不新增关系）', async () => {
    const store = newStore()
    const db = makeDb(store)
    const invite = await createFriendInvite(db, INVITER)
    const first = await acceptFriendInvite(db, { code: invite.code, accepterId: INVITEE })

    await expect(
      acceptFriendInvite(db, { code: invite.code, accepterId: INVITEE })
    ).rejects.toMatchObject({ code: 'ALREADY_ACCEPTED' })
    expect(store.matches).toHaveLength(1)
    expect(store.conversations).toHaveLength(1)

    // 幂等兜底：即使 token 状态异常被消费两次，按用户对仍只返回同一会话
    const idem = await acceptFriendInvite(db, {
      code: invite.code,
      accepterId: INVITEE,
      idempotent: true,
    })
    expect(idem.conversationId).toBe(first.conversationId)
    expect(store.matches).toHaveLength(1)
    expect(store.conversations).toHaveLength(1)
  })

  it('同一邀请人对已被邀请过的人不可重复建关系（UNIQUE pair 幂等）', async () => {
    const store = newStore()
    const db = makeDb(store)
    const i1 = await createFriendInvite(db, INVITER)
    const r1 = await acceptFriendInvite(db, { code: i1.code, accepterId: INVITEE })
    // 第二次邀请同一对 —— create 仍允许（新 token），但 accept 走幂等
    const i2 = await createFriendInvite(db, INVITER)
    const r2 = await acceptFriendInvite(db, { code: i2.code, accepterId: INVITEE, idempotent: true })
    expect(r2.conversationId).toBe(r1.conversationId)
    expect(store.conversations).toHaveLength(1)
  })

  it('错误类型是 FriendInviteError（携带稳定 code，供 API 映射 HTTP 状态）', async () => {
    const store = newStore()
    const db = makeDb(store)
    try {
      await acceptFriendInvite(db, { code: 'ZZ9999', accepterId: INVITEE })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(FriendInviteError)
      expect((e as FriendInviteError).code).toBe('INVALID_CODE')
      expect((e as FriendInviteError).httpStatus).toBe(400)
    }
  })
})

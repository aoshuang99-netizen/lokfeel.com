/**
 * T09 Slice 6 · **对外送达**（`AgentDeliveryTarget` + 第二道门）服务层证据
 *
 * ═══════════════════════════════════════════════════════════════
 * 这份文件钉的是"送达对手方"这件事的两端
 * ═══════════════════════════════════════════════════════════════
 *   A. **创建时**：目标身份由服务端固定（四道校验），授权集合由 T05 读数注入，
 *      目标与运行**同一个 create** 落库，审计面只记计数。
 *   B. **执行时**：披露授权可能已被撤销/收窄 —— 第二道门必须拒绝，且**不留副作用**。
 *   C. **同源**：DTO 的 `execution.available` 与执行器用的是**同一对**纯函数 + 同一份读数
 *      ⇒ 结构上不存在"界面说能执行、点了必然 409"的空按钮（AC-18 的判据）。
 *   D. **反向对照**：改坏前提，断言必须变红（自证这些断言不是恒真）。
 *
 * ⚠️ 披露表（`socialIntent` / `missionParticipation`）在假库里是**只读**的：
 *    本文件只摆"当时生效的读数"，不实现授权/撤销的业务链路（那是 T03/T05 的测试域）。
 */

jest.mock('@/lib/db', () => ({
  db: {
    agentRun: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    agentCall: { findMany: jest.fn() },
    agentApproval: { create: jest.fn() },
    agentExecution: { create: jest.fn(), findUnique: jest.fn() },
    notificationDelivery: { findUnique: jest.fn(), upsert: jest.fn() },
    notification: { create: jest.fn() },
    organization: { findUnique: jest.fn() },
    idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
    membership: { findFirst: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
    socialIntent: { findFirst: jest.fn(), findMany: jest.fn() },
    missionParticipation: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { db } from '@/lib/db'
import { ConflictError, ValidationError } from '@/lib/errors'
import { createStubProvider } from '@/lib/agent'
import {
  createAgentRun,
  decideAgentRun,
  executeAgentRun,
  getAgentRun,
  listAgentRuns,
} from '@/lib/agents'
import type { TenantContext } from '@/lib/tenancy/resolve'
import type { Role } from '@/lib/tenancy/capabilities'

import { createFakeAgentDb, installFakeAgentDb, type FakeAgentDb } from './_fake-db'

const ORG = 'org_1'
const REQUESTER = 'u_1'
const TARGET_USER = 'u_target'
const TARGET_USER_2 = 'u_target_2'
const INTENT_ID = 'intent_1'
const MISSION_ID = 'm_1'
const INTRO_GOAL = '帮助我们在 30 天内对接 5 家渠道伙伴'

const ctx = (role: Role = 'ADMIN', userId = REQUESTER): TenantContext => ({
  organizationId: ORG,
  userId,
  role,
  membershipId: 'ms_1',
})

let fake: FakeAgentDb

beforeEach(() => {
  jest.clearAllMocks()
  fake = createFakeAgentDb()
  installFakeAgentDb(db, fake)
})

/**
 * 摆好"当时生效的披露读数"。
 *
 * 默认 \`{ bio: 'COUNTERPARTY' }\` ⇒ 对手方可见字段 = \`['bio']\`（唯一的那个）。
 * 传 \`{}\` 可造"没有任何披露"的情形；传两个键可造"创建时更宽"的情形（用于收窄用例）。
 */
function seedDisclosure(
  disclosure: Record<string, string> = { bio: 'COUNTERPARTY' },
  opts: { intentStatus?: string; expiresAt?: Date | null; targetStatus?: string } = {},
) {
  fake.socialIntents.push({
    id: INTENT_ID,
    organizationId: ORG,
    userId: REQUESTER,
    missionId: MISSION_ID,
    disclosure: JSON.stringify(disclosure),
    status: opts.intentStatus ?? 'ACTIVE',
    expiresAt: opts.expiresAt ?? null,
  })
  fake.participations.push({
    id: 'mp_1',
    organizationId: ORG,
    missionId: MISSION_ID,
    userId: TARGET_USER,
    status: opts.targetStatus ?? 'INTERESTED',
  })
  fake.participations.push({
    id: 'mp_2',
    organizationId: ORG,
    missionId: MISSION_ID,
    userId: TARGET_USER_2,
    status: 'INTERESTED',
  })
}

const introInput = (allowedFieldKeys: string[] = ['goal']) => ({
  goal: INTRO_GOAL,
  subjectLabel: '我方',
  counterpartLabel: '对方',
  allowedFieldKeys,
})

/** 一个确定性 provider（记录**模型真正收到的请求**，用于证明服务端注入生效）。 */
function recordingProvider(out: string[] = []) {
  return createStubProvider(
    (req) => {
      out.push(JSON.stringify(req))
      return JSON.stringify({ counterpartLabel: '对方', draftMessage: '你好，想聊聊合作', usedFieldKeys: [] })
    },
    { inputTokens: 10, outputTokens: 5 },
  )
}

async function createIntro(key = 'd-intro', allowedFieldKeys: string[] = ['goal']) {
  return createAgentRun(ctx(), {
    skill: 'INTRO_DRAFT',
    input: introInput(allowedFieldKeys),
    idempotencyKey: key,
    delivery: { targetUserId: TARGET_USER, intentId: INTENT_ID },
    provider: { kind: 'ready', provider: recordingProvider() },
  })
}

/** 走完"创建 → 批准"两步（介绍草稿是高风险技能，必须有人工裁决才能执行）。 */
async function createApprovedIntro(key = 'd-approved') {
  const { run } = await createIntro(key)
  const approved = await decideAgentRun(ctx(), run.id, 'APPROVED')
  return { run, approved }
}

const auditCall = (eventType: string) =>
  (db.tenantAuditEvent.create as unknown as jest.Mock).mock.calls.find(
    (c) => c[0]?.data?.eventType === eventType,
  )

/* ══════════════════════════════════════════════════════════════════
 * A. 创建：目标身份的四道校验
 * ══════════════════════════════════════════════════════════════════ */

describe('创建：送达目标的四道校验（全部在**服务端**，输入不可信）', () => {
  it('🔴 技能的执行计划不声明对外送达 → 400（否则"挂个收件人"就成了通用后门）', async () => {
    seedDisclosure()
    await expect(
      createAgentRun(ctx(), {
        skill: 'COORDINATION_ADVICE',
        input: { goal: '为社群成员对接合适的合作伙伴', allowedCandidateIds: [] },
        idempotencyKey: 'd-bad-skill',
        delivery: { targetUserId: TARGET_USER, intentId: INTENT_ID },
        provider: { kind: 'ready', provider: recordingProvider() },
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(fake.runs).toHaveLength(0)
    expect(fake.calls).toHaveLength(0) // 目标不合法 ⇒ **一条模型调用都不该发生**
  })

  it('目标不能是发起人自己 → 400', async () => {
    seedDisclosure()
    await expect(
      createAgentRun(ctx(), {
        skill: 'INTRO_DRAFT',
        input: introInput(),
        idempotencyKey: 'd-self',
        delivery: { targetUserId: REQUESTER, intentId: INTENT_ID },
        provider: { kind: 'ready', provider: recordingProvider() },
      }),
    ).rejects.toThrow(/不能是发起人自己/)
    expect(fake.runs).toHaveLength(0)
  })

  it('🔴 披露依据必须是**发起人自己**的意图 → 400（不能拿别人的意图当授权）', async () => {
    seedDisclosure()
    // 意图属于别人：假库按 (id, organizationId, userId) 三联查，这里查不到。
    fake.socialIntents[0].userId = 'u_someone_else'
    await expect(createIntro('d-notmine')).rejects.toThrow(/不属于你/)
    expect(fake.runs).toHaveLength(0)
  })

  it('目标不在该意图所属任务里 / 不在参与状态 → 400', async () => {
    // ① 完全不在任务里的用户
    seedDisclosure()
    await expect(
      createAgentRun(ctx(), {
        skill: 'INTRO_DRAFT',
        input: introInput(),
        idempotencyKey: 'd-nomember',
        delivery: { targetUserId: 'u_stranger', intentId: INTENT_ID },
        provider: { kind: 'ready', provider: recordingProvider() },
      }),
    ).rejects.toThrow(/不是该意图所属任务的参与成员/)
    expect(fake.runs).toHaveLength(0)

    // ② 在任务里但已退出（status 条件写进了同一条 where —— 漏了它就等于"退出了还能收"）
    fake = createFakeAgentDb()
    installFakeAgentDb(db, fake)
    seedDisclosure({ bio: 'COUNTERPARTY' }, { targetStatus: 'WITHDRAWN' })
    await expect(createIntro('d-withdrawn')).rejects.toThrow(/不是该意图所属任务的参与成员/)
    expect(fake.runs).toHaveLength(0)
  })

  it('🔴 意图当前未向对手方披露任何字段 → 400（没有可送达的介绍内容）', async () => {
    seedDisclosure({}) // 空披露表
    await expect(createIntro('d-empty')).rejects.toThrow(/未向对手方披露任何字段/)
    expect(fake.runs).toHaveLength(0)
  })

  it('🔴 意图已过期 → 400（"撤销/过期即刻生效"在**创建**侧就已经生效）', async () => {
    seedDisclosure({ bio: 'COUNTERPARTY' }, { expiresAt: new Date(Date.now() - 60_000) })
    await expect(createIntro('d-expired')).rejects.toThrow(/未向对手方披露任何字段/)
    expect(fake.runs).toHaveLength(0)
  })
})

/* ══════════════════════════════════════════════════════════════════
 * A2. 创建：落库、投影、注入、审计
 * ══════════════════════════════════════════════════════════════════ */

describe('创建：落库 / 投影 / 服务端注入 / 审计面', () => {
  it('送达目标与运行**同一个 create** 落库（原子），行内容可核对', async () => {
    seedDisclosure({ bio: 'COUNTERPARTY' })
    const { run } = await createIntro('d-store')

    expect(fake.runs).toHaveLength(1)
    expect(fake.deliveryTargets).toHaveLength(1)
    const row = fake.deliveryTargets[0]
    expect(row.runId).toBe(run.id)
    expect(row.organizationId).toBe(ORG)
    expect(row.targetUserId).toBe(TARGET_USER)
    expect(row.intentId).toBe(INTENT_ID)
    expect(row.audience).toBe('COUNTERPARTY')
    // 授权是**快照**（JSON 文本）—— 执行时用它判"有没有被收窄"。
    expect(JSON.parse(String(row.authorizedFieldKeys))).toEqual(['bio'])
  })

  it('DTO 只下发**目标身份**，不下发授权快照', async () => {
    seedDisclosure({ bio: 'COUNTERPARTY' })
    const { run } = await createIntro('d-dto')
    expect(run.deliveryTarget).toEqual({ targetUserId: TARGET_USER })
    // 反向对照：授权快照是内部判据的输入，多下发一个数组就多一处会漂移的对外承诺。
    expect(JSON.stringify(run.deliveryTarget)).not.toContain('bio')
  })

  it('没给 delivery 的运行 → `deliveryTarget` 为 null（而不是 undefined）', async () => {
    const { run } = await createAgentRun(ctx(), {
      skill: 'COORDINATION_ADVICE',
      input: { goal: '为社群成员对接合适的合作伙伴', allowedCandidateIds: [] },
      idempotencyKey: 'd-none',
      provider: { kind: 'ready', provider: recordingProvider() },
    })
    expect(run.deliveryTarget).toBeNull()
  })

  it('🔴 创建那一刻：第一道门先发话（待批），第二道门不越位抢答', async () => {
    seedDisclosure({ bio: 'COUNTERPARTY' })
    const { run } = await createIntro('d-order')
    expect(run.status).toBe('AWAITING_APPROVAL')
    expect(run.execution.available).toBe(false)
    // 不许在这里报 DISCLOSURE_* —— 那是"要等批准"与"授权已撤回"两种不同的处置动作。
    expect(run.execution.code).toBe('STATUS_NOT_EXECUTABLE')
  })

  it('🔴 服务端注入授权集合：模型收到的 allowedFieldKeys 是 T05 读数，**不采信**请求体', async () => {
    seedDisclosure({ bio: 'COUNTERPARTY' })
    const seen: string[] = []
    const sentinel = 'SENTINEL_CALLER_SUPPLIED_MUST_BE_IGNORED'
    await createAgentRun(ctx(), {
      skill: 'INTRO_DRAFT',
      input: introInput([sentinel]),
      idempotencyKey: 'd-inject',
      delivery: { targetUserId: TARGET_USER, intentId: INTENT_ID },
      provider: { kind: 'ready', provider: recordingProvider(seen) },
    })

    expect(seen).toHaveLength(1)
    const prompt = seen[0]
    expect(prompt).toContain('bio')
    expect(prompt).not.toContain(sentinel)
  })

  it('审计面只记"送不送、按哪一档、授权了几项"——不记目标 id，也不记字段名', async () => {
    seedDisclosure({ bio: 'COUNTERPARTY' })
    await createIntro('d-audit')

    const call = auditCall('agent.run.created')
    expect(call).toBeTruthy()
    const meta = call![0].data.safeMetadata
    const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta
    expect(parsed.outbound).toEqual({ audience: 'COUNTERPARTY', authorizedFieldCount: 1 })
    const serialized = JSON.stringify(parsed)
    expect(serialized).not.toContain(TARGET_USER)
    expect(serialized).not.toContain('bio')
    expect(serialized).not.toContain(INTENT_ID)
  })
})

/* ══════════════════════════════════════════════════════════════════
 * B. 执行：第二道门
 * ══════════════════════════════════════════════════════════════════ */

describe('执行：第二道门（披露授权「撤销即刻生效」在投递侧的落点）', () => {
  it('正常路径：站内信送给**对手方**，执行记录与审计都如实记下收件人类别', async () => {
    seedDisclosure({ bio: 'COUNTERPARTY' })
    const { run } = await createApprovedIntro('d-ok')

    const result = await executeAgentRun(ctx('OPERATOR', 'u_decider'), run.id)

    expect(result.run.status).toBe('EXECUTED')
    expect(result.execution!.recipientId).toBe(TARGET_USER)
    expect(fake.notifications).toHaveLength(1)
    expect(fake.notifications[0].userId).toBe(TARGET_USER)
    expect(fake.executions[0].recipientId).toBe(TARGET_USER)
    // 执行人 ≠ 收件人：批准者与收到东西的人是两个身份，必须分开记。
    expect(fake.executions[0].actorId).toBe('u_decider')

    const meta = JSON.parse(auditCall('agent.run.executed')![0].data.safeMetadata)
    expect(meta.recipientKind).toBe('TARGET')
    expect(meta.recipientIsRequester).toBe(false)
    expect(meta.outbound).toEqual({
      audience: 'COUNTERPARTY',
      authorizedFieldCount: 1,
      visibleFieldCount: 1,
    })
    expect(JSON.stringify(meta)).not.toContain(TARGET_USER)
    expect(JSON.stringify(meta)).not.toContain('bio')
  })

  it('🔴 授权被**撤销** → 409 DISCLOSURE_EMPTY，且**不留任何副作用**', async () => {
    seedDisclosure({ bio: 'COUNTERPARTY' })
    const { run } = await createApprovedIntro('d-revoked')

    // 撤销：状态离开 ACTIVE（T05 的 `liveDisclosureOf` 立刻返回空表）。
    fake.socialIntents[0].status = 'WITHDRAWN'

    await expect(executeAgentRun(ctx(), run.id)).rejects.toBeInstanceOf(ConflictError)
    expect(fake.executions).toHaveLength(0)
    expect(fake.notifications).toHaveLength(0)
    expect(fake.deliveries).toHaveLength(0)
    // 状态必须**没变**：这不是"执行失败"，是"这一步现在不被允许"。
    expect(fake.runs[0].status).toBe('APPROVED')
  })

  it('🔴 授权被**收窄** → 409 DISCLOSURE_NARROWED，且原因里点名被收窄的字段', async () => {
    // 创建时更宽（两个字段）⇒ 快照 = ['bio','city']；执行前收到只剩 bio。
    seedDisclosure({ bio: 'COUNTERPARTY', city: 'COUNTERPARTY' })
    const { run } = await createIntro('d-narrow')
    expect(JSON.parse(String(fake.deliveryTargets[0].authorizedFieldKeys))).toEqual(['bio', 'city'])
    await decideAgentRun(ctx(), run.id, 'APPROVED')

    fake.socialIntents[0].disclosure = JSON.stringify({ bio: 'COUNTERPARTY' })

    const err = await executeAgentRun(ctx(), run.id).catch((e: unknown) => e as Error)
    expect(err).toBeInstanceOf(ConflictError)
    expect((err as Error).message).toContain('city')
    expect(fake.executions).toHaveLength(0)
    expect(fake.notifications).toHaveLength(0)
  })

  it('🔴 意图整行被删 → 保守不送（读不到依据 ≠ 没有限制）', async () => {
    seedDisclosure({ bio: 'COUNTERPARTY' })
    const { run } = await createApprovedIntro('d-intent-gone')
    fake.socialIntents = []

    await expect(executeAgentRun(ctx(), run.id)).rejects.toBeInstanceOf(ConflictError)
    expect(fake.notifications).toHaveLength(0)
  })
})

/* ══════════════════════════════════════════════════════════════════
 * C. 同源：DTO 与执行器给出同一个答案
 * ══════════════════════════════════════════════════════════════════ */

describe('🔴 同源：界面的"能不能执行"与执行器的判据是同一对纯函数', () => {
  it('撤销后 DTO 的 execution 变为不可执行，且 code 指向"授权已归零"', async () => {
    seedDisclosure({ bio: 'COUNTERPARTY' })
    const { run } = await createApprovedIntro('d-same-source')
    expect((await getAgentRun(ctx(), run.id)).execution.available).toBe(true)

    fake.socialIntents[0].status = 'WITHDRAWN'

    const after = await getAgentRun(ctx(), run.id)
    expect(after.execution.available).toBe(false)
    expect(after.execution.code).toBe('DISCLOSURE_EMPTY')
    // 反向对照：这与执行器的拒绝码**逐字相同** —— 界面据此禁用按钮，而不是留一个点了必然 409 的空按钮。
    const err = await executeAgentRun(ctx(), run.id).catch((e: unknown) => e as ConflictError)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.details?.code).toBe('DISCLOSURE_EMPTY')
  })

  it('列表页同样算闸门（不是只有详情页才拦）', async () => {
    seedDisclosure({ bio: 'COUNTERPARTY' })
    const { run } = await createApprovedIntro('d-list')
    fake.socialIntents[0].status = 'WITHDRAWN'

    const page = await listAgentRuns(ctx())
    const row = page.items.find((r) => r.id === run.id)
    expect(row).toBeTruthy()
    expect(row!.execution.available).toBe(false)
    expect(row!.deliveryTarget).toEqual({ targetUserId: TARGET_USER })
  })
})

/* ══════════════════════════════════════════════════════════════════
 * D. 幂等：delivery 进请求指纹
 * ══════════════════════════════════════════════════════════════════ */

describe('幂等：同一把键配不同送达目标是**两件事**', () => {
  it('同键 + 同 delivery → 回放（不产生第二次模型调用）', async () => {
    seedDisclosure()
    const first = await createIntro('d-idem')
    const second = await createIntro('d-idem')
    expect(second.replayed).toBe(true)
    expect(second.run.id).toBe(first.run.id)
    expect(fake.runs).toHaveLength(1)
    expect(fake.calls).toHaveLength(1)
  })

  it('🔴 同键 + 不同 delivery → 409（唯一约束只能保证"不重复"，保证不了"没被复用"）', async () => {
    seedDisclosure()
    await createIntro('d-idem-2')
    await expect(
      createAgentRun(ctx(), {
        skill: 'INTRO_DRAFT',
        input: introInput(),
        idempotencyKey: 'd-idem-2',
        delivery: { targetUserId: TARGET_USER_2, intentId: INTENT_ID },
        provider: { kind: 'ready', provider: recordingProvider() },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(fake.runs).toHaveLength(1)
  })
})

/* ══════════════════════════════════════════════════════════════════
 * E. 反向对照（自证断言有牙）
 * ══════════════════════════════════════════════════════════════════ */

describe('反向对照：把前提改坏，断言必须变红', () => {
  it('把创建时的授权快照抹掉 → 执行必须被拒（证明 DISCLOSURE_EMPTY 不是恒真）', async () => {
    seedDisclosure({ bio: 'COUNTERPARTY' })
    const { run } = await createApprovedIntro('d-variant-1')

    // 变异：把快照清空（模拟"这条运行当初就没拿到授权"）。
    fake.deliveryTargets[0].authorizedFieldKeys = null

    await expect(executeAgentRun(ctx(), run.id)).rejects.toBeInstanceOf(ConflictError)
    expect(fake.notifications).toHaveLength(0)
  })

  it('把目标行删掉 → 执行必须报"没有目标身份"（而不是发给自己）', async () => {
    seedDisclosure({ bio: 'COUNTERPARTY' })
    const { run } = await createApprovedIntro('d-variant-2')

    fake.deliveryTargets = []

    const err = await executeAgentRun(ctx(), run.id).catch((e: unknown) => e as ConflictError)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.details?.code).toBe('NO_TARGET')
    expect(fake.notifications).toHaveLength(0)
  })

  it('把披露加宽（对手方看到更多）→ 仍应放行（这道门只拦"变窄"，不拦"变宽"）', async () => {
    seedDisclosure({ bio: 'COUNTERPARTY' })
    const { run } = await createApprovedIntro('d-variant-3')

    fake.socialIntents[0].disclosure = JSON.stringify({ bio: 'COUNTERPARTY', city: 'COUNTERPARTY' })

    const result = await executeAgentRun(ctx(), run.id)
    expect(result.run.status).toBe('EXECUTED')
    expect(fake.notifications).toHaveLength(1)
  })
})

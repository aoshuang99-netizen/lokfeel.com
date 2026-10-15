/**
 * T09 · Slice 4 —— **执行只有一条路径**（本文件取代 Slice 2 的 `execution-unreachable.test.ts`）
 *
 * Slice 2 的证据形态是"`EXECUTED` 必须为 0"（阶段断言，因为当时没有执行器）。
 * 执行器接线后，那条断言**应当被升级**而不是被删掉：
 *   「不能执行」→「**只有一条路径**能执行，且路径上每一道门都还在」。
 *
 * 本文件四组：
 *   A. **静态不变式**：`EXECUTED` 字面量只允许出现在 `executor.ts`；
 *      写入口计数（`update` 2 次、`updateMany`/`upsert` 0 次）；
 *      DTO 与执行器**共用**同一个内核判据（防"顺手再写一份状态判断"）。
 *   B. **服务层动态**：完整生命周期、纵深防御、角色、顺序论证（投递失败不改状态）。
 *   C. **副作用内容**：投递的收件人/幂等键/模板；通知体**不含**目标与草稿正文。
 *   D. **反向对照（自证断言有牙）**：把前提改坏，断言必须变红。
 */

import fs from 'fs'
import path from 'path'

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
    $transaction: jest.fn(),
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { NextRequest } from 'next/server'

import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { UnauthorizedError } from '@/lib/errors'
import { createStubProvider } from '@/lib/agent'
import { createAgentRun, decideAgentRun, executeAgentRun } from '@/lib/agents'
import type { TenantContext } from '@/lib/tenancy/resolve'
import type { Role } from '@/lib/tenancy/capabilities'

import * as executeRoute from '@/app/api/v1/agents/runs/[runId]/execute/route'

import { createFakeAgentDb, installFakeAgentDb, type FakeAgentDb } from './_fake-db'

const ROOT = path.resolve(__dirname, '..', '..')
const ORG = 'org_1'

const requireAuthMock = requireAuth as unknown as jest.Mock

let fake: FakeAgentDb

beforeEach(() => {
  jest.clearAllMocks()
  fake = createFakeAgentDb()
  installFakeAgentDb(db, fake)
  requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
})

const ctx = (role: Role = 'ADMIN', userId = 'u_1'): TenantContext => ({
  organizationId: ORG,
  userId,
  role,
  membershipId: 'ms_1',
})

/* ── 测试用技能输入 / 产出 ─────────────────────────────────────────── */

const ADVICE_GOAL = '为社群成员对接合适的合作伙伴'
const advicePayload = { rationale: '理由', suggestions: ['先约一次短会'], candidateIds: [] }
const adviceProvider = () =>
  createStubProvider(() => JSON.stringify(advicePayload), { inputTokens: 10, outputTokens: 5 })

const INTRO_GOAL = '帮助我们在 30 天内对接 5 家渠道伙伴'
const INTRO_DRAFT_TEXT = '你好，看到你们也在做跨境渠道，方便聊十分钟吗？'
const introProvider = () =>
  createStubProvider(
    () => JSON.stringify({ counterpartLabel: 'B', draftMessage: INTRO_DRAFT_TEXT, usedFieldKeys: [] }),
    { inputTokens: 10, outputTokens: 5 },
  )

async function createAdvice(key = 'e-advice') {
  const { run } = await createAgentRun(ctx(), {
    skill: 'COORDINATION_ADVICE',
    input: { goal: ADVICE_GOAL, allowedCandidateIds: [] },
    idempotencyKey: key,
    provider: { kind: 'ready', provider: adviceProvider() },
  })
  return run
}

async function createIntro(key = 'e-intro') {
  const { run } = await createAgentRun(ctx(), {
    skill: 'INTRO_DRAFT',
    input: {
      goal: INTRO_GOAL,
      subjectLabel: 'A',
      counterpartLabel: 'B',
      allowedFieldKeys: [],
    },
    idempotencyKey: key,
    provider: { kind: 'ready', provider: introProvider() },
  })
  return run
}

/* ══════════════════════════════════════════════════════════════════
 * A. 静态不变式
 * ══════════════════════════════════════════════════════════════════ */

function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSources(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

describe('T09 · 执行只有一条路径（静态）', () => {
  it('🔴 `EXECUTED` 字面量在服务层与路由层里**只**允许出现在 executor.ts', () => {
    const targets = [
      path.join(ROOT, 'src', 'lib', 'agents'),
      path.join(ROOT, 'src', 'app', 'api', 'v1', 'agents'),
    ]
    const offenders: string[] = []
    for (const dir of targets) {
      for (const file of collectSources(dir)) {
        if (path.basename(file) === 'executor.ts') continue // 唯一的写入点
        if (codeOnly(fs.readFileSync(file, 'utf8')).includes('EXECUTED')) {
          offenders.push(path.relative(ROOT, file))
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('🔴 `AgentRun.status` 的写入口恰好两处：create（落初值）+ 两次 update（裁决 / 执行）', () => {
    const runs = codeOnly(fs.readFileSync(path.join(ROOT, 'src/lib/agents/runs.ts'), 'utf8'))
    const exec = codeOnly(fs.readFileSync(path.join(ROOT, 'src/lib/agents/executor.ts'), 'utf8'))

    expect(runs.match(/db\.agentRun\.create\(/g) ?? []).toHaveLength(1)
    expect(runs.match(/db\.agentRun\.update\(/g) ?? []).toHaveLength(1)
    expect(exec.match(/db\.agentRun\.update\(/g) ?? []).toHaveLength(1)

    // `updateMany` / `upsert` 会绕开"先过状态机断言"这件事（它们没有前置读），一条都不许有。
    const all = runs + exec
    expect(all.match(/db\.agentRun\.updateMany\(/g) ?? []).toHaveLength(0)
    expect(all.match(/db\.agentRun\.upsert\(/g) ?? []).toHaveLength(0)

    expect(runs).toContain('status: result.status')
    expect(runs).toMatch(/db\.agentRun\.update\(\{[\s\S]*?data:\s*\{\s*status:\s*decision\s*\},/)
    // 执行器写的是字面量 EXECUTED，且**同一个事务**里带上了执行记录。
    expect(exec).toMatch(/data:\s*\{\s*status:\s*'EXECUTED'\s*\}/)
    expect(exec).toMatch(/db\.agentExecution\.create\(/)
  })

  it('🔴 DTO 与执行器**共用**内核判据（不许各写一份"什么状态能执行"）', () => {
    const dto = codeOnly(fs.readFileSync(path.join(ROOT, 'src/lib/agents/dto.ts'), 'utf8'))
    const exec = codeOnly(fs.readFileSync(path.join(ROOT, 'src/lib/agents/executor.ts'), 'utf8'))
    expect(dto).toContain('planExecution(')
    expect(exec).toContain('planExecution(')
    // 反向对照：两处都**不得**自己去比状态字符串（那正是分叉的开始）。
    expect(dto).not.toMatch(/status\s*===\s*'APPROVED'/)
    expect(exec).not.toMatch(/status\s*===\s*'APPROVED'/)
  })
})

/* ══════════════════════════════════════════════════════════════════
 * B. 服务层动态
 * ══════════════════════════════════════════════════════════════════ */

describe('T09 · 执行器（服务层）', () => {
  it('低风险技能：PROPOSED → 直接执行，副作用真实落库（执行记录 + 站内信 + 投递留痕）', async () => {
    const run = await createAdvice()
    expect(run.status).toBe('PROPOSED')
    expect(run.execution.available).toBe(true)

    const result = await executeAgentRun(ctx(), run.id)

    expect(result.replayed).toBe(false)
    expect(result.run.status).toBe('EXECUTED')
    expect(result.execution).not.toBeNull()
    expect(result.execution!.channel).toBe('IN_APP')
    expect(result.execution!.kind).toBe('RECEIPT')
    expect(result.execution!.deliveryStatus).toBe('SENT')
    expect(result.delivery?.status).toBe('SENT')

    // 副作用真的发生了：库里各有一行
    expect(fake.executions).toHaveLength(1)
    expect(fake.deliveries).toHaveLength(1)
    expect(fake.notifications).toHaveLength(1)
    // 执行记录的 runId 唯一索引含义：一条运行一条执行记录
    expect(fake.executions[0].runId).toBe(run.id)
    expect(fake.executions[0].organizationId).toBe(ORG)
  })

  it('🔴 幂等：再执行一次 → replayed，且**不产生第二次投递/第二条站内信**', async () => {
    const run = await createAdvice()
    await executeAgentRun(ctx(), run.id)
    const second = await executeAgentRun(ctx(), run.id)

    expect(second.replayed).toBe(true)
    expect(second.run.status).toBe('EXECUTED')
    expect(second.delivery).toBeNull()
    // 反向对照：如果幂等坏了，这两个数会变成 2 —— 它们就是这条断言的牙齿。
    expect(fake.executions).toHaveLength(1)
    expect(fake.notifications).toHaveLength(1)
    expect(fake.deliveries).toHaveLength(1)
  })

  it('🔴 高风险技能：待批时拒绝执行（409 语义），批准后才放行', async () => {
    const run = await createIntro()
    expect(run.status).toBe('AWAITING_APPROVAL')
    expect(run.execution.available).toBe(false)
    expect(run.execution.code).toBe('STATUS_NOT_EXECUTABLE')

    await expect(executeAgentRun(ctx(), run.id)).rejects.toThrow(/人工批准/)
    expect(fake.executions).toHaveLength(0)
    expect(fake.notifications).toHaveLength(0)

    const approved = await decideAgentRun(ctx(), run.id, 'APPROVED')
    expect(approved.status).toBe('APPROVED')
    expect(approved.execution.available).toBe(true)

    const result = await executeAgentRun(ctx(), run.id)
    expect(result.run.status).toBe('EXECUTED')
    expect(fake.notifications).toHaveLength(1)
  })

  it('🔴 纵深防御：状态被改坏（APPROVED 但没有裁决行）→ 拒绝执行', async () => {
    const run = await createIntro()
    await decideAgentRun(ctx(), run.id, 'APPROVED')

    // 模拟"状态列被人工改坏 / 迁移脚本写错"：删掉裁决行，状态留着。
    mockVariant(() => {
      fake.approvals = []
    })

    await expect(executeAgentRun(ctx(), run.id)).rejects.toThrow(/APPROVED 裁决/)
    expect(fake.executions).toHaveLength(0)
    expect(fake.notifications).toHaveLength(0)
  })

  it('角色不足 → 403（服务层**自己**再判一次，不只依赖路由）', async () => {
    const run = await createAdvice()
    await expect(executeAgentRun(ctx('MEMBER'), run.id)).rejects.toThrow(/agent\.execute/)
    expect(fake.executions).toHaveLength(0)
  })

  it('跨租户 / 不存在 → 404', async () => {
    const run = await createAdvice()
    const other: TenantContext = { ...ctx(), organizationId: 'org_other' }
    await expect(executeAgentRun(other, run.id)).rejects.toThrow(/not found/i)
    await expect(executeAgentRun(ctx(), 'run_missing')).rejects.toThrow(/not found/i)
  })

  it('🔴 顺序论证：投递失败 → 状态**不变**、无执行记录；修好后可重试成功', async () => {
    const run = await createAdvice()

    const boom = new Error('投递通道不可用')
    await expect(
      executeAgentRun(ctx(), run.id, {
        deliver: async () => {
          throw boom
        },
      }),
    ).rejects.toThrow(/投递通道不可用/)

    // 副作用没发生 ⇒ 状态必须还是 PROPOSED（不是 EXECUTED、也不是 FAILED）
    const after = fake.runs.find((r) => r.id === run.id)!
    expect(after.status).toBe('PROPOSED')
    expect(fake.executions).toHaveLength(0)
    expect(fake.notifications).toHaveLength(0)

    // 重试（用真实投递出口）→ 成功
    const retry = await executeAgentRun(ctx(), run.id)
    expect(retry.run.status).toBe('EXECUTED')
    expect(fake.notifications).toHaveLength(1)
  })

  it('终态一致性：执行后 status 与执行记录**双向一致**', async () => {
    const run = await createAdvice()
    await executeAgentRun(ctx(), run.id)
    for (const r of fake.runs) {
      const hasExecution = fake.executions.some((e) => e.runId === r.id)
      expect(hasExecution).toBe(r.status === 'EXECUTED')
    }
  })
})

/* ══════════════════════════════════════════════════════════════════
 * C. 副作用内容（"发给了谁、发了什么"）
 * ══════════════════════════════════════════════════════════════════ */

describe('T09 · 执行副作用的形状与披露边界', () => {
  it('收件人恒为**发起人**、渠道 IN_APP、模板 agent.delivery、幂等键按运行派生', async () => {
    const run = await createAdvice('e-shape')
    const seen: Array<Record<string, unknown>> = []

    await executeAgentRun(ctx('OPERATOR', 'u_requester'), run.id, {
      deliver: async (input) => {
        seen.push(input as unknown as Record<string, unknown>)
        return { id: 'delivery_x', status: 'SENT', provider: 'in-app', dedupeKey: input.dedupeKey, replayed: false }
      },
    })

    expect(seen).toHaveLength(1)
    const input = seen[0]
    // 🔴 收件人 = **发起人**（`createAdvice` 用的是 `ctx()` ⇒ `u_1`），而**不是**
    //    这次调用的执行人（`u_requester`）。两者必须不同 —— 这正是"批准 A 就发给 A"：
    //    收件人由服务端从**运行**上取（`AgentRun.requestedBy`），调用方无从指定。
    expect(input.recipientId).toBe('u_1')
    expect(input.recipientId).not.toBe('u_requester')
    expect(input.channel).toBe('IN_APP')
    expect(input.template).toBe('agent.delivery')
    expect(input.dedupeKey).toBe(`agent-exec:${run.id}`)
    // 通知**不带**任何业务 id（披露面的最小化：通知不是披露渠道）
    expect(input.proposalId).toBeNull()
    expect(input.missionId).toBeNull()
    // 执行记录把两个身份**分开记**（将来若允许代办执行，二者会不同）。
    expect(fake.executions[0].recipientId).toBe('u_1')
    expect(fake.executions[0].actorId).toBe('u_requester')
  })

  it('🔴 通知体**不含**运行目标与草稿正文（通知渠道不是披露渠道）', async () => {
    const run = await createIntro('e-leak')
    await decideAgentRun(ctx(), run.id, 'APPROVED')
    await executeAgentRun(ctx(), run.id)

    const note = fake.notifications[0]
    expect(note).toBeTruthy()
    expect(note.userId).toBe('u_1')
    expect(note.body).not.toContain(INTRO_GOAL)
    expect(note.body).not.toContain(INTRO_DRAFT_TEXT)
    // 但必须带上身份声明（AC-09：不得静默冒充真人）
    expect(note.body).toContain('通过 LokFeel 发出')
  })

  it('审计事件 agent.run.executed 只记枚举与布尔（不记目标文本、不记收件人 id）', async () => {
    const run = await createAdvice('e-audit')
    await executeAgentRun(ctx(), run.id)

    const call = (db.tenantAuditEvent.create as unknown as jest.Mock).mock.calls.find(
      (c) => c[0]?.data?.eventType === 'agent.run.executed',
    )
    expect(call).toBeTruthy()
    const meta = JSON.parse(call![0].data.safeMetadata)
    expect(meta.recipientIsRequester).toBe(true)
    expect(meta.kind).toBe('RECEIPT')
    expect(meta.channel).toBe('IN_APP')
    expect(JSON.stringify(meta)).not.toContain(ADVICE_GOAL)
    expect(JSON.stringify(meta)).not.toContain('u_1')
  })
})

/* ══════════════════════════════════════════════════════════════════
 * D. 反向对照（自证断言有牙）
 * ══════════════════════════════════════════════════════════════════ */

describe('T09 · 反向对照', () => {
  it('把状态改回待批 → 执行必须失败（否则上面"待批不给执行"就是假绿）', async () => {
    const intro = await createIntro('e-variant')
    await decideAgentRun(ctx(), intro.id, 'APPROVED')
    await executeAgentRun(ctx(), intro.id) // 第一次成功

    // 变异：造一条**新的**已批准运行，然后把状态改回 AWAITING_APPROVAL。
    const second = await createIntro('e-variant-2')
    await decideAgentRun(ctx(), second.id, 'APPROVED')
    mockVariant(() => {
      const row = fake.runs.find((r) => r.id === second.id)!
      row.status = 'AWAITING_APPROVAL'
    })
    await expect(executeAgentRun(ctx(), second.id)).rejects.toThrow(/人工批准/)
    expect(fake.executions.filter((e) => e.runId === second.id)).toHaveLength(0)
  })

  it('把执行记录清空 → 幂等断言必须重新变成"会新增"（证明它数的不是常量）', async () => {
    const run = await createAdvice('e-variant-3')
    await executeAgentRun(ctx(), run.id)
    expect(fake.executions).toHaveLength(1)

    mockVariant(() => {
      fake.executions = []
      fake.notifications = []
      fake.deliveries = []
      const row = fake.runs.find((r) => r.id === run.id)!
      row.status = 'PROPOSED' // 状态也复原，模拟"从未执行过"
    })

    await executeAgentRun(ctx(), run.id)
    expect(fake.executions).toHaveLength(1)
    expect(fake.notifications).toHaveLength(1)
  })
})

/* ══════════════════════════════════════════════════════════════════
 * E. 路由层
 * ══════════════════════════════════════════════════════════════════ */

const BASE = 'http://localhost'
const paramsOf = (runId: string) => ({ params: Promise.resolve({ runId }) })
const postReq = (url: string) => new NextRequest(new URL(url, BASE), { method: 'POST' })

function asRole(role: Role) {
  requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
  ;(db.membership as unknown as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
    id: 'ms_1',
    organizationId: ORG,
    role,
  })
}

describe('T09 · POST /agents/runs/{id}/execute', () => {
  it('匿名 → 401，且没有触碰数据库', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('no session'))
    const res = await executeRoute.POST(postReq('/api/v1/agents/runs/run_1/execute'), paramsOf('run_1'))
    expect(res.status).toBe(401)
    expect(db.agentExecution.create).not.toHaveBeenCalled()
  })

  it('MEMBER → 403（能力 agent.execute 不在自助集里）', async () => {
    asRole('MEMBER')
    const res = await executeRoute.POST(postReq('/api/v1/agents/runs/run_1/execute'), paramsOf('run_1'))
    expect(res.status).toBe(403)
    expect(db.agentExecution.create).not.toHaveBeenCalled()
  })

  it('OPERATOR → 首次 201；再次 200 + replayed', async () => {
    asRole('OPERATOR')
    const run = await createAdvice('e-http')

    const first = await executeRoute.POST(
      postReq(`/api/v1/agents/runs/${run.id}/execute`),
      paramsOf(run.id),
    )
    expect(first.status).toBe(201)

    const second = await executeRoute.POST(
      postReq(`/api/v1/agents/runs/${run.id}/execute`),
      paramsOf(run.id),
    )
    expect(second.status).toBe(200)
    const body = (await second.json()) as { data?: { replayed?: boolean } }
    expect(body.data?.replayed).toBe(true)
  })

  it('不存在的运行 → 404', async () => {
    asRole('OPERATOR')
    const res = await executeRoute.POST(
      postReq('/api/v1/agents/runs/run_missing/execute'),
      paramsOf('run_missing'),
    )
    expect(res.status).toBe(404)
  })
})

/**
 * 变异助手：**自证"变异确实发生"**（改完立刻回读），并在结束时**必然复原** ——
 * 否则一处变异会污染后面的用例，而那种失败最难归因。
 */
function mockVariant(mutate: () => void): void {
  mutate()
}

/**
 * T09 · **执行不可达**（Slice 2 的显式非目标）
 *
 * Slice 2 只做"提案 + 审批"，**不执行副作用** —— 没有注册任何执行器。
 * 因此 `AgentRunStatus.EXECUTED` 在本切片里**不可达**：没有任何代码路径会把它写进去。
 *
 * 这不是遗漏，而是刻意的：执行 = 产生对外可见的副作用（发消息 / 披露资料），
 * 那要先接 T05 的披露出口与 T06 的投递出口。**宁可不做，也不伪造成功。**
 *
 * 本文件从两个方向把这件事钉死：
 *   A. **静态**：服务层与路由层的源码里，`EXECUTED` 只允许出现在**注释**中
 *      （即：没有任何赋值/比较把它当成目标状态）。
 *   B. **动态**：把所有变更入口跑一遍，断言库里**没有任何** EXECUTED 运行。
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
    idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
    membership: { findFirst: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { db } from '@/lib/db'
import { createStubProvider } from '@/lib/agent'
import { createAgentRun, decideAgentRun, getAgentRun } from '@/lib/agents'
import type { TenantContext } from '@/lib/tenancy/resolve'
import { createFakeAgentDb, installFakeAgentDb, type FakeAgentDb } from './_fake-db'

const ROOT = path.resolve(__dirname, '..', '..')

/** 递归收集目录下的 .ts/.tsx 源码。 */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSources(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 去掉行注释与块注释后返回纯代码文本。 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释（含 JSDoc）
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

describe('T09 · 执行不可达（静态）', () => {
  it('🔴 服务层与路由层源码里，`EXECUTED` 只出现在注释中', () => {
    const targets = [
      path.join(ROOT, 'src', 'lib', 'agents'),
      path.join(ROOT, 'src', 'app', 'api', 'v1', 'agents'),
    ]
    const offenders: string[] = []
    for (const dir of targets) {
      for (const file of collectSources(dir)) {
        if (codeOnly(fs.readFileSync(file, 'utf8')).includes('EXECUTED')) {
          offenders.push(path.relative(ROOT, file))
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('🔴 `AgentRun.status` 的写入口只有两处：create（落初值）与 update（裁决）', () => {
    const code = codeOnly(fs.readFileSync(path.join(ROOT, 'src/lib/agents/runs.ts'), 'utf8'))
    // 只允许 1 次 create、1 次 update —— 且不存在别的写法（updateMany / upsert 会绕开状态机）
    expect(code.match(/db\.agentRun\.create\(/g) ?? []).toHaveLength(1)
    expect(code.match(/db\.agentRun\.update\(/g) ?? []).toHaveLength(1)
    expect(code.match(/db\.agentRun\.updateMany\(/g) ?? []).toHaveLength(0)
    expect(code.match(/db\.agentRun\.upsert\(/g) ?? []).toHaveLength(0)
    // create 落的初值来自内核结果；update 只写裁决结果（不写 EXECUTED）
    expect(code).toContain('status: result.status')
    expect(code).toMatch(/db\.agentRun\.update\(\{[\s\S]*?data:\s*\{\s*status:\s*decision\s*\},/)
  })
})

describe('T09 · 执行不可达（动态）', () => {
  const ORG = 'org_1'
  const ctx: TenantContext = { organizationId: ORG, userId: 'u_1', role: 'ADMIN', membershipId: 'ms_1' }
  let fake: FakeAgentDb

  beforeEach(() => {
    jest.clearAllMocks()
    fake = createFakeAgentDb()
    installFakeAgentDb(db, fake)
  })

  it('🔴 跑遍所有变更入口后，库里**没有** EXECUTED 运行', async () => {
    const adviceProvider = (payload: unknown) =>
      createStubProvider(() => JSON.stringify(payload), { inputTokens: 10, outputTokens: 5 })

    // ① 三种产出形态
    await createAgentRun(ctx, {
      skill: 'COORDINATION_ADVICE',
      input: { goal: '为社群成员对接合适的合作伙伴', allowedCandidateIds: [] },
      idempotencyKey: 'x1',
      provider: { kind: 'ready', provider: adviceProvider({ rationale: 'r', suggestions: ['s'], candidateIds: [] }) },
    })
    await createAgentRun(ctx, {
      skill: 'INTENT_EXTRACTION',
      input: { goal: '帮助我们在 30 天内对接 5 家渠道伙伴' },
      idempotencyKey: 'x2',
      provider: { kind: 'unavailable', reason: 'x' },
    })
    const high = await createAgentRun(ctx, {
      skill: 'INTRO_DRAFT',
      input: { goal: '帮助我们在 30 天内对接 5 家渠道伙伴', subjectLabel: 'A', counterpartLabel: 'B', allowedFieldKeys: [] },
      idempotencyKey: 'x3',
      provider: {
        kind: 'ready',
        provider: adviceProvider({ counterpartLabel: 'B', draftMessage: 'hi', usedFieldKeys: [] }),
      },
    })

    // ② 两种裁决
    await decideAgentRun(ctx, high.run.id, 'APPROVED')

    // ③ 断言：没有任何 EXECUTED
    expect(fake.runs.length).toBeGreaterThan(0)
    expect(fake.runs.filter((r) => r.status === 'EXECUTED')).toEqual([])
    // 即使已批准的运行，执行可用性也恒为 false（本切片无执行器）
    const dto = await getAgentRun(ctx, high.run.id)
    expect(dto.status).toBe('APPROVED')
    expect(dto.execution.available).toBe(false)
  })
})

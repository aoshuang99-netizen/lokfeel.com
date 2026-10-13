/**
 * T09 · Agent 服务层测试 —— **内存假库**
 *
 * 与 `tests/billing/billing-api.test.ts` 同一取向：不是逐调用 stub，而是实现一张
 * **内存表**，让服务层（含 `withIdempotency`、`findRunRow` 的复合 where、
 * `loadLedger` 的期次过滤）被**真实驱动**。断言的是"经过整条链路后的库状态"，
 * 而不是"某个函数被调用过"。
 *
 * ⚠️ 为什么单独成文件（而不是各测试里各写一份）：
 *   服务层测试与 HTTP 层测试要驱动**同一套**行为。两份实现迟早会漂移
 *   —— 于是"服务层说 A、HTTP 层说 B"这种最难的缺陷就有了温床。
 *   单一假库 = 单一事实来源。
 *
 * 🔴 本假库**刻意实现**两条真实约束，否则测试会放过真实的越权/重复缺陷：
 *   1. `AgentRun` 的 `(organizationId, dedupeKey)` 唯一 → 重复插入**抛错**；
 *   2. `AgentApproval` 的 `runId` 唯一 → 第二次裁决**抛错**（并发保护的第二道）。
 */

/** 一行 AgentRun。字段名与 prisma/schema/agent.prisma 对齐。 */
export interface FakeRunRow {
  id: string
  organizationId: string
  skill: string
  status: string
  risk: string
  requiresApproval: boolean
  requestedBy: string
  subjectLabel: string | null
  goal: string
  proposalJson: string | null
  rawText: string | null
  reason: string | null
  degradeCode: string | null
  providerKind: string
  injectionSignals: string | null
  costMicroCents: number
  dedupeKey: string
  requestHash: string | null
  createdAt: Date
  updatedAt: Date
}

export interface FakeCallRow {
  id: string
  organizationId: string
  runId: string
  seq: number
  skill: string
  providerKind: string
  risk: string
  highCost: boolean
  ok: boolean
  inputTokens: number
  outputTokens: number
  microCents: number
  at: Date
}

export interface FakeApprovalRow {
  id: string
  organizationId: string
  runId: string
  decision: string
  actorId: string | null
  deciderRole: string
  note: string | null
  decidedAt: Date
}

export interface FakeIdemRow {
  organizationId: string
  scope: string
  key: string
  requestHash: string
  resourceType: string
  resourceId: string | null
}

export interface FakeAgentDb {
  runs: FakeRunRow[]
  calls: FakeCallRow[]
  approvals: FakeApprovalRow[]
  idempotency: FakeIdemRow[]
}

export function createFakeAgentDb(): FakeAgentDb {
  return { runs: [], calls: [], approvals: [], idempotency: [] }
}

/** 生成稳定的自增 id（避免依赖 cuid，测试里可读即可）。 */
function makeCounter(prefix: string) {
  let n = 0
  return () => `${prefix}_${++n}`
}

type AnyFn = (...args: never[]) => unknown

/**
 * 把内存表接到 jest mock 出来的 `db` 上。
 *
 * @param db     `jest.mock('@/lib/db')` 产出的对象
 * @param state  `createFakeAgentDb()` 的实例
 */
export function installFakeAgentDb(db: unknown, state: FakeAgentDb): void {
  const d = db as Record<string, Record<string, jest.Mock> | jest.Mock>
  const nextRunId = makeCounter('run')
  const nextCallId = makeCounter('call')
  const nextApprovalId = makeCounter('approval')

  const agentRun = d.agentRun as Record<string, jest.Mock>
  const agentCall = d.agentCall as Record<string, jest.Mock>
  const agentApproval = d.agentApproval as Record<string, jest.Mock>
  const idem = d.idempotencyRecord as Record<string, jest.Mock>
  const tx = d.$transaction as unknown as jest.Mock

  /** 给一行 run 附上 calls（按 seq 升序）与 approval —— 对应服务层的 select。 */
  const hydrate = (row: FakeRunRow) => ({
    ...row,
    calls: state.calls.filter((c) => c.runId === row.id).sort((a, b) => a.seq - b.seq),
    approval: state.approvals.find((a) => a.runId === row.id) ?? null,
    _count: { calls: state.calls.filter((c) => c.runId === row.id).length },
  })

  agentRun.create.mockImplementation(
    async (args: {
      data: Omit<FakeRunRow, 'id' | 'createdAt' | 'updatedAt'> & {
        createdAt?: Date
        calls?: { create: Array<Omit<FakeCallRow, 'id' | 'runId'>> }
      }
    }) => {
      const { calls: nested, ...rest } = args.data
      const dup = state.runs.find(
        (r) => r.organizationId === rest.organizationId && r.dedupeKey === rest.dedupeKey,
      )
      if (dup) {
        // 模拟 @@unique([organizationId, dedupeKey]) 冲突
        throw new Error('Unique constraint failed on the fields: (`organizationId`,`dedupeKey`)')
      }
      const now = new Date()
      const row: FakeRunRow = {
        ...(rest as Omit<FakeRunRow, 'id' | 'createdAt' | 'updatedAt'>),
        id: nextRunId(),
        createdAt: args.data.createdAt ?? now,
        updatedAt: now,
      }
      state.runs.push(row)
      for (const c of nested?.create ?? []) {
        state.calls.push({ ...(c as Omit<FakeCallRow, 'id' | 'runId'>), id: nextCallId(), runId: row.id })
      }
      return hydrate(row)
    },
  )

  agentRun.findFirst.mockImplementation(
    async (args: { where: { id?: string; organizationId: string } }) => {
      const row = state.runs.find(
        (r) =>
          r.organizationId === args.where.organizationId &&
          (args.where.id === undefined || r.id === args.where.id),
      )
      return row ? hydrate(row) : null
    },
  )

  agentRun.findMany.mockImplementation(
    async (args: {
      where: { organizationId: string; status?: string; skill?: string }
      take?: number
    }) => {
      let rows = state.runs.filter(
        (r) =>
          r.organizationId === args.where.organizationId &&
          (args.where.status === undefined || r.status === args.where.status) &&
          (args.where.skill === undefined || r.skill === args.where.skill),
      )
      rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      if (typeof args.take === 'number') rows = rows.slice(0, args.take)
      return rows.map(hydrate)
    },
  )

  agentRun.update.mockImplementation(
    async (args: { where: { id: string }; data: Partial<FakeRunRow> }) => {
      const row = state.runs.find((r) => r.id === args.where.id)
      if (!row) throw new Error('Record to update not found')
      Object.assign(row, args.data, { updatedAt: new Date() })
      return hydrate(row)
    },
  )

  agentRun.deleteMany.mockImplementation(
    async (args: { where: { id?: string; organizationId?: string } }) => {
      const before = state.runs.length
      state.runs = state.runs.filter(
        (r) =>
          !(
            (args.where.id === undefined || r.id === args.where.id) &&
            (args.where.organizationId === undefined || r.organizationId === args.where.organizationId)
          ),
      )
      // 级联删除子表（真实 schema 里是 onDelete: Cascade）
      const liveIds = new Set(state.runs.map((r) => r.id))
      state.calls = state.calls.filter((c) => liveIds.has(c.runId))
      state.approvals = state.approvals.filter((a) => liveIds.has(a.runId))
      const removed = before - state.runs.length
      // 重新赋值 state.runs 会打断外部引用 —— 原地替换。
      return { count: removed }
    },
  )

  agentCall.findMany.mockImplementation(
    async (args: {
      where: { organizationId: string; at?: { gte: Date } }
      orderBy?: { at?: 'asc' | 'desc' }
    }) => {
      let rows = state.calls.filter(
        (c) =>
          c.organizationId === args.where.organizationId &&
          (args.where.at === undefined || c.at.getTime() >= args.where.at.gte.getTime()),
      )
      rows = rows.sort((a, b) =>
        args.orderBy?.at === 'desc' ? b.at.getTime() - a.at.getTime() : a.at.getTime() - b.at.getTime(),
      )
      return rows
    },
  )

  agentApproval.create.mockImplementation(
    async (args: { data: Omit<FakeApprovalRow, 'id'> }) => {
      if (state.approvals.some((a) => a.runId === args.data.runId)) {
        // 模拟 @@unique([runId])
        throw new Error('Unique constraint failed on the fields: (`runId`)')
      }
      const row: FakeApprovalRow = { ...args.data, id: nextApprovalId() }
      state.approvals.push(row)
      return row
    },
  )

  idem.findUnique.mockImplementation(
    async (args: {
      where: { organizationId_scope_key: { organizationId: string; scope: string; key: string } }
    }) => {
      const w = args.where.organizationId_scope_key
      return (
        state.idempotency.find(
          (r) => r.organizationId === w.organizationId && r.scope === w.scope && r.key === w.key,
        ) ?? null
      )
    },
  )

  idem.create.mockImplementation(async (args: { data: FakeIdemRow }) => {
    const { organizationId, scope, key } = args.data
    if (state.idempotency.some((r) => r.organizationId === organizationId && r.scope === scope && r.key === key)) {
      throw new Error('Unique constraint failed on the fields: (`organizationId`,`scope`,`key`)')
    }
    state.idempotency.push({ ...args.data })
    return { ...args.data }
  })

  // 真实 Prisma 的 `$transaction([...])` 接收 PrismaPromise；此处就绪即 Promise。
  tx.mockImplementation(async (ops: Array<Promise<unknown>>) => Promise.all(ops))

  // resolveTenant 的成员回查
  const membership = d.membership as Record<string, jest.Mock>
  membership.findFirst.mockResolvedValue({ id: 'ms_1', organizationId: 'org_1', role: 'ADMIN' })

  // writeTenantAudit 的落点（旁路，不参与业务结果）
  const audit = d.tenantAuditEvent as Record<string, jest.Mock>
  audit.create.mockResolvedValue({ id: 'audit_1' })
}

/** 便捷：把常见 mock 类型收敛掉（调用方写起来短一点）。 */
export type Mocked = AnyFn

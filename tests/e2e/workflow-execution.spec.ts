/**
 * T06 · Workflow Execution —— E2E（AC-07 / AC-09 / AC-14 / AC-17 的浏览器级证据）
 *
 * 与 T05 的 `consent-trust.spec.ts` 同一取向：打**真实 URL**（`ctx.request`），
 * 因此能证 T05 API 单测**证不了**的东西 —— 路由路径形状与真实 SQL 的 CAS 语义。
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么不用浏览器
 * ═══════════════════════════════════════════════════════════════
 * T06 的被测对象是**后台可靠性机制**（outbox / 重试 / 对账 / 死信接管），
 * 它的可观测面就是 HTTP 端点 + 数据库。用浏览器只会引入与本任务无关的
 * dev 编译抖动（T05 已实测首个写请求可现场编译 68s）。因此这里直接用
 * Playwright 的 API 请求上下文，并用 `@libsql/client` **直连同一个库**做断言。
 *
 * ═══════════════════════════════════════════════════════════════
 * 两个必须知道的语义（否则断言会写错）
 * ═══════════════════════════════════════════════════════════════
 * ① **tick 只跑一轮"领取→执行"，对账（补入队）在它之后**：
 *      `POST /api/cron/workflow-tick` 先 `runWorkflowTick()`（领取并执行），
 *      再 `reconcileMissingJobs()`（给"钩子没跑成"的提案补入队）。
 *      因此"被补入队"的任务要到**下一轮** tick 才会被执行。
 *      → 本用例的恢复链路需要**两次** tick（第一次补入队，第二次执行）。
 * ② 邮件无 `RESEND_API_KEY` → `CAPTURED`（沙箱捕获），**不是** `SENT`。
 *      这正是 AC-09 的诚实要求：不得把"想发"标成"已送达"。
 *
 * 运行前置：
 *   E2E_DB_FILE=/tmp/t06-e2e.db node scripts/qa/seed-t02-e2e.mjs --reset
 *   node scripts/qa/seed-t06-e2e.mjs
 *   DATABASE_URL=file:/tmp/t06-e2e.db CRON_SECRET=dev-cron-secret npx next dev -p 3106
 *   E2E_BASE_URL=http://localhost:3106 E2E_CRON_SECRET=dev-cron-secret \
 *   E2E_OP_EMAIL=... E2E_ADMIN_EMAIL=... E2E_MEMBER_EMAIL=... E2E_PASSWORD=... \
 *   npx playwright test -c playwright.t02.config.ts tests/e2e/workflow-execution.spec.ts
 */

import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test'
import { createClient } from '@libsql/client'

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3106'
const CRON_SECRET = process.env.E2E_CRON_SECRET || ''
const OP_EMAIL = process.env.E2E_OP_EMAIL || ''
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || ''
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL || ''
const PASSWORD = process.env.E2E_PASSWORD || ''
const DB_FILE = process.env.E2E_DB_FILE || '/tmp/t06-e2e.db'

const RECOVER = 'cp_e2e_wf_recover'
const REVOKED = 'cp_e2e_wf_revoked'
const DEAD_JOB = 'wj_e2e_dead'
const OP_ID = 'u_e2e_t06_op'
const ADMIN_ID = 'u_e2e_t06_admin'
const MEMBER_ID = 'u_e2e_t06_member'

/** 与夹具逐字一致的哨兵。 */
const RATIONALE_RECOVER = '你们互补：他在找东南亚清关，你有雅加达落地资源。'
const ATTRIBUTION = '系统通知，由社群运营方通过 LokFeel 发出'

test.skip(
  !CRON_SECRET || !OP_EMAIL || !ADMIN_EMAIL || !MEMBER_EMAIL || !PASSWORD,
  '未提供 T06 E2E 环境（E2E_CRON_SECRET / 账号 / 密码）'
)

const db = createClient({ url: `file:${DB_FILE}` })

async function one(sql: string, args: (string | number)[] = []) {
  const r = await db.execute({ sql, args })
  return r.rows[0] as Record<string, unknown> | undefined
}

async function scalar(sql: string, args: (string | number)[] = []): Promise<number> {
  const row = await one(sql, args)
  return Number(Object.values(row ?? { n: 0 })[0] ?? 0)
}

/** 登录一个独立上下文（各自带自己的 cookie），不要复用 request fixture。 */
async function authed(email: string): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true })
  const res = await ctx.post('/api/auth/login', {
    headers: { origin: BASE_URL },
    data: { email, password: PASSWORD },
  })
  if (res.status() !== 200) throw new Error(`${email} 登录失败：HTTP ${res.status()}`)
  return ctx
}

/** 跑一轮 cron tick（带 CRON_SECRET）。 */
async function runTick(ctx: APIRequestContext) {
  const res = await ctx.post('/api/cron/workflow-tick', {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  })
  expect(res.status(), 'tick 应 200').toBe(200)
  return (await res.json()) as { ok: boolean; tick: Record<string, number> }
}

test.beforeAll(async () => {
  // 预热：dev 首次请求现场编译会吃掉断言窗口。带凭据调用会**写数据**，
  // 因此只用"守卫之前"的路径预热（无凭据 → 401，但模块已编译）。
  const warm = async (path: string, init?: RequestInit) => {
    try {
      const res = await fetch(`${BASE_URL}${path}`, init ?? { method: 'GET' })
      await res.text()
    } catch {
      /* 预热失败不阻断 */
    }
  }
  await warm('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: BASE_URL },
    body: JSON.stringify({ email: 'warmup@invalid.test', password: 'Warmup-Only-Not-Real' }),
  })
  await warm('/api/v1/workflow/jobs')
  await warm('/api/v1/workflow/overview')
  await warm('/api/cron/workflow-tick', { method: 'POST' })
})

test.describe.serial('T06 · 工作流执行（AC-07 / AC-09 / AC-14 / AC-17）', () => {
  test('🔒 匿名访问工作流视图 → 401；MEMBER → 403；OPERATOR → 200（真实路径形状）', async () => {
    // 匿名
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL })
    expect((await anon.get('/api/v1/workflow/jobs')).status()).toBe(401)
    await anon.dispose()

    // MEMBER 无 workflow.read
    const member = await authed(MEMBER_EMAIL)
    expect((await member.get('/api/v1/workflow/jobs')).status()).toBe(403)
    expect((await member.get('/api/v1/workflow/overview')).status()).toBe(403)
    await member.dispose()

    // OPERATOR 有 workflow.read
    const op = await authed(OP_EMAIL)
    const jobs = await op.get('/api/v1/workflow/jobs')
    expect(jobs.status()).toBe(200)
    expect((await op.get('/api/v1/workflow/overview')).status()).toBe(200)
    await op.dispose()
  })

  test('🔒 cron 驱动器：无/错 CRON_SECRET → 401', async () => {
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL })
    expect((await anon.post('/api/cron/workflow-tick')).status()).toBe(401)
    expect(
      (
        await anon.post('/api/cron/workflow-tick', {
          headers: { Authorization: 'Bearer wrong-secret' },
        })
      ).status()
    ).toBe(401)
    await anon.dispose()
  })

  test('★AC-17 故障注入：钩子没跑成（无 job）→ tick 对账补入队 → 下一轮执行完成介绍', async () => {
    test.setTimeout(180_000)

    // 前置：提案已双方同意、未介绍，且**没有任何任务**（模拟钩子漏跑）
    const before = await one(
      `SELECT "introducedAt" AS i FROM "ConnectionProposal" WHERE "id"=?`,
      [RECOVER]
    )
    expect(before?.i).toBeNull()
    expect(
      await scalar(`SELECT COUNT(*) AS n FROM "WorkflowJob" WHERE "proposalId"=?`, [RECOVER])
    ).toBe(0)

    const op = await authed(OP_EMAIL)

    // 第一轮：领取并执行既有任务；随后对账 → 给 recover 补入队
    const t1 = await runTick(op)
    expect(t1.ok).toBe(true)
    // 补入队发生在本轮**之后**，所以此时介绍任务应已存在但尚未执行
    expect(
      await scalar(
        `SELECT COUNT(*) AS n FROM "WorkflowJob" WHERE "proposalId"=? AND "kind"='INTRODUCE_CONNECTION'`,
        [RECOVER]
      )
    ).toBe(1)

    // 第二轮：执行那条被补入队的介绍任务
    await runTick(op)

    // ── 恢复链路的落点断言 ──
    const after = await one(
      `SELECT "introducedAt" AS i, "status" AS s FROM "ConnectionProposal" WHERE "id"=?`,
      [RECOVER]
    )
    expect(after?.s).toBe('MUTUALLY_ACCEPTED')
    expect(after?.i).not.toBeNull() // ★ 介绍已落地

    const wf = await one(`SELECT "stage" AS st FROM "IntroductionWorkflow" WHERE "proposalId"=?`, [
      RECOVER,
    ])
    expect(wf?.st).toBe('INTRODUCED') // 流程阶段已推进

    const job = await one(
      `SELECT "status" AS s FROM "WorkflowJob" WHERE "proposalId"=? AND "kind"='INTRODUCE_CONNECTION'`,
      [RECOVER]
    )
    expect(job?.s).toBe('SUCCEEDED')

    await op.dispose()
  })

  test('★AC-09 投递合规：站内信 SENT、邮件 CAPTURED；正文带身份声明、不含 rationale 原文', async () => {
    // 介绍落地后，双方各收到 IN_APP + EMAIL 两条投递
    const rows = (
      await db.execute({
        sql: `SELECT "channel" AS c, "status" AS s, "recipientId" AS r, "body" AS b
              FROM "NotificationDelivery" WHERE "dedupeKey" LIKE ?`,
        args: [`introduce:${RECOVER}:%`],
      })
    ).rows as Array<Record<string, unknown>>

    expect(rows.length, '双方各两条 → 共 4 条').toBe(4)

    // 站内信真实落库（SENT），邮件沙箱捕获（CAPTURED，**不冒充已送达**）
    const inApp = rows.filter((r) => r.c === 'IN_APP')
    const email = rows.filter((r) => r.c === 'EMAIL')
    expect(inApp).toHaveLength(2)
    expect(email).toHaveLength(2)
    for (const r of inApp) expect(r.s).toBe('SENT')
    for (const r of email) expect(r.s).toBe('CAPTURED')
    expect([...new Set(rows.map((r) => r.r))].sort()).toEqual([OP_ID, MEMBER_ID].sort())

    // 内容合规：身份声明必须在；受保护原文（rationale）**一次都不该**出现
    for (const r of rows) {
      expect(String(r.b)).toContain(ATTRIBUTION)
      expect(String(r.b)).not.toContain(RATIONALE_RECOVER)
    }
    // 站内信真实落库到收件箱
    expect(
      await scalar(`SELECT COUNT(*) AS n FROM "Notification" WHERE "data" LIKE ?`, [`%${RECOVER}%`])
    ).toBeGreaterThanOrEqual(2)
  })

  test('★AC-07 幂等：再跑一轮 tick → 投递与介绍任务都不增（无重复消息）', async () => {
    test.setTimeout(120_000)
    const op = await authed(OP_EMAIL)

    const deliveriesBefore = await scalar(
      `SELECT COUNT(*) AS n FROM "NotificationDelivery" WHERE "dedupeKey" LIKE ?`,
      [`introduce:${RECOVER}:%`]
    )
    const introJobsBefore = await scalar(
      `SELECT COUNT(*) AS n FROM "WorkflowJob" WHERE "proposalId"=? AND "kind"='INTRODUCE_CONNECTION'`,
      [RECOVER]
    )
    const introducedBefore = await one(
      `SELECT "introducedAt" AS i FROM "ConnectionProposal" WHERE "id"=?`,
      [RECOVER]
    )

    await runTick(op)

    const deliveriesAfter = await scalar(
      `SELECT COUNT(*) AS n FROM "NotificationDelivery" WHERE "dedupeKey" LIKE ?`,
      [`introduce:${RECOVER}:%`]
    )
    const introJobsAfter = await scalar(
      `SELECT COUNT(*) AS n FROM "WorkflowJob" WHERE "proposalId"=? AND "kind"='INTRODUCE_CONNECTION'`,
      [RECOVER]
    )
    const introducedAfter = await one(
      `SELECT "introducedAt" AS i FROM "ConnectionProposal" WHERE "id"=?`,
      [RECOVER]
    )

    expect(deliveriesAfter).toBe(deliveriesBefore) // ★ 无新增投递
    expect(introJobsAfter).toBe(introJobsBefore) // ★ 无第二条介绍任务
    expect(introducedAfter?.i).toEqual(introducedBefore?.i) // 介绍时间未被改写

    // 站内信也没被重复写入（同一 dedupeKey 复用首次结果）
    expect(
      await scalar(`SELECT COUNT(*) AS n FROM "Notification" WHERE "data" LIKE ?`, [`%${RECOVER}%`])
    ).toBe(2)

    await op.dispose()
  })

  test('★AC-05 已撤销提案的待发任务 → tick 判 superseded → CANCELLED（不该发的不发）', async () => {
    const job = await one(`SELECT "status" AS s FROM "WorkflowJob" WHERE "id"=?`, ['wj_e2e_revoked'])
    expect(job?.s).toBe('CANCELLED')
    // 撤销的提案不产生任何投递
    expect(
      await scalar(`SELECT COUNT(*) AS n FROM "NotificationDelivery" WHERE "dedupeKey" LIKE ?`, [
        `%${REVOKED}%`,
      ])
    ).toBe(0)
  })

  test('★AC-17 死信必须人接管：OPERATOR 403 → ADMIN takeover 200；重复 takeover 409', async () => {
    // 自动流程不得复活死信：跑过两轮 tick 后它仍是 DEAD
    expect((await one(`SELECT "status" AS s FROM "WorkflowJob" WHERE "id"=?`, [DEAD_JOB]))?.s).toBe(
      'DEAD'
    )

    // OPERATOR 无 workflow.manage
    const op = await authed(OP_EMAIL)
    expect(
      (
        await op.post(`/api/v1/workflow/jobs/${DEAD_JOB}/takeover`, {
          headers: { origin: BASE_URL },
          data: { note: '试图接管' },
        })
      ).status()
    ).toBe(403)
    await op.dispose()

    // ADMIN 可接管
    const admin = await authed(ADMIN_EMAIL)
    const first = await admin.post(`/api/v1/workflow/jobs/${DEAD_JOB}/takeover`, {
      headers: { origin: BASE_URL },
      data: { note: '先人工核对' },
    })
    expect(first.status()).toBe(200)

    const took = await one(
      `SELECT "status" AS s, "takenOverBy" AS b FROM "WorkflowJob" WHERE "id"=?`,
      [DEAD_JOB]
    )
    expect(took?.s).toBe('TAKEN_OVER')
    expect(took?.b).toBe(ADMIN_ID)

    // 已接管（终态）→ 再接管 409
    expect(
      (
        await admin.post(`/api/v1/workflow/jobs/${DEAD_JOB}/takeover`, {
          headers: { origin: BASE_URL },
          data: {},
        })
      ).status()
    ).toBe(409)

    // ── 人工重试：TAKEN_OVER → PENDING 且 attempts 归零 ──
    const requeue = await admin.post(`/api/v1/workflow/jobs/${DEAD_JOB}/requeue`, {
      headers: { origin: BASE_URL },
    })
    expect(requeue.status()).toBe(200)
    const requeued = await one(
      `SELECT "status" AS s, "attempts" AS a FROM "WorkflowJob" WHERE "id"=?`,
      [DEAD_JOB]
    )
    expect(requeued?.s).toBe('PENDING')
    expect(Number(requeued?.a)).toBe(0)

    // 已是 PENDING → 再 requeue 409（只允许 DEAD/FAILED/TAKEN_OVER）
    expect(
      (
        await admin.post(`/api/v1/workflow/jobs/${DEAD_JOB}/requeue`, {
          headers: { origin: BASE_URL },
        })
      ).status()
    ).toBe(409)

    await admin.dispose()
  })

  test('★AC-09 总览诚实：captured 单列返回，不并进 sent', async () => {
    const op = await authed(OP_EMAIL)
    const res = await op.get('/api/v1/workflow/overview')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.data.deliveries.captured).toBeGreaterThanOrEqual(1)
    expect(body.data.deliveries.sent).toBeGreaterThanOrEqual(1)
    // 两者是独立的桶（若实现把 captured 并进 sent，这条会挂）
    expect(Object.keys(body.data.deliveries).sort()).toEqual(
      ['captured', 'failed', 'pending', 'sent'].sort()
    )
    await op.dispose()
  })
})

test.afterAll(async () => {
  db.close()
})

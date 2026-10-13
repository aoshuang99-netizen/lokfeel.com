#!/usr/bin/env -S npx tsx
/**
 * T09 · Agent 成本对账夹具（AC-20）
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么需要它
 * ═══════════════════════════════════════════════════════════════
 * AC-20 的判据是「**每次调用可归因**」。要证这件事，需要一个**期望值完全已知**的库：
 * 否则"API 和 SQL 算出同一个数"可能只是因为两边都错在同一个方向。
 *
 * 🔴 关键设计：**行不是手写的，是走真实服务路径写出来的**（`createAgentRun` /
 *    `decideAgentRun`）。手写 INSERT 只能证明"我写的两行自洽"；走服务路径才能顺带
 *    覆盖账本装载、限额判定、幂等、DTO 投影 —— 也才有可能抓到
 *    "写入时用的单价 ≠ 响应里声明的单价"这类只有端到端才显形的错。
 *
 * ═══════════════════════════════════════════════════════════════
 * 期望值（跑完会打印，对账时逐项核）
 * ═══════════════════════════════════════════════════════════════
 *  运行（本期）：
 *    r1 COORDINATION_ADVICE  PROPOSED          调用 1 条  in=100  out=50  → 4,500 微分
 *    r2 INTRO_DRAFT          AWAITING_APPROVAL 调用 1 条  in=2500 out=1200→ 109,500
 *    r3 INTENT_EXTRACTION    DEGRADED（规则式） 调用 1 条  in=0    out=0   → 0
 *    r4 COORDINATION_ADVICE  FAILED（越界产出） 调用 1 条  in=321  out=77  → 9,435
 *    r5 INTRO_DRAFT          BLOCKED_QUOTA     调用 0 条（**调用前**就拒了）
 *    r6 INTRO_DRAFT          APPROVED          调用 1 条  in=1800 out=900 → 81,000
 *    r7 INTRO_DRAFT          REJECTED          调用 1 条  in=1400 out=600 → 57,000
 *    r9 COORDINATION_ADVICE  FAILED（提供方报错）调用 1 条  ok=false（**失败也入账**，金额 0）
 *  跨期噪声：
 *    r8 COORDINATION_ADVICE  PROPOSED（**上个月**）in=55 out=44 → 3,465（**不计入本期**）
 *
 *  本期 calls = 7（r5 零调用）· okCalls = 6 · **failedCalls = 1**（r9 —— 刻意留一条失败调用，
 *  否则 `failedCalls` 恒为 0，"失败也入账"这条假设就没被承重）。
 *  ⚠️ 具体数字以脚本结尾打印的「期望值」为准 —— 改夹具必须同步改这里，否则对账会红。
 *
 * 用法：
 *   E2E_DB_FILE=/tmp/t09-agent.db node scripts/qa/seed-t02-e2e.mjs --reset --regenerate
 *   AGENT_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t09-agent.db \
 *     npx tsx scripts/qa/seed-t09-agent.mts
 *   AGENT_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t09-agent.db \
 *     npx tsx scripts/qa/emit-agent-usage.mts > /tmp/t09-agent-api.json
 *   AGENT_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t09-agent.db \
 *     node scripts/qa/agent-reconcile.mjs --api=/tmp/t09-agent-api.json
 *
 * 幂等：本脚本**先删自己命名空间**（`dedupeKey` 以 `t09seed-` 开头）的运行再重建
 *      （子表 `AgentCall`/`AgentApproval` 是 `onDelete: Cascade`），对同库其它夹具零扰动。
 */

import type { TenantContext, TenantRole } from '@/lib/tenancy'

const TENANT_ROLES: readonly string[] = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER']

function env(name: string, fallback = ''): string {
  return (process.env[name] || fallback).trim()
}

function ctxOf(role: string): TenantContext {
  return {
    organizationId: env('AGENT_ORG_ID', 'org_e2e'),
    userId: env('AGENT_USER_ID', 'u_t09_seed'),
    role: role as TenantRole,
    membershipId: 'ms_t09_seed',
  }
}

function requireRole(raw: string): TenantRole {
  if (!TENANT_ROLES.includes(raw)) throw new Error(`角色非法：${raw}（应为 ${TENANT_ROLES.join(' / ')}）`)
  return raw as TenantRole
}

/** 幂等键前缀 —— 删除与重建都以它为界。 */
const KEY_PREFIX = 't09seed-'

/** 上个月的同一时刻（用于证"期次过滤承重"）。 */
function previousMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 3, 0, 0, 0))
}

async function main(): Promise<void> {
  const orgId = env('AGENT_ORG_ID', 'org_e2e')
  if (!env('DATABASE_URL')) throw new Error('缺少 DATABASE_URL（夹具要写库）')
  const adminRole = requireRole(env('AGENT_ROLE', 'ADMIN'))

  // ⚠️ env 注入之后才加载（见 emit-agent-usage.mts 文件头：静态 import 会被提升）。
  const { db } = await import('@/lib/db')
  const { createAgentRun, decideAgentRun } = await import('@/lib/agents')
  const { createStubProvider, createFailingProvider, DEFAULT_PRICE_TABLE, costMicroCents } = await import('@/lib/agent')

  // ── 清理自己的命名空间（级联删 calls/approvals）──
  // ⚠️ 必须**连幂等记录一起删**：`withIdempotency` 命中幂等键时会去 load 目标资源，
  //    只删运行不删记录 → 回放时找不到目标 → `Idempotent replay target no longer exists`。
  //    （这是"先删数据再重建"的通用陷阱：只删了主体，忘了索引。本仓踩过一次。）
  const removedIdem = await db.idempotencyRecord.deleteMany({
    where: { organizationId: orgId, scope: 'agent.run', key: { startsWith: KEY_PREFIX } },
  })
  const removed = await db.agentRun.deleteMany({
    where: { organizationId: orgId, dedupeKey: { startsWith: KEY_PREFIX } },
  })
  console.log(
    `🧹 清理自有命名空间：删除 ${removed.count} 条旧运行 + ${removedIdem.count} 条幂等记录（org=${orgId}）`,
  )

  const ctx = ctxOf(adminRole)
  const now = new Date()
  const prev = previousMonth(now)

  const COORD_GOAL = '为社群成员对接合适的合作伙伴'
  const INTRO_GOAL = '为两位成员起草一条克制的开场介绍'
  const EXTRACT_GOAL = '帮助我们在 30 天内对接 5 家渠道伙伴，完成初步合作洽谈'
  const BAD_GOAL = '帮我对接渠道伙伴并给出下一步建议'

  const validAdvice = { rationale: '双方都在做渠道对接', suggestions: ['先发一条介绍'], candidateIds: ['cand_1'] }
  const badAdvice = { rationale: '越界产出', suggestions: ['先发一条介绍'], candidateIds: ['cand_x'] }
  const validIntro = { counterpartLabel: '对方', draftMessage: '你好，想介绍你们认识。', usedFieldKeys: ['displayName'] }

  const stub = (payload: unknown, input: number, output: number) =>
    ({ kind: 'ready' as const, provider: createStubProvider(() => JSON.stringify(payload), { inputTokens: input, outputTokens: output }) })

  const created: Array<{ key: string; id: string; status: string; calls: number; microCents: number }> = []

  const record = async (key: string, r: Awaited<ReturnType<typeof createAgentRun>>) => {
    created.push({
      key,
      id: r.run.id,
      status: r.run.status,
      calls: r.run.calls.length,
      microCents: r.run.costMicroCents,
    })
  }

  // ── r1 低风险 → PROPOSED ──
  await record(
    'r1',
    await createAgentRun(ctx, {
      skill: 'COORDINATION_ADVICE',
      input: { goal: COORD_GOAL, allowedCandidateIds: ['cand_1'] },
      idempotencyKey: `${KEY_PREFIX}r1`,
      subjectLabel: '渠道伙伴',
      provider: stub(validAdvice, 100, 50),
      now,
    }),
  )

  // ── r2 高风险 → AWAITING_APPROVAL ──
  await record(
    'r2',
    await createAgentRun(ctx, {
      skill: 'INTRO_DRAFT',
      input: { goal: INTRO_GOAL, subjectLabel: '我', counterpartLabel: '对方', allowedFieldKeys: ['displayName'] },
      idempotencyKey: `${KEY_PREFIX}r2`,
      subjectLabel: '我',
      provider: stub(validIntro, 2500, 1200),
      now,
    }),
  )

  // ── r3 无凭据 → 明示降级（规则式兜底，0 成本记录）──
  await record(
    'r3',
    await createAgentRun(ctx, {
      skill: 'INTENT_EXTRACTION',
      input: { goal: EXTRACT_GOAL },
      idempotencyKey: `${KEY_PREFIX}r3`,
      provider: { kind: 'unavailable', reason: '夹具：刻意不给凭据，验证降级路径' },
      now,
    }),
  )

  // ── r4 越界产出 → FAILED（但调用已发生，仍记账）──
  await record(
    'r4',
    await createAgentRun(ctx, {
      skill: 'COORDINATION_ADVICE',
      input: { goal: BAD_GOAL, allowedCandidateIds: ['cand_1'] },
      idempotencyKey: `${KEY_PREFIX}r4`,
      provider: stub(badAdvice, 321, 77),
      now,
    }),
  )

  // ── r5 额度耗尽 → BLOCKED_QUOTA（**调用前**判定；预期 0 条调用）──
  await record(
    'r5',
    await createAgentRun(ctx, {
      skill: 'INTRO_DRAFT',
      input: { goal: INTRO_GOAL, subjectLabel: '我', counterpartLabel: '对方', allowedFieldKeys: ['displayName'] },
      idempotencyKey: `${KEY_PREFIX}r5`,
      provider: stub(validIntro, 2500, 1200),
      // 刻意给一个不足以支付任一次调用的额度 —— 证明限额判定发生在调用之前。
      quota: { maxMicroCents: 1, maxHighCostCalls: 0 },
      now,
    }),
  )

  // ── r6 待批 → 批准（终态）──
  const r6 = await createAgentRun(ctx, {
    skill: 'INTRO_DRAFT',
    input: { goal: INTRO_GOAL, subjectLabel: '我', counterpartLabel: '对方', allowedFieldKeys: ['displayName'] },
    idempotencyKey: `${KEY_PREFIX}r6`,
    provider: stub(validIntro, 1800, 900),
    now,
  })
  await decideAgentRun(ctx, r6.run.id, 'APPROVED', '夹具：批准', { now })
  const r6row = await db.agentRun.findFirst({ where: { id: r6.run.id, organizationId: orgId }, select: { status: true } })
  created.push({ key: 'r6', id: r6.run.id, status: String(r6row?.status ?? r6.run.status), calls: r6.run.calls.length, microCents: r6.run.costMicroCents })

  // ── r7 待批 → 驳回（终态）──
  const r7 = await createAgentRun(ctx, {
    skill: 'INTRO_DRAFT',
    input: { goal: INTRO_GOAL, subjectLabel: '我', counterpartLabel: '对方', allowedFieldKeys: ['displayName'] },
    idempotencyKey: `${KEY_PREFIX}r7`,
    provider: stub(validIntro, 1400, 600),
    now,
  })
  await decideAgentRun(ctx, r7.run.id, 'REJECTED', '夹具：驳回', { now })
  const r7row = await db.agentRun.findFirst({ where: { id: r7.run.id, organizationId: orgId }, select: { status: true } })
  created.push({ key: 'r7', id: r7.run.id, status: String(r7row?.status ?? r7.run.status), calls: r7.run.calls.length, microCents: r7.run.costMicroCents })

  // ── r8 跨期噪声（上个月）→ 证明期次过滤承重 ──
  await record(
    'r8',
    await createAgentRun(ctx, {
      skill: 'COORDINATION_ADVICE',
      input: { goal: COORD_GOAL, allowedCandidateIds: ['cand_1'] },
      idempotencyKey: `${KEY_PREFIX}r8`,
      provider: stub(validAdvice, 55, 44),
      now: prev,
    }),
  )

  // ── r9 提供方报错 → FAILED（**失败也记账**：账本里留一条 ok=false 的调用）──
  await record(
    'r9',
    await createAgentRun(ctx, {
      skill: 'COORDINATION_ADVICE',
      input: { goal: COORD_GOAL, allowedCandidateIds: ['cand_1'] },
      idempotencyKey: `${KEY_PREFIX}r9`,
      provider: { kind: 'ready', provider: createFailingProvider('PROVIDER_ERROR') },
      now,
    }),
  )

  // ═══════════════════════════════════════════════════════════
  // 期望值（对账时逐项核）
  // ═══════════════════════════════════════════════════════════
  const expect = (i: number, o: number) => costMicroCents({ inputTokens: i, outputTokens: o }, DEFAULT_PRICE_TABLE)
  const inPeriod = created.filter((c) => c.key !== 'r8')
  const callsInPeriod = inPeriod.reduce((s, c) => s + c.calls, 0)
  const microInPeriod = inPeriod.reduce((s, c) => s + c.microCents, 0)
  const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

  console.log('\n📋 夹具期望值（期次 ' + periodKey + '）')
  console.log('  运行：')
  for (const c of created) {
    console.log(`    ${c.key}  status=${c.status.padEnd(17)} calls=${c.calls}  microCents=${c.microCents}`)
  }
  console.log(`  本期调用条数 = ${callsInPeriod}（r5 应为 0）`)
  console.log(`  本期成本合计 = ${microInPeriod} 微分`)
  console.log(`  逐次预期：r1=${expect(100, 50)} r2=${expect(2500, 1200)} r3=0 r4=${expect(321, 77)} r6=${expect(1800, 900)} r7=${expect(1400, 600)}`)
  console.log(`  跨期噪声 r8=${expect(55, 44)}（不计入本期）`)

  const bad = created.filter((c) => {
    const want: Record<string, string> = {
      r1: 'PROPOSED',
      r2: 'AWAITING_APPROVAL',
      r3: 'DEGRADED',
      r4: 'FAILED',
      r5: 'BLOCKED_QUOTA',
      r6: 'APPROVED',
      r7: 'REJECTED',
      r8: 'PROPOSED',
      r9: 'FAILED',
    }
    return want[c.key] !== undefined && c.status !== want[c.key]
  })
  if (bad.length > 0) {
    console.error('\n❌ 夹具自检失败：以下运行的状态与预期不符（代码或夹具漂移了，先查清再对账）')
    for (const b of bad) console.error(`  · ${b.key} 实际=${b.status}`)
    process.exit(1)
  }
  const blocked = created.find((c) => c.key === 'r5')
  if (blocked && blocked.calls !== 0) {
    console.error(`\n❌ 夹具自检失败：r5 是 BLOCKED_QUOTA 却产生了 ${blocked.calls} 条调用（AC-20 破了）`)
    process.exit(1)
  }
  console.log('\n✅ 夹具写好且自检通过（状态与"零调用"两条都符合预期）')
}

main().catch((err) => {
  console.error('❌ 夹具异常：', err?.message || err)
  process.exit(1)
})

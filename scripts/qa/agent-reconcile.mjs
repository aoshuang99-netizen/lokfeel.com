#!/usr/bin/env node
/**
 * T09 · Agent 成本 **SQL 对账**（AC-20 的"复算一侧"）
 *
 * ═══════════════════════════════════════════════════════════════
 * 它证明什么
 * ═══════════════════════════════════════════════════════════════
 * AC-20 的判据是「**每次调用可归因**」+「限额触发时停止高成本任务」。本脚本各有一条机械实现：
 *
 *   ── ① 每次调用**可归因**（本轮的核心，逐条复算）──────────────
 *      对 `AgentCall` 的**每一行**，用**响应自己下发的单价** + 表里的原始 token 计数
 *      重算金额，必须等于表里存的 `microCents`、也等于响应里下发的那个数。
 *      对账**不 import 任何业务代码** —— 所以它不是"把服务的答案抄一遍"。
 *      逐条复算才能抓"重试场景下金额静默少算"那类只有明细才暴露的错。
 *
 *   ── ② 运行级冗余列不漂移 ──────────────────────────────────
 *      `AgentRun.costMicroCents` 是**冗余列**（列表页要按运行聚合）。它与
 *      `SUM(AgentCall.microCents)` 的一致性由 SQL 独立验证 —— 写入非原子，
 *      漂移必须被**发现**，而不是被容忍。
 *
 *   ── ③ 状态与裁决一致 ──────────────────────────────────────
 *      终态（APPROVED/REJECTED）必有裁决行、待批态必无、状态与 decision 同向。
 *      Slice 4 起执行器已接线：**不再**断言"无 EXECUTED 行"，改为断言
 *      `EXECUTED ⇒ 必有 AgentExecution 行` 且反过来也成立（双向一致，
 *      与 `scripts/connection/migrate.mjs` 的 C7 段同口径）。
 *
 *   ── ④ 限额判定用的额度**就是**响应下发的那份 ──────────────────
 *      用响应里的 `usage.quota` 复算 used/remaining，并核对 `used === totals.microCents`。
 *      对账脚本**自带一份额度常量**会让"改代码没改脚本"两边同时错——故一律从响应读。
 *
 *   ── ⑤ 诚实条款（不得把"降级兜底"说成"真实调用"）───────────────
 *      `usage.provider.realCallsEnabled === false` ⇒ 本期**不得**存在
 *      `providerKind='OPENAI'` 的调用行。这是把"响应里的自述"与"表里的既成事实"
 *      钉在一起 —— 单看任一侧都可能被伪造。
 *
 * ⚠️ 为什么这个脚本用 `.mjs` 而不是 `.mts`：
 *    它**故意不依赖任何 TS 源码** —— 只用原始 SQL。`.mjs` 由
 *    `npm run check:script-decls` 守着（tsc 覆盖不到 `.mjs`，那正是它需要的守卫）。
 *
 * 🔴 为什么最后还要跑「变异自证」：
 *    一个"永远通过"的对账脚本与一个正确的对账脚本，在**只有一次干净跑**时长得一样。
 *    故本脚本在干净通过后，会把载荷**故意改坏**若干处并断言"必须被抓到"；
 *    其中**改单价**与**改 token** 两例专门证明"逐条复算"这一段是**承重**的
 *    （不是把 API 的值原样回读一遍）。
 *
 * 用法:
 *   AGENT_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t09-agent.db \
 *     node scripts/qa/agent-reconcile.mjs --api=/tmp/t09-agent-api.json
 *   … --period=2026-10     # 覆盖期次（默认取载荷 usage.periodKey）
 */

import fs from 'node:fs'
import { createClient } from '@libsql/client'

// ─────────────────────────────────────────────────────────────
// 参数
// ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { _: [] }
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq === -1) out[a.slice(2)] = true
      else out[a.slice(2, eq)] = a.slice(eq + 1)
    } else {
      out._.push(a)
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const API_FILE = typeof args.api === 'string' ? args.api : process.env.AGENT_API_FILE || ''
const ORG = typeof args.org === 'string' ? args.org : process.env.AGENT_ORG_ID || ''
const PERIOD_OVERRIDE = typeof args.period === 'string' ? args.period : process.env.AGENT_PERIOD || ''
const DB_URL = (process.env.DATABASE_URL || '').trim()
const AUTH_TOKEN = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim()

/**
 * 期望的「真实模型调用」开关。
 *
 * 🔴 为什么需要它（而不是只断言 `false ⇒ 无 OPENAI 行` 那一侧）：
 *    那条单项断言**挡不住"把 false 改成 true"** —— 改完之后前提不成立，断言恒真。
 *    （这正是变异自证抓出来的：15 个变异里唯一漏网的就是这条。）
 *    要挡住它，对账必须知道**期望值**：
 *      · **service 模式**（与本脚本同一台机、同一个 shell）→ 从本进程 env 推断；
 *      · **http 模式**（对着已部署环境取证）→ 本进程 env 与目标环境**无关**，
 *        必须显式传 `--expect-real-calls=0|1`，**不许猜**。
 */
const EXPECT_REAL_CALLS_RAW =
  (typeof args['expect-real-calls'] === 'string' ? args['expect-real-calls'] : process.env.AGENT_EXPECT_REAL_CALLS || '').trim()
const EXPECT_REAL_CALLS_SOURCE = EXPECT_REAL_CALLS_RAW
  ? `显式给出（--expect-real-calls / AGENT_EXPECT_REAL_CALLS）`
  : `由本进程 env 推断（OPENAI_API_KEY ${(process.env.OPENAI_API_KEY || '').trim() ? '存在' : '缺失'}）`
const EXPECT_REAL_CALLS = EXPECT_REAL_CALLS_RAW
  ? EXPECT_REAL_CALLS_RAW === '1'
  : Boolean((process.env.OPENAI_API_KEY || '').trim())

/** 与 `src/lib/agent/types.ts` 的枚举逐字一致（两边不一致由 schema 漂移测试先挡住）。 */
const RUN_STATUSES = [
  'PROPOSED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
  'DEGRADED',
  'BLOCKED_QUOTA',
  'FAILED',
]
const PROVIDER_KINDS_DB = ['OPENAI', 'STUB', 'RULES']
const APPROVAL_DECISIONS = ['APPROVED', 'REJECTED']
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH']
/** 终态（必须已裁决）——与 `approval.ts` 的 TERMINAL_STATUSES 同口径。 */
const DECIDED_STATUSES = ['APPROVED', 'REJECTED']
const UNDECIDED_BLOCKED_STATUSES = ['PROPOSED', 'AWAITING_APPROVAL', 'DEGRADED', 'BLOCKED_QUOTA', 'FAILED']

/** 运行 DTO 里**禁止出现**的键（投影边界的机械实现，见 `dto.ts` 文件头）。 */
const FORBIDDEN_RUN_KEYS = ['rawText', 'dedupeKey', 'requestHash']
/** `AgentCall` DTO 的字段集（与表列逐字对齐；双向比字段集）。 */
const CALL_DTO_KEYS = [
  'seq',
  'skill',
  'providerKind',
  'risk',
  'highCost',
  'ok',
  'inputTokens',
  'outputTokens',
  'microCents',
  'at',
]

// ─────────────────────────────────────────────────────────────
// 断言框架（可重复运行：供"干净跑"与"变异跑"复用）
// ─────────────────────────────────────────────────────────────

function makeChecker() {
  const lines = []
  let pass = 0
  let fail = 0
  const ck = (section, label, ok, detail = '') => {
    lines.push(`  ${ok ? '✅' : '❌'} [${section}] ${label}${detail ? '  ' + detail : ''}`)
    if (ok) pass += 1
    else fail += 1
  }
  const info = (section, label, detail = '') => {
    lines.push(`  ·  [${section}] ${label}${detail ? '  ' + detail : ''}`)
  }
  return { ck, info, lines, get pass() { return pass }, get fail() { return fail } }
}

// ─────────────────────────────────────────────────────────────
// 数值/结构工具
// ─────────────────────────────────────────────────────────────

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
const asCount = (x) => Math.max(0, Math.floor(num(x)))

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function sameKeySet(obj, keys) {
  if (!obj || typeof obj !== 'object') return false
  return Object.keys(obj).sort().join(',') === [...keys].sort().join(',')
}

/**
 * 时间戳相等 = **同一时刻**，不是同一字符串。
 *
 * 库里可能是 `…+00:00`（Prisma/夹具写），DTO 经 `toISOString()` 归一为 `…Z`；
 * 两者是同一时刻的合法表示 ⇒ 必须按解析后的时刻比（T08 `risks.md` R10 同款陷阱）。
 */
function sameTs(a, b) {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === ''
  if (b === null || b === undefined || b === '') return false
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return String(a) === String(b)
  return ta === tb
}

/** 期次口径（UTC 自然月，对 `Z` / `+00:00` / 空格三种写法都成立 —— 本仓数据集里三种都有）。 */
const PK = (col) => `substr(replace(replace(${col},'Z',''),'+00:00',''),1,7)`

/**
 * 逐条复算：`(inputTokens, outputTokens) × 声明单价 → 微分`。
 *
 * ⚠️ 与 `cost.ts` 的 `costMicroCents()` **同形**，这是刻意的：这里要验证的是
 *    "表里的 token 列与金额列自洽、且与响应一致"，不是"重新发明一套定价"。
 *    定价这层（单价是否合理）由**响应下发的假设**承担，并由本脚本的变异自证
 *    证明"改单价必须让结果变"。
 */
function recomputeMicroCents(inputTokens, outputTokens, price) {
  const raw = (inputTokens * price.inputMicroCentsPerK + outputTokens * price.outputMicroCentsPerK) / 1000
  return Math.round(raw)
}

// ─────────────────────────────────────────────────────────────
// 原始读数（唯一做 IO 的地方 —— 之后全部走纯比较）
// ─────────────────────────────────────────────────────────────

async function fetchRaw(client, org, periodKey) {
  const q = async (sql, params = []) => (await client.execute({ sql, args: params })).rows
  const scalar = async (sql, params = []) => Number(((await q(sql, params))[0] || { n: 0 }).n)

  const runs = await q(
    `SELECT "id","skill","status","risk","requiresApproval","requestedBy","subjectLabel","goal",
            "reason","degradeCode","providerKind","costMicroCents","createdAt","updatedAt"
       FROM "AgentRun" WHERE "organizationId" = ?`,
    [org]
  )

  const calls = await q(
    `SELECT "id","runId","seq","skill","providerKind","risk","highCost","ok",
            "inputTokens","outputTokens","microCents","at"
       FROM "AgentCall" WHERE "organizationId" = ?`,
    [org]
  )

  const approvals = await q(
    `SELECT "id","runId","decision","actorId","deciderRole","note","decidedAt"
       FROM "AgentApproval" WHERE "organizationId" = ?`,
    [org]
  )

  // ── SQL 聚合（与命令式折叠不可能共享同一个 bug）──
  const aggInPeriod = {
    calls: await scalar(
      `SELECT COUNT(*) AS n FROM "AgentCall" WHERE "organizationId" = ? AND ${PK('"at"')} = ?`,
      [org, periodKey]
    ),
    okCalls: await scalar(
      `SELECT COUNT(*) AS n FROM "AgentCall" WHERE "organizationId" = ? AND "ok" = 1 AND ${PK('"at"')} = ?`,
      [org, periodKey]
    ),
    highCostCalls: await scalar(
      `SELECT COUNT(*) AS n FROM "AgentCall" WHERE "organizationId" = ? AND "highCost" = 1 AND ${PK('"at"')} = ?`,
      [org, periodKey]
    ),
    inputTokens: await scalar(
      `SELECT COALESCE(SUM("inputTokens"),0) AS n FROM "AgentCall" WHERE "organizationId" = ? AND ${PK('"at"')} = ?`,
      [org, periodKey]
    ),
    outputTokens: await scalar(
      `SELECT COALESCE(SUM("outputTokens"),0) AS n FROM "AgentCall" WHERE "organizationId" = ? AND ${PK('"at"')} = ?`,
      [org, periodKey]
    ),
    microCents: await scalar(
      `SELECT COALESCE(SUM("microCents"),0) AS n FROM "AgentCall" WHERE "organizationId" = ? AND ${PK('"at"')} = ?`,
      [org, periodKey]
    ),
  }
  aggInPeriod.failedCalls = aggInPeriod.calls - aggInPeriod.okCalls

  const aggAllPeriods = {
    calls: await scalar(`SELECT COUNT(*) AS n FROM "AgentCall" WHERE "organizationId" = ?`, [org]),
    microCents: await scalar(
      `SELECT COALESCE(SUM("microCents"),0) AS n FROM "AgentCall" WHERE "organizationId" = ?`,
      [org]
    ),
  }

  const runByStatus = await q(
    `SELECT "status" AS "status", COUNT(*) AS "n" FROM "AgentRun" WHERE "organizationId" = ? GROUP BY "status"`,
    [org]
  )

  const bySkillRows = await q(
    `SELECT "skill" AS "skill", COUNT(*) AS "calls", COALESCE(SUM("microCents"),0) AS "microCents"
       FROM "AgentCall" WHERE "organizationId" = ? AND ${PK('"at"')} = ?
      GROUP BY "skill"`,
    [org, periodKey]
  )

  /** 悬空调用（软引用完整性：账不能挂在不存在的运行上）。 */
  const orphanCalls = await q(
    `SELECT c."id" AS "id", c."runId" AS "runId"
       FROM "AgentCall" c
      WHERE c."organizationId" = ?
        AND NOT EXISTS (SELECT 1 FROM "AgentRun" r WHERE r."id" = c."runId" AND r."organizationId" = c."organizationId")`,
    [org]
  )

  const orphanApprovals = await q(
    `SELECT a."id" AS "id", a."runId" AS "runId"
       FROM "AgentApproval" a
      WHERE a."organizationId" = ?
        AND NOT EXISTS (SELECT 1 FROM "AgentRun" r WHERE r."id" = a."runId" AND r."organizationId" = a."organizationId")`,
    [org]
  )

  /** 未知枚举值（表里出现枚举外取值 = 代码/数据漂移，必须报）。 */
  const unknownEnums = {
    runStatus: await scalar(
      `SELECT COUNT(*) AS n FROM "AgentRun" WHERE "organizationId" = ? AND "status" NOT IN (${RUN_STATUSES.map(() => '?').join(',')})`,
      [org, ...RUN_STATUSES]
    ),
    runRisk: await scalar(
      `SELECT COUNT(*) AS n FROM "AgentRun" WHERE "organizationId" = ? AND "risk" NOT IN (${RISK_LEVELS.map(() => '?').join(',')})`,
      [org, ...RISK_LEVELS]
    ),
    providerKind: await scalar(
      `SELECT COUNT(*) AS n FROM "AgentCall" WHERE "organizationId" = ? AND "providerKind" NOT IN (${PROVIDER_KINDS_DB.map(() => '?').join(',')})`,
      [org, ...PROVIDER_KINDS_DB]
    ),
    decision: await scalar(
      `SELECT COUNT(*) AS n FROM "AgentApproval" WHERE "organizationId" = ? AND "decision" NOT IN (${APPROVAL_DECISIONS.map(() => '?').join(',')})`,
      [org, ...APPROVAL_DECISIONS]
    ),
  }

  /** 诚实性：本期是否存在 OPENAI 调用（与 `usage.provider.realCallsEnabled` 双向核对）。 */
  const openaiCallsInPeriod = await scalar(
    `SELECT COUNT(*) AS n FROM "AgentCall" WHERE "organizationId" = ? AND "providerKind" = 'OPENAI' AND ${PK('"at"')} = ?`,
    [org, periodKey]
  )

  /**
   * Slice 4：执行记录 —— 「`EXECUTED` ⇔ 有 `AgentExecution` 行」双向一致的原始读数。
   *
   * 🔴 缺表（C7 未应用）时**不能**静默通过：把 `executionsTableReady` 标成 false，
   *    由断言显式报出。否则一个"还没有执行表"的旧库会让"双向一致"凭空成立
   *    （两边都是空集 —— 空集一致性没有判别力）。
   */
  let executions = []
  let orphanExecutions = []
  let executionsTableReady = true
  try {
    executions = await q(
      `SELECT e."id" AS "id", e."runId" AS "runId", e."organizationId" AS "organizationId"
         FROM "AgentExecution" e WHERE e."organizationId" = ?`,
      [org]
    )
    orphanExecutions = await q(
      `SELECT e."id" AS "id", e."runId" AS "runId"
         FROM "AgentExecution" e
        WHERE e."organizationId" = ?
          AND NOT EXISTS (SELECT 1 FROM "AgentRun" r WHERE r."id" = e."runId" AND r."organizationId" = e."organizationId")`,
      [org]
    )
  } catch {
    executionsTableReady = false
  }

  return {
    runs,
    calls,
    approvals,
    aggInPeriod,
    aggAllPeriods,
    runByStatus,
    bySkillRows,
    orphanCalls,
    orphanApprovals,
    unknownEnums,
    openaiCallsInPeriod,
    executions,
    orphanExecutions,
    executionsTableReady,
  }
}

// ─────────────────────────────────────────────────────────────
// 纯比较：把 (响应, 原始读数) 变成一组断言
//    —— 与 IO 分离，故可对"变异载荷"重复调用（变异自证）。
// ─────────────────────────────────────────────────────────────

function compareAll(payload, raw, expect) {
  const C = makeChecker()
  const usage = payload?.usage ?? null
  const runs = Array.isArray(payload?.runs) ? payload.runs : null

  if (!usage || !runs) {
    C.ck('载荷', '载荷含 usage 与 runs[] 两段', false, `keys=${Object.keys(payload || {}).join(',')}`)
    return C
  }

  const periodKey = PERIOD_OVERRIDE || usage.periodKey
  const price = usage?.assumptions?.price ?? null
  const quota = usage?.quota ?? null
  const totals = usage?.totals ?? {}

  // ═════════════════════════════════════════════════════════
  // [0] 载荷自洽性（错了就没必要往下算）
  // ═════════════════════════════════════════════════════════
  C.ck('0', 'usage.periodKey 形如 YYYY-MM（UTC 自然月）', /^\d{4}-\d{2}$/.test(String(periodKey)), `periodKey=${periodKey}`)
  C.ck(
    '0',
    '③ 假设随响应下发：assumptions.price 字段集完整',
    sameKeySet(price, ['inputMicroCentsPerK', 'outputMicroCentsPerK']),
    JSON.stringify(price)
  )
  C.ck(
    '0',
    'assumptions.price 是正整数微分单价（不是浮点分）',
    typeof price?.inputMicroCentsPerK === 'number' &&
      typeof price?.outputMicroCentsPerK === 'number' &&
      Number.isInteger(price.inputMicroCentsPerK) &&
      Number.isInteger(price.outputMicroCentsPerK) &&
      price.inputMicroCentsPerK >= 0 &&
      price.outputMicroCentsPerK >= 0,
    JSON.stringify(price)
  )
  C.ck('0', 'assumptions.quota 是说明字符串（额度口径必须能被人读懂）', typeof usage?.assumptions?.quota === 'string', '')
  C.ck(
    '0',
    'assumptions.period 是说明字符串（期次口径必须随响应下发）',
    typeof usage?.assumptions?.period === 'string',
    ''
  )
  C.ck(
    '0',
    'usage.quota 字段集齐备（max/used/remaining/次数）',
    sameKeySet(quota, ['maxMicroCents', 'maxHighCostCalls', 'usedMicroCents', 'remainingMicroCents', 'highCostCalls']),
    Object.keys(quota || {}).join(',')
  )
  C.ck('0', '🔴 载荷里至少有 1 条运行（否则对账是空转）', runs.length > 0, `runs=${runs.length}`)
  C.ck(
    '0',
    '🔴 至少有 1 条调用明细（AC-20 的"逐次可归因"必须有对象）',
    runs.some((r) => Array.isArray(r?.calls) && r.calls.length > 0),
    runs.map((r) => (r?.calls || []).length).join(',')
  )
  if (C.fail > 0) {
    C.info('0', '载荷本身不自洽 → 跳过后续对账')
    return C
  }

  const callsById = new Map(raw.calls.map((c) => [c.id, c]))
  const runsById = new Map(raw.runs.map((r) => [r.id, r]))
  const approvalsByRun = new Map(raw.approvals.map((a) => [a.runId, a]))
  const callsByRun = new Map()
  for (const c of raw.calls) {
    if (!callsByRun.has(c.runId)) callsByRun.set(c.runId, [])
    callsByRun.get(c.runId).push(c)
  }

  // ═════════════════════════════════════════════════════════
  // [1] 逐条运行时：明细与冗余列、状态与裁决
  // ═════════════════════════════════════════════════════════
  let runMissingInDb = 0
  for (const run of runs) {
    const dbRun = runsById.get(run.id)
    if (!dbRun) {
      runMissingInDb += 1
      C.ck('1', `run ${run.id} 存在于库中`, false, '响应里有、库里没有')
      continue
    }
    C.ck('1', `run[${run.id}].skill 与库一致`, run.skill === dbRun.skill, `API=${run.skill} DB=${dbRun.skill}`)
    C.ck('1', `run[${run.id}].status 与库一致`, run.status === dbRun.status, `API=${run.status} DB=${dbRun.status}`)
    C.ck('1', `run[${run.id}].risk 与库一致`, run.risk === dbRun.risk, `API=${run.risk} DB=${dbRun.risk}`)
    C.ck('1', `run[${run.id}].providerKind 与库一致`, run.providerKind === String(dbRun.providerKind).toLowerCase())
    C.ck(
      '1',
      `run[${run.id}].requiresApproval 与库一致`,
      run.requiresApproval === Boolean(dbRun.requiresApproval)
    )
    C.ck('1', `run[${run.id}].goal 与库一致`, run.goal === dbRun.goal)

    // ── ② 冗余列不漂移 ──
    const dbCalls = (callsByRun.get(run.id) || []).slice().sort((a, b) => a.seq - b.seq)
    const dbSum = dbCalls.reduce((s, c) => s + num(c.microCents), 0)
    C.ck(
      '1',
      `run[${run.id}] costMicroCents = SUM(AgentCall.microCents)（SQL 独立求和）`,
      num(dbRun.costMicroCents) === dbSum,
      `列=${dbRun.costMicroCents} 求和=${dbSum}`
    )
    C.ck(
      '1',
      `run[${run.id}].costMicroCents 与响应一致`,
      num(run.costMicroCents) === dbSum,
      `API=${run.costMicroCents} SQL=${dbSum}`
    )

    // ── 明细条数与序号连续性 ──
    C.ck(
      '1',
      `run[${run.id}] 明细条数与库一致`,
      run.calls.length === dbCalls.length,
      `API=${run.calls.length} DB=${dbCalls.length}`
    )
    C.ck(
      '1',
      `run[${run.id}] seq 从 1 起连续无洞`,
      dbCalls.every((c, i) => c.seq === i + 1),
      dbCalls.map((c) => c.seq).join(',')
    )

    // ── ③ 状态与裁决一致 ──
    const approval = approvalsByRun.get(run.id) ?? null
    if (DECIDED_STATUSES.includes(String(dbRun.status))) {
      C.ck('1', `run[${run.id}] 终态（${dbRun.status}）必有裁决行`, approval !== null, approval ? '' : '缺失')
      C.ck(
        '1',
        `run[${run.id}] status 与裁决 decision 同向`,
        approval !== null && String(approval.decision) === String(dbRun.status),
        `status=${dbRun.status} decision=${approval?.decision}`
      )
    } else if (UNDECIDED_BLOCKED_STATUSES.includes(String(dbRun.status))) {
      C.ck('1', `run[${run.id}] 非终态（${dbRun.status}）不得有裁决行`, approval === null, approval ? `多出 ${approval.decision}` : '')
    }
    C.ck('1', `run[${run.id}] 状态属于已知集合`, RUN_STATUSES.includes(String(run.status)), `status=${run.status}`)

    // ── ⑤ 执行可用性与状态**同源**（Slice 4：执行器已接线 ⇒ 不再断言"恒 false"）──
    //    只做**可判定的结构一致性**：不重新推导业务规则，只检查 DTO 自身
    //    （available ⇔ code ⇔ kind/channel ⇔ executionRecord ⇔ status）不自相矛盾。
    const ex = run?.execution ?? {}
    const executableStates = ['PROPOSED', 'DEGRADED', 'APPROVED']
    C.ck(
      '1',
      `run[${run.id}] execution.available 是布尔且 reason 非空（无论如何都要说明）`,
      typeof ex.available === 'boolean' && typeof ex.reason === 'string' && ex.reason.length > 0,
      JSON.stringify(ex)
    )
    C.ck(
      '1',
      `🔴 run[${run.id}] available ⇔ (code === null)（两处不可自相矛盾）`,
      (ex.available === true) === (ex.code === null)
    )
    C.ck(
      '1',
      `🔴 run[${run.id}] available=true ⇒ kind/channel 取自闭集；false ⇒ 二者为 null`,
      ex.available === true
        ? ex.kind === 'RECEIPT' && ex.channel === 'IN_APP'
        : ex.kind === null && ex.channel === null,
      `kind=${ex.kind} channel=${ex.channel}`
    )
    C.ck(
      '1',
      `🔴 run[${run.id}] available=true ⇒ 状态确实允许执行（${executableStates.join('/')}）`,
      ex.available !== true || executableStates.includes(String(dbRun.status)),
      `status=${dbRun.status}`
    )
    C.ck(
      '1',
      `🔴 run[${run.id}] (status === 'EXECUTED') ⇔ executionRecord 非空`,
      (String(dbRun.status) === 'EXECUTED') === (run?.executionRecord != null),
      `status=${dbRun.status} record=${run?.executionRecord ? '有' : 'null'}`
    )

    // ── 投影边界：禁用键不得出现 ──
    const leaked = FORBIDDEN_RUN_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(run, k))
    C.ck('1', `🔴 run[${run.id}] 未泄漏禁用键（${FORBIDDEN_RUN_KEYS.join('/')}）`, leaked.length === 0, leaked.join(','))

    // ── injectionFlagged 与信号一致 ──
    C.ck(
      '1',
      `run[${run.id}].injectionFlagged = (injectionSignals.length > 0)`,
      run.injectionFlagged === (Array.isArray(run.injectionSignals) && run.injectionSignals.length > 0)
    )
  }
  C.ck('1', '响应里的每条运行都能在库里找到', runMissingInDb === 0, `missing=${runMissingInDb}`)
  C.ck('1', '账本无悬空调用（每笔调用都能追回运行）', raw.orphanCalls.length === 0, raw.orphanCalls.map((r) => r.id).join(','))
  C.ck('1', '裁决无悬空运行', raw.orphanApprovals.length === 0, raw.orphanApprovals.map((r) => r.id).join(','))
  C.ck('1', '枚举取值全部合法（运行状态/风险级/提供方/裁决）', Object.values(raw.unknownEnums).every((n) => n === 0), JSON.stringify(raw.unknownEnums))

  // ═════════════════════════════════════════════════════════
  // [2] 🔴 逐次调用归因（AC-20 核心）：token × 声明单价 → 金额
  // ═════════════════════════════════════════════════════════
  let mismatched = 0
  let checkedCalls = 0
  for (const run of runs) {
    for (const call of run.calls) {
      const dbCall = dbCalls_find(raw, run.id, call.seq)
      if (!dbCall) {
        C.ck('2', `run[${run.id}] seq=${call.seq} 在库中存在`, false, 'missing')
        mismatched += 1
        continue
      }
      checkedCalls += 1
      const expected = recomputeMicroCents(num(dbCall.inputTokens), num(dbCall.outputTokens), price)
      if (num(dbCall.microCents) !== expected) {
        mismatched += 1
        C.ck(
          '2',
          `run[${run.id}] seq=${call.seq} 表内金额 = token × 声明单价`,
          false,
          `存=${dbCall.microCents} 复算=${expected}（in=${dbCall.inputTokens} out=${dbCall.outputTokens}）`
        )
      }
      if (num(call.microCents) !== expected) {
        mismatched += 1
        C.ck(
          '2',
          `run[${run.id}] seq=${call.seq} 响应金额 = token × 声明单价`,
          false,
          `API=${call.microCents} 复算=${expected}`
        )
      }
      if (num(call.inputTokens) !== num(dbCall.inputTokens) || num(call.outputTokens) !== num(dbCall.outputTokens)) {
        mismatched += 1
        C.ck('2', `run[${run.id}] seq=${call.seq} token 计数与库一致`, false, `API=${call.inputTokens}/${call.outputTokens} DB=${dbCall.inputTokens}/${dbCall.outputTokens}`)
      }
      if (String(call.providerKind).toUpperCase() !== String(dbCall.providerKind)) {
        mismatched += 1
        C.ck('2', `run[${run.id}] seq=${call.seq} providerKind 与库一致`, false, `API=${call.providerKind} DB=${dbCall.providerKind}`)
      }
      if (call.ok !== Boolean(dbCall.ok)) {
        mismatched += 1
        C.ck('2', `run[${run.id}] seq=${call.seq} ok 与库一致`, false, `API=${call.ok} DB=${dbCall.ok}`)
      }
      if (call.highCost !== Boolean(dbCall.highCost)) {
        mismatched += 1
        C.ck('2', `run[${run.id}] seq=${call.seq} highCost 与库一致`, false, `API=${call.highCost} DB=${dbCall.highCost}`)
      }
      if (!sameTs(call.at, dbCall.at)) {
        mismatched += 1
        C.ck('2', `run[${run.id}] seq=${call.seq} 调用时刻与库一致（按时刻比，不按字符串）`, false, `API=${call.at} DB=${dbCall.at}`)
      }
    }
  }
  C.ck(
    '2',
    `🔴 逐次调用归因全部对得上（复算 ${checkedCalls} 条，0 处不一致）`,
    mismatched === 0,
    mismatched === 0 ? `checked=${checkedCalls}` : `不一致 ${mismatched} 处（明细见上）`
  )

  // ═════════════════════════════════════════════════════════
  // [3] 汇总：SQL 聚合 vs 响应
  // ═════════════════════════════════════════════════════════
  C.ck('3', 'totals.calls = COUNT(AgentCall 本期)', num(totals.calls) === raw.aggInPeriod.calls, `API=${totals.calls} SQL=${raw.aggInPeriod.calls}`)
  C.ck('3', 'totals.okCalls = COUNT(ok=1 本期)', num(totals.okCalls) === raw.aggInPeriod.okCalls, `API=${totals.okCalls} SQL=${raw.aggInPeriod.okCalls}`)
  C.ck(
    '3',
    'totals.failedCalls = COUNT(ok=0 本期)（失败也入账）',
    num(totals.failedCalls) === raw.aggInPeriod.failedCalls,
    `API=${totals.failedCalls} SQL=${raw.aggInPeriod.failedCalls}`
  )
  C.ck('3', 'okCalls + failedCalls = calls', num(totals.okCalls) + num(totals.failedCalls) === num(totals.calls))
  C.ck(
    '3',
    'totals.highCostCalls = COUNT(highCost=1 本期)',
    num(totals.highCostCalls) === raw.aggInPeriod.highCostCalls,
    `API=${totals.highCostCalls} SQL=${raw.aggInPeriod.highCostCalls}`
  )
  C.ck('3', 'totals.inputTokens = SUM(inputTokens 本期)', num(totals.inputTokens) === raw.aggInPeriod.inputTokens, `API=${totals.inputTokens} SQL=${raw.aggInPeriod.inputTokens}`)
  C.ck('3', 'totals.outputTokens = SUM(outputTokens 本期)', num(totals.outputTokens) === raw.aggInPeriod.outputTokens, `API=${totals.outputTokens} SQL=${raw.aggInPeriod.outputTokens}`)
  C.ck('3', 'totals.microCents = SUM(microCents 本期)', num(totals.microCents) === raw.aggInPeriod.microCents, `API=${totals.microCents} SQL=${raw.aggInPeriod.microCents}`)

  // 期次过滤必须**承重**：全期 ≥ 本期，且若多于则说明过滤真的在起作用
  const filteredAny = num(raw.aggAllPeriods.calls) > num(raw.aggInPeriod.calls)
  C.info(
    '3',
    '期次过滤承重（全期 vs 本期）',
    `calls: ${raw.aggInPeriod.calls}/${raw.aggAllPeriods.calls}  microCents: ${raw.aggInPeriod.microCents}/${raw.aggAllPeriods.microCents}` +
      (filteredAny ? '  ⇒ 过滤生效' : '  ⚠️ 无跨期数据，过滤未被承重')
  )
  C.ck('3', '全期调用数不少于本期（过滤是包含关系）', num(raw.aggAllPeriods.calls) >= num(raw.aggInPeriod.calls))

  // ── bySkill ──
  const apiBySkill = Array.isArray(usage.bySkill) ? usage.bySkill : []
  const sqlBySkill = raw.bySkillRows
    .map((r) => ({ skill: String(r.skill), calls: num(r.calls), microCents: num(r.microCents) }))
    .sort((a, b) => a.skill.localeCompare(b.skill))
  const apiBySkillSorted = apiBySkill
    .map((r) => ({ skill: String(r.skill), calls: asCount(r.calls), microCents: num(r.microCents) }))
    .sort((a, b) => a.skill.localeCompare(b.skill))
  C.ck(
    '3',
    'bySkill 分组与 SQL GROUP BY 完全一致（含金额，不只条数）',
    sameJson(apiBySkillSorted, sqlBySkill),
    `API=${JSON.stringify(apiBySkillSorted)} SQL=${JSON.stringify(sqlBySkill)}`
  )
  C.ck(
    '3',
    'bySkill 金额之和 = totals.microCents（分组不漏不重）',
    apiBySkill.reduce((s, r) => s + num(r.microCents), 0) === num(totals.microCents),
    `分组合计=${apiBySkill.reduce((s, r) => s + num(r.microCents), 0)}`
  )
  C.ck(
    '3',
    'bySkill 条数之和 = totals.calls（分组不漏不重）',
    apiBySkill.reduce((s, r) => s + asCount(r.calls), 0) === num(totals.calls)
  )

  // ── runs.byStatus ──
  const sqlByStatus = {}
  for (const r of raw.runByStatus) sqlByStatus[String(r.status)] = num(r.n)
  const apiByStatus = { ...(usage?.runs?.byStatus ?? {}) }
  const statusKeys = [...new Set([...Object.keys(sqlByStatus), ...Object.keys(apiByStatus)])].sort()
  const statusOk = statusKeys.every((k) => num(apiByStatus[k]) === num(sqlByStatus[k]))
  C.ck('3', 'runs.byStatus 与 SQL GROUP BY status 逐状态一致', statusOk, `API=${JSON.stringify(apiByStatus)} SQL=${JSON.stringify(sqlByStatus)}`)
  C.ck('3', 'runs.total = COUNT(AgentRun)', num(usage?.runs?.total) === raw.runs.length, `API=${usage?.runs?.total} SQL=${raw.runs.length}`)
  C.ck('3', 'runs.byStatus 各状态之和 = runs.total', Object.values(apiByStatus).reduce((s, n) => s + num(n), 0) === num(usage?.runs?.total))

  // ═════════════════════════════════════════════════════════
  // [4] 限额：用**响应自己下发的额度**复算（④）
  // ═════════════════════════════════════════════════════════
  C.ck(
    '4',
    'quota.usedMicroCents = totals.microCents（限额的"已用"就是账本合计）',
    num(quota.usedMicroCents) === num(totals.microCents),
    `quota=${quota.usedMicroCents} totals=${totals.microCents}`
  )
  C.ck(
    '4',
    'quota.remainingMicroCents = max(0, max − used)（用响应下发的 max 复算）',
    num(quota.remainingMicroCents) === Math.max(0, num(quota.maxMicroCents) - num(quota.usedMicroCents)),
    `remaining=${quota.remainingMicroCents} 复算=${Math.max(0, num(quota.maxMicroCents) - num(quota.usedMicroCents))}`
  )
  C.ck(
    '4',
    'quota.highCostCalls = totals.highCostCalls（高成本次数是限额的另一条判据）',
    num(quota.highCostCalls) === num(totals.highCostCalls),
    `quota=${quota.highCostCalls} totals=${totals.highCostCalls}`
  )
  C.ck(
    '4',
    'quota.maxMicroCents / maxHighCostCalls 是正整数',
    Number.isInteger(num(quota.maxMicroCents)) && num(quota.maxMicroCents) > 0 && Number.isInteger(num(quota.maxHighCostCalls)) && num(quota.maxHighCostCalls) >= 0,
    `${quota.maxMicroCents} / ${quota.maxHighCostCalls}`
  )

  // ═════════════════════════════════════════════════════════
  // [5] 形状也是契约：DTO 字段集 == 表列集（**双向**）
  // ═════════════════════════════════════════════════════════
  const anyCall = runs.find((r) => r.calls.length > 0)?.calls?.[0] ?? null
  if (anyCall) {
    C.ck(
      '5',
      '🔴 AgentCall DTO 字段集 == 表列集（多下发没人复算的数字 / 少下发算了没给的，都要报）',
      sameKeySet(anyCall, CALL_DTO_KEYS),
      `DTO=${Object.keys(anyCall).sort().join(',')}`
    )
  }
  C.ck(
    '5',
    'AgentRun DTO 必含字段齐备',
    runs.every(
      (r) =>
        sameKeySet(r, [
          'id',
          'skill',
          'status',
          'risk',
          'requiresApproval',
          'requestedBy',
          'subjectLabel',
          'goal',
          'proposal',
          'reason',
          'degradeCode',
          'providerKind',
          'injectionSignals',
          'injectionFlagged',
          'costMicroCents',
          'calls',
          'approval',
          'execution',
          'executionRecord',
          'createdAt',
          'updatedAt',
        ])
    ),
    `keys=${Object.keys(runs[0]).sort().join(',')}`
  )

  // ═════════════════════════════════════════════════════════
  // [6] 诚实条款：不得把"降级兜底"说成"真实调用"（⑤）
  // ═════════════════════════════════════════════════════════
  const honesty = usage?.provider ?? null
  C.ck('6', 'usage.provider 是对象且声明了 provider 名', honesty !== null && typeof honesty?.provider === 'string', JSON.stringify(honesty))
  C.ck('6', 'usage.provider.realCallsEnabled 是布尔', typeof honesty?.realCallsEnabled === 'boolean', `${honesty?.realCallsEnabled}`)
  C.ck('6', 'usage.provider.reason 非空（无论开没开都要说明）', typeof honesty?.reason === 'string' && honesty.reason.length > 0, '')
  C.ck(
    '6',
    '🔴 realCallsEnabled=false ⇒ 本期**不得**存在 OPENAI 调用行（响应自述与表内事实钉在一起）',
    honesty?.realCallsEnabled !== false || raw.openaiCallsInPeriod === 0,
    `realCallsEnabled=${honesty?.realCallsEnabled} OPENAI 行数=${raw.openaiCallsInPeriod}`
  )
  C.ck(
    '6',
    `🔴 realCallsEnabled === ${expect.realCallsEnabled}（与期望一致 —— 挡住"把 false 改成 true"）`,
    honesty?.realCallsEnabled === expect.realCallsEnabled,
    `API=${honesty?.realCallsEnabled} 期望=${expect.realCallsEnabled}（${expect.source}）`
  )
  // ── 执行记录：双向一致（Slice 4 起执行器已接线）──
  const executedRunIds = new Set(
    raw.runs.filter((r) => String(r.status) === 'EXECUTED').map((r) => String(r.id))
  )
  const execRunIds = new Set((raw.executions ?? []).map((e) => String(e.runId)))
  const missingExecRows = [...executedRunIds].filter((id) => !execRunIds.has(id))
  const staleExecRows = [...execRunIds].filter((id) => !executedRunIds.has(id))
  C.ck(
    '6',
    '🔴 AgentExecution 表存在（C7 迁移已应用 —— 缺表即代表部署不完整）',
    raw.executionsTableReady === true,
    raw.executionsTableReady ? `rows=${raw.executions.length}` : '缺表'
  )
  C.ck(
    '6',
    '🔴 EXECUTED ⇒ 必有 AgentExecution 行（"已执行"不能是空口宣称）',
    raw.executionsTableReady === true && missingExecRows.length === 0,
    missingExecRows.join(',')
  )
  C.ck(
    '6',
    '🔴 AgentExecution 行 ⇒ 所属运行必为 EXECUTED（不许有"执行了但状态没变"的幽灵记录）',
    raw.executionsTableReady === true && staleExecRows.length === 0,
    staleExecRows.join(',')
  )
  C.ck(
    '6',
    '执行记录无悬空运行（软引用完整性）',
    raw.executionsTableReady === true && (raw.orphanExecutions ?? []).length === 0,
    (raw.orphanExecutions ?? []).map((r) => String(r.runId)).join(',')
  )
  C.ck(
    '6',
    '本期每条调用都带 providerKind（归因必须有来源）',
    raw.calls.every((c) => typeof c.providerKind === 'string' && c.providerKind.length > 0)
  )

  return C
}

/** 在原始读数里按 (runId, seq) 找一条调用（避免运行时重建 Map 的重复逻辑）。 */
function dbCalls_find(raw, runId, seq) {
  return raw.calls.find((c) => c.runId === runId && num(c.seq) === num(seq)) ?? null
}

// ─────────────────────────────────────────────────────────────
// 变异自证 —— 证明断言**不是"永远通过"**
// ─────────────────────────────────────────────────────────────

function mutationProof(cleanPayload, raw, expect) {
  const firstRunWithCalls = cleanPayload.runs.findIndex((r) => (r.calls || []).length > 0)
  const ri = firstRunWithCalls >= 0 ? firstRunWithCalls : 0
  const cases = [
    ['totals.calls + 1', (p) => { p.usage.totals.calls += 1 }],
    ['totals.microCents + 1', (p) => { p.usage.totals.microCents += 1 }],
    ['totals.okCalls + 1（与 ok/failed 之和不符）', (p) => { p.usage.totals.okCalls += 1 }],
    ['quota.usedMicroCents + 1（与 totals 脱钩）', (p) => { p.usage.quota.usedMicroCents += 1 }],
    ['quota.remainingMicroCents + 1（与 max−used 脱钩）', (p) => { p.usage.quota.remainingMicroCents += 1 }],
    ['bySkill[0].microCents + 1', (p) => { if (p.usage.bySkill[0]) p.usage.bySkill[0].microCents += 1 }],
    ['runs.byStatus 某状态 + 1', (p) => { const k = Object.keys(p.usage.runs.byStatus)[0]; if (k) p.usage.runs.byStatus[k] += 1 }],
    ['run.costMicroCents + 1（冗余列漂移）', (p) => { p.runs[ri].costMicroCents += 1 }],
    ['call.microCents + 1（逐次归因）', (p) => { p.runs[ri].calls[0].microCents += 1 }],
    ['call.inputTokens + 1（token 与金额不再自洽）', (p) => { p.runs[ri].calls[0].inputTokens += 1 }],
    ['assumptions.price 改价（假设必须承重）', (p) => { p.usage.assumptions.price.inputMicroCentsPerK += 1 }],
    ['run.execution.available 取反（与 code/kind 不再自洽）', (p) => { p.runs[ri].execution.available = !p.runs[ri].execution.available }],
    ['run 注入禁用键 rawText（投影边界）', (p) => { p.runs[ri].rawText = '模型原文泄漏' }],
    ['usage.provider.realCallsEnabled 取反（诚实块）', (p) => { p.usage.provider.realCallsEnabled = !p.usage.provider.realCallsEnabled }],
    ['call 多下发一个字段（形状契约）', (p) => { p.runs[ri].calls[0].mysteryField = 1 }],
  ]
  const out = []
  for (const [name, mutate] of cases) {
    const clone = JSON.parse(JSON.stringify(cleanPayload))
    try {
      mutate(clone)
    } catch (err) {
      out.push({ name, caught: false, failures: 0, error: err?.message || String(err) })
      continue
    }
    const r = compareAll(clone, raw, expect)
    out.push({ name, caught: r.fail > 0, failures: r.fail })
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

async function main() {
  if (!ORG) throw new Error('缺少组织 id —— 用 --org=<id> 或 AGENT_ORG_ID')
  if (!DB_URL) throw new Error('缺少 DATABASE_URL（对账要直连同一个库）')
  if (!API_FILE) throw new Error('缺少 --api=<file>（或 AGENT_API_FILE）—— 先跑 emit-agent-usage.mts 产出它')

  const rawPayload = JSON.parse(fs.readFileSync(API_FILE, 'utf8'))
  const data = rawPayload && typeof rawPayload === 'object' && rawPayload.data ? rawPayload.data : rawPayload

  const declaredPeriod = PERIOD_OVERRIDE || data?.usage?.periodKey
  if (!declaredPeriod) throw new Error('载荷里没有 usage.periodKey，且未传 --period')

  const client = createClient({ url: DB_URL, ...(AUTH_TOKEN ? { authToken: AUTH_TOKEN } : {}) })
  let raw
  try {
    raw = await fetchRaw(client, ORG, declaredPeriod)
  } finally {
    client.close()
  }

  console.log(`\n📄 载荷：${API_FILE}`)
  console.log(`🏢 组织：${ORG}   期次：${declaredPeriod}   库：${DB_URL.replace(/\/\/.*@/, '//***@')}`)
  console.log(`🔌 期望「真实模型调用」= ${EXPECT_REAL_CALLS}（${EXPECT_REAL_CALLS_SOURCE}）`)

  const expect = { realCallsEnabled: EXPECT_REAL_CALLS, source: EXPECT_REAL_CALLS_SOURCE }

  // ── 干净跑 ──
  const clean = compareAll(data, raw, expect)
  for (const line of clean.lines) console.log(line)

  // ── 变异自证 ──
  console.log('\n[7] 变异自证（把载荷故意改坏，断言必须被抓到）')
  const proofs = mutationProof(data, raw, expect)
  let proofFail = 0
  for (const p of proofs) {
    const ok = p.caught
    if (!ok) proofFail += 1
    console.log(
      `  ${ok ? '✅' : '❌'} 变异「${p.name}」→ ${ok ? `已抓到（${p.failures} 项不一致）` : `未被抓到 —— 断言形同虚设${p.error ? `（${p.error}）` : ''}`}`
    )
  }

  const totalFail = clean.fail + proofFail
  console.log(
    `\n${totalFail === 0 ? '✅ 对账通过' : '❌ 对账失败'}：对账 ${clean.pass} 通过 / ${clean.fail} 不一致；变异自证 ${proofs.length - proofFail}/${proofs.length}`
  )
  if (clean.fail > 0) {
    console.log('\n不一致明细：')
    for (const line of clean.lines) if (line.includes('❌')) console.log(line)
  }
  process.exit(totalFail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n❌ 对账脚本异常：', err?.message || err)
  process.exit(1)
})

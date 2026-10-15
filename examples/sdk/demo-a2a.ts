/**
 * 示例 C · **A2A 适配层**（需要凭据）
 *
 * ── A2A 在这里是什么 ────────────────────────────────────────────
 *   同一批能力的**另一种信封**。技能目录与 MCP 完全同源
 *   （`src/lib/interop/tools.ts`），差别只在表达方式：
 *     · MCP  用 JSON-RPC 的 `result.content[].text` 承载结果
 *     · A2A  用 `task.status.state` + `task.artifacts[].parts[]` 承载结果
 *
 * ── 授权语义（与 MCP 逐条对齐，这是刻意的）──────────────────────
 *   无会话          → HTTP 401
 *   能力不足        → HTTP 200 且 `task.status.state = "failed"`
 *   技能不存在      → HTTP 404 `SKILL_NOT_FOUND`
 *   请求体缺 skillId → HTTP 400 `INVALID_ARGUMENT`
 *
 * ── 🔴 关键的一条：**任务不落库** ────────────────────────────────
 *   本适配层刻意选择无状态：同一次调用重发两次，`task.id` 一定不同。
 *   若把 task 落库，就会产生"第二套运行记录"，与 T09 的 `AgentRun` 语义重叠
 *   （谁是真相来源？重试以谁为准？）。因此本示例**断言两次 id 不同** ——
 *   这条断言把"无状态"从一句注释变成了可执行的约束。
 *
 * 运行：
 *   LOKFEEL_BASE_URL=http://localhost:3099 \
 *   LOKFEEL_LOGIN_EMAIL=qa.member@example.com \
 *   LOKFEEL_LOGIN_PASSWORD=… \
 *     npx tsx examples/sdk/demo-a2a.ts
 *
 *   （或用 LOKFEEL_COOKIE 直接给会话 Cookie；两种方式见 config.ts）
 */
import { createClient } from './config'
import { LokFeelClient } from './lokfeel-client'
import { createChecker } from './expect'

type TaskEnvelope = {
  task?: {
    id?: string
    skillId?: string
    status?: { state?: string; message?: string; timestamp?: string }
    artifacts?: { artifactId?: string; parts?: { type?: string; data?: unknown }[] }[]
  }
}

type ErrorEnvelope = { error?: { code?: string; message?: string } }

const ELEVATED_SKILL = 'list_missions'
const ELEVATED_CAPABILITY = 'mission.read'

async function main(): Promise<number> {
  const { client, baseUrl, source } = await createClient({ requireCredential: true })
  const check = createChecker(`A2A 授权 / 越权 · ${baseUrl}（凭据来源：${source}）`)

  // ── ① agent card ──────────────────────────────────────────────
  const card = (await client.agentCard()) as { protocolVersion?: string; url?: string } | null
  check.ok(
    'agent card 的 url 指向本适配层端点',
    typeof card?.url === 'string' && card.url.endsWith('/api/v1/a2a/tasks'),
    `url=${String(card?.url)}`,
  )

  // ── ② 授权路径：能力足够 ⇒ completed ─────────────────────────
  const ok = await client.sendTask('list_bridges', { limit: 3 })
  const okEnv = ok.body as TaskEnvelope
  check.ok(
    '【授权】list_bridges 返回 200 且 state=completed',
    ok.status === 200 && okEnv?.task?.status?.state === 'completed',
    `status=${ok.status} state=${String(okEnv?.task?.status?.state)}`,
  )
  const parts = okEnv?.task?.artifacts?.[0]?.parts ?? []
  check.ok(
    'completed 的任务带 artifacts（data 部分承载结果）',
    parts.length > 0 && parts[0]?.type === 'data',
    `parts=${parts.length} 首个类型=${String(parts[0]?.type)}`,
  )
  check.ok(
    '任务信封含 skillId 与 status.timestamp',
    okEnv?.task?.skillId === 'list_bridges' && typeof okEnv?.task?.status?.timestamp === 'string',
    `skillId=${String(okEnv?.task?.skillId)}`,
  )

  // ── ③ 无状态：两次同调用，task.id 必须不同 ───────────────────
  const again = await client.sendTask('list_bridges', { limit: 3 })
  const againEnv = again.body as TaskEnvelope
  check.ok(
    '【无状态】重复调用产生**不同** task.id（任务不落库）',
    !!okEnv?.task?.id && !!againEnv?.task?.id && okEnv.task.id !== againEnv.task.id,
    `${String(okEnv?.task?.id)} vs ${String(againEnv?.task?.id)}`,
  )

  // ── ④ 越权·无会话 ⇒ 401 ──────────────────────────────────────
  const anon = new LokFeelClient({ baseUrl })
  const noSession = await anon.sendTask('list_bridges')
  check.ok('【越权·无会话】HTTP 401', noSession.status === 401, `status=${noSession.status}`)

  // ── ⑤ 越权·能力不足 ⇒ 200 + failed ──────────────────────────
  const elevated = await client.sendTask(ELEVATED_SKILL, { pageSize: 1 })
  const elevatedEnv = elevated.body as TaskEnvelope
  const state = elevatedEnv?.task?.status?.state
  if (elevated.status === 401) {
    check.ok(
      '【越权·能力不足】凭据无效，无法判定（HTTP 401）',
      false,
      '请检查 LOKFEEL_COOKIE 或 LOKFEEL_LOGIN_EMAIL/PASSWORD',
    )
  } else if (state === 'failed') {
    const msg = String(elevatedEnv?.task?.status?.message ?? '')
    check.ok(
      `【越权·能力不足】${ELEVATED_SKILL}（需 ${ELEVATED_CAPABILITY}）⇒ 200 + state=failed`,
      elevated.status === 200 && msg.includes('权限不足'),
      `status=${elevated.status} message=${msg.slice(0, 80)}`,
    )
    check.ok(
      'failed 的任务**不**带 artifacts（失败不产出数据）',
      (elevatedEnv?.task?.artifacts ?? []).length === 0,
      `artifacts=${(elevatedEnv?.task?.artifacts ?? []).length}`,
    )
  } else if (state === 'completed') {
    check.skip(
      `【越权·能力不足】${ELEVATED_SKILL}`,
      `当前令牌角色具备 ${ELEVATED_CAPABILITY}，夹具不适用；请用 MEMBER 角色复跑`,
    )
  } else {
    check.ok('【越权·能力不足】返回了非任务信封', false, `status=${elevated.status} state=${String(state)}`)
  }

  // ── ⑥ 越权·未知技能 ⇒ 404 ───────────────────────────────────
  const unknown = await client.sendTask('definitely_not_a_skill')
  const unknownErr = (unknown.body as ErrorEnvelope)?.error
  check.ok(
    '【越权·未知技能】HTTP 404 SKILL_NOT_FOUND 并回列可用技能',
    unknown.status === 404 &&
      unknownErr?.code === 'SKILL_NOT_FOUND' &&
      /可用技能/.test(String(unknownErr?.message)),
    `status=${unknown.status} code=${String(unknownErr?.code)}`,
  )

  // ── ⑦ 缺 skillId ⇒ 400 ───────────────────────────────────────
  const missing = await client.sendTask('')
  const missingErr = (missing.body as ErrorEnvelope)?.error
  check.ok(
    '缺 skillId ⇒ HTTP 400 INVALID_ARGUMENT',
    missing.status === 400 && missingErr?.code === 'INVALID_ARGUMENT',
    `status=${missing.status} code=${String(missingErr?.code)}`,
  )

  return check.finish()
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error('示例执行异常：', err)
    process.exit(1)
  })

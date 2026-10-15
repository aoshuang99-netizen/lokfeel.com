/**
 * 示例 A · **发现面**（无需任何凭据）
 *
 * ── 它演示什么 ──────────────────────────────────────────────────
 *   在**没有令牌**的情况下，一个外部 Agent 能看到什么、不能看到什么：
 *     ✓ `initialize`      —— 握手（协议版本、服务器身份）
 *     ✓ `tools/list`      —— 能力清单（"能做什么"）
 *     ✓ agent card        —— A2A 侧的同一份能力清单
 *     ✗ `tools/call`      —— **必须**是 HTTP 401（"数据"不是公开的）
 *
 * ── 断言的核心：两份清单必须**逐字一致** ────────────────────────
 *   MCP 的 `tools/list` 与 A2A 的 agent card `skills` 是同一件事的两种表述。
 *   如果它们漂移（一边加了工具，另一边没加），**两边都不会报错** ——
 *   直到某个外部 Agent 说"你的卡片里没有这个 skill"。
 *   所以本示例做**双向集合相等**断言，而不是"各查各的"。
 *
 * 运行：`npx tsx examples/sdk/demo-discovery.ts`
 *      （`LOKFEEL_BASE_URL` 省略时默认 http://localhost:3099）
 */
import { resolveBaseUrl } from './config'
import { LokFeelClient } from './lokfeel-client'
import { createChecker } from './expect'

type AgentCard = {
  name?: string
  protocolVersion?: string
  url?: string
  capabilities?: { streaming?: boolean; pushNotifications?: boolean }
  securitySchemes?: Record<string, unknown>
  skills?: { id?: string; 'x-required-capability'?: string }[]
}

async function main(): Promise<number> {
  // 刻意**不**读 LOKFEEL_COOKIE：本示例的全部断言都建立在"没有凭据"之上，
  // 环境里若残留 cookie，'匿名调用必须 401' 会假失败（或更糟：假绿）。
  const baseUrl = resolveBaseUrl()
  const client = new LokFeelClient({ baseUrl })
  const check = createChecker(`发现面（匿名）· ${baseUrl}`)

  // ── ① MCP 握手 ────────────────────────────────────────────────
  const init = await client.initialize()
  const initResult = init.kind === 'result' ? (init.result as Record<string, unknown>) : undefined
  check.ok(
    'initialize 无需会话即返回',
    init.kind === 'result' && init.status === 200,
    `status=${init.status} kind=${init.kind}`,
  )
  check.ok(
    'initialize 返回协议版本与服务器身份',
    typeof initResult?.protocolVersion === 'string' && typeof initResult?.serverInfo === 'object',
    `protocolVersion=${String(initResult?.protocolVersion)}`,
  )
  check.ok('initialize 不泄漏凭据形态', !/token|secret|key/i.test(JSON.stringify(initResult ?? {})), '')

  // ── ② MCP 能力清单 ────────────────────────────────────────────
  const tools = await client.listTools()
  check.ok('tools/list 无需会话即可取到能力清单', tools.length > 0, `${tools.length} 个工具`)
  check.ok(
    '每个工具都声明了 requiredCapability（没有"看起来在执法"的空声明）',
    tools.every((t) => typeof t.annotations?.requiredCapability === 'string'),
    tools.map((t) => `${t.name}:${t.annotations?.requiredCapability}`).join(', '),
  )

  // ── ③ A2A agent card ──────────────────────────────────────────
  const card = (await client.agentCard()) as AgentCard | null
  const skills = card?.skills ?? []
  check.ok('agent card 可匿名获取', !!card && typeof card.name === 'string', `name=${card?.name}`)
  check.ok(
    'agent card 未声明未实现的能力（streaming / pushNotifications 均为 false）',
    card?.capabilities?.streaming === false && card?.capabilities?.pushNotifications === false,
    JSON.stringify(card?.capabilities ?? {}),
  )
  check.ok(
    'agent card 不含凭据（只有 securitySchemes 的形状声明）',
    !!card?.securitySchemes && !/"(?:api[_-]?key|secret|token|password)"\s*:/i.test(JSON.stringify(card)),
    `securitySchemes=${Object.keys(card?.securitySchemes ?? {}).join(',')}`,
  )

  // ── ④ 两份清单必须集合相等（**双向**）─────────────────────────
  const mcpNames = new Set(tools.map((t) => t.name))
  const cardIds = new Set(skills.map((s) => s.id ?? ''))
  const onlyInMcp = [...mcpNames].filter((n) => !cardIds.has(n))
  const onlyInCard = [...cardIds].filter((n) => !mcpNames.has(n))
  check.ok(
    'MCP tools/list 与 A2A agent card skills 双向一致',
    onlyInMcp.length === 0 && onlyInCard.length === 0,
    onlyInMcp.length || onlyInCard.length
      ? `仅出现在 MCP: [${onlyInMcp.join(', ')}]；仅出现在卡片: [${onlyInCard.join(', ')}]`
      : `${mcpNames.size} 项逐字一致`,
  )

  // 同一份清单，能力声明也必须逐字一致（防"清单同步了、能力写错了"）
  const capDrift = tools
    .map((t) => {
      const s = skills.find((x) => x.id === t.name)
      return s && s['x-required-capability'] !== t.annotations?.requiredCapability
        ? `${t.name}: 卡片=${String(s['x-required-capability'])} vs 工具=${String(t.annotations?.requiredCapability)}`
        : null
    })
    .filter((x): x is string => x !== null)
  check.ok('两份清单对每个工具声明的能力逐字一致', capDrift.length === 0, capDrift.join('; '))

  // ── ⑤ 数据面必须拒绝匿名 ──────────────────────────────────────
  const anonCall = await client.callTool('list_bridges')
  check.ok(
    '匿名 tools/call 必须是 HTTP 401（发现公开 / 协作需授权）',
    anonCall.status === 401,
    `status=${anonCall.status} kind=${anonCall.kind}`,
  )
  const anonTask = await client.sendTask('list_bridges')
  check.ok('匿名 A2A 任务必须是 HTTP 401', anonTask.status === 401, `status=${anonTask.status}`)

  return check.finish()
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error('示例执行异常：', err)
    process.exit(1)
  })

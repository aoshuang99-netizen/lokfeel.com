/**
 * 示例 B · **授权路径 vs 越权路径**（需要凭据）
 *
 * ── 为什么这两组必须放在一起演示 ────────────────────────────────
 *   只演示"能调通"证明不了任何安全属性 —— 任何人把守卫删掉，那个演示依然通过。
 *   安全命题的形状是**对照**：「同一个端点，有权限时成功、无权限时失败」。
 *   所以本示例的每一组都成对出现，且**越权那一半必须断言为失败**。
 *
 * ── 三组对照 ────────────────────────────────────────────────────
 *   ① 握手 + 会话建立  → `notifications/initialized` 返回 202（无响应体）
 *   ② 授权：有会话 + 能力足够   → `list_bridges`（bridge.read，任何成员都有）
 *   ③ 越权：三种不同成因，三种不同表达
 *        a. 无会话            → HTTP 401（传输层未认证）
 *        b. 有会话、能力不足  → HTTP 200 且 `result.isError = true`
 *                               （"调用成功、业务被拒"是工具结果，不是协议错误）
 *        c. 调用不存在的工具  → HTTP 200 且 JSON-RPC `-32602`，附可用清单
 *
 *   🔴 ③b 需要调用者的角色**恰好不具备** `mission.read`（OPERATOR 及以上才有）。
 *      若令牌是高权限账号，这组夹具不适用 —— 脚本会显式打印 SKIP，
 *      **不会**静默算通过（静默通过等于把"越权被拒"这条结论变成一句无证据的声明）。
 *
 * 运行：
 *   LOKFEEL_BASE_URL=http://localhost:3099 \
 *   LOKFEEL_LOGIN_EMAIL=qa.member@example.com \
 *   LOKFEEL_LOGIN_PASSWORD=… \
 *     npx tsx examples/sdk/demo-mcp.ts
 *
 *   （或用 LOKFEEL_COOKIE 直接给会话 Cookie；两种方式见 config.ts）
 */
import { createClient } from './config'
import { LokFeelClient, toolIsError, toolText, type McpError } from './lokfeel-client'
import { createChecker } from './expect'

/** 选定一个"高门槛"工具作为越权夹具：mission.read 属 OPERATOR+，普通成员没有。 */
const ELEVATED_TOOL = 'list_missions'
const ELEVATED_CAPABILITY = 'mission.read'

async function main(): Promise<number> {
  const { client, baseUrl, source } = await createClient({ requireCredential: true })
  const check = createChecker(`MCP 授权 / 越权 · ${baseUrl}（凭据来源：${source}）`)

  // ── ① 会话建立 ────────────────────────────────────────────────
  const init = await client.initialize()
  check.ok('initialize 成功', init.kind === 'result', `status=${init.status}`)

  const notified = await client.notifyInitialized()
  check.ok(
    'notifications/initialized 返回 202 且无响应体',
    notified.status === 202 && notified.kind === 'accepted',
    `status=${notified.status} kind=${notified.kind}`,
  )

  const tools = await client.listTools()
  check.ok('tools/list 拿到能力清单', tools.length > 0, `${tools.length} 个工具`)

  // ── ② 授权路径：能力足够 ⇒ 成功 ───────────────────────────────
  const allowed = await client.callTool('list_bridges', { limit: 3 })
  check.ok(
    '【授权】list_bridges（bridge.read，SELF_SERVICE）调用成功',
    allowed.kind === 'result' && allowed.status === 200 && toolIsError(allowed) === false,
    `status=${allowed.status} kind=${allowed.kind} isError=${String(toolIsError(allowed))}`,
  )
  console.log(`       结果片段：${toolText(allowed).slice(0, 160).replace(/\s+/g, ' ')}`)

  // ── ③a 越权：无会话 ⇒ 401 ────────────────────────────────────
  const anon = new LokFeelClient({ baseUrl })
  const noSession = await anon.callTool('list_bridges')
  check.ok(
    '【越权·无会话】HTTP 401（不是 200 + isError）',
    noSession.status === 401 && noSession.kind === 'error',
    `status=${noSession.status} kind=${noSession.kind}`,
  )

  // ── ③b 越权：能力不足 ⇒ 200 + isError ────────────────────────
  const elevated = await client.callTool(ELEVATED_TOOL, { pageSize: 1 })
  const elevatedErr = toolIsError(elevated)
  if (elevated.status === 401) {
    check.ok(
      '【越权·能力不足】凭据无效，无法判定（HTTP 401）',
      false,
      '请检查 LOKFEEL_COOKIE 或 LOKFEEL_LOGIN_EMAIL/PASSWORD',
    )
  } else if (elevatedErr === true) {
    check.ok(
      `【越权·能力不足】${ELEVATED_TOOL}（需 ${ELEVATED_CAPABILITY}）被拒且走 isError`,
      elevated.status === 200,
      `status=${elevated.status}：${toolText(elevated).slice(0, 90).replace(/\s+/g, ' ')}`,
    )
  } else if (elevatedErr === false) {
    check.skip(
      `【越权·能力不足】${ELEVATED_TOOL}`,
      `当前令牌角色具备 ${ELEVATED_CAPABILITY}，越权夹具不适用；请用 MEMBER 角色的令牌复跑本组`,
    )
  } else {
    check.ok(
      `【越权·能力不足】${ELEVATED_TOOL} 返回了非工具层结果`,
      false,
      `status=${elevated.status} kind=${elevated.kind}`,
    )
  }

  // ── ③c 越权：未知工具 ⇒ -32602 + 可用清单 ────────────────────
  const unknown = await client.callTool('definitely_not_a_tool')
  const unknownErr = unknown.kind === 'error' ? (unknown.error as McpError) : undefined
  const available = (unknownErr?.data as { available?: string[] } | undefined)?.available
  check.ok(
    '【越权·未知工具】JSON-RPC -32602，并回列可用工具',
    unknownErr?.code === -32602 && Array.isArray(available) && available.length === tools.length,
    `code=${String(unknownErr?.code)} available=${available?.length ?? 0}`,
  )

  // ── 越权：未实现的协议方法 ⇒ -32601 / 404 ────────────────────
  const badMethod = await client.mcpRaw('resources/list')
  const badMethodErr = badMethod.kind === 'error' ? badMethod.error : undefined
  check.ok(
    '未实现的协议方法返回 -32601 且 HTTP 404',
    badMethodErr?.code === -32601 && badMethod.status === 404,
    `code=${String(badMethodErr?.code)} status=${badMethod.status}`,
  )

  // 说明（不作为断言）：越权被拒时服务端会 `console.error('[mcp] capability denied …')`。
  // 本示例读不到服务端日志，故不写成"通过"—— 一条恒真的断言等于没有断言。
  // 真实核验方式见 docs/implementation/T11/slice-5.md 的门禁取证段。
  console.log('  · 提示：越权留痕可在平台日志按 `[mcp] capability denied` 检索（需人工核验）')

  return check.finish()
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error('示例执行异常：', err)
    process.exit(1)
  })

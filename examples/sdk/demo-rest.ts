/**
 * 示例 D · **REST 面 + 能力守卫**（需要凭据）
 *
 * ── 与前两个示例的关系 ──────────────────────────────────────────
 *   同一个授权模型（`ROLE_CAPABILITIES` 一张表）在三个面上的表达：
 *     GET  /api/v1/bridges   需 `bridge.read`   —— 自助能力，任何成员都有
 *     POST /api/v1/bridges   需 `bridge.manage` —— ADMIN+（决定"本群成员数据能否出街"）
 *   于是同一份令牌在 GET 上成功、在 POST 上被拒 —— 这就是 **AC-22** 要的形状。
 *
 * ── 🔴 本示例**不修改任何数据** ────────────────────────────────
 *   POST 之所以能安全演示越权，是因为两点巧合都对我们有利：
 *     · 能力守卫**先于**请求体校验 ⇒ 普通成员在读到 body 之前就被 403 拦下；
 *     · 而本项目按约定**要求 `Idempotency-Key`** ⇒ 即便调用者是 ADMIN，
 *       缺这个 header 也只会拿到 400，不会真的建出一份协议。
 *   因此示例**刻意不传** `Idempotency-Key` —— 演示脚本不该有副作用。
 *
 * ── 另一个被断言的点：守卫顺序 ──────────────────────────────────
 *   匿名 POST 必须是 **401**（而不是 400 "缺少幂等键"）。
 *   若顺序反了，请求体会先被校验 —— 那意味着**未认证的输入被用来驱动逻辑**，
 *   而且错误信息会泄漏"这个端点需要哪些字段"给未认证方。
 *
 * 运行：
 *   LOKFEEL_BASE_URL=http://localhost:3099 \
 *   LOKFEEL_LOGIN_EMAIL=qa.member@example.com \
 *   LOKFEEL_LOGIN_PASSWORD=… \
 *     npx tsx examples/sdk/demo-rest.ts
 *
 *   （或用 LOKFEEL_COOKIE 直接给会话 Cookie；两种方式见 config.ts）
 */
import { createClient } from './config'
import { LokFeelClient } from './lokfeel-client'
import { createChecker } from './expect'

const READ_PATH = '/api/v1/bridges?limit=2'
const MANAGE_PATH = '/api/v1/bridges'

async function main(): Promise<number> {
  const { client, baseUrl, source } = await createClient({ requireCredential: true })
  const check = createChecker(`REST 授权 / 越权 · ${baseUrl}（凭据来源：${source}）`)

  // ── ① 授权路径：GET（bridge.read，自助）───────────────────────
  const get = await client.rest('GET', READ_PATH)
  check.ok(
    '【授权】GET /api/v1/bridges（bridge.read）→ 200',
    get.status === 200,
    `status=${get.status}`,
  )
  const body = get.body as { data?: unknown; error?: { code?: string } } | null
  check.ok(
    '200 的响应是业务信封（data 存在、无 error）',
    !!body && body.error === undefined && 'data' in body,
    `keys=${body && typeof body === 'object' ? Object.keys(body).join(',') : typeof body}`,
  )

  // ── ② 越权·无会话：GET 401 ───────────────────────────────────
  const anonClient = new LokFeelClient({ baseUrl })
  const anonGet = await anonClient.rest('GET', READ_PATH)
  check.ok('【越权·无会话】GET → 401', anonGet.status === 401, `status=${anonGet.status}`)

  // ── ③ 守卫顺序：匿名 POST 必须 401（不是 400）────────────────
  const anonPost = await anonClient.rest('POST', MANAGE_PATH, {})
  check.ok(
    '【守卫顺序】匿名 POST → 401，而非 400（能力守卫先于请求体校验）',
    anonPost.status === 401,
    `status=${anonPost.status}`,
  )

  // ── ④ 越权·能力不足：POST 需 bridge.manage（ADMIN+）─────────
  // 刻意不传 Idempotency-Key：见文件头「本示例不修改任何数据」。
  const post = await client.rest('POST', MANAGE_PATH, {})
  if (post.status === 403) {
    const err = (post.body as { error?: { code?: string } } | null)?.error
    check.ok(
      '【越权·能力不足】POST /api/v1/bridges（bridge.manage）→ 403',
      true,
      `status=403 code=${String(err?.code)}`,
    )
  } else if (post.status === 400) {
    check.skip(
      '【越权·能力不足】POST /api/v1/bridges',
      `当前令牌角色具备 bridge.manage（ADMIN+），能力门槛未触发；` +
        `收到的 400 是"缺少 Idempotency-Key"这一层。请用 MEMBER 角色复跑本组`,
    )
  } else {
    check.ok(
      '【越权·能力不足】POST 返回了意外状态（可能创建了资源，请立即核查）',
      false,
      `status=${post.status} body=${JSON.stringify(post.body).slice(0, 120)}`,
    )
  }

  // ── ⑤ 越权·能力不足的另一半：A2A / MCP 的同源结论已在各自示例里 ──
  // 此处只补一个"不存在的能力不等于放行"的对照：不存在的路径 ⇒ 404。
  const notFound = await client.rest('GET', '/api/v1/no-such-resource')
  check.ok('不存在的路径 → 404（不会退化成 200 空列表）', notFound.status === 404, `status=${notFound.status}`)

  return check.finish()
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error('示例执行异常：', err)
    process.exit(1)
  })

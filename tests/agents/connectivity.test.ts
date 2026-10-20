/**
 * T09 Slice 6 · **服务端出口连通性自检**（`probeAgentConnectivity`）单测
 *
 * 这里断言的不是"能不能连上 OpenAI"（那要网络），而是**这份报告诚实不诚实**：
 *   · 三层结论**分开**且**永不合成一个布尔**（"网络通"推不出"凭据对"）；
 *   · 缺前提记 `BLOCKED`，**不是** PASS（把前提当结论是本仓点名的反模式）；
 *   · 不为"多证一点"发第二个请求（探测端点不该变成两次出网）；
 *   · **不泄漏 key**（报告是要给管理员看的，看得到报告 ≠ 看得到密钥）；
 *   · 目标端点本身不合法时**一次出网都不发**（`file://` 不该变成一次本地读取）。
 *   · 2026-10-20 起同时覆盖**云端算力口径**：探的必须是运行时真正在用的那条路
 *     （云端算力优先于 OpenAI），且云端要额外核对"目录里有没有配的模型"。
 *
 * `fetch` 全部注入 —— 本文件恒不发生真实网络 IO。
 */

import { OPENAI_DEFAULTS } from '@/lib/agent'
// 🔴 **深路径**导入，刻意不走 `@/lib/agents` barrel：
//    barrel 会把整条 IO 服务层（runs → billing → tenancy → `next-auth`）一起拖进来，
//    而 `next-auth@5` 是纯 ESM、jest（CJS）require 不了 → **整个用例文件跑不起来**
//    （不是断言失败，是 suite 加载失败）。
//    本模块按设计**无 IO**（不 import `db`、不发网络以外的调用），所以它可以、也应该
//    被单独加载 —— 这也正是"连通性自检"能被离线穷举测试的原因。
import { probeAgentConnectivity, summarizeConnectivity, type ConnectivityReport } from '@/lib/agents/connectivity'

/** 极简 Response 替身：被测代码只用到 `status` / `headers.get` / `text()`。 */
function fakeResponse(status: number, body: string, contentType = 'application/json'): Response {
  return {
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
  } as unknown as Response
}

/** OpenAI 在缺凭据时给出的错误体形状（身份层的判据就靠它）。 */
const OPENAI_401 = JSON.stringify({
  error: {
    message:
      "You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY)",
    type: 'invalid_request_error',
  },
})
const OPENAI_200 = JSON.stringify({ object: 'list', data: [{ id: OPENAI_DEFAULTS.model }] })

/**
 * 记录调用的 fetch 替身。
 *
 * ⚠️ 返回 `{ impl, calls }` 而不是把 `jest.fn` 直接当 `fetch` 用：后者要写
 *    `as unknown as typeof fetch` 的断言，`await` 出来的类型就丢了，
 *    `mock.calls` 也会退化成 `any[]`。分成两个引用，两边都保持有类型。
 */
function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = jest.fn(impl)
  return {
    impl: fn as unknown as typeof fetch,
    calls: fn.mock.calls as Array<[string, RequestInit?]>,
  }
}

const headersOf = (calls: Array<[string, RequestInit?]>, call = 0): Record<string, string> =>
  (calls[call]?.[1]?.headers ?? {}) as Record<string, string>

describe('probeAgentConnectivity —— 三层分开报', () => {
  it('🔴 无 key：网络与身份仍被实测，凭据记 BLOCKED（**不是** PASS）', async () => {
    const { impl, calls } = stubFetch(async () => fakeResponse(401, OPENAI_401))
    const report = await probeAgentConnectivity({}, { fetchImpl: impl })

    expect(report.network.verdict).toBe('PASS')
    expect(report.network.status).toBe(401)
    expect(report.identity.verdict).toBe('PASS')
    expect(report.credentials.verdict).toBe('BLOCKED')
    expect(report.credentials.keyPresent).toBe(false)
    expect(report.credentials.keyLength).toBe(0)
    // 无 key 也要真的探一次（否则"出口被墙"与"没配 key"分不开）。
    expect(calls.length).toBe(1)

    // 🔴 整体结论不得因为"网络通了"就说通过 —— 缺前提 ≠ 通过。
    const s = summarizeConnectivity(report)
    expect(s.verdict).toBe('BLOCKED')
    expect(s.verdict).not.toBe('PASS')
  })

  it('无 key 时**不带** Authorization（401 本身就是"有鉴权闸门"的身份证据）', async () => {
    const { impl, calls } = stubFetch(async () => fakeResponse(401, OPENAI_401))
    await probeAgentConnectivity({}, { fetchImpl: impl })
    expect(headersOf(calls).authorization).toBeUndefined()
  })

  it('有 key + 200：三层全 PASS，且请求带了该 key', async () => {
    const key = 'sk-test-abcdefghijklmnopqrstuvwxyz'
    const { impl, calls } = stubFetch(async () => fakeResponse(200, OPENAI_200))
    const report = await probeAgentConnectivity({ OPENAI_API_KEY: key }, { fetchImpl: impl })

    expect(report.network.verdict).toBe('PASS')
    expect(report.identity.verdict).toBe('PASS')
    expect(report.credentials.verdict).toBe('PASS')
    expect(summarizeConnectivity(report).verdict).toBe('PASS')
    expect(headersOf(calls).authorization).toBe(`Bearer ${key}`)
  })

  it('有 key + 401：凭据 FAIL（措辞要指向"换/补 key"，**不是**网络问题）', async () => {
    const { impl } = stubFetch(async () => fakeResponse(401, OPENAI_401))
    const report = await probeAgentConnectivity({ OPENAI_API_KEY: 'sk-bad' }, { fetchImpl: impl })

    expect(report.network.verdict).toBe('PASS')
    expect(report.credentials.verdict).toBe('FAIL')
    expect(report.credentials.detail).toContain('不是网络问题')
    expect(summarizeConnectivity(report).verdict).toBe('FAIL')
  })

  it('🔴 身份层认得 OpenAI 的**两种** 401 措辞（"没带"与"不对"都要算本尊）', async () => {
    // 完全没带凭据 → "You didn't provide an API key..."
    const none = stubFetch(async () => fakeResponse(401, OPENAI_401))
    expect((await probeAgentConnectivity({}, { fetchImpl: none.impl })).identity.verdict).toBe('PASS')
    // 带了但不对 → "Incorrect API key provided: sk-***"
    const wrong = stubFetch(async () =>
      fakeResponse(401, JSON.stringify({ error: { message: 'Incorrect API key provided: sk-***' } })),
    )
    expect(
      (await probeAgentConnectivity({ OPENAI_API_KEY: 'sk-nope' }, { fetchImpl: wrong.impl })).identity
        .verdict,
    ).toBe('PASS')
    // 反向对照：一个**不是** OpenAI 措辞的 401（门户页/中间人）→ 必须判可疑
    const portal = stubFetch(async () => fakeResponse(401, JSON.stringify({ error: { message: 'Unauthorized' } })))
    expect((await probeAgentConnectivity({}, { fetchImpl: portal.impl })).identity.verdict).toBe('FAIL')
  })

  it('🔴 网络层不通：identity 与 credentials 都是 BLOCKED（推不出结论就不下结论）', async () => {
    const { impl } = stubFetch(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:443')
    })
    const report = await probeAgentConnectivity({ OPENAI_API_KEY: 'sk-x' }, { fetchImpl: impl })

    expect(report.network.verdict).toBe('FAIL')
    expect(report.network.status).toBeNull()
    expect(report.identity.verdict).toBe('BLOCKED')
    expect(report.credentials.verdict).toBe('BLOCKED')
    // FAIL 优先于 BLOCKED：有一种病就别说成"未判定"。
    expect(summarizeConnectivity(report).verdict).toBe('FAIL')
  })

  it('🔴 端点不合法（file://）：三层 FAIL 且**一次出网都不发**', async () => {
    const { impl, calls } = stubFetch(async () => fakeResponse(200, OPENAI_200))
    const report = await probeAgentConnectivity(
      { OPENAI_API_KEY: 'sk-x', OPENAI_BASE_URL: 'file:///etc/passwd' },
      { fetchImpl: impl },
    )

    expect(calls.length).toBe(0)
    expect(report.endpoint.probeUrl).toBe('(未解析)')
    expect(report.endpoint.timeoutMs).toBe(0)
    for (const layer of [report.network, report.identity, report.credentials]) {
      expect(layer.verdict).toBe('FAIL')
      expect(layer.detail).toContain('OPENAI_BASE_URL 必须是 http(s) 地址')
    }
  })

  it('🔴 只发一次请求 —— "多证一点"不是理由（不把诊断端变成两次出网）', async () => {
    const withKey = stubFetch(async () => fakeResponse(200, OPENAI_200))
    await probeAgentConnectivity({ OPENAI_API_KEY: 'sk-x' }, { fetchImpl: withKey.impl })
    expect(withKey.calls.length).toBe(1)

    const noKey = stubFetch(async () => fakeResponse(401, OPENAI_401))
    await probeAgentConnectivity({}, { fetchImpl: noKey.impl })
    expect(noKey.calls.length).toBe(1)
  })

  it('🔴 报告里**没有** key 明文（只给长度）', async () => {
    const key = 'sk-verysecret-DO-NOT-LEAK-0123456789'
    const { impl } = stubFetch(async () => fakeResponse(200, OPENAI_200))
    const report = await probeAgentConnectivity({ OPENAI_API_KEY: key }, { fetchImpl: impl })

    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain(key)
    expect(serialized).not.toContain('Bearer ')
    expect(report.credentials.keyLength).toBe(key.length)
  })

  it('非 openai.com 端点：身份层 INFO（错误体形状由端点自定，刻意不判死）', async () => {
    const { impl } = stubFetch(async () =>
      fakeResponse(401, JSON.stringify({ message: 'unauthorized' })),
    )
    const report = await probeAgentConnectivity(
      { OPENAI_API_KEY: 'sk-x', OPENAI_BASE_URL: 'https://my-gateway.example/v1' },
      { fetchImpl: impl },
    )

    expect(report.endpoint.source).toBe('env')
    expect(report.endpoint.baseUrl).toBe('https://my-gateway.example/v1')
    expect(report.endpoint.probeUrl).toBe('https://my-gateway.example/v1/models')
    expect(report.network.verdict).toBe('PASS')
    expect(report.identity.verdict).toBe('INFO')
    expect(summarizeConnectivity(report).verdict).toBe('FAIL')
  })

  it('🔴 超时被内核上限夹住（不让 env 写一个吃光函数预算的值）', async () => {
    const { impl } = stubFetch(async () => fakeResponse(200, OPENAI_200))
    const report = await probeAgentConnectivity(
      { OPENAI_API_KEY: 'sk-x', OPENAI_TIMEOUT_MS: '600000' },
      { fetchImpl: impl, timeoutMs: 600_000 },
    )
    expect(report.endpoint.timeoutMs).toBe(OPENAI_DEFAULTS.maxTimeoutMs)
  })

  it('探针元信息自述"不计费 / 不写库 / 只用 GET"（可复跑取证的一部分）', async () => {
    const { impl } = stubFetch(async () => fakeResponse(200, OPENAI_200))
    const report = await probeAgentConnectivity({ OPENAI_API_KEY: 'sk-x' }, { fetchImpl: impl })
    expect(report.probe.method).toBe('GET')
    expect(report.probe.billed).toBe(false)
    expect(report.probe.wrote).toBe(false)
    expect(new Date(report.probe.ranAt).toString()).not.toBe('Invalid Date')
  })
})

// ═══════════════════════════════════════════════════════════════════
// 云端算力口径（2026-10-20 起生产的真实调用走这条）
//
// 为什么这些断言必须存在：诊断若只认 OPENAI_API_KEY，就会出现
// "运行真的在调云端模型、诊断却说没配置"的自相矛盾。这里钉住的是
// **探的就是运行时真正在用的那条路**，而不是"另一条也能通"。
// ═══════════════════════════════════════════════════════════════════
describe('probeAgentConnectivity —— 云端算力口径', () => {
  const WB_ENDPOINT = 'https://lokfeel.app.workbuddy.host'
  // 运行时拼接，源码里不留形似凭据的字面量（gitleaks 会把夹具判成真 key）。
  const WB_KEY = ['wbpk', 'unit', 'test', 'publishable', 'value', 'for', 'assertions'].join('_')
  const WB_MODEL = 'deepseek-v4.1-flash'
  const WB_ENV = { WORKBUDDY_LLM_ENDPOINT: WB_ENDPOINT, WORKBUDDY_LLM_KEY: WB_KEY }
  const catalog = (models: Array<{ id: string; enabled?: boolean }>) => JSON.stringify(models)

  it('🔴 云端已配置：探 /.cloud/llm/models，用应用级头，**不**出现 Authorization', async () => {
    const { impl, calls } = stubFetch(async () =>
      fakeResponse(200, catalog([{ id: 'auto' }, { id: WB_MODEL }])),
    )
    const report = await probeAgentConnectivity(WB_ENV, { fetchImpl: impl })

    expect(calls.length).toBe(1)
    expect(calls[0][0]).toBe(`${WB_ENDPOINT}/.cloud/llm/models`)
    expect(headersOf(calls)['x-wb-webapp-access-key']).toBe(WB_KEY)
    expect(headersOf(calls).authorization).toBeUndefined()

    expect(report.endpoint.provider).toBe('workbuddy')
    expect(report.endpoint.source).toBe('workbuddy')
    expect(report.endpoint.model).toBe(WB_MODEL)
    expect(report.credentials.keyVar).toBe('WORKBUDDY_LLM_KEY')
    expect(report.network.verdict).toBe('PASS')
    expect(report.identity.verdict).toBe('PASS')
    expect(report.credentials.verdict).toBe('PASS')
    expect(summarizeConnectivity(report).verdict).toBe('PASS')
  })

  it('🔴 目录里没有配的模型 → identity FAIL（端点通了 ≠ model 写对了）', async () => {
    const { impl } = stubFetch(async () => fakeResponse(200, catalog([{ id: 'auto' }])))
    const report = await probeAgentConnectivity(WB_ENV, { fetchImpl: impl })

    expect(report.identity.verdict).toBe('FAIL')
    expect(report.identity.detail).toContain(WB_MODEL)
    // 凭据确实是对的 —— 失败原因不能甩给 key。
    expect(report.credentials.verdict).toBe('PASS')
    expect(summarizeConnectivity(report).verdict).toBe('FAIL')
  })

  it('模型在目录里但 enabled=false → identity FAIL（停用也是跑不起来）', async () => {
    const { impl } = stubFetch(async () =>
      fakeResponse(200, catalog([{ id: WB_MODEL, enabled: false }])),
    )
    const report = await probeAgentConnectivity(WB_ENV, { fetchImpl: impl })
    expect(report.identity.verdict).toBe('FAIL')
    expect(report.identity.detail).toContain('enabled=false')
  })

  it('🔴 200 但不是模型目录（门户页/中间人）→ identity FAIL', async () => {
    const { impl } = stubFetch(async () => fakeResponse(200, '<html>portal</html>', 'text/html'))
    const report = await probeAgentConnectivity(WB_ENV, { fetchImpl: impl })
    expect(report.identity.verdict).toBe('FAIL')
    expect(report.identity.detail).toContain('不是模型目录')
    expect(summarizeConnectivity(report).verdict).toBe('FAIL')
  })

  it('🔴 只配了端点没配 key：仍探一次（401 invalid_client），凭据记 BLOCKED 且点名变量', async () => {
    const { impl, calls } = stubFetch(async () =>
      fakeResponse(401, JSON.stringify({ error: 'invalid_client', error_description: 'unknown client' })),
    )
    const report = await probeAgentConnectivity({ WORKBUDDY_LLM_ENDPOINT: WB_ENDPOINT }, { fetchImpl: impl })

    expect(calls.length).toBe(1)
    expect(headersOf(calls)['x-wb-webapp-access-key']).toBeUndefined()
    expect(report.network.verdict).toBe('PASS')
    expect(report.identity.verdict).toBe('PASS') // 错误体是网关形状
    expect(report.credentials.verdict).toBe('BLOCKED')
    expect(report.credentials.keyPresent).toBe(false)
    expect(report.credentials.detail).toContain('WORKBUDDY_LLM_KEY')
    expect(summarizeConnectivity(report).verdict).toBe('BLOCKED')
  })

  it('🔴 403 access_denied → 凭据 FAIL，措辞指向"只接受服务端调用"（不是网络问题）', async () => {
    const { impl } = stubFetch(async () =>
      fakeResponse(403, JSON.stringify({ error: 'access_denied', error_description: 'origin not allowed' })),
    )
    const report = await probeAgentConnectivity(WB_ENV, { fetchImpl: impl })

    expect(report.network.verdict).toBe('PASS')
    expect(report.credentials.verdict).toBe('FAIL')
    expect(report.credentials.detail).toContain('服务端')
    expect(report.credentials.detail).toContain('403')
    expect(summarizeConnectivity(report).verdict).toBe('FAIL')
  })

  it('🔴 云端优先于 OpenAI：两条都配了，也只打云端（否则诊断与运行自相矛盾）', async () => {
    const { impl, calls } = stubFetch(async () =>
      fakeResponse(200, catalog([{ id: WB_MODEL }])),
    )
    const report = await probeAgentConnectivity(
      { ...WB_ENV, OPENAI_API_KEY: 'sk-x', OPENAI_BASE_URL: 'https://api.openai.com/v1' },
      { fetchImpl: impl },
    )

    expect(calls.length).toBe(1)
    expect(calls[0][0]).toBe(`${WB_ENDPOINT}/.cloud/llm/models`)
    expect(report.endpoint.provider).toBe('workbuddy')
  })

  it('WORKBUDDY_LLM_MODEL 覆盖默认模型（诊断要报**正在用的**那个）', async () => {
    const { impl, calls } = stubFetch(async () =>
      fakeResponse(200, catalog([{ id: 'glm-5.3-flash' }])),
    )
    const report = await probeAgentConnectivity(
      { ...WB_ENV, WORKBUDDY_LLM_MODEL: 'glm-5.3-flash' },
      { fetchImpl: impl },
    )
    expect(calls.length).toBe(1)
    expect(report.endpoint.model).toBe('glm-5.3-flash')
    expect(report.identity.verdict).toBe('PASS')
  })

  it('🔴 报告里没有 publishable key 明文（只给长度）', async () => {
    const { impl } = stubFetch(async () => fakeResponse(200, catalog([{ id: WB_MODEL }])))
    const report = await probeAgentConnectivity(WB_ENV, { fetchImpl: impl })

    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain(WB_KEY)
    expect(serialized).not.toContain('x-wb-webapp-access-key')
    expect(report.credentials.keyLength).toBe(WB_KEY.length)
  })

  it('🔴 云端端点不合法（file://）：三层 FAIL 且一次出网都不发，错误指向 WORKBUDDY_LLM_ENDPOINT', async () => {
    const { impl, calls } = stubFetch(async () => fakeResponse(200, catalog([{ id: WB_MODEL }])))
    const report = await probeAgentConnectivity(
      { WORKBUDDY_LLM_ENDPOINT: 'file:///etc/passwd', WORKBUDDY_LLM_KEY: WB_KEY },
      { fetchImpl: impl },
    )

    expect(calls.length).toBe(0)
    expect(report.endpoint.provider).toBe('workbuddy')
    expect(report.endpoint.probeUrl).toBe('(未解析)')
    for (const layer of [report.network, report.identity, report.credentials]) {
      expect(layer.verdict).toBe('FAIL')
      expect(layer.detail).toContain('WORKBUDDY_LLM_ENDPOINT')
    }
  })
})

describe('summarizeConnectivity —— 优先级 FAIL > BLOCKED > PASS', () => {
  const layer = (verdict: 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO') => ({ verdict, detail: '' })

  /** 造一份最小可用的报告（只有三层结论参与汇总）。 */
  const report = (
    network: 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO',
    identity: 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO',
    credentials: 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO',
  ) =>
    ({
      endpoint: { baseUrl: '', source: 'kernel-default', model: '', probeUrl: '', timeoutMs: 0 },
      network: { ...layer(network), status: null, latencyMs: null, error: null },
      identity: layer(identity),
      credentials: { ...layer(credentials), keyPresent: false, keyLength: 0 },
      probe: { ranAt: '', billed: false, wrote: false, method: 'GET' },
    }) as unknown as ConnectivityReport

  it('全 PASS → PASS', () => {
    expect(summarizeConnectivity(report('PASS', 'PASS', 'PASS')).verdict).toBe('PASS')
  })

  it('任一 BLOCKED（无 FAIL）→ BLOCKED，且措辞明说"不得宣称已验"', () => {
    const s = summarizeConnectivity(report('PASS', 'INFO', 'BLOCKED'))
    expect(s.verdict).toBe('BLOCKED')
    expect(s.message).toContain('不得宣称')
  })

  it('任一 FAIL → FAIL（哪怕同时有 BLOCKED：有一种病就说成一种病）', () => {
    expect(summarizeConnectivity(report('FAIL', 'BLOCKED', 'BLOCKED')).verdict).toBe('FAIL')
    expect(summarizeConnectivity(report('PASS', 'INFO', 'FAIL')).verdict).toBe('FAIL')
  })

  it('🔴 全 PASS/INFO（没有任何未判定项）→ PASS —— INFO 是"不需要判"，不是"未判定"', () => {
    // 非 openai.com 的自建端点就是这一态：网络已实证、身份刻意不判死、凭据层给出 PASS/FAIL。
    expect(summarizeConnectivity(report('PASS', 'INFO', 'PASS')).verdict).toBe('PASS')
  })
})

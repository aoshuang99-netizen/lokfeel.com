/**
 * T09 · 真实 OpenAI Provider 测试（Slice 3）
 *
 * ═══════════════════════════════════════════════════════════════
 * 这个套件钉住什么
 * ═══════════════════════════════════════════════════════════════
 * 这条路径**唯一**的失职方式是"撒谎"：把打不通说成打过了、把降级说成调用成功。
 * 所以断言全部围绕"失败要**可判定**、缺凭据要**明确不可用**"：
 *
 *   ① **请求体逐字可断言**（注入 `fetchImpl`）：端点、方法、鉴权头、system/user 两段、
 *      `temperature: 0`、不可信区在 user 段 —— 任何一处写错都会被逐字比对抓住。
 *   ② **失败映射分开**：401/403 = 凭据（该去配 env）· 408/504 = 超时（可重试）·
 *      其余 4xx/5xx = 请求错（该改代码）。混成一个码会让看板上分不清该做什么。
 *   ③ **缺 usage 即拒绝** —— AC-20 要求每次调用可归因；记 0 是"账本少算"，不是免费。
 *   ④ **截断即拒绝**（`finish_reason: 'length'`）：半截 JSON 不是"短一点的产出"。
 *   ⑤ **绝不静默降级成假模型**：`resolveRuntimeProvider({})` 必须 `unavailable`。
 *   ⑥ **凭据只出现在鉴权头里**：不进 URL、不进请求体、不进我们自己拼的错误信息。
 *   ⑦ **端到端**：`openai` → DB 枚举 `OPENAI` 的映射真的被走过（此前的测试都只走 STUB）。
 *
 * ⚠️ **沙箱探不了外部网络**（本仓既有结论）：所有用例都注入 `fetchImpl`（一个返回
 *    鸭子类型响应的假 fetch，只实现 provider 真正用到的 `ok/status/text()`），
 *    因此"真实端点可达"这件事**没有被取证**，只被记为已知限制（见 slice-3.md）。
 */

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
import { EMPTY_LEDGER, OPENAI_DEFAULTS, resolveProviderConfig, runSkill } from '@/lib/agent'
import { createAgentRun, createOpenAIProvider, providerHonesty, resolveRuntimeProvider } from '@/lib/agents'
import type { TenantContext } from '@/lib/tenancy/resolve'
import { createFakeAgentDb, installFakeAgentDb, type FakeAgentDb } from './_fake-db'

const ORG = 'org_1'
const ctx = (): TenantContext => ({ organizationId: ORG, userId: 'u_1', role: 'ADMIN', membershipId: 'ms_1' })

const validAdvice = { rationale: '双方都在做渠道对接', suggestions: ['先发一条介绍'], candidateIds: ['cand_1'] }
const adviceInput = { goal: '为社群成员对接合适的合作伙伴', allowedCandidateIds: ['cand_1'] }

/** provider 真正用到的响应形状 —— 只实现这三样，避免依赖全局 `Response`。 */
interface FakeRes {
  ok: boolean
  status: number
  text: () => Promise<string>
}

function resOf(status: number, body: string): FakeRes {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

function okRes(body: Record<string, unknown>): string {
  return JSON.stringify({
    choices: [{ message: { content: JSON.stringify(body) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  })
}

/** 造一个"成功响应"的 fetch。 */
function okFetch(content: string, prompt = 100, completion = 50) {
  return jest.fn(async () =>
    resOf(
      200,
      JSON.stringify({
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: prompt, completion_tokens: completion },
      }),
    ),
  ) as unknown as typeof fetch
}

function errFetch(status: number, body = '{"error":{"message":"boom"}}') {
  return jest.fn(async () => resOf(status, body)) as unknown as typeof fetch
}

const REQ = { system: 's', untrusted: 'u', instruction: 'i', maxOutputTokens: 10 }

let fake: FakeAgentDb

beforeEach(() => {
  jest.clearAllMocks()
  fake = createFakeAgentDb()
  installFakeAgentDb(db, fake)
})

// ═══════════════════════════════════════════════════════════
// ① 环境解码（纯函数）
// ═══════════════════════════════════════════════════════════

describe('① resolveProviderConfig：纯函数的环境解码', () => {
  it('缺 OPENAI_API_KEY → ok:false（而不是"用 stub 顶上"）', () => {
    const r = resolveProviderConfig({})
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('OPENAI_API_KEY')
  })

  it('空字符串/纯空白不算配了', () => {
    expect(resolveProviderConfig({ OPENAI_API_KEY: '   ' }).ok).toBe(false)
  })

  it('有 key → ok:true，并用默认模型/端点/超时', () => {
    const r = resolveProviderConfig({ OPENAI_API_KEY: 'sk-test' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.apiKey).toBe('sk-test')
    expect(r.config.model).toBe(OPENAI_DEFAULTS.model)
    expect(r.config.baseUrl).toBe(OPENAI_DEFAULTS.baseUrl)
    expect(r.config.timeoutMs).toBe(OPENAI_DEFAULTS.timeoutMs)
  })

  it('model/baseUrl 可覆盖，且 baseUrl 去掉尾部斜杠', () => {
    const r = resolveProviderConfig({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-x',
      OPENAI_BASE_URL: 'https://example.test/v1///',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.model).toBe('gpt-x')
    expect(r.config.baseUrl).toBe('https://example.test/v1')
  })

  it('🔴 非 http(s) 端点直接拒绝（否则"调用模型"会变成一次本地读取）', () => {
    expect(resolveProviderConfig({ OPENAI_API_KEY: 'sk', OPENAI_BASE_URL: 'file:///etc/passwd' }).ok).toBe(false)
    expect(resolveProviderConfig({ OPENAI_API_KEY: 'sk', OPENAI_BASE_URL: '/relative/path' }).ok).toBe(false)
  })

  it('🔴 超时有上限：env 写多大都不会把函数预算吃光', () => {
    const r = resolveProviderConfig({ OPENAI_API_KEY: 'sk', OPENAI_TIMEOUT_MS: '99999999' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.timeoutMs).toBe(OPENAI_DEFAULTS.maxTimeoutMs)
  })

  it('非法/非正超时 → 回落默认（不把 NaN 传下去）', () => {
    for (const raw of ['abc', '-1', '0', '']) {
      const r = resolveProviderConfig({ OPENAI_API_KEY: 'sk', OPENAI_TIMEOUT_MS: raw })
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      expect(r.config.timeoutMs).toBe(OPENAI_DEFAULTS.timeoutMs)
    }
  })

  it('纯函数：同一 env 必得同一结果', () => {
    const env = { OPENAI_API_KEY: 'sk-test' }
    expect(resolveProviderConfig(env)).toEqual(resolveProviderConfig(env))
    expect(resolveProviderConfig({}).ok).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════
// ② 解析：ready / unavailable 的语义
// ═══════════════════════════════════════════════════════════

describe('② resolveRuntimeProvider：绝不静默降级', () => {
  it('🔴 缺凭据 → unavailable（不是 ready，更不是 stub）', () => {
    const r = resolveRuntimeProvider({})
    expect(r.kind).toBe('unavailable')
    expect(r.kind === 'unavailable' && r.reason).toContain('OPENAI_API_KEY')
  })

  it('有凭据 → ready，provider.kind === openai', () => {
    const r = resolveRuntimeProvider({ OPENAI_API_KEY: 'sk-test' })
    expect(r.kind).toBe('ready')
    if (r.kind !== 'ready') return
    expect(r.provider.kind).toBe('openai')
    expect(r.provider.name).toContain(OPENAI_DEFAULTS.model)
  })

  it('诚实块与解析同源：realCallsEnabled = (解析成功)，且不泄露凭据', () => {
    expect(providerHonesty({}).realCallsEnabled).toBe(false)
    const withKey = providerHonesty({ OPENAI_API_KEY: 'sk-test-value' })
    expect(withKey.realCallsEnabled).toBe(true)
    expect(JSON.stringify(withKey)).not.toContain('sk-test-value')
  })
})

// ═══════════════════════════════════════════════════════════
// ③ 请求体逐字可断言
// ═══════════════════════════════════════════════════════════

describe('③ 请求体：端点/方法/鉴权/两段消息/温度', () => {
  it('打的是 {baseUrl}/chat/completions，带 Bearer 鉴权，两段消息，temperature 0', async () => {
    const fetchImpl = okFetch(JSON.stringify(validAdvice))
    const p = createOpenAIProvider({
      apiKey: 'sk-secret',
      model: 'gpt-test',
      baseUrl: 'https://api.example.test/v1',
      timeoutMs: 5_000,
      fetchImpl,
    })

    await p.complete({
      system: 'SYS',
      untrusted: '<untrusted_data>\nU\n</untrusted_data>',
      instruction: 'INS',
      maxOutputTokens: 321,
    })

    const mock = fetchImpl as unknown as jest.Mock
    expect(mock).toHaveBeenCalledTimes(1)
    const [url, init] = mock.mock.calls[0]
    expect(url).toBe('https://api.example.test/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer sk-secret')

    const body = JSON.parse(init.body)
    expect(body.model).toBe('gpt-test')
    expect(body.max_tokens).toBe(321)
    expect(body.temperature).toBe(0)
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' })
    // 🔴 指令（可信）在前、不可信区（已包裹）在后 —— 两者不得混写。
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content).toBe('INS\n\n<untrusted_data>\nU\n</untrusted_data>')
    // 刻意**不传** response_format（部分兼容端点不支持，写死会 400）。
    expect(body.response_format).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════
// ④ 成功路径与归因
// ═══════════════════════════════════════════════════════════

describe('④ 成功路径：文本 + 归因都在', () => {
  it('解析出 content 与 usage', async () => {
    const p = createOpenAIProvider({ apiKey: 'sk', fetchImpl: okFetch('{"a":1}', 111, 22) })
    const r = await p.complete(REQ)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toBe('{"a":1}')
    expect(r.usage).toEqual({ inputTokens: 111, outputTokens: 22 })
  })

  it('🔴 缺 usage → 拒绝接受（AC-20：记 0 是账本少算，不是免费）', async () => {
    const fetchImpl = jest.fn(async () =>
      resOf(200, JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] })),
    ) as unknown as typeof fetch
    const r = await createOpenAIProvider({ apiKey: 'sk', fetchImpl }).complete(REQ)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('PROVIDER_ERROR')
    expect(r.ok === false && r.message).toMatch(/归因/)
  })

  it('🔴 finish_reason=length → 拒绝半截产出', async () => {
    const fetchImpl = jest.fn(async () =>
      resOf(
        200,
        JSON.stringify({
          choices: [{ message: { content: '{"rationale":"x"' }, finish_reason: 'length' }],
          usage: { prompt_tokens: 1, completion_tokens: 2 },
        }),
      ),
    ) as unknown as typeof fetch
    const r = await createOpenAIProvider({ apiKey: 'sk', fetchImpl }).complete(REQ)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('OUTPUT_NOT_PARSEABLE')
  })

  it('空 content / 无 choices → 明确失败（不是空字符串当成功）', async () => {
    for (const body of [{ choices: [] }, { choices: [{ message: { content: '' } }] }, {}]) {
      const fetchImpl = jest.fn(async () => resOf(200, JSON.stringify(body))) as unknown as typeof fetch
      const r = await createOpenAIProvider({ apiKey: 'sk', fetchImpl }).complete(REQ)
      expect(r.ok).toBe(false)
    }
  })
})

// ═══════════════════════════════════════════════════════════
// ⑤ 失败映射：可判定，且不泄露凭据
// ═══════════════════════════════════════════════════════════

describe('⑤ 失败映射：凭据/超时/请求错分开', () => {
  it.each([
    [401, 'PROVIDER_UNAVAILABLE'],
    [403, 'PROVIDER_UNAVAILABLE'],
    [408, 'PROVIDER_TIMEOUT'],
    [504, 'PROVIDER_TIMEOUT'],
    [400, 'PROVIDER_ERROR'],
    [429, 'PROVIDER_ERROR'],
    [500, 'PROVIDER_ERROR'],
  ])('HTTP %s → %s', async (status, code) => {
    const r = await createOpenAIProvider({ apiKey: 'sk', fetchImpl: errFetch(status as number) }).complete(REQ)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe(code)
    expect(r.ok === false && r.message).toContain(String(status))
  })

  it('200 但 body 里带 error → 失败（不是"有 choices 就算成功"）', async () => {
    const fetchImpl = jest.fn(async () => resOf(200, JSON.stringify({ error: { message: 'model not found' } }))) as unknown as typeof fetch
    const r = await createOpenAIProvider({ apiKey: 'sk', fetchImpl }).complete(REQ)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message).toContain('model not found')
  })

  it('非 JSON 响应体 → PROVIDER_ERROR（含截断原文，便于定位）', async () => {
    const fetchImpl = jest.fn(async () => resOf(200, '<html>gateway timeout</html>')) as unknown as typeof fetch
    const r = await createOpenAIProvider({ apiKey: 'sk', fetchImpl }).complete(REQ)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('PROVIDER_ERROR')
    expect(r.ok === false && r.message).toContain('gateway timeout')
  })

  it('网络异常 → PROVIDER_UNAVAILABLE（"打不通"必须与"打过了但失败"可区分）', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const r = await createOpenAIProvider({ apiKey: 'sk', fetchImpl }).complete(REQ)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('PROVIDER_UNAVAILABLE')
    expect(r.ok === false && r.message).toContain('ECONNREFUSED')
  })

  it('超时（AbortError）→ PROVIDER_TIMEOUT', async () => {
    const fetchImpl = jest.fn(async () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }) as unknown as typeof fetch
    const r = await createOpenAIProvider({ apiKey: 'sk', fetchImpl, timeoutMs: 1 }).complete(REQ)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('PROVIDER_TIMEOUT')
  })

  it('🔴 凭据只出现在鉴权头里：不进 URL、不进请求体、不进我们自己拼的错误信息', async () => {
    const secret = 'sk-super-secret-value'
    const fetchImpl = okFetch(JSON.stringify(validAdvice))
    await createOpenAIProvider({ apiKey: secret, fetchImpl }).complete(REQ)

    const [url, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0]
    expect(url).not.toContain(secret)
    expect(init.body).not.toContain(secret)
    expect(init.headers.authorization).toBe(`Bearer ${secret}`)

    // 网络层的错误信息由**我们**拼接 —— 不得把凭据拼进去。
    const netFail = jest.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const r = await createOpenAIProvider({ apiKey: secret, fetchImpl: netFail }).complete(REQ)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message).not.toContain(secret)
  })
})

// ═══════════════════════════════════════════════════════════
// ⑥ 与内核/服务层接线
// ═══════════════════════════════════════════════════════════

describe('⑥ 接线：真实 provider 走完内核与持久化', () => {
  it('runSkill 用真实 provider 成功 → PROPOSED，providerKind = openai', async () => {
    const provider = createOpenAIProvider({ apiKey: 'sk', fetchImpl: okFetch(JSON.stringify(validAdvice), 2000, 900) })
    const out = await runSkill({
      skill: 'COORDINATION_ADVICE',
      input: adviceInput,
      provider: { kind: 'ready', provider },
      ledger: EMPTY_LEDGER,
    })
    expect(out.status).toBe('PROPOSED')
    expect(out.providerKind).toBe('openai')
    expect(out.cost?.providerKind).toBe('openai')
    expect(out.cost?.usage).toEqual({ inputTokens: 2000, outputTokens: 900 })
  })

  it('🔴 端到端：`openai` → DB 枚举 `OPENAI` 的映射真的被走过（此前只覆盖过 STUB）', async () => {
    const provider = createOpenAIProvider({ apiKey: 'sk', fetchImpl: okFetch(JSON.stringify(validAdvice), 2000, 900) })
    const { run } = await createAgentRun(ctx(), {
      skill: 'COORDINATION_ADVICE',
      input: adviceInput,
      idempotencyKey: 'openai-1',
      provider: { kind: 'ready', provider },
    })
    expect(run.providerKind).toBe('openai')
    expect(fake.calls[0].providerKind).toBe('OPENAI')
    expect(fake.runs[0].providerKind).toBe('OPENAI')
  })

  it('🔴 无凭据的生产路径：runSkill 拿到 unavailable → DEGRADED（规则式），绝不假装成功', async () => {
    const out = await runSkill({
      skill: 'INTENT_EXTRACTION',
      input: { goal: '帮助我们在 30 天内对接 5 家渠道伙伴，完成初步合作洽谈' },
      provider: resolveRuntimeProvider({}),
      ledger: EMPTY_LEDGER,
    })
    expect(out.status).toBe('DEGRADED')
    expect(out.providerKind).toBe('rules')
    expect(out.degradeCode).toBe('PROVIDER_UNAVAILABLE')
    expect(out.reason).toContain('OPENAI_API_KEY')
  })

  it('成功响应体形状的夹具自检（`okRes` 与真实 OpenAI 响应同形）', () => {
    const parsed = JSON.parse(okRes(validAdvice))
    expect(parsed.choices[0].message.content).toBe(JSON.stringify(validAdvice))
    expect(parsed.usage.prompt_tokens).toBe(100)
  })
})

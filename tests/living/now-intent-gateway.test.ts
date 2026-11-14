/**
 * IntentGateway 契约（TDD · 先红后绿）
 *
 * V21 · C03：Now 屏的「目标 → 理解」必须走**服务端真实链路**
 * `POST /api/v1/agents/runs`（skill=INTENT_EXTRACTION），并**如实**标注来源：
 *   - 模型产出（providerKind=workbuddy/openai 且未降级）→ provenance='ai'
 *   - 服务端诚实降级（DEGRADED）/ 本地规则兜底 → provenance='rule'
 *
 * 这组用例钉死三件事：
 *   1. **不冒充**：规则结果永远不说自己是 AI。
 *   2. **不沉默**：降级原因必须带到 UI（note 字段），不许吞掉。
 *   3. **不假成功**：服务端没给合法 spec 就报 error，哪怕 HTTP 是 2xx。
 *
 * fetch 在系统边界 mock（网络边界允许 mock）；本地规则编译用真实现。
 */

import { resolveIntent, provenanceBadge } from '@/lib/living/now/intent-gateway'
import { NOW_SEEDS } from '@/lib/living/now/seeds'
import { compileWorkspaceSpec, MIN_GOAL_LENGTH, WorkspaceSpecSchema } from '@/lib/workspace-spec'

const GOAL = NOW_SEEDS[0].goal
const KEY = 'idem-key-1'

/** 构造一个**契约合法**的 spec（用真实编译器产出，不用手写夹具）。 */
function validSpec(): unknown {
  const result = compileWorkspaceSpec(GOAL)
  if (!result.ok) throw new Error('夹具目标编译失败：' + result.reason)
  return result.spec
}

/** 服务端 2xx 响应的最小形状（AgentRunDto 里客户端会消费的字段）。 */
function runEnvelope(run: Record<string, unknown>, replayed = false) {
  return {
    ok: true,
    status: 201,
    headers: { get: () => (replayed ? 'true' : null) },
    json: async () => ({ success: true, data: { run, replayed } }),
  }
}

function httpError(status: number, message: string) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => ({ success: false, error: { code: `HTTP_${status}`, message } }),
  }
}

describe('resolveIntent · 服务端 AI 成功', () => {
  it('模型产出 → provenance=ai，spec 通过契约校验，runId 落账', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      runEnvelope({
        id: 'run_1',
        status: 'PROPOSED',
        providerKind: 'workbuddy',
        proposal: validSpec(),
        reason: null,
        degradeCode: null,
        injectionFlagged: false,
      }),
    )
    const out = await resolveIntent(GOAL, KEY, { fetchImpl })

    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.provenance).toBe('ai')
    expect(out.note).toBeNull() // 没有降级就没有注释
    expect(out.meta.runId).toBe('run_1')
    expect(WorkspaceSpecSchema.safeParse(out.spec).success).toBe(true)
    // 请求形状：skill / input.goal / 幂等键头
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/agents/runs')
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(KEY)
    expect(JSON.parse(String(init.body))).toEqual({ skill: 'INTENT_EXTRACTION', input: { goal: GOAL } })
  })

  it('幂等重放（replayed）→ meta.replayed=true，UI 能区分"又建了一条"', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      runEnvelope(
        {
          id: 'run_1',
          status: 'PROPOSED',
          providerKind: 'workbuddy',
          proposal: validSpec(),
          reason: null,
          degradeCode: null,
          injectionFlagged: false,
        },
        true,
      ),
    )
    const out = await resolveIntent(GOAL, KEY, { fetchImpl })
    if (out.kind !== 'ok') throw new Error('期望 ok')
    expect(out.meta.replayed).toBe(true)
  })

  it('注入告警（injectionFlagged）→ 原样透出，UI 不得吞掉', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      runEnvelope({
        id: 'run_2',
        status: 'PROPOSED',
        providerKind: 'workbuddy',
        proposal: validSpec(),
        reason: null,
        degradeCode: null,
        injectionFlagged: true,
      }),
    )
    const out = await resolveIntent(GOAL, KEY, { fetchImpl })
    if (out.kind !== 'ok') throw new Error('期望 ok')
    expect(out.meta.injectionFlagged).toBe(true)
  })
})

describe('resolveIntent · 服务端诚实降级', () => {
  it('DEGRADED → provenance=rule，且降级原因带进 note（不沉默）', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      runEnvelope({
        id: 'run_3',
        status: 'DEGRADED',
        providerKind: 'rules',
        proposal: validSpec(),
        reason: '当前环境没有可用模型。已降级为「规则式」抽取。',
        degradeCode: 'PROVIDER_UNAVAILABLE',
        injectionFlagged: false,
      }),
    )
    const out = await resolveIntent(GOAL, KEY, { fetchImpl })
    if (out.kind !== 'ok') throw new Error('DEGRADED 也应给出可用的规则 spec：' + out.reason)
    expect(out.provenance).toBe('rule')
    expect(out.note).toContain('规则')
    expect(out.meta.degradeCode).toBe('PROVIDER_UNAVAILABLE')
  })

  it('HTTP 200 但 proposal 不合法（防御纵深）→ 本地规则兜底，note 说明服务端产出被拒', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      runEnvelope({
        id: 'run_4',
        status: 'PROPOSED',
        providerKind: 'workbuddy',
        proposal: { version: '9.9', nodes: '不是数组' }, // 服务端谎称成功
        reason: null,
        degradeCode: null,
        injectionFlagged: false,
      }),
    )
    const out = await resolveIntent(GOAL, KEY, { fetchImpl })
    if (out.kind !== 'ok') throw new Error('本地兜底应成功：' + ('reason' in out ? out.reason : ''))
    expect(out.provenance).toBe('rule')
    expect(out.note).toContain('降级')
  })

  it('服务端 FAILED 但目标本地可编译 → 规则兜底（note 带服务端原因），产品不断路', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      runEnvelope({ id: 'run_5', status: 'FAILED', providerKind: 'rules', proposal: null, reason: '模型输出未通过契约校验', degradeCode: 'OUTPUT_SCHEMA_INVALID', injectionFlagged: false }),
    )
    const out = await resolveIntent(GOAL, KEY, { fetchImpl })
    if (out.kind !== 'ok') throw new Error('FAILED 应兜底为本地规则编译：' + out.reason)
    expect(out.provenance).toBe('rule')
    expect(out.note).toContain('契约校验')
  })

  it('服务端 FAILED 且本地也编译不了 → error，不假成功', async () => {
    // 没有可识别意图的长句子：服务端与本地规则都会编译失败。
    const unrecognizable = '今天天气不错出去散步感觉相当舒服的呢'
    const fetchImpl = jest.fn().mockResolvedValue(
      runEnvelope({ id: 'run_6', status: 'FAILED', providerKind: 'rules', proposal: null, reason: '模型输出未通过契约校验', degradeCode: 'OUTPUT_SCHEMA_INVALID', injectionFlagged: false }),
    )
    const out = await resolveIntent(unrecognizable, KEY, { fetchImpl })
    expect(out.kind).toBe('error')
    if (out.kind !== 'error') return
    expect(out.reason).toContain('规则也编译不了')
    expect(out.suggestions.length).toBeGreaterThan(0)
  })
})

describe('resolveIntent · 能力与网络', () => {
  it('403（无 agent.run 能力）→ 本地规则兜底（provenance=rule，runId=null）', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(httpError(403, '当前角色没有发起 Agent 运行的能力'))
    const out = await resolveIntent(GOAL, KEY, { fetchImpl })
    if (out.kind !== 'ok') throw new Error('403 应兜底为本地规则编译：' + out.reason)
    expect(out.provenance).toBe('rule')
    expect(out.meta.runId).toBeNull()
    expect(out.note).toContain('规则')
  })

  it('401（未登录）→ error，不静默兜底', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(httpError(401, '登录已过期'))
    const out = await resolveIntent(GOAL, KEY, { fetchImpl })
    expect(out.kind).toBe('error')
  })

  it('400（输入错误）→ error 带服务端原因', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(httpError(400, 'goal 长度不足'))
    const out = await resolveIntent(GOAL, KEY, { fetchImpl })
    if (out.kind !== 'error') throw new Error('400 不应兜底成功')
    expect(out.reason).toContain('goal')
  })

  it('网络异常 → 本地规则兜底（离线也能用，但要标明来源）', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'))
    const out = await resolveIntent(GOAL, KEY, { fetchImpl })
    if (out.kind !== 'ok') throw new Error('断网应兜底：' + out.reason)
    expect(out.provenance).toBe('rule')
    expect(out.note).toContain('规则')
  })

  it(`目标短于 ${MIN_GOAL_LENGTH} 字 → 直接 error，不发请求`, async () => {
    const fetchImpl = jest.fn()
    const out = await resolveIntent('太短', KEY, { fetchImpl })
    expect(out.kind).toBe('error')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('provenanceBadge', () => {
  it("ai → 标签含「AI」，不出现「规则」字样", () => {
    const badge = provenanceBadge('ai')
    expect(badge.label).toMatch(/AI/)
    expect(badge.label).not.toMatch(/规则/)
  })

  it("rule → 标签含「规则」，不出现「AI」", () => {
    const badge = provenanceBadge('rule')
    expect(badge.label).toMatch(/规则/)
    expect(badge.label).not.toMatch(/AI/)
  })
})

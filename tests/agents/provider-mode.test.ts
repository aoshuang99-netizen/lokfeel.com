/**
 * V20.0 · S1 沙箱（stub）守卫 + 装配 —— WO-1084 验收
 *
 * ═══════════════════════════════════════════════════════════════
 * 这个套件钉住什么
 * ═══════════════════════════════════════════════════════════════
 * `stub` 是「声明式沙箱」，能证明编排链路可跑，但**绝不能**冒充真实调用成功
 * （R-04 用户安全边界）。所以断言只围绕两件事：
 *
 *   ① **守卫先行**：生产环境请求 stub → 必须抛错；非生产但未声明隔离 → 必须抛错。
 *      "悄悄降级成假模型" 是本仓库最危险的假绿来源，必须硬失败。
 *   ② **装配可达**：仅在「非生产 + `AGENT_TEST_ISOLATION=true`」时，
 *      `resolveRuntimeProvider` 才返回 `kind:'ready'` 且 `provider.kind==='stub'`。
 *      —— 修复前此处返回 `unavailable`（返回值被丢弃），A-03b 因此恒为 BLOCKED_ENV。
 *   ③ **缺凭据仍不可用**：无凭据必须 `unavailable` 且**不抛错**，
 *      由编排层走明示的规则式降级，不得自动回退 stub。
 *
 * ⚠️ 全部离线：env 全部显式传入（不读进程环境），无网络、无凭据、无 DB。
 */

import { resolveProviderMode } from '@/lib/agent'
import { resolveRuntimeProvider } from '@/lib/agents/provider-runtime'
import { WorkspaceSpecSchema } from '@/lib/workspace-spec'

const STUB_ENV = { AGENT_PROVIDER: 'stub', AGENT_TEST_ISOLATION: 'true' } as const

describe('resolveProviderMode · S1 守卫', () => {
  it('① 生产环境请求 stub → 抛错（凭据齐全也不放行）', () => {
    expect(() =>
      resolveProviderMode({
        ...STUB_ENV,
        NODE_ENV: 'production',
        OPENAI_API_KEY: 'sk-should-not-matter',
      }),
    ).toThrow(/stub/i)
  })

  it('② 非生产但未声明隔离 → 抛错', () => {
    expect(() =>
      resolveProviderMode({ NODE_ENV: 'development', AGENT_PROVIDER: 'stub' }),
    ).toThrow(/AGENT_TEST_ISOLATION/)
  })

  it('③ 非生产 + 隔离 → 返回 stub', () => {
    expect(resolveProviderMode({ ...STUB_ENV, NODE_ENV: 'development' })).toBe('stub')
  })

  it('④ 生产环境无凭据 → unavailable，且不抛错', () => {
    expect(() => resolveProviderMode({ NODE_ENV: 'production' })).not.toThrow()
    expect(resolveProviderMode({ NODE_ENV: 'production' })).toBe('unavailable')
  })

  it('⑤ 未请求 stub 时，隔离标记不改变真实判定', () => {
    expect(
      resolveProviderMode({
        NODE_ENV: 'development',
        AGENT_TEST_ISOLATION: 'true',
      }),
    ).toBe('unavailable')
  })
})

describe('resolveRuntimeProvider · S1 装配', () => {
  it('⑥ 隔离沙箱内返回 ready + provider.kind=stub（修复前为 unavailable）', async () => {
    const res = resolveRuntimeProvider({ ...STUB_ENV, NODE_ENV: 'development' })

    expect(res.kind).toBe('ready')
    if (res.kind !== 'ready') throw new Error('unreachable')
    expect(res.provider.kind).toBe('stub')

    // stub 是可调用的确定响应，且**如实**带 usage（账本不记 0）
    const out = await res.provider.complete({ system: 's', user: 'u' } as never)
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('unreachable')
    expect(out.text).toContain('SANDBOX_PROBE')
    expect(out.usage.outputTokens).toBeGreaterThan(0)

    // 🔴 #1086：载荷必须**通过 INTENT_EXTRACTION 的输出契约**。
    // 否则编排层必走 OUTPUT_SCHEMA_INVALID → DEGRADED，沙箱到不了 AWAITING_APPROVAL，
    // 等于"沙箱装配好了但端到端永远走不通"（旧载荷正是这个下场）。
    const parsed = WorkspaceSpecSchema.safeParse(JSON.parse(out.text))
    expect(parsed.success).toBe(true)
  })

  it('⑦ 生产环境请求 stub：装配侧同样抛错（守卫不可绕过）', () => {
    expect(() =>
      resolveRuntimeProvider({ ...STUB_ENV, NODE_ENV: 'production' }),
    ).toThrow(/stub/i)
  })

  it('⑧ 无凭据 + 无 stub → unavailable 且不抛错', () => {
    const res = resolveRuntimeProvider({ NODE_ENV: 'production' })
    expect(res.kind).toBe('unavailable')
  })
})

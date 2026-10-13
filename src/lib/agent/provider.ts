/**
 * T09 · Agent Runtime —— 模型提供方（Provider）的**接口**与**纯环境解码**
 *
 * 🔴 这个文件的全部意义是**不撒谎**：
 *
 *   - `stub`（确定性假模型）**只用于测试**，且必须由调用方**显式注入**；
 *   - 生产环境缺凭据时，`resolveProviderConfig()` 返回 `ok:false` →
 *     服务层据此给出 `unavailable` → `runtime.ts` 走**明示的降级**（规则式兜底）
 *     并把原因写进结果 —— **绝不**静默用 stub 冒充"真实调用成功"。
 *     这与 T08 的 Creem 沙箱口径一致（无凭据 → 明确状态，不静默假装）。
 *
 * 🔴 **本文件不含任何网络调用**（由 `check-agent-invariants` 的 A5 守着）。
 *    为什么把这件事当成门禁而不只是约定：内核的"无 IO"必须是**可执行**的性质
 *    （跑单测不需要网络、不需要凭据），一旦这里出现 `fetch`，它就从"性质"退化成"口号"。
 *
 *    所以职责被切成两半：
 *      · **判据**留在这里（纯函数）：认哪个环境变量、默认模型是哪个、超时多少 →
 *        `resolveProviderConfig(env)`。只有一处实现，不存在"两个地方各写一份默认值"。
 *      · **怎么打**移到服务层：`src/lib/agents/provider-openai.ts`
 *        的 `createOpenAIProvider()`（那里允许 IO，且**不**受 A1/A2/A5 约束）。
 *
 *    这条切分的收益是可验证的：内核的单元测试**不需要** mock 任何 HTTP 层，
 *    而真实 Provider 的测试可以注入 `fetchImpl` 逐字断言请求体与错误映射。
 */

import type { DegradeReason, ProviderKind } from './types'

export interface ModelRequest {
  system: string
  /** 已由 `guard.wrapUntrusted()` 包裹的不可信数据段。 */
  untrusted: string
  instruction: string
  maxOutputTokens: number
}

export type ModelResult =
  | { ok: true; text: string; usage: { inputTokens: number; outputTokens: number } }
  | { ok: false; code: DegradeReason; message: string; usage?: { inputTokens: number; outputTokens: number } }

export interface ModelProvider {
  readonly name: string
  readonly kind: ProviderKind
  complete(req: ModelRequest): Promise<ModelResult>
}

export type ProviderResolution =
  | { kind: 'ready'; provider: ModelProvider }
  /** 没有可用凭据 —— 调用方必须走降级，并把 `reason` 原样告知用户。 */
  | { kind: 'unavailable'; reason: string }

/**
 * 测试用确定性 Provider。**不要在生产路径注入它**。
 * `responder` 返回模型的原始文本（好让测试能构造"非法 JSON / 越权字段"等情形）。
 */
export function createStubProvider(
  responder: (req: ModelRequest) => string | ModelResult,
  usage: { inputTokens: number; outputTokens: number } = { inputTokens: 100, outputTokens: 50 },
): ModelProvider {
  return {
    name: 'stub',
    kind: 'stub',
    async complete(req) {
      const out = responder(req)
      if (typeof out === 'string') {
        return { ok: true, text: out, usage }
      }
      return out
    },
  }
}

/** 一个永远失败的 Provider，用来测"失败降级"。 */
export function createFailingProvider(code: DegradeReason = 'PROVIDER_ERROR'): ModelProvider {
  return {
    name: `failing-${code}`,
    kind: 'stub',
    async complete() {
      return { ok: false, code, message: `注入的失败：${code}` }
    },
  }
}

// ═══════════════════════════════════════════════════════════
// 环境解码（纯函数；真实 HTTP 实现在服务层）
// ═══════════════════════════════════════════════════════════

/** OpenAI 兼容端点的连接参数（**不含**任何行为策略）。 */
export interface OpenAIConfig {
  apiKey: string
  model: string
  /** 已去掉尾部 `/`，便于拼 `/chat/completions`。 */
  baseUrl: string
  timeoutMs: number
}

/**
 * 默认值。**刻意写在代码里而不是散落在各处**：
 * 让"默认模型是哪个"只有一个答案，且能被测试逐字断言。
 */
export const OPENAI_DEFAULTS = {
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com/v1',
  timeoutMs: 30_000,
  /** 超时上限：防止有人把 env 写成 10 分钟，把函数平台的执行预算吃光。 */
  maxTimeoutMs: 120_000,
} as const

export type ProviderConfigResolution = { ok: true; config: OpenAIConfig } | { ok: false; reason: string }

/**
 * 从环境里解出 OpenAI 配置。**纯函数**（同一 env 必得同一结果），不读 `process.env` 本身
 * —— 由调用方显式传入，这样它可被单测穷举，也不会在模块加载时锁死环境快照。
 *
 * 🔴 **只认 `OPENAI_API_KEY`**；没有就 `ok:false`。
 *    返回 `ok:false` 的含义是"**不可用**"，**不是**"可以用假的顶上"。
 */
export function resolveProviderConfig(env: Record<string, string | undefined>): ProviderConfigResolution {
  const apiKey = (env.OPENAI_API_KEY ?? '').trim()
  if (!apiKey) {
    return {
      ok: false,
      reason:
        '未配置 OPENAI_API_KEY —— 不会用任何"假模型"冒充真实调用（T08 同口径：无凭据即明示不可用）。',
    }
  }

  const model = (env.OPENAI_MODEL ?? '').trim() || OPENAI_DEFAULTS.model

  const rawBase = (env.OPENAI_BASE_URL ?? '').trim() || OPENAI_DEFAULTS.baseUrl
  // http(s) 之外一律拒绝：`file:` / 相对路径会让"调用模型"变成一次本地读取。
  if (!/^https?:\/\//i.test(rawBase)) {
    return { ok: false, reason: `OPENAI_BASE_URL 必须是 http(s) 地址，得到：${rawBase}` }
  }
  const baseUrl = rawBase.replace(/\/+$/, '')

  const parsedTimeout = Number((env.OPENAI_TIMEOUT_MS ?? '').trim())
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? Math.min(Math.floor(parsedTimeout), OPENAI_DEFAULTS.maxTimeoutMs)
      : OPENAI_DEFAULTS.timeoutMs

  return { ok: true, config: { apiKey, model, baseUrl, timeoutMs } }
}

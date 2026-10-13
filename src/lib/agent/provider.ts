/**
 * T09 · Agent Runtime —— 模型提供方（Provider）
 *
 * 🔴 这个文件的全部意义是**不撒谎**：
 *
 *   - `stub`（确定性假模型）**只用于测试**，且必须由调用方**显式注入**；
 *   - 生产环境缺凭据时，`resolveProvider()` 返回 **`unavailable`**，
 *     由 `runtime.ts` 走**明示的降级**（规则式兜底）并把原因写进结果 ——
 *     **绝不**静默用 stub 冒充"真实调用成功"。
 *     这与 T08 的 Creem 沙箱口径一致（无凭据 → 明确状态，不静默假装）。
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

/**
 * 按环境解析出可用 Provider。
 *
 * ⚠️ **只认 `OPENAI_API_KEY`**；没有就返回 `unavailable`。
 * 真实实现（HTTP 调用）属于 Slice 3 —— 那时把这里换成真实 client 即可，
 * `runtime.ts` 不需要改（它只依赖 `ModelProvider` 接口）。
 */
export function resolveProvider(env: Record<string, string | undefined>): ProviderResolution {
  const key = env.OPENAI_API_KEY?.trim()
  if (!key) {
    return {
      kind: 'unavailable',
      reason:
        '未配置 OPENAI_API_KEY —— 不会用任何"假模型"冒充真实调用（T08 同口径：无凭据即明示不可用）。',
    }
  }
  return {
    kind: 'unavailable',
    reason:
      'OPENAI_API_KEY 存在，但真实 Provider 的 HTTP 实现属 T09 Slice 3，尚未接线 —— 明确不可用，不静默降级。',
  }
}

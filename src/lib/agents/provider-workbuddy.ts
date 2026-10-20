/**
 * T09 · Agent Runtime —— WorkBuddy 云端算力 Provider（**服务层**）
 *
 * 为什么有这个 Provider：生产环境没有供应商 API key，而 Agent 不能因此变成"演示"。
 * WorkBuddy 云端 LLM 是**免密钥**的（用应用级 `publishableKey`），因此它是
 * 「真实调用」与「规则式兜底」之间的第三条路 —— 走它，`realCallsEnabled` 就是 true。
 *
 * 🔴 三条实测约束（不是猜测，是`scripts/qa/verify-llm-live.mjs` 亲测的）：
 *    1. **只支持流式**：`stream:false` 会被服务端直接拒绝（"stream must be true"），
 *       所以本 Provider 必须边流边收，而不是像 OpenAI 那样拿一个 JSON body；
 *    2. **usage 在最后一帧**：token 归因只能从流的末尾取，取不到就必须**拒绝**这次结果
 *       （与 `provider-openai.ts` 同口径：没有 usage 就没有归因，记 0 是账本少算）；
 *    3. **服务端可调用、浏览器不可**：无 Origin 的请求通过；带 `Origin: https://app.lokfeel.com`
 *       的请求返回 403。因此本文件**只能**在服务端使用，凭据也不得进入前端产物。
 *
 * 与内核的分工不变：内核（`src/lib/agent`）只做判据与纯函数，本文件只负责"怎么打"。
 */

import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'
import {
  WORKBUDDY_DEFAULTS,
  type DegradeReason,
  type ModelProvider,
  type ModelRequest,
  type ModelResult,
} from '@/lib/agent'

/** 单次调用允许累积的文本上限（字符）。超出即拒绝 —— 防止一次意外响应把内存打满。 */
const MAX_RESPONSE_CHARS = 200_000

/** 错误信息里的响应体截断长度。 */
const ERROR_EXCERPT = 300

function fail(code: DegradeReason, message: string): ModelResult {
  return { ok: false, code, message }
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * 云端错误 → 降级原因码。
 *
 * 与 OpenAI 一版同样的取向：凭据/来源问题（401/403）是**该去配环境**，
 * 超时是**可重试**，其余是**我们的请求写错了**。三者混成一个码会让运维猜。
 */
function codeForError(err: unknown): DegradeReason {
  const msg = errText(err)
  if (/\b(401|403)\b/.test(msg) || /unauthor|forbidden|origin/i.test(msg)) return 'PROVIDER_UNAVAILABLE'
  if (/abort|timeout|timed out/i.test(msg)) return 'PROVIDER_TIMEOUT'
  if (/stream|sse|\[DONE\]|integrity/i.test(msg)) return 'PROVIDER_ERROR'
  return 'PROVIDER_ERROR'
}

export interface WorkBuddyProviderOptions {
  endpoint: string
  publishableKey: string
  model?: string
  timeoutMs?: number
  /**
   * 注入的 fetch。**只用于测试**：让"超时如何生效 / 各类失败如何映射"可断言。
   * 生产路径不传 → 用 `globalThis.fetch`。
   */
  fetchImpl?: typeof fetch
}

/**
 * 构造一个**真实**的 WorkBuddy 云端 Provider。
 *
 * 它只做四件事：拼请求 → 收流 → 解析 → 归因。**不做**任何策略判断
 * （不提权、不降级、不裁剪输出）—— 那些是内核的事。
 */
export function createWorkBuddyProvider(opts: WorkBuddyProviderOptions): ModelProvider {
  const endpoint = opts.endpoint.replace(/\/+$/, '')
  const model = opts.model ?? WORKBUDDY_DEFAULTS.model
  const timeoutMs = opts.timeoutMs ?? WORKBUDDY_DEFAULTS.timeoutMs
  const baseFetch = opts.fetchImpl ?? globalThis.fetch

  // SDK 的 create() 不接 signal，超时只能挂在注入的 fetch 上。
  const fetchWithTimeout: typeof fetch = async (input, init) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await baseFetch(input, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    name: `workbuddy:${model}`,
    kind: 'workbuddy',

    async complete(req: ModelRequest): Promise<ModelResult> {
      if (typeof baseFetch !== 'function') {
        return fail(
          'PROVIDER_UNAVAILABLE',
          '运行环境没有 fetch —— 无法发起真实调用（不会退化成假模型）。',
        )
      }

      const cloud = createWorkBuddyCloud({
        endpoint,
        publishableKey: opts.publishableKey,
        fetch: fetchWithTimeout,
      })

      let text = ''
      let finishReason: string | null = null
      let usage: { prompt_tokens: number; completion_tokens: number } | null = null

      try {
        for await (const chunk of cloud.llm.chat.completions.create({
          model,
          messages: [
            // 第一条必须是应用自有的 system（服务端强制），且指令在前、不可信区在后。
            { role: 'system', content: req.system },
            { role: 'user', content: `${req.instruction}\n\n${req.untrusted}` },
          ],
          max_tokens: req.maxOutputTokens,
          stream: true,
        })) {
          const choice = chunk?.choices?.[0]
          const delta = choice?.delta?.content
          if (delta) {
            text += delta
            if (text.length > MAX_RESPONSE_CHARS) {
              return fail(
                'PROVIDER_ERROR',
                `响应体过大（${text.length} 字符 > ${MAX_RESPONSE_CHARS}）—— 拒绝继续累积`,
              )
            }
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason
          // usage 只在最后一帧下发；中途帧可能没有，不能据此提前判定"缺归因"。
          if (chunk?.usage) {
            usage = {
              prompt_tokens: chunk.usage.prompt_tokens,
              completion_tokens: chunk.usage.completion_tokens,
            }
          }
        }
      } catch (err) {
        return fail(
          codeForError(err),
          `云端算力调用失败：${errText(err).slice(0, ERROR_EXCERPT)}`,
        )
      }

      if (text.trim().length === 0) {
        return fail('PROVIDER_ERROR', '流里没有任何文本增量 —— 无内容可校验，拒绝接受')
      }

      if (finishReason === 'length') {
        return fail(
          'OUTPUT_NOT_PARSEABLE',
          '模型输出因 max_tokens 被截断（finish_reason=length）—— 拒绝接受半截产出',
        )
      }

      if (usage === null) {
        return fail(
          'PROVIDER_ERROR',
          '流结束但没有 usage —— 无归因数据，拒绝接受（AC-20 要求每次调用可归因）',
        )
      }

      return { ok: true, text, usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens } }
    },
  }
}

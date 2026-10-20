/**
 * T09 · Agent Runtime —— 真实 OpenAI Provider（**服务层**，Slice 3）
 *
 * 🔴 为什么它在这里，而不在 `src/lib/agent/provider.ts`（内核）：
 *    内核的"无 IO"是**可执行**的性质（单测不需要网络/凭据），由
 *    `scripts/check-agent-invariants.mjs` 的 A5 守着（内核里不得出现 `fetch`）。
 *    本文件在**复数**目录（服务层）—— 那里允许 IO，也因此**不**受 A1/A2/A5 约束。
 *    判据（认哪个环境变量 / 默认模型 / 超时上限）仍在内核的
 *    `resolveProviderConfig()`：**一处实现**，本文件只负责"怎么打"。
 *    Provider 的**选择顺序**在 `provider-runtime.ts`（云端算力优先，OpenAI 次之）。
 *
 * 🔴 本文件的全部行为都服从一条规矩：**不能把"打不通"说成"打过了"**。
 *    · 缺凭据 → 调用方拿到 `unavailable`（`resolveRuntimeProvider`），走规则式降级；
 *    · 超时/网络失败/非 2xx → `ModelResult.ok = false` + **可判定的 reason code**；
 *    · 响应**缺少 usage** → **拒绝接受这次调用**（AC-20 要求"每次调用可归因"：
 *      拿不到 token 数就只能记 0，那是"账本少算"而不是"这次调用免费"）。
 *      这与内核"越界产出**拒绝**而非截断"同一取向：宁可不产出，也不给不可归因的东西。
 *
 * ⚠️ **不传 `response_format`**：它只在部分 OpenAI 兼容端点上存在，写死会让自建/代理端点
 *    直接 400。结构化可靠性由内核的 `extractJson()`（容忍围栏与前后废话）+ 技能自己的
 *    zod 契约保证 —— 校验是**服务端**做的，不依赖供应商配合。
 *
 * ⚠️ 沙箱**探不了外部网络**（本仓既有结论）：真实连通性无法在此环境取证，
 *    因此所有测试都注入 `fetchImpl` 逐字断言请求与错误映射；
 *    "真实端点可达"属于**未取证**项，写进 `docs/implementation/T09/slice-3.md`。
 */

import {
  OPENAI_DEFAULTS,
  type DegradeReason,
  type ModelProvider,
  type ModelRequest,
  type ModelResult,
} from '@/lib/agent'

/** 单次模型调用允许的响应体上限（字符）。超出即拒绝 —— 防止一次意外响应把内存打满。 */
const MAX_RESPONSE_CHARS = 200_000

/** 错误信息里的响应体截断长度（不要把整段 HTML 错误页塞进审计）。 */
const ERROR_EXCERPT = 300

export interface OpenAIProviderOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  timeoutMs?: number
  /**
   * 注入的 fetch。**只用于测试**：让"请求体长什么样 / 各类失败如何映射"变成可断言的。
   * 生产路径不传 → 用 `globalThis.fetch`。
   */
  fetchImpl?: typeof fetch
}

interface ChatCompletionBody {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string; type?: string; code?: string }
}

function fail(code: DegradeReason, message: string): ModelResult {
  return { ok: false, code, message }
}

function isAbortLike(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: unknown }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * HTTP 状态码 → 降级原因码。
 *
 * 分开的理由：`401/403` 是**凭据问题**（该去配 env），`429/5xx` 是**临时故障**（可重试），
 * 其余 4xx 多半是**我们的请求写错了**（改代码）。混成一个 `PROVIDER_ERROR`
 * 会让运维在看板上分不清"该配密钥"还是"该重试"。
 */
function codeForStatus(status: number): DegradeReason {
  if (status === 401 || status === 403) return 'PROVIDER_UNAVAILABLE'
  if (status === 408 || status === 504) return 'PROVIDER_TIMEOUT'
  return 'PROVIDER_ERROR'
}

/**
 * 构造一个**真实**的 OpenAI 兼容 Provider。
 *
 * 它只做四件事：拼请求 → 打 → 解析 → 归因。**不做**任何策略判断
 * （不提权、不降级、不裁剪输出）—— 那些是内核的事。
 */
export function createOpenAIProvider(opts: OpenAIProviderOptions): ModelProvider {
  const model = opts.model ?? OPENAI_DEFAULTS.model
  const baseUrl = (opts.baseUrl ?? OPENAI_DEFAULTS.baseUrl).replace(/\/+$/, '')
  const timeoutMs = opts.timeoutMs ?? OPENAI_DEFAULTS.timeoutMs
  const doFetch = opts.fetchImpl ?? globalThis.fetch

  return {
    name: `openai:${model}`,
    kind: 'openai',

    async complete(req: ModelRequest): Promise<ModelResult> {
      if (typeof doFetch !== 'function') {
        return fail(
          'PROVIDER_UNAVAILABLE',
          '运行环境没有 fetch —— 无法发起真实调用（不会退化成假模型）。',
        )
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      let res: Response
      try {
        res = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: req.system },
              // 指令（可信）在前，不可信区（已由 guard 包裹）在后 —— 两者不得混写。
              { role: 'user', content: `${req.instruction}\n\n${req.untrusted}` },
            ],
            max_tokens: req.maxOutputTokens,
            // 温度 0：技能产出的是结构化数据，不是创意文案。可复现优先。
            temperature: 0,
          }),
          signal: controller.signal,
        })
      } catch (err) {
        if (isAbortLike(err)) {
          return fail('PROVIDER_TIMEOUT', `模型调用超时（>${timeoutMs}ms）`)
        }
        // ⚠️ 不把 err 的完整堆栈塞进去（可能含 URL）；也不含 apiKey。
        return fail('PROVIDER_UNAVAILABLE', `网络不可达：${errText(err)}`)
      } finally {
        clearTimeout(timer)
      }

      const raw = await res.text().catch(() => '')

      if (raw.length > MAX_RESPONSE_CHARS) {
        return fail('PROVIDER_ERROR', `响应体过大（${raw.length} 字符 > ${MAX_RESPONSE_CHARS}）—— 拒绝解析`)
      }

      if (!res.ok) {
        let detail = raw.slice(0, ERROR_EXCERPT)
        try {
          const parsed = JSON.parse(raw) as ChatCompletionBody
          if (parsed?.error?.message) detail = String(parsed.error.message).slice(0, ERROR_EXCERPT)
        } catch {
          /* 非 JSON 错误体：直接用截断后的原文 */
        }
        return fail(codeForStatus(res.status), `模型端点返回 HTTP ${res.status}：${detail}`)
      }

      let body: ChatCompletionBody
      try {
        body = JSON.parse(raw) as ChatCompletionBody
      } catch {
        return fail('PROVIDER_ERROR', `模型端点返回的不是合法 JSON（前 ${ERROR_EXCERPT} 字符）：${raw.slice(0, ERROR_EXCERPT)}`)
      }

      if (body?.error) {
        return fail('PROVIDER_ERROR', `模型端点返回错误：${String(body.error.message ?? body.error.type ?? 'unknown')}`)
      }

      const choice = body?.choices?.[0]
      const text = choice?.message?.content
      if (typeof text !== 'string' || text.length === 0) {
        return fail('PROVIDER_ERROR', '响应里没有 choices[0].message.content —— 无文本可校验，拒绝接受')
      }

      // 截断的产出**不是**"短一点的产出"：它多半是半个 JSON。
      // 直接拒绝，避免"猜出半个对象"（内核的 extractJson 会尽力修，但这里能更早更准确地判死）。
      if (choice?.finish_reason === 'length') {
        return fail('OUTPUT_NOT_PARSEABLE', '模型输出因 max_tokens 被截断（finish_reason=length）—— 拒绝接受半截产出')
      }

      const inputTokens = body?.usage?.prompt_tokens
      const outputTokens = body?.usage?.completion_tokens
      if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
        // 🔴 这是刻意的严格：没有 usage 就没有归因。记 0 会让账本**静默少算**（AC-20 破）。
        return fail(
          'PROVIDER_ERROR',
          '响应缺少 usage（prompt_tokens/completion_tokens）—— 无归因数据，拒绝接受（AC-20 要求每次调用可归因）',
        )
      }

      return { ok: true, text, usage: { inputTokens, outputTokens } }
    },
  }
}

/**
 * Provider 选择与诚实块已迁到 `provider-runtime.ts`（那里要同时看云端算力与 OpenAI 两条路）。
 * 这里只保留 OpenAI 的**单一构造**，避免"两处各写一份优先级"。
 */


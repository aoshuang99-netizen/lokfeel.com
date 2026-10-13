/**
 * T09 · Agent Runtime —— 不可信数据通道 + 注入信号检测
 *
 * ## 这个文件**不是**安全防线 —— 读之前先接受这句话
 *
 * 模式匹配表**一定能被绕过**（换语言、拆字、编码、同义改写…）。
 * 因此本文件的产出**绝不能**作为"放行/拒绝"的判据，只做两件事：
 *   1. **通道化**：把用户/对手方提供的文本放进一个**明确标记**的不可信区，
 *      并**转义分隔符**，防止它"闭合标签后冒充指令"（这是**结构**手段，不是模式匹配）；
 *   2. **告警 + 升级**：命中信号 → 记录，并**强制升级为需要人工批准**
 *      （宁可多一次点击，也不放过一次"说服模型"的尝试）。
 *
 * 真正的防线在**不存在的代码路径**里（见 `docs/implementation/T09/plan.md` §2）：
 * 模型输出只被当作**经 zod 校验的结构化数据**消费，
 * **没有任何代码**把模型文本读成权限、白名单、配置或审批结果。
 */

import type { InjectionSignal } from './types'

export const UNTRUSTED_OPEN = '<untrusted_data>'
export const UNTRUSTED_CLOSE = '</untrusted_data>'

/**
 * 转义不可信文本，防止它闭合 `<untrusted_data>` 后**冒充指令**。
 *
 * 做法：把任何形如 `<untested_data` / `</untrusted_data` 的**尖括号**改成方括号
 * （大小写不敏感），并清掉零宽字符（零宽字符常被用来绕过"看起来像"的检查）。
 * ⚠️ 这是**防逃逸**，不是"消毒内容" —— 内容本身仍按原样保留在不可信区内。
 */
export function escapeUntrusted(text: string): string {
  return text
    // 零宽字符（U+200B..U+200D, U+FEFF）—— 先删，避免视觉上"看不见"的断字
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // 任何 <untrusted_data / </untrusted_data 变体（含大小写与多余空白）
    .replace(/<\s*\/?\s*untrusted_data\s*>/gi, (m) => m.replace(/</g, '[').replace(/>/g, ']'))
    // 顺带把裸的 < 开标签风险降到最低：只针对我们自己的分隔符做，其他保留（避免破坏内容语义）
}

/** 把不可信文本包进带标记的不可信区。 */
export function wrapUntrusted(text: string): string {
  return `${UNTRUSTED_OPEN}\n${escapeUntrusted(text)}\n${UNTRUSTED_CLOSE}`
}

/**
 * 注入信号模式表。
 *
 * 🔴 **只用于告警与升级审批**。新增模式**不会**让系统"更安全"到可以放宽其他约束 ——
 *    它只是提高"被人工看一眼"的概率。
 */
export const INJECTION_PATTERNS: readonly { code: string; re: RegExp }[] = [
  // 英文：试图覆盖既有指令
  { code: 'OVERRIDE_INSTRUCTIONS', re: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|prompts?)/i },
  { code: 'OVERRIDE_INSTRUCTIONS', re: /disregard\s+(all\s+)?(previous|prior|above)/i },
  { code: 'REVEAL_SYSTEM_PROMPT', re: /(reveal|show|print|leak)\s+(your\s+)?(system\s+prompt|instructions)/i },
  // 角色冒充
  { code: 'ROLE_IMPERSONATION', re: /^\s*(system|assistant|developer)\s*:/im },
  { code: 'ROLE_IMPERSONATION', re: /\byou\s+are\s+now\b/i },
  // 中文：同类意图
  { code: 'OVERRIDE_INSTRUCTIONS', re: /忽略(以上|上面|之前|此前|全部)?(所有)?(的)?(指令|规则|提示|要求)/ },
  { code: 'ROLE_IMPERSONATION', re: /你现在(是|就是|扮演)/ },
  { code: 'REVEAL_SYSTEM_PROMPT', re: /(输出|告诉我|打印|泄露)(你的)?(系统提示|系统指令|提示词)/ },
  // 越权/绕审批意图
  { code: 'BYPASS_APPROVAL', re: /(无需|不用|跳过|绕过)(审批|确认|授权|同意)/ },
  { code: 'ESCALATE_PRIVILEGE', re: /(给我|赋予|升级为)(管理员|owner|admin|最高)?权限/ },
]

/** 检测注入信号。**返回值只用于告警与"升级为需批准"，不作为放行判据。** */
export function detectInjection(text: string): InjectionSignal[] {
  const signals: InjectionSignal[] = []
  for (const { code, re } of INJECTION_PATTERNS) {
    const m = text.match(re)
    if (m) {
      signals.push({ code, excerpt: m[0].slice(0, 80) })
    }
  }
  return signals
}

/** 去重（同一 code 只留一条），用于让审计事件不重复刷屏。 */
export function dedupeSignals(signals: InjectionSignal[]): InjectionSignal[] {
  const seen = new Set<string>()
  const out: InjectionSignal[] = []
  for (const s of signals) {
    if (seen.has(s.code)) continue
    seen.add(s.code)
    out.push(s)
  }
  return out
}

/**
 * T09 · Agent Runtime —— 编排（Slice 1，**纯内核，无 DB / 无网络**）
 *
 * 流程（每一步都是**可独立断言**的）：
 *
 *   1. 校验输入（不符合技能契约 → `FAILED`，**不发起调用、不记账**）
 *   2. **限额判定**（AC-20：必须在**发起调用之前**）
 *   3. 拼 prompt：不可信字段经 `guard.wrapUntrusted()`；授权集合进**可信**指令
 *   4. 调用 Provider（失败 → **明示降级**）
 *   5. 解析 + **zod 校验**输出（不合格 → 拒绝，**绝不把未校验文本交给渲染层**）
 *   6. 校验"受约束字段 ⊆ 服务端授权集合"（越界 → 拒绝，不截断）
 *   7. 记账（**失败也记**）→ 返回**提案**（`PROPOSED` / `AWAITING_APPROVAL`）
 *
 * 🔴 **本函数不执行任何副作用**。执行只存在于未来的 `executeApproved()`，
 *    它必须过 `assertExecutable()`（见 `approval.ts`）—— 这就是"注入绕不过审批"。
 *
 * 🔴 本切片**不向模型传递任何主体档案数据**（只传 `subjectLabel` 这类标签）。
 *    真实披露要等 Slice 2 接线，且**必须**经 `discloseSubject()` 投影后再进 prompt（AC-03）。
 */

import { compileWorkspaceSpec } from '@/lib/workspace-spec'
import {
  DEFAULT_PRICE_TABLE,
  DEFAULT_QUOTA,
  EMPTY_LEDGER,
  ZERO_USAGE,
  appendCall,
  checkQuota,
  costMicroCents,
  type AgentCallRecord,
  type AgentQuota,
  type LedgerSnapshot,
  type ModelUsage,
  type PriceTable,
} from './cost'
import { dedupeSignals, detectInjection, wrapUntrusted } from './guard'
import type { ProviderResolution } from './provider'
import { SKILLS, type SkillKey, type SkillSpec } from './skills'
import type { AgentRunStatus, DegradeReason, InjectionSignal, ProviderKind, RiskLevel } from './types'

export interface AgentOutcome {
  status: AgentRunStatus
  skill: SkillKey
  risk: RiskLevel
  /** 是否必须人工批准才能执行（含**因注入信号而升级**的情形）。 */
  requiresApproval: boolean
  /** 已通过 zod 校验的结构化产出。失败为 `null`。**未校验的模型文本永不进入此处。** */
  payload: unknown | null
  /** 模型原始文本：**仅供审计/调试**，不得直接渲染（渲染必须走 `payload`）。 */
  rawText: string | null
  injectionSignals: InjectionSignal[]
  /** 本次调用的归因记录（规则式降级也记一条 0 成本记录，使降级率可见）。 */
  cost: AgentCallRecord | null
  /** 调用后的账本快照（便于调用方持久化 / 对账）。 */
  ledger: LedgerSnapshot
  reason: string | null
  degradeCode: DegradeReason | null
  providerKind: ProviderKind
}

export interface RunSkillOptions {
  skill: SkillKey
  input: unknown
  /** **显式**解析结果；`unavailable` 会走明示降级，不会静默换假模型。 */
  provider: ProviderResolution
  ledger?: LedgerSnapshot
  quota?: AgentQuota
  price?: PriceTable
  now?: () => Date
}

// ── 辅助（导出以便单测直接打） ────────────────────────────────────────

/** 从模型文本里抽出 JSON（容忍 ```json 围栏与前后废话）。 */
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  const candidate = (fenced ? fenced[1] : trimmed).trim()

  try {
    return { ok: true, value: JSON.parse(candidate) }
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)) }
      } catch {
        /* 落到下面统一返回 */
      }
    }
    return { ok: false, reason: '输出不是合法 JSON' }
  }
}

/** 把不可信字段包进不可信区，并收集注入信号。 */
export function buildUntrusted(
  skill: SkillSpec,
  input: Record<string, unknown>,
): { text: string; signals: InjectionSignal[] } {
  const parts: string[] = []
  const signals: InjectionSignal[] = []
  for (const field of skill.untrustedFields) {
    const v = input[field]
    if (typeof v === 'string' && v.length > 0) {
      parts.push(`[${field}]\n${v}`)
      signals.push(...detectInjection(v))
    }
  }
  return { text: wrapUntrusted(parts.join('\n\n')), signals: dedupeSignals(signals) }
}

/** 把**服务端**给的授权集合写进**可信**指令（不是让它自己"声明"）。 */
export function buildInstruction(skill: SkillSpec, input: Record<string, unknown>): string {
  const extra: string[] = []
  for (const c of skill.constrainedOutputFields ?? []) {
    const raw = input[c.source]
    const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
    extra.push(`${c.source} = ${JSON.stringify(list)}`)
  }
  if (extra.length === 0) return skill.instruction
  return `${skill.instruction}\n\n（服务端给定的约束集 —— 你**只能**使用其中列出的项）\n${extra.join('\n')}`
}

/** 校验"受约束输出 ⊆ 服务端授权集合"；越界返回违规说明（**不截断**）。 */
export function checkConstrained(
  skill: SkillSpec,
  payload: unknown,
  input: Record<string, unknown>,
): string | null {
  if (!skill.constrainedOutputFields || payload === null || typeof payload !== 'object') return null
  const obj = payload as Record<string, unknown>
  for (const c of skill.constrainedOutputFields) {
    const outVal = obj[c.outputField]
    if (!Array.isArray(outVal)) continue
    const rawAllowed = input[c.source]
    const allowed = new Set(Array.isArray(rawAllowed) ? rawAllowed.filter((x): x is string => typeof x === 'string') : [])
    const bad = outVal.filter((x) => typeof x !== 'string' || !allowed.has(x))
    if (bad.length > 0) {
      return `${c.outputField} 含**未授权项**（${bad.slice(0, 3).join('、')}）—— 越界产出一律拒绝，不截断。`
    }
  }
  return null
}

function makeRecord(
  skill: SkillSpec,
  providerKind: ProviderKind,
  ok: boolean,
  usage: ModelUsage,
  price: PriceTable,
  now: () => Date,
): AgentCallRecord {
  return {
    skill: skill.key,
    providerKind,
    risk: skill.risk,
    highCost: skill.costProfile.highCost,
    ok,
    usage,
    microCents: costMicroCents(usage, price),
    at: now().toISOString(),
  }
}

/** 降级：能走规则式兜底就走，否则**明示失败**（不假装成功）。 */
function degrade(
  skill: SkillSpec,
  input: Record<string, unknown>,
  code: DegradeReason,
  reason: string,
  requiresApproval: boolean,
  signals: InjectionSignal[],
  ledger: LedgerSnapshot,
  cost: AgentCallRecord | null,
  price: PriceTable,
  now: () => Date,
): AgentOutcome {
  if (skill.key === 'INTENT_EXTRACTION') {
    const goal = typeof input.goal === 'string' ? input.goal : ''
    const compiled = compileWorkspaceSpec(goal)
    if (compiled.ok) {
      // 归因记录的选择有讲究（两者不可混为一谈）：
      //   - `cost` 非空 ⇒ 本次**真的发生过一次模型调用**（哪怕失败）：
      //     就用那一条 —— "失败也记账"必须落到 `outcome.cost` 与账本上，
      //     否则 `ledgerTotals().failedCalls` 会永远为 0（那个假设没人验证过）。
      //     此时**不**再补记，避免一次运行在账本里变成两条（重复计数 = 对账失真）。
      //   - `cost` 为空 ⇒ 根本没发起调用（如 provider 不可用）：补记一条 0 成本
      //     规则式记录，使"降级率"在账本里可见。
      const attribution = cost ?? makeRecord(skill, 'rules', true, ZERO_USAGE, price, now)
      const nextLedger = cost ? ledger : appendCall(ledger, attribution)
      return {
        status: 'DEGRADED',
        skill: skill.key,
        risk: skill.risk,
        requiresApproval,
        payload: compiled.spec,
        rawText: null,
        injectionSignals: signals,
        cost: attribution,
        ledger: nextLedger,
        reason: `${reason} 已降级为**规则式**抽取（能力弱于模型路径，结果仍需你确认）。`,
        degradeCode: code,
        providerKind: 'rules',
      }
    }
    return {
      status: 'FAILED',
      skill: skill.key,
      risk: skill.risk,
      requiresApproval,
      payload: null,
      rawText: null,
      injectionSignals: signals,
      cost,
      ledger,
      reason: `${reason} 且规则式兜底也失败：${compiled.reason}`,
      degradeCode: 'NO_DEGRADE_PATH',
      providerKind: 'rules',
    }
  }

  return {
    status: 'FAILED',
    skill: skill.key,
    risk: skill.risk,
    requiresApproval,
    payload: null,
    rawText: null,
    injectionSignals: signals,
    cost,
    ledger,
    reason: `${reason}（该技能没有降级路径 —— 宁可不产出，也不给未经验证的结果。）`,
    degradeCode: code,
    providerKind: 'rules',
  }
}

// ── 主入口 ────────────────────────────────────────────────────────────

export async function runSkill(opts: RunSkillOptions): Promise<AgentOutcome> {
  const skill = SKILLS[opts.skill]
  const ledger = opts.ledger ?? EMPTY_LEDGER
  const quota = opts.quota ?? DEFAULT_QUOTA
  const price = opts.price ?? DEFAULT_PRICE_TABLE
  const now = opts.now ?? (() => new Date())

  // ① 输入校验 —— 不合格就不该花钱
  const parsedInput = skill.inputSchema.safeParse(opts.input)
  if (!parsedInput.success) {
    const first = parsedInput.error.issues[0]
    return {
      status: 'FAILED',
      skill: skill.key,
      risk: skill.risk,
      requiresApproval: skill.requiresApproval,
      payload: null,
      rawText: null,
      injectionSignals: [],
      cost: null,
      ledger,
      reason: `输入不符合技能契约：${first?.path.join('.') ?? '(root)'} ${first?.message ?? ''}`,
      degradeCode: 'INPUT_INVALID',
      providerKind: 'rules',
    }
  }
  const input = parsedInput.data as Record<string, unknown>

  const { text: untrusted, signals } = buildUntrusted(skill, input)
  // 注入信号 → **升级**为需人工批准（宁可多一次点击，也不放过一次尝试）。
  const requiresApproval = skill.requiresApproval || signals.length > 0

  // ② 限额判定（在调用之前）
  const decision = checkQuota(
    ledger,
    quota,
    { key: skill.key, highCost: skill.costProfile.highCost, costProfile: skill.costProfile },
    price,
  )
  if (!decision.allowed) {
    return {
      status: 'BLOCKED_QUOTA',
      skill: skill.key,
      risk: skill.risk,
      requiresApproval,
      payload: null,
      rawText: null,
      injectionSignals: signals,
      cost: null,
      ledger,
      reason: decision.reason,
      degradeCode: null,
      providerKind: 'rules',
    }
  }

  // ③ Provider 不可用 → 明示降级
  if (opts.provider.kind === 'unavailable') {
    return degrade(skill, input, 'PROVIDER_UNAVAILABLE', opts.provider.reason, requiresApproval, signals, ledger, null, price, now)
  }

  const provider = opts.provider.provider

  // ④ 调用
  const res = await provider.complete({
    system: skill.systemPrompt,
    untrusted,
    instruction: buildInstruction(skill, input),
    maxOutputTokens: skill.costProfile.estimatedOutputTokens,
  })

  if (!res.ok) {
    const record = makeRecord(skill, provider.kind, false, res.usage ?? ZERO_USAGE, price, now)
    const nextLedger = appendCall(ledger, record)
    return degrade(skill, input, res.code, res.message, requiresApproval, signals, nextLedger, record, price, now)
  }

  // ⑤ 记账（成功也记）
  const record = makeRecord(skill, provider.kind, true, res.usage, price, now)
  const nextLedger = appendCall(ledger, record)

  // ⑥ 解析 + 校验（顺序不可颠倒：先解析、再 zod、再越界检查）
  const extracted = extractJson(res.text)
  if (!extracted.ok) {
    return degrade(skill, input, 'OUTPUT_NOT_PARSEABLE', extracted.reason, requiresApproval, signals, nextLedger, record, price, now)
  }

  const validated = skill.outputSchema.safeParse(extracted.value)
  if (!validated.success) {
    const first = validated.error.issues[0]
    return degrade(
      skill,
      input,
      'OUTPUT_SCHEMA_INVALID',
      `模型输出未通过契约校验：${first?.path.join('.') ?? '(root)'} ${first?.message ?? ''}`,
      requiresApproval,
      signals,
      nextLedger,
      record,
      price,
      now,
    )
  }

  const violation = checkConstrained(skill, validated.data, input)
  if (violation) {
    return degrade(skill, input, 'OUTPUT_SCHEMA_INVALID', violation, requiresApproval, signals, nextLedger, record, price, now)
  }

  // ⑦ 返回**提案**（不执行副作用）
  return {
    status: requiresApproval ? 'AWAITING_APPROVAL' : 'PROPOSED',
    skill: skill.key,
    risk: skill.risk,
    requiresApproval,
    payload: validated.data,
    rawText: res.text,
    injectionSignals: signals,
    cost: record,
    ledger: nextLedger,
    reason: signals.length > 0 ? '检测到注入信号 → 已**升级**为需人工批准（信号本身不作为拒绝判据）。' : null,
    degradeCode: null,
    providerKind: provider.kind,
  }
}

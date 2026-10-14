/**
 * Living Connection OS · P1 —— Intent-to-UI Compiler
 *
 * 职责：**自然语言 → 受约束的 `WorkspaceSpec`**（再交给白名单渲染器）。
 *
 * 🔴 三条纪律（对应 `DESIGN/01` §6 与阻断标准 #3/#6）：
 *
 *   1. **绝不产 HTML / React 代码 / 可执行串**。只产 `WorkspaceSpec` 数据；
 *      渲染由 `src/components/living/node-card.tsx` 的白名单组件完成。
 *   2. **不伪造**。语言里没说的数量、期限、预算**不会**被编出来；
 *      识别不了的目标类型 → 返回 `ok:false` + 原因 + 建议，**而不是**硬凑一个 spec。
 *   3. **不产 `agent` 节点**。`agent` 依赖 T09 Agent Runtime，产出即为伪造能力。
 *
 * 关于"为什么这里是规则式而不是 LLM"：
 *   设计基准 §二 要求"模型不得直接写代码"，但**没有**要求 P1 就必须调模型。
 *   LLM 提案属于 **T09 Agent Runtime** 的范围（需 T09 的 schema 校验 + 成本限额 + 降级）。
 *   因此 P1 先把**契约 / 校验 / 白名单渲染**这条不可绕过的链路做实，
 *   提案器（proposer）保持可替换：T09 落地后只需换 `proposeSpecDraft()`，
 *   校验层与渲染层**一行都不用改**。
 */

import {
  RESERVED_NODE_TYPES,
  WorkspaceSpecSchema,
  WORKSPACE_SPEC_VERSION,
  type WorkspaceSpec,
} from './schema'

// ── 意图分类 ──────────────────────────────────────────────────────────

export const INTENT_CLASSES = ['PARTNERSHIP', 'RECRUITMENT', 'EVENT', 'RESEARCH', 'MENTORSHIP'] as const
export type IntentClass = (typeof INTENT_CLASSES)[number]

interface Playbook {
  readonly label: string
  readonly keywords: readonly string[]
  /** 该意图下通常需要的动作（能力名必须在 `src/lib/tenancy/capabilities.ts` 里真实存在）。 */
  readonly actions: readonly { key: string; label: string; capability: string }[]
  readonly example: string
}

/**
 * 意图剧本表。**只包含 5 类**——这是刻意的：
 * 与其用模糊的关键词覆盖一切（从而把不相关的话也"理解"成任务），
 * 不如**明确只认这 5 类**，其余一律返回 `ok:false` 让用户重述。
 */
export const INTENT_PLAYBOOKS: Record<IntentClass, Playbook> = {
  PARTNERSHIP: {
    label: '渠道 / 资源对接',
    keywords: ['合作', '渠道', '伙伴', '资源', '对接', '商务', 'bd', '联盟', '联合', '互换'],
    actions: [
      { key: 'create-mission', label: '创建连接任务', capability: 'mission.create' },
      { key: 'propose-connection', label: '发起双边提案', capability: 'proposal.create' },
    ],
    example: '帮助我们在 30 天内对接 5 家渠道伙伴，完成初步合作洽谈',
  },
  RECRUITMENT: {
    label: '成员招募 / 社群增长',
    keywords: ['招募', '招人', '成员', '加入', '扩群', '增长', '拉新', '沉淀', '入群'],
    actions: [
      { key: 'create-mission', label: '创建连接任务', capability: 'mission.create' },
      { key: 'invite-member', label: '邀请成员加入社群', capability: 'member.invite' },
    ],
    example: '本月为社群招募 20 位活跃成员，要求有内容创作经验',
  },
  EVENT: {
    label: '活动 / 线下聚会',
    keywords: ['活动', '沙龙', '线下', '聚会', '工作坊', '分享会', 'meetup', '直播'],
    actions: [
      { key: 'create-mission', label: '创建连接任务', capability: 'mission.create' },
      { key: 'create-mission-2', label: '招募活动参与者', capability: 'mission.create' },
    ],
    example: '下个月办一场 40 人的线下工作坊，主题是 AI 产品落地',
  },
  RESEARCH: {
    label: '调研 / 用户访谈',
    keywords: ['调研', '访谈', '问卷', '反馈', '用户研究', '回访', '评测'],
    actions: [
      { key: 'create-mission', label: '创建连接任务', capability: 'mission.create' },
      { key: 'report-outcome', label: '记录调研成果', capability: 'outcome.report' },
    ],
    example: '两周内完成 10 位老用户的深度访谈，输出体验问题清单',
  },
  MENTORSHIP: {
    label: '导师 / 陪伴成长',
    keywords: ['导师', '教练', 'mentor', '陪伴', '指导', '带教', '咨询'],
    actions: [
      { key: 'create-mission', label: '创建连接任务', capability: 'mission.create' },
      { key: 'propose-connection', label: '发起双边提案', capability: 'proposal.create' },
    ],
    example: '为 3 位新成员匹配产品方向的导师，进行为期 6 周的带教',
  },
}

/** 目标描述的最小长度（太短的信息量不足以判定意图）。 */
export const MIN_GOAL_LENGTH = 8

// ── 关键词打分 ────────────────────────────────────────────────────────

export interface Classification {
  intentClass: IntentClass | null
  matchedKeywords: string[]
  /** 全部分类的命中分，便于 UI 解释"为什么这样判"。 */
  scores: Record<IntentClass, number>
}

/**
 * 纯函数分类。平手时按 `INTENT_CLASSES` 声明顺序取先者（确定性 —— 同一输入恒得同一结果）。
 */
export function classifyIntent(input: string): Classification {
  const haystack = input.toLowerCase()
  const scores = {} as Record<IntentClass, number>
  const hits = {} as Record<IntentClass, string[]>

  for (const cls of INTENT_CLASSES) {
    let score = 0
    const matched: string[] = []
    for (const kw of INTENT_PLAYBOOKS[cls].keywords) {
      if (haystack.includes(kw.toLowerCase())) {
        score += 1
        matched.push(kw)
      }
    }
    scores[cls] = score
    hits[cls] = matched
  }

  let best: IntentClass | null = null
  for (const cls of INTENT_CLASSES) {
    if (scores[cls] > 0 && (best === null || scores[cls] > scores[best])) {
      best = cls
    }
  }

  return {
    intentClass: best,
    matchedKeywords: best ? hits[best] : [],
    scores,
  }
}

// ── 草稿字段抽取（**只抽语言里真实出现的**） ──────────────────────────

const CN_NUM: Record<string, number> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

function toNumber(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw)
  return CN_NUM[raw] ?? null
}

/**
 * 从目标描述里抽取**草稿**约束与成功判据。
 *
 * ⚠️ 抽不到就是空数组 —— **不做默认假设**（例如不会因为"没写期限"就默认 30 天）。
 * 抽到的值一律以"草稿"身份呈现给用户确认（见 `notes`）。
 */
export function extractDraftFields(input: string): {
  constraints: string[]
  successCriteria: string[]
  expiresAt?: string
} {
  const constraints: string[] = []
  const successCriteria: string[] = []

  // 期限："30 天内" / "两周内" / "3 个月"
  // ⚠️ 三个抽取器必须**都跑完**再返回 —— 首版在期限分支里提前 return，
  //    导致"写了期限"的目标反而抽不到预算与数量判据（已修）。
  const durationRe = /(\d+|[一二两三四五六七八九十])\s*(天|日|周|星期|个月|月|季度|年)\s*(内|之内)?/g
  let m: RegExpExecArray | null
  let earliestDays: number | null = null
  while ((m = durationRe.exec(input)) !== null) {
    const n = toNumber(m[1])
    if (n === null) continue
    const unit = m[2]
    const days =
      unit === '天' || unit === '日'
        ? n
        : unit === '周' || unit === '星期'
          ? n * 7
          : unit === '个月' || unit === '月'
            ? n * 30
            : unit === '季度'
              ? n * 90
              : n * 365
    constraints.push(`期限：${n}${unit}${m[3] ?? ''}`)
    if (earliestDays === null || days < earliestDays) earliestDays = days
  }

  // 预算："预算 5000" / "不超过 2 万"（仅当原文真的写了）
  const budgetMatch = input.match(/(?:预算|经费|费用|不超过|控制在)\s*(\d+(?:\.\d+)?)\s*(万|千|元)?/)
  if (budgetMatch) {
    constraints.push(`预算：${budgetMatch[1]}${budgetMatch[2] ?? ''}`)
  }

  // 数量判据："20 次" / "5 家" / "10 位"
  const countRe = /(\d+|[一二两三四五六七八九十])\s*(次|位|人|家|个|场|篇|份)/g
  const seen = new Set<string>()
  while ((m = countRe.exec(input)) !== null) {
    const phrase = `${m[1]}${m[2]}`
    if (seen.has(phrase)) continue
    seen.add(phrase)
    successCriteria.push(`达成 ${phrase}`)
  }

  if (earliestDays !== null && earliestDays > 0 && earliestDays <= 365) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + earliestDays)
    // 只保留日期，避免把"当前时刻"这种噪声写进业务字段。
    const expiresAt = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    ).toISOString()
    return { constraints, successCriteria, expiresAt }
  }

  return { constraints, successCriteria }
}

// ── 编译 ──────────────────────────────────────────────────────────────

export type CompileResult =
  | {
      ok: true
      spec: WorkspaceSpec
      intentClass: IntentClass
      matchedKeywords: string[]
    }
  | {
      ok: false
      /** 面向用户的**具体**原因（不写"敬请期待"这类空话）。 */
      reason: string
      /** 可操作的下一步建议。 */
      suggestions: string[]
    }

/** 提供给 UI 的建议文案（列出**当前真支持**的 5 类）。 */
export function supportedIntentHints(): string[] {
  return INTENT_CLASSES.map((cls) => `${INTENT_PLAYBOOKS[cls].label} —— 例如：${INTENT_PLAYBOOKS[cls].example}`)
}

/**
 * 由目标描述编译出 `WorkspaceSpec`。
 *
 * 纯函数、确定性、无副作用 —— 同一输入恒得同一 spec（可单测）。
 */
export function compileWorkspaceSpec(rawInput: string): CompileResult {
  const input = rawInput.trim()

  if (input.length < MIN_GOAL_LENGTH) {
    return {
      ok: false,
      reason: `目标描述太短（至少 ${MIN_GOAL_LENGTH} 个字符）——无法判断你要达成什么。`,
      suggestions: supportedIntentHints(),
    }
  }

  const { intentClass, matchedKeywords } = classifyIntent(input)
  if (intentClass === null) {
    return {
      ok: false,
      reason: '没有识别出目标类型。当前只支持下列 5 类目标（识别不出时不会替你猜）。',
      suggestions: supportedIntentHints(),
    }
  }

  const playbook = INTENT_PLAYBOOKS[intentClass]
  const { constraints, successCriteria, expiresAt } = extractDraftFields(input)

  const draft: WorkspaceSpec = {
    version: WORKSPACE_SPEC_VERSION,
    title: playbook.label,
    summary: `由目标描述编译出的草稿（意图类型：${playbook.label}）。`,
    nodes: [
      {
        id: 'intent-1',
        type: 'intent',
        title: '目标与成功判据',
        data: {
          goal: input,
          constraints,
          successCriteria,
          ...(expiresAt ? { expiresAt } : {}),
        },
      },
      {
        // 候选节点留空是**刻意的**：真实候选来自 `/api/v1/connections/candidates`，
        // 需要 ACTIVE 社群成员身份。这里**不预填任何候选**（AC-13 不伪造匹配）。
        id: 'candidate-1',
        type: 'candidate',
        title: '候选择优',
        data: { candidates: [] },
      },
    ],
    availableActions: playbook.actions.map((a) => ({
      key: a.key,
      label: a.label,
      capability: a.capability,
      // 真实可执行性由**运行期能力探测**覆写（见 `living-workspace.tsx` 的 probe）。
      // 编译期一律给 false + 原因，避免前端"以为"有权。
      ready: false,
      reason: `需服务端校验 ${a.capability} 能力（需要 ACTIVE 社群成员身份）。`,
    })),
    notes: [
      '约束与成功判据是从你的描述里抽出的草稿，原文没写的（例如预算）不会被补默认值 —— 请在创建前确认。',
      '候选区当前为空：真实候选需要 ACTIVE 社群成员身份后由服务端召回，本页不会预填。',
      ...(expiresAt ? [`期限按描述中的最短时间折算为 ${expiresAt.slice(0, 10)}。`] : []),
    ],
  }

  // 🔴 产出必须过校验才算数 —— 门禁在**编译器内部**执行，不依赖调用方自觉。
  const parsed = WorkspaceSpecSchema.safeParse(draft)
  if (!parsed.success) {
    return {
      ok: false,
      reason: `内部错误：生成的 spec 未通过契约校验（${parsed.error.issues[0]?.message ?? '未知'}）。已阻止渲染，避免展示不合规内容。`,
      suggestions: ['请重述目标；若持续出现请上报（这是编译器缺陷，不是你的输入问题）。'],
    }
  }

  // 第二道闸：禁止出现保留节点类型（`agent` 等）。
  const reserved = parsed.data.nodes.find((n) =>
    (RESERVED_NODE_TYPES as readonly string[]).includes(n.type),
  )
  if (reserved) {
    return {
      ok: false,
      reason: `内部错误：编译器产出了保留节点类型 "${reserved.type}"（依赖 T09 Agent Runtime），已阻止渲染。`,
      suggestions: ['请重述目标并上报此问题。'],
    }
  }

  return { ok: true, spec: parsed.data, intentClass, matchedKeywords }
}

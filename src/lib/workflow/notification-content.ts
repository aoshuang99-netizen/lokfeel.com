/**
 * T06 · 通知内容渲染与**披露边界守卫**（纯函数，无 IO）
 *
 * 这个文件回答一个问题：**"可以往外发什么？"**
 *
 * 背景（AC-09「消息合规」+ 主指令「仅用官方授权渠道，禁止静默冒充真人」）：
 *   通知是**旁路渠道**（站内信/邮件）。它绕开了页面上的披露投影（`discloseSubject()`），
 *   因此**极易**成为一次计划外的信息披露。T05 的 R4 已经点明：
 *   通知内容"不得包含 rationale 全文与对侧档案 —— 它是'你有提案待处理'的提示，
 *   不是一次披露（否则通知渠道会绕开 discloseSubject()）"。
 *
 * 本文件用**三道防线**把这条纪律钉住：
 *   1. **类型层**：`RenderInput` 里**没有** rationale / 档案字段的位置 —— 想传也传不进来；
 *   2. **运行时**：`assertNoLeakage()` 对渲染结果做长公共子串检测，命中即抛错（纵深防御）；
 *   3. **身份声明**：每条通知**必须**携带"由谁通过 LokFeel 发出"，
 *      让"系统/组织方发出"与"真人私聊"在文本层面就不可混淆。
 */

/** 通知模板。模板决定文案骨架，与具体人无关，故可安全落库与断言。 */
export type NotificationTemplate =
  | 'proposal.pending' // 你有一条新提案待处理
  | 'proposal.accepted' // 对方已同意，等你表态
  | 'connection.introduced' // 连接已建立
  | 'connection.followup' // 跟进提示（AC-14 的"跟进"段）
  | 'operator.attention' // 运营告警：有任务需要人工处置（R9）

export const NOTIFICATION_TEMPLATES: readonly NotificationTemplate[] = [
  'proposal.pending',
  'proposal.accepted',
  'connection.introduced',
  'connection.followup',
  'operator.attention',
] as const

export function isNotificationTemplate(value: unknown): value is NotificationTemplate {
  return typeof value === 'string' && (NOTIFICATION_TEMPLATES as readonly string[]).includes(value)
}

/**
 * 渲染入参。
 *
 * ⚠️ **这里没有 `rationale`、没有档案字段、没有对侧姓名** —— 这是刻意的。
 *   通知要表达的是"有一件事在等你"，而不是"对方是谁、为什么是你"。
 *   后者的唯一合法出口是连接页上的披露投影。
 *
 * `missionTitle` 是唯一可选的业务文本：它是**公开信息**（分享页未注册访客就能看到），
 *   传进来只是为了让人知道"是哪条任务的提案"。
 */
export interface RenderInput {
  template: NotificationTemplate
  /** 组织名。用于身份声明（AC-09：不得静默冒充真人）。 */
  organizationName: string
  /** 任务标题。可选；仅在确认其为公开信息时传入。 */
  missionTitle?: string | null
  /** 站内/邮件里可点的落地页。 */
  actionUrl?: string | null
}

export interface RenderedNotification {
  subject: string
  body: string
  actionUrl: string | null
}

/** 身份声明的固定后缀。E2E 与单测断言它**必须**存在。 */
export const SENDER_ATTRIBUTION_SUFFIX = '（系统通知，由社群运营方通过 LokFeel 发出）'

/**
 * 渲染一条通知。
 *
 * 文案用中文，与 T05 的移动端界面（「我的连接」）保持一致 ——
 * 若日后需要多语言，应在这一层引入 locale 参数，而不是在上层拼字符串。
 */
export function renderNotification(input: RenderInput): RenderedNotification {
  const org = input.organizationName?.trim() || '你的社群'
  const mission = input.missionTitle?.trim()

  const { subject, body } = (() => {
    switch (input.template) {
      case 'proposal.pending':
        return {
          subject: '你有一条新的连接提案待处理',
          body: [
            `「${org}」为你发起了一条连接提案${mission ? `（任务：${mission}）` : ''}。`,
            '对方的身份与推荐理由会在你打开连接页时按你授权的披露范围展示。',
            '你可以选择同意、拒绝或忽略；在你明确同意之前，不会向对方披露你的信息。',
          ].join('\n'),
        }
      case 'proposal.accepted':
        return {
          subject: '对方已同意，等待你的表态',
          body: [
            `「${org}」的这条连接提案中，对方已经同意${mission ? `（任务：${mission}）` : ''}。`,
            '只有双方都同意，连接才会建立。你的选择随时可以改变。',
          ].join('\n'),
        }
      case 'connection.introduced':
        return {
          subject: '连接已建立',
          body: [
            `「${org}」已完成介绍，你们的连接已建立${mission ? `（任务：${mission}）` : ''}。`,
            '接下来可以在连接页查看对方按披露范围公开的信息，并开始协调。',
          ].join('\n'),
        }
      case 'connection.followup':
        return {
          subject: '你的连接还顺利吗？',
          body: [
            `「${org}」想了解你这条连接${mission ? `（任务：${mission}）` : ''}的进展。`,
            '如果已经聊过了，可以在连接页记录结果；如果暂时没有进展，也可以先放一放。',
          ].join('\n'),
        }
      case 'operator.attention':
        // 运营告警：收件人是**运营/管理员**，不是成员。
        // 刻意**不**引用 mission 标题与任何业务文本 —— 告警只需要表达
        // "有待处置项"，多说一个字都是一次多余的披露面（R9 的防回路 + R4 的纵深防御）。
        return {
          subject: '有连接任务需要人工处置',
          body: [
            `「${org}」的连接工作流里有任务进入了需要人工处置的状态（死信 / 已接管 / 失败）。`,
            '请打开运营控制台查看待处置清单，必要时接管或重试；在处置之前，这些任务不会自动重试。',
          ].join('\n'),
        }
    }
  })()

  // 身份声明是**强制**的：AC-09 禁止"静默冒充真人"。
  const withAttribution = `${body}\n\n${SENDER_ATTRIBUTION_SUFFIX}`

  return { subject, body: withAttribution, actionUrl: input.actionUrl ?? null }
}

// ═══════════════════════════════════════════════════════════════
// 披露边界守卫（纵深防御）
// ═══════════════════════════════════════════════════════════════

/** 判定为泄漏的最短公共子串长度。取 12：短于此的巧合重合不可信。 */
export const LEAK_MIN_OVERLAP = 12

/**
 * 最长公共子串长度。用于检测"渲染结果里混进了不该出现的原文"。
 *
 * 为什么不用 `includes()`：泄漏往往发生在**模板拼接之后**（例如有人把 rationale
 * 截断 20 字塞进 body），此时整串包含不成立，但长片段仍然重合。
 * 用最长公共子串能把"截断后的泄漏"一并抓住。
 */
export function longestCommonSubstringLength(a: string, b: string): number {
  if (!a || !b) return 0
  const s1 = a
  const s2 = b
  let best = 0
  // 滚动数组 DP：只保留上一行，避免 O(n*m) 内存。
  let prev = new Array<number>(s2.length + 1).fill(0)
  for (let i = 1; i <= s1.length; i++) {
    const curr = new Array<number>(s2.length + 1).fill(0)
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        curr[j] = prev[j - 1] + 1
        if (curr[j] > best) best = curr[j]
      }
    }
    prev = curr
  }
  return best
}

export class NotificationLeakError extends Error {
  readonly template: NotificationTemplate
  readonly overlap: number

  constructor(template: NotificationTemplate, overlap: number) {
    super(
      `Notification for "${template}" appears to leak protected content (overlap ${overlap} chars)`
    )
    this.name = 'NotificationLeakError'
    this.template = template
    this.overlap = overlap
  }
}

/**
 * 断言渲染结果没有泄漏受保护内容。
 *
 * 调用点在**发送之前**（`service.ts`）。命中即抛错并让任务失败 ——
 * 这是"宁可这条通知发不出去，也不把不该发的发出去"的取舍：
 * 通知的可用性远低于披露边界的正确性（后者是 AC-03 的 BLOCKER 取向）。
 *
 * `protectedTexts` 由调用方从数据库取出（如提案的 rationale）。
 * 注意：**它不进 `RenderInput`** —— 它的唯一用途就是被这里比对，而不是被渲染。
 */
export function assertNoLeakage(
  rendered: RenderedNotification,
  protectedTexts: readonly (string | null | undefined)[],
  template: NotificationTemplate
): void {
  const haystack = `${rendered.subject}\n${rendered.body}`
  for (const raw of protectedTexts) {
    const needle = raw?.trim()
    if (!needle) continue
    const overlap = longestCommonSubstringLength(haystack, needle)
    if (overlap >= LEAK_MIN_OVERLAP) {
      throw new NotificationLeakError(template, overlap)
    }
  }
}

/** 断言身份声明存在（AC-09 的"不得静默冒充真人"）。 */
export function hasSenderAttribution(rendered: RenderedNotification): boolean {
  return rendered.body.includes(SENDER_ATTRIBUTION_SUFFIX)
}

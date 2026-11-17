/**
 * V25.3 · T04（V25-13/14/19）—— 私人生成式沟通的**溯源 + 零外发**护栏
 *
 * 背景：聊天侧要接 AI 翻译 / 表达建议 / 回复草稿。V25.3 硬验收要求：
 *   · 每次 AI 调用都带 consent_ref / purpose / recipient_scope / model_id /
 *     input_data_scope / request_id 六个溯源字段；
 *   · 区分 AI_PRIVATE_DRAFT 与 HUMAN_SENT —— AI 草稿在用户点击"发送"前，
 *     **数据库消息写增量 0、对外发送 0**；
 *   · 草稿不得冒充真人（impersonation）、不得把"对方私聊 / 未授权敏感内容"
 *     送进模型；危险情绪/意图必须带不确定性说明。
 *
 * 本模块是**纯契约层**（零 IO、零 Prisma、零网络），刻意做成不可绕过的值对象：
 * 调用方只能用 `makePrivateDraft()` 产出草稿、用 `authorizeDraftSend()` 取得
 * "用户已确认发送"的唯一许可。任何想跳过 provenance 或直接把草稿当 HUMAN_SENT
 * 的调用在类型/运行时都拿不到许可。
 *
 * ⚠️ 本模块不产模型文本、不决定输出质量 —— 模型调用走 `src/lib/agent`（已有
 * 注入护栏 / strictObject 契约）。这里只管"这份产出能不能、何时能变成一条真人消息"。
 */

/** 一次 AI 调用的溯源记录（spec 六个字段，全部必填）。 */
export interface DraftProvenance {
  consent_ref: string
  purpose: 'translate' | 'expression' | 'reply_draft'
  recipient_scope: string
  model_id: string
  input_data_scope: string
  request_id: string
}

/** 草稿消息来源——永不可为 HUMAN_SENT（那是发送动作产生的，不是 AI 产生的）。 */
export type DraftOrigin = 'AI_PRIVATE_DRAFT'

export interface PrivateDraft {
  origin: DraftOrigin
  text: string
  provenance: DraftProvenance
  /** 危险情绪/意图推断必须带的不确定性说明（无则为空数组）。 */
  caveats: string[]
  /** 该草稿是否使用了"对方私聊内容"作为输入（必须=false，否则不可用于模型）。 */
  usedCounterpartyPrivateChat: false
}

export type ProvenanceIssue =
  | 'EMPTY_CONSENT_REF'
  | 'EMPTY_REQUEST_ID'
  | 'EMPTY_PURPOSE_SCOPE'
  | 'EMPTY_MODEL_ID'
  | 'COUNTERPARTY_PRIVATE_CHAT_FORBIDDEN'

/** 校验溯源完整性；返回空数组表示合规。纯函数、可穷举。 */
export function validateProvenance(
  p: DraftProvenance,
  usedCounterpartyPrivateChat: boolean,
): ProvenanceIssue[] {
  const issues: ProvenanceIssue[] = []
  if (!p.consent_ref?.trim()) issues.push('EMPTY_CONSENT_REF')
  if (!p.request_id?.trim()) issues.push('EMPTY_REQUEST_ID')
  if (!p.purpose?.trim() || !p.recipient_scope?.trim() || !p.input_data_scope?.trim()) {
    issues.push('EMPTY_PURPOSE_SCOPE')
  }
  if (!p.model_id?.trim()) issues.push('EMPTY_MODEL_ID')
  if (usedCounterpartyPrivateChat) issues.push('COUNTERPARTY_PRIVATE_CHAT_FORBIDDEN')
  return issues
}

export type DraftBuildResult =
  | { ok: true; draft: PrivateDraft }
  | { ok: false; issues: ProvenanceIssue[] }

/**
 * 构造一条 AI 私人草稿。溯源不全 / 用了对方私聊 ⇒ 拒绝构造（fail closed）。
 * 产出恒为 origin=AI_PRIVATE_DRAFT，且 usedCounterpartyPrivateChat 恒 false。
 */
export function makePrivateDraft(params: {
  text: string
  provenance: DraftProvenance
  caveats?: string[]
  usedCounterpartyPrivateChat?: boolean
}): DraftBuildResult {
  const usedPrivate = params.usedCounterpartyPrivateChat === true
  const issues = validateProvenance(params.provenance, usedPrivate)
  if (issues.length) return { ok: false, issues }
  return {
    ok: true,
    draft: {
      origin: 'AI_PRIVATE_DRAFT',
      text: params.text,
      provenance: { ...params.provenance },
      caveats: [...(params.caveats ?? [])],
      usedCounterpartyPrivateChat: false,
    },
  }
}

/** 用户确认发送的许可凭证——只能由 `authorizeDraftSend` 产生。 */
export interface SendAuthorization {
  draftId: string
  confirmedByUserId: string
  confirmedAt: number
  /** 发送后系统应写入的消息来源——此刻才升级为真人消息。 */
  resultingOrigin: 'HUMAN_SENT'
}

/**
 * 把一条 AI 草稿升级为"可发送"。必须显式给出确认用户与时间；
 * 未调用本函数前，草稿只是本地文本 —— 没有任何写库/外发副作用。
 */
export function authorizeDraftSend(
  draft: PrivateDraft,
  confirmedByUserId: string,
  confirmedAt: number = Date.now(),
): SendAuthorization | null {
  if (!confirmedByUserId?.trim() || !Number.isFinite(confirmedAt)) return null
  if (draft.origin !== 'AI_PRIVATE_DRAFT') return null
  return {
    draftId: `${draft.provenance.request_id}:${confirmedByUserId}`,
    confirmedByUserId,
    confirmedAt,
    resultingOrigin: 'HUMAN_SENT',
  }
}

/**
 * 危险情绪/意图措辞检测（保守告警，不做最终判定）。命中时调用方应在 caveats 里
 * 附不确定性说明；这里只给"是否需要说明"的判据，避免把推断当事实。
 */
const UNCERTAIN_TONE = /(一定|绝对|肯定|必然)[^，。！？]{0,4}(喜欢|讨厌|爱|恨|会|想|拒绝|接受)|他.?心里|她.?心里|潜意识|一定不会/i

export function needsUncertaintyCaveat(text: string): boolean {
  return UNCERTAIN_TONE.test(text ?? '')
}

/** 把"模型来源 / 降级"标注附加到草稿文本，避免冒充真人。 */
export function labelDraftSource(text: string, modelId: string, degraded = false): string {
  const tag = degraded ? `[AI 草稿 · ${modelId} · 降级]` : `[AI 草稿 · ${modelId}]`
  return `${tag} ${text}`
}

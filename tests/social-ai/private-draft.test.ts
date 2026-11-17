/**
 * V25.3 · T04 —— 私人 AI 草稿的溯源 + 零外发护栏负向测试
 *
 * 核心断言不是"文案好不好"，而是硬验收里的三条：
 *  ① 六个溯源字段缺任一 ⇒ 无法构造草稿（fail closed）；
 *  ② AI 草稿恒为 AI_PRIVATE_DRAFT，未授权发送前拿不到 SendAuthorization
 *     —— 即"用户没点发送，数据库消息写增量 0、外发 0"在代码里不可表达；
 *  ③ 对方私聊内容喂进模型 ⇒ 拒绝；危险情绪措辞 ⇒ 要求不确定性说明。
 */

import {
  validateProvenance,
  makePrivateDraft,
  authorizeDraftSend,
  needsUncertaintyCaveat,
  labelDraftSource,
  type DraftProvenance,
} from '@/lib/social-ai/private-draft'

const GOOD: DraftProvenance = {
  consent_ref: 'consent_abc',
  purpose: 'reply_draft',
  recipient_scope: 'conv_1:user_b',
  model_id: 'deepseek-v4.1-flash',
  input_data_scope: 'own_message_only',
  request_id: 'req_123',
}

describe('validateProvenance · 六字段完整性', () => {
  it('完整溯源 → 零 issue', () => {
    expect(validateProvenance(GOOD, false)).toEqual([])
  })

  it('🔒 consent_ref 空 → EMPTY_CONSENT_REF', () => {
    expect(validateProvenance({ ...GOOD, consent_ref: '  ' }, false)).toContain('EMPTY_CONSENT_REF')
  })

  it('🔒 request_id 空 → EMPTY_REQUEST_ID', () => {
    expect(validateProvenance({ ...GOOD, request_id: '' }, false)).toContain('EMPTY_REQUEST_ID')
  })

  it('🔒 purpose/recipient_scope/input_data_scope 任一空 → EMPTY_PURPOSE_SCOPE', () => {
    expect(validateProvenance({ ...GOOD, purpose: '' }, false)).toContain('EMPTY_PURPOSE_SCOPE')
    expect(validateProvenance({ ...GOOD, recipient_scope: '' }, false)).toContain('EMPTY_PURPOSE_SCOPE')
    expect(validateProvenance({ ...GOOD, input_data_scope: '' }, false)).toContain('EMPTY_PURPOSE_SCOPE')
  })

  it('🔒 model_id 空 → EMPTY_MODEL_ID', () => {
    expect(validateProvenance({ ...GOOD, model_id: '' }, false)).toContain('EMPTY_MODEL_ID')
  })

  it('🔒 使用对方私聊内容 → COUNTERPARTY_PRIVATE_CHAT_FORBIDDEN', () => {
    expect(validateProvenance(GOOD, true)).toContain('COUNTERPARTY_PRIVATE_CHAT_FORBIDDEN')
  })
})

describe('makePrivateDraft · fail closed', () => {
  it('合规草稿 → origin 恒 AI_PRIVATE_DRAFT，未用对方私聊', () => {
    const r = makePrivateDraft({ text: '好的，我明天告诉你', provenance: GOOD })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.origin).toBe('AI_PRIVATE_DRAFT')
    expect(r.draft.usedCounterpartyPrivateChat).toBe(false)
    expect(r.draft.provenance).toEqual(GOOD)
  })

  it('🔒 溯源不全 → 拒绝构造（拿不到草稿对象）', () => {
    const r = makePrivateDraft({ text: 'x', provenance: { ...GOOD, request_id: '' } })
    expect(r.ok).toBe(false)
  })

  it('🔒 声明用了对方私聊 → 拒绝构造', () => {
    const r = makePrivateDraft({ text: 'x', provenance: GOOD, usedCounterpartyPrivateChat: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues).toContain('COUNTERPARTY_PRIVATE_CHAT_FORBIDDEN')
  })

  it('正控：caveats / 溯源是不可变副本（调用方改原对象不污染草稿）', () => {
    const caveats = ['仅为表达建议']
    const p = { ...GOOD }
    const r = makePrivateDraft({ text: 'x', provenance: p, caveats })
    caveats.push('篡改')
    p.request_id = 'tampered'
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.caveats).toEqual(['仅为表达建议'])
    expect(r.draft.provenance.request_id).toBe('req_123')
  })
})

describe('authorizeDraftSend · 零外发的唯一许可', () => {
  it('无草稿（未构造）时无从授权 —— 发送许可只能来自私有草稿', () => {
    // 类型层面 authorizeDraftSend 要求 PrivateDraft；这里验证运行时对脏输入拒绝。
    expect(authorizeDraftSend({ origin: 'HUMAN_SENT' } as never, 'u1', 1)).toBeNull()
  })

  it('用户确认后 → 许可把来源升级为 HUMAN_SENT', () => {
    const r = makePrivateDraft({ text: 'hi', provenance: GOOD })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const auth = authorizeDraftSend(r.draft, 'u_sender', 1700000000000)
    expect(auth).not.toBeNull()
    expect(auth!.resultingOrigin).toBe('HUMAN_SENT')
    expect(auth!.confirmedByUserId).toBe('u_sender')
  })

  it('🔒 空的确认用户 → 拒绝授权（零外发）', () => {
    const r = makePrivateDraft({ text: 'hi', provenance: GOOD })
    if (!r.ok) return
    expect(authorizeDraftSend(r.draft, '  ', 1)).toBeNull()
  })

  it('🔒 非法时间戳 → 拒绝授权', () => {
    const r = makePrivateDraft({ text: 'hi', provenance: GOOD })
    if (!r.ok) return
    expect(authorizeDraftSend(r.draft, 'u1', Number.NaN)).toBeNull()
  })
})

describe('来源标注与不确定性', () => {
  it('AI 草稿带模型来源标签，不冒充真人', () => {
    const out = labelDraftSource('你好', 'gpt-x')
    expect(out).toContain('AI 草稿')
    expect(out).toContain('gpt-x')
    expect(out).not.toBe('你好')
  })

  it('降级时标签明确标注 degraded', () => {
    expect(labelDraftSource('hi', 'm', true)).toContain('降级')
  })

  it('🔒 危险情绪/意图推断 → 需要不确定性说明', () => {
    expect(needsUncertaintyCaveat('他一定很喜欢你')).toBe(true)
    expect(needsUncertaintyCaveat('她绝对不会拒绝')).toBe(true)
    expect(needsUncertaintyCaveat('我猜测他可能感兴趣')).toBe(false)
  })
})

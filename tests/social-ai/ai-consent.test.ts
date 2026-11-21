/**
 * V25.6 UX06 · 服务端 AI 处理授权判定（纯函数）穷举测试
 *
 * 钉死：客户端字符串不再被采信；授权必须逐项匹配 owner / 会话 / 用途 /
 * 接收范围 / 状态 / 有效期 / 处理位置 / 模型范围。撤销优先于过期。
 */
import {
  evaluateAIProcessingConsent,
  type ConsentView,
  type VerifyInput,
} from '@/lib/social-ai/ai-consent'

const NOW = 1_700_000_000_000
const GRANT: ConsentView = {
  id: 'consent_server_issued_1',
  userId: 'user_A',
  conversationId: 'conv_1',
  purpose: 'translate',
  recipientScope: 'conv_1',
  processingLocation: 'cloud',
  modelScope: null,
  status: 'ACTIVE',
  expiresAt: NOW + 15 * 60 * 1000,
  revokedAt: null,
}
const REQ: VerifyInput = {
  consentRef: GRANT.id,
  userId: 'user_A',
  conversationId: 'conv_1',
  purpose: 'translate',
  recipientScope: 'conv_1',
  wantsCloud: true,
  now: NOW,
}

describe('UX06 服务端 AI 处理授权 · 正例', () => {
  it('① 合法授权（cloud）→ 允许，返回规范化视图', () => {
    const r = evaluateAIProcessingConsent(GRANT, REQ)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.consent.processingLocation).toBe('cloud')
  })

  it('② local 授权 + 不上云 → 允许（本地降级草稿路径）', () => {
    const r = evaluateAIProcessingConsent(
      { ...GRANT, processingLocation: 'local' },
      { ...REQ, wantsCloud: false },
    )
    expect(r.ok).toBe(true)
  })
})

describe('UX06 服务端 AI 处理授权 · 负例（fail closed）', () => {
  const expectReason = (record: ConsentView | null, input: Partial<VerifyInput>, reason: string) => {
    const r = evaluateAIProcessingConsent(record, { ...REQ, ...input })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe(reason)
  }

  it('③ 客户端伪造的 consentRef（查无记录）→ CONSENT_NOT_FOUND', () => {
    expectReason(null, { consentRef: 'I_just_made_this_up' }, 'CONSENT_NOT_FOUND')
  })

  it('④ consentRef 大小写/值不匹配记录 → CONSENT_NOT_FOUND', () => {
    expectReason(GRANT, { consentRef: 'consent_server_issued_2' }, 'CONSENT_NOT_FOUND')
  })

  it('⑤ 拿他人授权（owner 不符）→ CONSENT_OWNER_MISMATCH', () => {
    expectReason(GRANT, { userId: 'user_B' }, 'CONSENT_OWNER_MISMATCH')
  })

  it('⑥ 跨会话搬运授权 → CONSENT_CONVERSATION_MISMATCH', () => {
    expectReason(GRANT, { conversationId: 'conv_other', recipientScope: 'conv_other' }, 'CONSENT_CONVERSATION_MISMATCH')
  })

  it('⑦ 用途不符（translate 授权拿去做 expression）→ CONSENT_PURPOSE_MISMATCH', () => {
    expectReason(GRANT, { purpose: 'expression' }, 'CONSENT_PURPOSE_MISMATCH')
  })

  it('⑧ 接收范围不符 → CONSENT_SCOPE_MISMATCH', () => {
    expectReason(GRANT, { recipientScope: 'someone_else' }, 'CONSENT_SCOPE_MISMATCH')
  })

  it('⑨ 撤销后即时失效 → CONSENT_REVOKED', () => {
    expectReason({ ...GRANT, status: 'REVOKED', revokedAt: NOW - 1 }, {}, 'CONSENT_REVOKED')
  })

  it('⑩ revokedAt 非零即使 status 仍 ACTIVE 也拒绝 → CONSENT_REVOKED', () => {
    expectReason({ ...GRANT, revokedAt: NOW - 1 }, {}, 'CONSENT_REVOKED')
  })

  it('⑪ 过期授权 → CONSENT_EXPIRED', () => {
    expectReason({ ...GRANT, expiresAt: NOW - 1 }, {}, 'CONSENT_EXPIRED')
  })

  it('⑫ local 授权 + wantsCloud=true（云开关误开）→ CONSENT_CLOUD_NOT_AUTHORIZED', () => {
    expectReason({ ...GRANT, processingLocation: 'local' }, { wantsCloud: true }, 'CONSENT_CLOUD_NOT_AUTHORIZED')
  })

  it('⑬ modelScope 限定后换模型 → CONSENT_MODEL_NOT_ALLOWED', () => {
    expectReason(
      { ...GRANT, modelScope: 'deepseek-v4.1-flash' },
      { modelId: 'other-model' },
      'CONSENT_MODEL_NOT_ALLOWED',
    )
  })

  it('⑭ modelScope 限定且模型匹配 → 允许', () => {
    const r = evaluateAIProcessingConsent(
      { ...GRANT, modelScope: 'deepseek-v4.1-flash' },
      { ...REQ, modelId: 'deepseek-v4.1-flash' },
    )
    expect(r.ok).toBe(true)
  })

  it('⑮ 缺少必需上下文（空 userId）→ CONSENT_BAD_INPUT', () => {
    expectReason(GRANT, { userId: '' }, 'CONSENT_BAD_INPUT')
  })

  it('⑯ 非法 purpose（不在白名单）→ CONSENT_BAD_INPUT', () => {
    expectReason(GRANT, { purpose: 'send_auto' as VerifyInput['purpose'] }, 'CONSENT_BAD_INPUT')
  })

  it('⑰ 撤销优先于过期：同时 revoked + expired 时判 REVOKED', () => {
    expectReason(
      { ...GRANT, status: 'REVOKED', revokedAt: NOW - 100, expiresAt: NOW - 200 },
      {},
      'CONSENT_REVOKED',
    )
  })
})

/**
 * V25.3 · T02 —— 统一媒体披露判决 API 负向测试
 *
 * 钉住 V25.3 硬验收 G1 的核心：
 *  · 同一份媒体原文经 view/send/forward/export/process_ai 五条动作披露时，
 *    每一条都重新查当前授权，拒绝时返回**不含秘密的占位符**；
 *  · process_ai 对媒体一律拒绝（AI/Bot 不得拿到原文，无独立授权类型）；
 *  · forward 不跨会话复用授权；
 *  · 作者自己的内容 OWN_CONTENT 放行（发送端自有可见性单独契约）；
 *  · 任何 DB 异常 fail closed；
 *  · 拒绝分支不触碰 grant 之外的写侧（本模块纯读，天然零副作用）。
 */

import {
  authorizeMediaAction,
  safePayloadForDisclosure,
  type MediaDisclosureSubject,
} from '@/lib/im/media-disclosure'
import { sniffContentMediaLevel, resolveRequiredMediaLevel } from '@/lib/im/consent-guard'
import type { MediaGrantClient } from '@/lib/im/consent-guard'

const SECRET = 'data:image/png;base64,SUPERSECRETPAYLOAD'
const PLACEHOLDER = '[媒体内容已被撤回授权，无法查看]'

function clientWith(levels: string[], opts: { throw?: boolean } = {}): {
  client: MediaGrantClient
  findMany: jest.Mock
} {
  const findMany = jest.fn(async () => {
    if (opts.throw) throw new Error('db down')
    return levels.map((grantedLevel) => ({ grantedLevel }))
  })
  return { client: { consentGrant: { findMany } } as unknown as MediaGrantClient, findMany }
}

function subject(over: Partial<MediaDisclosureSubject> = {}): MediaDisclosureSubject {
  return {
    actorId: 'u_receiver',
    senderId: 'u_sender',
    conversationId: 'c1',
    mediaLevel: 'L1_IMAGE',
    payload: SECRET,
    msgType: 'IMAGE',
    ...over,
  }
}

describe('authorizeMediaAction · view（读取/实时披露）', () => {
  it('🔒 撤销/无授权 → allowed=false 且 safePayload 不含原文', async () => {
    const { client } = clientWith([])
    const v = await authorizeMediaAction('view', subject(), client)
    expect(v.allowed).toBe(false)
    expect(v.redact).toBe(true)
    expect(v.reason).toBe('NO_GRANT')
    expect(v.safePayload).toBe(PLACEHOLDER)
    expect(v.safePayload).not.toContain('SECRET')
    expect(v.safePayload).not.toContain('data:')
  })

  it('档位不足（仅 L1，需 L2 VOICE）→ 拒绝且遮盖', async () => {
    const { client } = clientWith(['L1_IMAGE'])
    const v = await authorizeMediaAction('view', subject({ mediaLevel: 'L2_VOICE' }), client)
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('INSUFFICIENT_LEVEL')
    expect(v.safePayload).toBe(PLACEHOLDER)
  })

  it('当前档位足够 → 放行原文（GRANTED）', async () => {
    const { client } = clientWith(['L2_VOICE'])
    const v = await authorizeMediaAction('view', subject({ mediaLevel: 'L1_IMAGE' }), client)
    expect(v.allowed).toBe(true)
    expect(v.reason).toBe('GRANTED')
    expect(v.safePayload).toBe(SECRET)
  })

  it('多 grant 取最高档：L1+L2 并存 ⇒ L2 VOICE 也放行', async () => {
    const { client } = clientWith(['L1_IMAGE', 'L2_VOICE'])
    const v = await authorizeMediaAction('view', subject({ mediaLevel: 'L2_VOICE' }), client)
    expect(v.allowed).toBe(true)
  })

  it('query 的会话号必须是消息所属会话（不跨会话复用）', async () => {
    const { client, findMany } = clientWith(['L1_IMAGE'])
    await authorizeMediaAction('view', subject({ conversationId: 'c-secret' }), client)
    expect(findMany.mock.calls[0][0].where.conversationId).toBe('c-secret')
  })
})

describe('authorizeMediaAction · process_ai（AI/Bot 上下文）', () => {
  it('🔒 已授权的媒体也**禁止**进入 AI 上下文（无 process_ai 授权类型）', async () => {
    const { client, findMany } = clientWith(['L2_VOICE'])
    const v = await authorizeMediaAction('process_ai', subject(), client)
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('DENY_BY_ACTION')
    expect(v.safePayload).toBe(PLACEHOLDER)
    // 媒体一律拒绝，连 DB 都不必查 —— 零外发、零查询
    expect(findMany).not.toHaveBeenCalled()
  })

  it('🔒 即便作者本人，媒体也不进 AI 上下文', async () => {
    const { client } = clientWith([])
    const v = await authorizeMediaAction('process_ai', subject({ actorId: 'u_sender' }), client)
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('DENY_BY_ACTION')
  })

  it('纯文本可进入 AI 上下文（不误伤 Bot 回复能力）', async () => {
    const { client } = clientWith([])
    const v = await authorizeMediaAction(
      'process_ai',
      subject({ mediaLevel: 'L0_TEXT', msgType: 'TEXT', payload: 'hello?' }),
      client,
    )
    expect(v.allowed).toBe(true)
    expect(v.reason).toBe('TEXT')
    expect(v.safePayload).toBe('hello?')
  })
})

describe('authorizeMediaAction · forward / export / own-content', () => {
  it('🔒 forward 缺目标会话 → 拒绝（CROSS_CONVERSATION）', async () => {
    const { client } = clientWith(['L1_IMAGE'])
    const v = await authorizeMediaAction('forward', subject(), client)
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('CROSS_CONVERSATION')
  })

  it('🔒 forward 目标会话无授权 → 拒绝（授权不跨会话）', async () => {
    const { client, findMany } = clientWith(['L1_IMAGE'])
    // grant 只在源会话 c1 有效；forward 到 c2 时 where 必须是 c2 ⇒ 查询返回空
    findMany.mockImplementation(async () => [])
    const v = await authorizeMediaAction('forward', subject({ targetConversationId: 'c2' }), client)
    expect(v.allowed).toBe(false)
    expect(findMany.mock.calls[0][0].where.conversationId).toBe('c2')
  })

  it('作者查看自己的媒体 → OWN_CONTENT 放行（不查 grant）', async () => {
    const { client, findMany } = clientWith([])
    const v = await authorizeMediaAction('view', subject({ actorId: 'u_sender' }), client)
    expect(v.allowed).toBe(true)
    expect(v.reason).toBe('OWN_CONTENT')
    expect(v.safePayload).toBe(SECRET)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('导出（他人发的媒体）撤销后 → 遮盖', async () => {
    const { client } = clientWith([])
    const v = await authorizeMediaAction('export', subject({ actorId: 'u_exporter' }), client)
    expect(v.allowed).toBe(false)
    expect(v.safePayload).toBe(PLACEHOLDER)
  })

  it('send 动作以接收方为 actor 复核 grant', async () => {
    const { client, findMany } = clientWith(['L1_IMAGE'])
    const v = await authorizeMediaAction('send', subject(), client)
    expect(v.allowed).toBe(true)
    expect(findMany.mock.calls[0][0].where).toMatchObject({ granterId: 'u_receiver', granteeId: 'u_sender' })
  })
})

describe('authorizeMediaAction · fail-closed', () => {
  it('🔒 DB 异常 → fail closed 遮盖，绝不泄露原文（NO_GRANT / FAIL_CLOSED 均可）', async () => {
    const { client } = clientWith([], { throw: true })
    const v = await authorizeMediaAction('view', subject(), client)
    expect(v.allowed).toBe(false)
    expect(['FAIL_CLOSED', 'NO_GRANT']).toContain(v.reason)
    expect(v.safePayload).toBe(PLACEHOLDER)
    expect(v.safePayload).not.toContain('SECRET')
  })

  it('safePayloadForDisclosure 封装返回同样安全的内容', async () => {
    const { client } = clientWith([])
    const out = await safePayloadForDisclosure('view', subject(), client)
    expect(out).toBe(PLACEHOLDER)
  })
})

describe('T02 · MIME 伪装加固（data URL 前缀正则之外）', () => {
  it('🔒 data:text/plain;base64,<JPEG魔数> ⇒ 仍判 L1_IMAGE', () => {
    // /9j/ 是 JPEG 的 base64 魔数前缀
    expect(sniffContentMediaLevel('data:text/plain;base64,/9j/4AAQSkZJRg==')).toBe('L1_IMAGE')
  })

  it('🔒 data:application/octet-stream;base64,<PNG魔数> ⇒ L1_IMAGE', () => {
    expect(sniffContentMediaLevel('data:application/octet-stream;base64,iVBORw0KGgoAAAANS')).toBe('L1_IMAGE')
  })

  it('🔒 data:text/plain;base64,<MP3 ID3魔数> ⇒ L2_VOICE', () => {
    expect(sniffContentMediaLevel('data:text/plain;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2Zw==')).toBe('L2_VOICE')
  })

  it('🔒 普通图片 URL 引用 ⇒ L1_IMAGE', () => {
    expect(sniffContentMediaLevel('https://cdn.example.com/x/photo.JPG?token=abc')).toBe('L1_IMAGE')
  })

  it('🔒 普通音频 URL 引用 ⇒ L2_VOICE', () => {
    expect(sniffContentMediaLevel('https://cdn.example.com/voice.m4a')).toBe('L2_VOICE')
  })

  it('纯文本正文不误判', () => {
    expect(sniffContentMediaLevel('看这张图片 https://example.com/article')).toBeNull()
    expect(sniffContentMediaLevel('hello world')).toBeNull()
  })

  it('伪装类型声明 + 内容嗅探取最高档', () => {
    // 客户端声明 TEXT，内容是 JPEG 魔数的 data URL ⇒ 仍要求 L1
    expect(resolveRequiredMediaLevel('TEXT', 'data:foo/bar;base64,/9j/4AAQSk')).toBe('L1_IMAGE')
  })
})

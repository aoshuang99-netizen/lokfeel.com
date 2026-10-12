/**
 * T06 · 统一投递出口 —— AC-09「消息合规」的证据层
 *
 * 三件事必须有可证伪的断言：
 *   ① 站内信**真实落库**（不是假装发了）；
 *   ② 邮件无凭据时进**沙箱捕获**（CAPTURED），**绝不**冒充已送达（SENT）；
 *   ③ 披露守卫在**发送之前**拦截——越界内容一条都不会出街。
 * 外加 AC-07 的投递幂等：同键第二次调用复用首次结果，不产生第二条。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: {
    notificationDelivery: { findUnique: jest.fn(), upsert: jest.fn() },
    notification: { create: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}))

// `@/lib/workflow` 的模块图会经由 `@/lib/connection` → `@/lib/tenancy` 拉到
// `next-auth`（纯 ESM，jest/CJS 无法 require）。它与被测的投递逻辑无关，用桩替换。
jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { db } from '@/lib/db'
import {
  SENDER_ATTRIBUTION_SUFFIX,
  createResendSender,
  deliverNotification,
  resolveEmailSender,
  type EmailSender,
} from '@/lib/workflow'

const delFindUnique = db.notificationDelivery.findUnique as unknown as jest.Mock
const delUpsert = db.notificationDelivery.upsert as unknown as jest.Mock
const notifCreate = db.notification.create as unknown as jest.Mock
const userFindUnique = db.user.findUnique as unknown as jest.Mock

const ORG = 'org_1'
const ME = 'u_me'
const NOW = new Date('2026-10-12T00:00:00.000Z')

function baseInput(over: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    dedupeKey: 'proposal-created:p_1:u_me:in_app:u_me',
    channel: 'IN_APP' as const,
    recipientId: ME,
    template: 'proposal.pending' as const,
    organizationName: '示例社群',
    proposalId: 'p_1',
    missionId: 'm_1',
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  delFindUnique.mockResolvedValue(null)
  delUpsert.mockResolvedValue({ id: 'nd_1' })
  notifCreate.mockResolvedValue({ id: 'n_1' })
  userFindUnique.mockResolvedValue({ email: 'member@example.test' })
})

describe('T06 · deliverNotification · IN_APP', () => {
  it('① 站内信真实落库：写 Notification 表 + 留痕 SENT', async () => {
    const r = await deliverNotification(baseInput(), { now: NOW })
    expect(r.status).toBe('SENT')
    expect(r.provider).toBe('in-app')
    expect(r.replayed).toBe(false)

    expect(notifCreate).toHaveBeenCalledTimes(1)
    const data = notifCreate.mock.calls[0][0].data
    expect(data.userId).toBe(ME)
    expect(data.title).toBeTruthy()
    expect(data.body).toContain(SENDER_ATTRIBUTION_SUFFIX) // 身份声明随正文一起落库

    const upsertData = delUpsert.mock.calls[0][0].create
    expect(upsertData.status).toBe('SENT')
    expect(upsertData.sentAt).toEqual(NOW)
    expect(upsertData.channel).toBe('IN_APP')
  })

  it('留痕里不含收件人邮箱（投递记录是审计面，不是通讯录）', async () => {
    await deliverNotification(baseInput(), { now: NOW })
    const create = delUpsert.mock.calls[0][0].create
    expect(JSON.stringify(create)).not.toContain('member@example.test')
  })
})

describe('T06 · deliverNotification · EMAIL 沙箱', () => {
  it('② 无凭据（sender=null）→ CAPTURED，**不**写站内信、**不**标 SENT', async () => {
    const r = await deliverNotification(
      baseInput({ channel: 'EMAIL', dedupeKey: 'k:email:u_me' }),
      { emailSender: null, now: NOW }
    )
    expect(r.status).toBe('CAPTURED')
    expect(r.provider).toBe('sandbox')
    expect(notifCreate).not.toHaveBeenCalled()

    const create = delUpsert.mock.calls[0][0].create
    expect(create.status).toBe('CAPTURED')
    expect(create.capturedAt).toEqual(NOW)
    expect(create.sentAt).toBeNull()
    expect(create.providerMessageId).toBeNull()
  })

  it('③ 有注入的 sender → 真的调用它，记为 SENT + provider 名', async () => {
    const sender: EmailSender = { provider: 'fake', send: jest.fn().mockResolvedValue('msg_1') }
    const r = await deliverNotification(
      baseInput({ channel: 'EMAIL', dedupeKey: 'k:email:u_me' }),
      { emailSender: sender, now: NOW }
    )
    expect(r.status).toBe('SENT')
    expect(r.provider).toBe('fake')
    expect(sender.send).toHaveBeenCalledTimes(1)
    const sent = (sender.send as jest.Mock).mock.calls[0][0]
    expect(sent.to).toBe('member@example.test')
    expect(sent.body).toContain(SENDER_ATTRIBUTION_SUFFIX)
    expect(delUpsert.mock.calls[0][0].create.providerMessageId).toBe('msg_1')
  })

  it('★ 收件人无邮箱 → JobFailure(permanent)（重试不会凭空长出邮箱）', async () => {
    userFindUnique.mockResolvedValue({ email: null })
    const sender: EmailSender = { provider: 'fake', send: jest.fn() }
    await expect(
      deliverNotification(baseInput({ channel: 'EMAIL', dedupeKey: 'k:email:u_me' }), {
        emailSender: sender,
        now: NOW,
      })
    ).rejects.toMatchObject({ name: 'JobFailure', kind: 'permanent' })
    expect(sender.send).not.toHaveBeenCalled()
  })
})

describe('T06 · deliverNotification · 幂等（AC-07）', () => {
  it('★ 已有 SENT 记录 → replayed:true，不再发第二次', async () => {
    delFindUnique.mockResolvedValue({ id: 'nd_old', status: 'SENT', provider: 'in-app' })
    const r = await deliverNotification(baseInput(), { now: NOW })
    expect(r.replayed).toBe(true)
    expect(r.id).toBe('nd_old')
    expect(notifCreate).not.toHaveBeenCalled()
    expect(delUpsert).not.toHaveBeenCalled()
  })

  it('★ 已有 CAPTURED 记录 → 同样复用（沙箱捕获也算"已经留痕"）', async () => {
    delFindUnique.mockResolvedValue({ id: 'nd_cap', status: 'CAPTURED', provider: 'sandbox' })
    const r = await deliverNotification(baseInput({ channel: 'EMAIL', dedupeKey: 'k:email:u_me' }), {
      emailSender: null,
      now: NOW,
    })
    expect(r.replayed).toBe(true)
    expect(r.status).toBe('CAPTURED')
  })

  it('已有 FAILED 记录 → **不**复用（失败不算已投递，应重投）', async () => {
    delFindUnique.mockResolvedValue({ id: 'nd_f', status: 'FAILED', provider: 'in-app' })
    const r = await deliverNotification(baseInput(), { now: NOW })
    expect(r.replayed).toBe(false)
    expect(notifCreate).toHaveBeenCalled()
  })
})

describe('T06 · deliverNotification · 披露守卫在发送之前', () => {
  it('🔒 受保护原文混入正文 → 抛 NotificationLeakError，且**未**发送、**未**落库', async () => {
    const rationale = '你们互补：他在找东南亚清关，你有雅加达落地资源可以互补。'
    // 场景：受保护原文（rationale）被当作"业务文本"塞进了 missionTitle，
    // 而同一段文本又被登记为受保护对象 → 守卫应在发送前拦下。
    await expect(
      deliverNotification(
        baseInput({ missionTitle: rationale, protectedTexts: [rationale] }),
        { now: NOW }
      )
    ).rejects.toMatchObject({ name: 'NotificationLeakError' })

    expect(notifCreate).not.toHaveBeenCalled()
    expect(delUpsert).not.toHaveBeenCalled()
  })

  it('受保护原文与正文无关 → 正常发送（守卫不误报）', async () => {
    const r = await deliverNotification(
      baseInput({ protectedTexts: ['完全不相干的另一段推荐理由'] }),
      { now: NOW }
    )
    expect(r.status).toBe('SENT')
  })
})

describe('T06 · resolveEmailSender（凭据探测）', () => {
  it('无 key → null（→ 沙箱捕获）', () => {
    expect(resolveEmailSender({})).toBeNull()
    expect(resolveEmailSender({ RESEND_API_KEY: '   ' })).toBeNull()
  })

  it('非 re_ 前缀 → null（把误配的 key 挡在门外，而不是拿它去发）', () => {
    expect(resolveEmailSender({ RESEND_API_KEY: 'sk_live_xxx' })).toBeNull()
  })

  it('re_ 前缀 → 返回 resend 发送器', () => {
    const s = resolveEmailSender({ RESEND_API_KEY: 're_abc123' })
    expect(s?.provider).toBe('resend')
  })

  it('createResendSender 走官方 HTTP API，非 2xx 抛错', async () => {
    const origFetch = global.fetch
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'invalid',
      json: async () => ({}),
    }) as any
    try {
      const s = createResendSender('re_x')
      await expect(s.send({ to: 'a@b.c', subject: 's', body: 'b' })).rejects.toThrow(/Resend rejected/)
      const call = (global.fetch as jest.Mock).mock.calls[0]
      expect(String(call[0])).toContain('api.resend.com')
    } finally {
      global.fetch = origFetch
    }
  })
})

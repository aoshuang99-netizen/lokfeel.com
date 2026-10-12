/**
 * T06 · 统一投递出口（站内信 + 邮件沙箱）
 *
 * **所有**对外的连接通知都必须经过 `deliverNotification()` —— 这是 AC-09
 * 「仅使用官方授权渠道」在代码层的落点。散落各处直接 `fetch` 邮件 API 或
 * 直接写 `Notification` 表，都会绕开：
 *   - 披露边界守卫（`assertNoLeakage`）、
 *   - 投递幂等（`NotificationDelivery` 唯一键）、
 *   - 沙箱判定（无凭据时不冒充已送达）。
 *
 * 沙箱语义（主指令「没有真实凭据的流程只能标记 MOCKED / BLOCKED，不能标记 PASSED」）：
 *   无 `RESEND_API_KEY` 时**不发送**，但把"要发什么"完整落进 `NotificationDelivery`
 *   （`status = CAPTURED` + `capturedAt`）。于是 AC-09 的"内容合规"与"失败可恢复"
 *   可以在**没有外部凭据**的情况下被真实验证 —— 只是"真实外发"这一条标 BLOCKED。
 */

import { db } from '@/lib/db'
import { JobFailure } from './job-core'
import {
  assertNoLeakage,
  hasSenderAttribution,
  renderNotification,
  type NotificationTemplate,
  type RenderedNotification,
} from './notification-content'

export type NotificationChannel = 'IN_APP' | 'EMAIL'

/** 投递结果状态。与 prisma 的 `MessageDeliveryStatus` 同义（此处用字面量 union 保持无依赖）。 */
export type DeliveryStatus = 'SENT' | 'CAPTURED' | 'FAILED'

export interface DeliveryInput {
  organizationId: string
  /** 幂等键（`deliveryDedupeKey()` 产出）。同一键重复投递 → 复用首次结果。 */
  dedupeKey: string
  channel: NotificationChannel
  recipientId: string
  template: NotificationTemplate
  /** 组织名，用于身份声明。 */
  organizationName: string
  missionTitle?: string | null
  actionUrl?: string | null
  /** 关联资源 id（写进站内信的 data，便于前端深链）。 */
  proposalId?: string | null
  missionId?: string | null
  /**
   * 受保护原文（如提案的 rationale），**仅供泄漏检测**，绝不参与渲染。
   * 类型上刻意与 `RenderInput` 分离 —— 让"传进来用于比对"与"传进来用于展示"
   * 长得不一样，避免有人图省事直接把它塞进模板。
   */
  protectedTexts?: readonly (string | null | undefined)[]
}

export interface DeliveryResult {
  id: string
  status: DeliveryStatus
  provider: string
  dedupeKey: string
  /** true = 命中已有记录（本次未产生新投递）。 */
  replayed: boolean
  failureReason?: string
}

// ═══════════════════════════════════════════════════════════════
// 邮件发送器（可注入，便于测试失败路径）
// ═══════════════════════════════════════════════════════════════

export interface EmailSender {
  readonly provider: string
  /** 返回 provider 侧的消息 id；抛错表示发送失败（调用方据此重试）。 */
  send(input: { to: string; subject: string; body: string }): Promise<string>
}

/**
 * Resend 发送器。**只走官方 HTTP API**（主指令：不得绕过平台官方 API/ToS）。
 */
export function createResendSender(apiKey: string, from = 'noreply@lokfeel.com'): EmailSender {
  return {
    provider: 'resend',
    async send({ to, subject, body }) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from: `LokFeel <${from}>`,
          to: [to],
          subject,
          text: body,
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        // 把 provider 的答复带进错误信息，便于排障（不含收件人地址）。
        throw new Error(`Resend rejected the message: ${res.status} ${text.slice(0, 200)}`)
      }
      const json = (await res.json().catch(() => ({}))) as { id?: string }
      return json.id ?? 'unknown'
    },
  }
}

/**
 * 解析可用的邮件发送器。
 *
 * 返回 `null` 表示**没有可用凭据** → 调用方走沙箱捕获，而不是伪造成已发送。
 * 这是 AC-09 证据形态的开关：接上真实 key 的那一刻，"CAPTURED" 自动变成 "SENT"。
 */
export function resolveEmailSender(env: Record<string, string | undefined> = process.env): EmailSender | null {
  const key = env.RESEND_API_KEY?.trim()
  if (!key || !key.startsWith('re_')) return null
  return createResendSender(key, env.SMTP_FROM?.trim() || 'noreply@lokfeel.com')
}

// ═══════════════════════════════════════════════════════════════
// 投递
// ═══════════════════════════════════════════════════════════════

export interface DeliveryDeps {
  /** `undefined` = 自动解析；`null` = 强制沙箱；传入对象 = 用自定义 sender（测试用）。 */
  emailSender?: EmailSender | null
  /** 覆盖"现在"，便于确定性断言。 */
  now?: Date
}

/**
 * 投递一条通知。
 *
 * 顺序（每一步都不能省）：
 *   1. **幂等前置查**：同键已有 SENT/CAPTURED → 直接返回，不发第二次；
 *   2. **渲染**：只用 `RenderInput` 允许的字段；
 *   3. **守卫**：泄漏检测 + 身份声明断言，不通过即在**发送前**失败；
 *   4. **发送**：站内写库 / 邮件走 sender（无 sender → 捕获）；
 *   5. **留痕**：写 `NotificationDelivery`（含 CAPTURED 的内容快照）。
 *
 * @throws 渲染泄漏（`NotificationLeakError`）与缺失身份声明（`Error`）——
 *         两者都应在**发送前**抛出，让任务进入失败/重试，而不是把违规内容发出去。
 */
export async function deliverNotification(
  input: DeliveryInput,
  deps: DeliveryDeps = {}
): Promise<DeliveryResult> {
  const now = deps.now ?? new Date()

  // 1) 幂等：已有成功/捕获记录 → 复用。
  const existing = await db.notificationDelivery.findUnique({
    where: {
      organizationId_dedupeKey: {
        organizationId: input.organizationId,
        dedupeKey: input.dedupeKey,
      },
    },
  })
  if (existing && (existing.status === 'SENT' || existing.status === 'CAPTURED')) {
    return {
      id: existing.id,
      status: existing.status as DeliveryStatus,
      provider: existing.provider ?? 'unknown',
      dedupeKey: input.dedupeKey,
      replayed: true,
    }
  }

  // 2) 渲染 —— 入参类型里根本没有 rationale 的位置。
  const rendered: RenderedNotification = renderNotification({
    template: input.template,
    organizationName: input.organizationName,
    missionTitle: input.missionTitle,
    actionUrl: input.actionUrl,
  })

  // 3) 守卫（纵深防御）：泄漏与身份声明都在发送**之前**判定。
  assertNoLeakage(rendered, input.protectedTexts ?? [], input.template)
  if (!hasSenderAttribution(rendered)) {
    // 走到这里说明模板被改坏了（renderNotification 总是加声明）。
    // 这是一个**开发期契约**，必须响而不是静默发出"像人写的"消息。
    throw new Error('Rendered notification is missing the sender attribution (AC-09)')
  }

  // 4) 发送
  let status: DeliveryStatus
  let provider: string
  let providerMessageId: string | null = null
  let capturedAt: Date | null = null
  let sentAt: Date | null = null
  // 目前所有失败路径都**抛错**（由引擎按失败分类处理），因此这里永远为 null。
  // 保留字段是为了让"投递记录里能表达软失败"这一形状就位（例如未来源码有降级分支）。
  const failureReason: string | null = null

  if (input.channel === 'IN_APP') {
    // 站内信：真实落库（用户可见的收件箱条目）。
    await db.notification.create({
      data: {
        userId: input.recipientId,
        type: 'SYSTEM_ANNOUNCEMENT',
        title: rendered.subject,
        body: rendered.body,
        actionUrl: rendered.actionUrl ?? undefined,
        data: JSON.stringify({
          kind: 'connection-workflow',
          template: input.template,
          proposalId: input.proposalId ?? null,
          missionId: input.missionId ?? null,
        }),
      },
    })
    status = 'SENT'
    provider = 'in-app'
    sentAt = now
  } else {
    // 邮件：解析 sender。无凭据 → 沙箱捕获（不冒充已发送）。
    const sender =
      deps.emailSender !== undefined ? deps.emailSender : resolveEmailSender()

    if (!sender) {
      status = 'CAPTURED'
      provider = 'sandbox'
      capturedAt = now
    } else {
      const recipient = await db.user.findUnique({
        where: { id: input.recipientId },
        select: { email: true },
      })
      if (!recipient?.email) {
        // 没有邮箱不是"暂时性"问题 —— 重试也不会凭空长出邮箱。
        // 显式归为 permanent，否则会被默认策略（retryable）重试到耗尽额度。
        throw new JobFailure('permanent', 'Recipient has no email address')
      }
      // ⚠️ 邮箱地址**不落库**（NotificationDelivery 里没有这个字段）：
      //    投递记录是审计面，不是通讯录。
      providerMessageId = await sender.send({
        to: recipient.email,
        subject: rendered.subject,
        body: rendered.body,
      })
      status = 'SENT'
      provider = sender.provider
      sentAt = now
    }
  }

  // 5) 留痕（upsert：并发下第二次写会撞唯一键，此时读回胜者）。
  try {
    const saved = await db.notificationDelivery.upsert({
      where: {
        organizationId_dedupeKey: {
          organizationId: input.organizationId,
          dedupeKey: input.dedupeKey,
        },
      },
      create: {
        organizationId: input.organizationId,
        dedupeKey: input.dedupeKey,
        channel: input.channel,
        status,
        recipientId: input.recipientId,
        template: input.template,
        subject: rendered.subject,
        body: rendered.body,
        actionUrl: rendered.actionUrl ?? null,
        capturedAt,
        provider,
        providerMessageId,
        failureReason,
        sentAt,
      },
      update: {
        status,
        capturedAt,
        provider,
        providerMessageId,
        failureReason,
        sentAt,
      },
    })
    return {
      id: saved.id,
      status,
      provider,
      dedupeKey: input.dedupeKey,
      replayed: false,
      ...(failureReason ? { failureReason } : {}),
    }
  } catch (err) {
    // 并发下第二条写会撞唯一键：读回胜者，避免把"重复投递"变成 500。
    const winner = await db.notificationDelivery
      .findUnique({
        where: {
          organizationId_dedupeKey: {
            organizationId: input.organizationId,
            dedupeKey: input.dedupeKey,
          },
        },
      })
      .catch(() => null)
    if (winner) {
      return {
        id: winner.id,
        status: winner.status as DeliveryStatus,
        provider: winner.provider ?? 'unknown',
        dedupeKey: input.dedupeKey,
        replayed: true,
      }
    }
    throw err
  }
}

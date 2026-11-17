/**
 * V25.3 · T02（V25-09/10）—— 媒体披露的**统一权限判决 API**
 *
 * 背景（真实 P0 隐私缺口）：V25.2 只在 `/api/im/send`（发送）与
 * `/api/im/messages/*` + `lib/im/list.ts`（读取）两处做了 Consent 门禁。
 * 但同一份媒体原文还会经**其它服务端受控路径**被重新披露：
 *   · Pusher `im:message` 实时广播（send route 与 bot-reply 各一次）；
 *   · Bot / AI 的对话上下文（`handleBotReply(content)` → 模板分类）；
 *   · 备用会话列表读路径 `getConversationsByUserId`（payload 回显）；
 *   · 未来的转发 / 导出。
 * 只要这些路径里任何一条能返回原文，撤销授权后的隐私保护就不成立。
 *
 * 本模块给出单一判决入口 `authorizeMediaAction(action, subject, client?)`，
 * 覆盖 view / send / forward / export / process_ai 五种动作，**每次新披露都
 * 重新查当前授权**（方向、会话、档位、时间、撤销），并直接返回可安全外发的
 * `safePayload`。所有分支 fail closed。
 *
 * 设计约束：
 *   · 不重写 V25.2 的 send/read fix —— 本模块是叠加的“第二道判决”，
 *     复用 `consent-guard` 的 `checkMediaGrant` / `shouldRedact*` 语义；
 *   · 纯逻辑 + 可注入 client，便于负向测试断言“拒绝时零副作用”；
 *   · `process_ai` 对媒体**一律拒绝**：AI/Bot 属于新的第三方处理披露，
 *     在存在独立 process_ai 授权类型之前，媒体原文零外发（G1 硬要求）。
 */

import type { MediaAccessLevel } from '@/lib/im'
import {
  checkMediaGrant,
  resolveRequiredMediaLevel,
  MEDIA_REDACTED_PLACEHOLDER,
  type MediaGrantClient,
} from './consent-guard'

/** 服务端受控披露动作。 */
export type MediaAction = 'view' | 'send' | 'forward' | 'export' | 'process_ai'

export interface MediaDisclosureSubject {
  /** 本次披露的实际接收/消费主体（view=查看者；send/forward=接收方；process_ai=bot/userId；export=导出者本人） */
  actorId: string
  /** 媒体作者（授权方向里的 grantee） */
  senderId: string
  /** 消息所属会话 —— 授权不跨会话复用 */
  conversationId: string
  /** 消息落库时记录的媒体档位；null/L0_TEXT 表示非媒体 */
  mediaLevel: string | null
  /** 消息原文（可能是 data URL / 媒体引用） */
  payload: string
  /** 消息类型，用于 mediaLevel 缺失时兜底嗅探 */
  msgType?: string
  /** forward 的目标会话；缺省或等同来源会话 ⇒ 拒绝（授权不跨会话复用） */
  targetConversationId?: string
}

export type MediaDisclosureReason =
  | 'TEXT'
  | 'OWN_CONTENT'
  | 'GRANTED'
  | 'NO_GRANT'
  | 'INSUFFICIENT_LEVEL'
  | 'CROSS_CONVERSATION'
  | 'DENY_BY_ACTION'
  | 'FAIL_CLOSED'

export interface MediaDisclosureVerdict {
  allowed: boolean
  /** 是否必须用占位符替换原文（拒绝披露媒体时为 true） */
  redact: boolean
  /** 面向该披露动作可安全外发的内容；被拒时恒为不含 secret 的占位符 */
  safePayload: string
  action: MediaAction
  reason: MediaDisclosureReason
}

const RANK: Record<string, number> = {
  L0_TEXT: 0,
  L1_IMAGE: 1,
  L2_VOICE: 2,
  L3_VIDEO: 3,
  L4_LOCATION: 4,
  L5_CONTACT: 5,
}

function deny(action: MediaAction, reason: MediaDisclosureReason): MediaDisclosureVerdict {
  return { allowed: false, redact: true, safePayload: MEDIA_REDACTED_PLACEHOLDER, action, reason }
}

function allow(payload: string, action: MediaAction, reason: MediaDisclosureReason): MediaDisclosureVerdict {
  return { allowed: true, redact: false, safePayload: payload, action, reason }
}

/**
 * 统一媒体披露判决。任何服务端“新的数据披露”都应在外发原文之前调用它，
 * 并且**只使用返回的 safePayload**，绝不直接使用 subject.payload。
 */
export async function authorizeMediaAction(
  action: MediaAction,
  subject: MediaDisclosureSubject,
  client?: MediaGrantClient,
): Promise<MediaDisclosureVerdict> {
  try {
    // 1) 判定本次披露涉及的媒体档位。落库档位优先，缺失时用类型 + 内容嗅探兜底。
    const stored = subject.mediaLevel
    const required: MediaAccessLevel | null =
      stored && stored !== 'L0_TEXT' && stored in RANK
        ? (stored as MediaAccessLevel)
        : resolveRequiredMediaLevel(subject.msgType ?? 'TEXT', subject.payload)

    // 2) 纯文本：没有媒体披露面，任何动作都放行原文。
    if (!required) return allow(subject.payload, action, 'TEXT')

    // 3) process_ai 是“把内容交给第三方处理器”的新披露。媒体一律拒绝，
    //    即使作者本人也不放行（避免把 A 发的图塞进面向 A 的 AI 上下文）。
    //    这是最保守也最容易审计的规则：没有 process_ai 授权 ⇒ 零媒体外发。
    if (action === 'process_ai') return deny(action, 'DENY_BY_ACTION')

    // 4) 作者查看自己的内容：不构成“对他人的新披露”，放行。
    //    forward 例外 —— 转发会创建对另一个主体的新披露，必须走会话 + 授权复核。
    if (subject.senderId === subject.actorId && action !== 'forward') {
      return allow(subject.payload, action, 'OWN_CONTENT')
    }

    // 5) forward：授权绑定到目标会话，既不跨会话复用，也不能缺目标会话。
    //    接收方 = actorId；作者仍是 senderId。目标会话必须显式给出且不同于来源会话。
    let checkConversation = subject.conversationId
    if (action === 'forward') {
      const target = subject.targetConversationId
      if (!target || target === subject.conversationId) return deny(action, 'CROSS_CONVERSATION')
      checkConversation = target
    }

    // 6) view / send / export / forward 统一走当前 Grant 判决（默认拒绝）。
    //    actorId 是接收/消费方，即授权方向里的 granter（数据主人）。
    const verdict = await checkMediaGrant(
      {
        receiverId: subject.actorId,
        senderId: subject.senderId,
        conversationId: checkConversation,
        requiredLevel: required,
      },
      client,
    )

    return verdict.granted
      ? allow(subject.payload, action, 'GRANTED')
      : deny(action, verdict.reason)
  } catch {
    // 任何异常（DB 故障 / 参数异常）都 fail closed。
    return deny(action, 'FAIL_CLOSED')
  }
}

/** 便捷封装：只取安全载荷，供各披露路径直接外发。 */
export async function safePayloadForDisclosure(
  action: MediaAction,
  subject: MediaDisclosureSubject,
  client?: MediaGrantClient,
): Promise<string> {
  return (await authorizeMediaAction(action, subject, client)).safePayload
}

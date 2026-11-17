/**
 * V25.1 · V25-09 / M04 —— 多模态消息的发送执行点授权守卫
 *
 * 背景（真实 P0 隐私缺口）：在 `/api/im/send` 里，`mediaLevel` 由客户端
 * 声明的 `msgType` 自动推导（IMAGE→L1_IMAGE、VOICE→L2_VOICE），
 * `consentState` 硬编码 `CONSENT_NONE`，但**发送执行点从未校验接收方是否
 * 授权了该档位媒体**。也就是说 `ConsentGrant` 表写了等于没写：任何人都能
 * 在任意双人会话里直接声明 msgType=IMAGE 发出图片。
 *
 * 本模块把"接收方 → 发送方"的媒体授权变成发送前置的硬门禁：
 *   · 授权方向：granterId = 接收方（数据主人），granteeId = 发送方；
 *   · 档位比较：grantedLevel >= requiredLevel（L1_IMAGE=1，L2_VOICE=2）；
 *   · 最小权限默认拒绝：查不到有效 grant（不存在 / 已撤销 / 已过期 /
 *     会话不匹配）一律拒绝，且必须在任何 DB / 队列 / 推送写之前。
 *
 * 设计取舍：接受可选 client 参数（依赖注入），让负向测试能直接断言
 * "未授权时 send route 未触碰 $transaction / pusher / bot reply"。
 */

import { prisma } from '@/lib/prisma'
import type { MediaAccessLevel } from '@/lib/im'

/** 档位序号——用于"已授权档位 >= 请求档位"比较；未知值视为 -1（拒绝）。 */
const MEDIA_LEVEL_RANK: Record<string, number> = {
  L0_TEXT: 0,
  L1_IMAGE: 1,
  L2_VOICE: 2,
  L3_VIDEO: 3,
  L4_LOCATION: 4,
  L5_CONTACT: 5,
}

/**
 * 客户端消息类型 → 发送所需的最低媒体授权档位。
 * TEXT 返回 null（基础通信能力，不需要媒体授权）。
 * 未知类型同样返回 null —— 但 send route 已把 msgType 白名单降级为 TEXT，
 * 所以实际不会到这里。此处保持保守：不因为类型异常而误放行媒体。
 */
export function requiredLevelForMessageType(msgType: string): MediaAccessLevel | null {
  switch (msgType) {
    case 'IMAGE':
      return 'L1_IMAGE'
    case 'VOICE':
      return 'L2_VOICE'
    default:
      return null
  }
}

/**
 * V25.2 P0-SEC-02：从 payload 内容嗅探媒体档位，防止"把媒体伪装成 TEXT"绕过门禁。
 * 上传接口返回 `data:image/jpeg;base64,...`（见 /api/upload:184/287），因此内联
 * data URL 是真实媒体格式，不能只信客户端声明的 msgType。
 *   · data:image/*  ⇒ L1_IMAGE
 *   · data:audio/* / data:video/audio 等 ⇒ L2_VOICE（保守归到已定义最高媒体档）
 * 只识别**字符串开头**的 data URL，避免正文里引用 data URI 文字被误判。
 */
export function sniffContentMediaLevel(content: unknown): MediaAccessLevel | null {
  if (typeof content !== 'string') return null
  const head = content.trimStart().slice(0, 40).toLowerCase()
  if (head.startsWith('data:image/')) return 'L1_IMAGE'
  if (head.startsWith('data:audio/') || head.startsWith('data:video/')) return 'L2_VOICE'
  return null
}

/**
 * 发送所需的最终媒体档位 = 声明类型档位 与 内容嗅探档位 的**较高者**。
 * 这是防伪装的核心：即使客户端声明 TEXT，只要 payload 是媒体 data URL，
 * 仍按媒体档位要求授权。两个 null 才表示纯文本、无需授权。
 */
export function resolveRequiredMediaLevel(msgType: string, content: unknown): MediaAccessLevel | null {
  const declared = requiredLevelForMessageType(msgType)
  const sniffed = sniffContentMediaLevel(content)
  if (!declared) return sniffed
  if (!sniffed) return declared
  return (MEDIA_LEVEL_RANK[sniffed] ?? -1) > (MEDIA_LEVEL_RANK[declared] ?? -1) ? sniffed : declared
}

export type MediaGrantVerdict =
  | { granted: true; requiredLevel: MediaAccessLevel; effectiveLevel: MediaAccessLevel; reason: 'GRANTED' }
  | {
      granted: false
      requiredLevel: MediaAccessLevel
      effectiveLevel: MediaAccessLevel | null
      reason: 'NO_GRANT' | 'INSUFFICIENT_LEVEL'
    }

/** 守卫只需要 consentGrant.findMany——缩小测试 mock 面。 */
export interface MediaGrantClient {
  consentGrant: {
    findMany: (args: {
      where: {
        granterId: string
        granteeId: string
        conversationId: string
        consentType: string
        isRevoked: boolean
        OR: Array<{ expiresAt: null } | { expiresAt: { gt: Date } }>
      }
      select: { grantedLevel: true }
    }) => Promise<Array<{ grantedLevel: MediaAccessLevel }>>
  }
}

/**
 * 判断"接收方是否已授权发送方向自己发送 requiredLevel 档位的媒体"。
 * 默认拒绝：任何查询异常 / 无记录 → granted:false（fail closed）。
 */
export async function checkMediaGrant(
  params: {
    receiverId: string
    senderId: string
    conversationId: string
    requiredLevel: MediaAccessLevel
  },
  client: MediaGrantClient = prisma as unknown as MediaGrantClient,
): Promise<MediaGrantVerdict> {
  const { receiverId, senderId, conversationId, requiredLevel } = params

  let grants: Array<{ grantedLevel: MediaAccessLevel }> = []
  try {
    // V25.2：取**所有**有效 grant 的最高档，而不是 findFirst 的任意一条。
    // 否则同一会话里先 L1 后 L2 两条并存时，findFirst 可能命中旧 L1，
    // 导致已获 L2 授权的用户发 VOICE 被误拒（真实 HTTP 闭环实测到该缺陷）。
    grants = await client.consentGrant.findMany({
      where: {
        granterId: receiverId, // 接收方是数据主人
        granteeId: senderId, // 发送方是被授权人
        conversationId, // 授权不跨会话复用
        consentType: 'MEDIA',
        isRevoked: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { grantedLevel: true },
    })
  } catch {
    // 缺表 / DB 异常一律 fail closed，绝不因为"查不到就放行"。
    return { granted: false, requiredLevel, effectiveLevel: null, reason: 'NO_GRANT' }
  }

  if (!grants.length) {
    return { granted: false, requiredLevel, effectiveLevel: null, reason: 'NO_GRANT' }
  }

  // 取最高档；未知档位 rank=-1，不影响其它有效 grant。
  const effective = grants.reduce<MediaAccessLevel>((best, g) => {
    const cur = (g.grantedLevel ?? 'L0_TEXT') as MediaAccessLevel
    return (MEDIA_LEVEL_RANK[cur] ?? -1) > (MEDIA_LEVEL_RANK[best] ?? -1) ? cur : best
  }, 'L0_TEXT')
  const effectiveRank = MEDIA_LEVEL_RANK[effective] ?? -1
  const requiredRank = MEDIA_LEVEL_RANK[requiredLevel] ?? Number.POSITIVE_INFINITY

  if (effectiveRank < requiredRank) {
    return { granted: false, requiredLevel, effectiveLevel: effective, reason: 'INSUFFICIENT_LEVEL' }
  }

  return { granted: true, requiredLevel, effectiveLevel: effective, reason: 'GRANTED' }
}

/**
 * V25.2 P0-SEC-03：读取侧媒体脱敏占位符。
 * 撤销授权后，历史媒体消息仍可枚举（消息元数据、seq、发送者），但媒体原文
 * 不再随读取/预览响应返回。规范化占位符不泄露任何 base64 内容。
 */
export const MEDIA_REDACTED_PLACEHOLDER = '[媒体内容已被撤回授权，无法查看]'

/**
 * 判断一条读取中的消息是否需要在当前查看者视角下脱敏。
 *   · 自己发的：始终可见（发送方对自己产出内容的访问不受"对方撤销"影响）；
 *   · 对方发的媒体（mediaLevel≠L0）：以"查看者=granter、发送者=grantee"复核
 *     当前有效授权；撤销/过期/档位不足 ⇒ 脱敏。
 * 默认拒绝：查询异常 ⇒ 脱敏（fail closed）。
 */
export async function shouldRedactIncomingMedia(
  msg: { senderId: string; mediaLevel: string | null },
  viewerId: string,
  conversationId: string,
  client?: MediaGrantClient,
): Promise<boolean> {
  const level = msg.mediaLevel
  if (!level || level === 'L0_TEXT') return false
  if (msg.senderId === viewerId) return false
  const required = level as MediaAccessLevel
  if (!(required in MEDIA_LEVEL_RANK)) return true // 未知档位保守脱敏
  const verdict = await checkMediaGrant(
    { receiverId: viewerId, senderId: msg.senderId, conversationId, requiredLevel: required },
    client,
  )
  return !verdict.granted
}

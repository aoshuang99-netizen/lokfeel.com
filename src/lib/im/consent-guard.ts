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

export type MediaGrantVerdict =
  | { granted: true; requiredLevel: MediaAccessLevel; effectiveLevel: MediaAccessLevel; reason: 'GRANTED' }
  | {
      granted: false
      requiredLevel: MediaAccessLevel
      effectiveLevel: MediaAccessLevel | null
      reason: 'NO_GRANT' | 'INSUFFICIENT_LEVEL'
    }

/** 守卫只需要 consentGrant.findFirst——缩小测试 mock 面。 */
export interface MediaGrantClient {
  consentGrant: {
    findFirst: (args: {
      where: {
        granterId: string
        granteeId: string
        conversationId: string
        consentType: string
        isRevoked: boolean
        OR: Array<{ expiresAt: null } | { expiresAt: { gt: Date } }>
      }
      select: { grantedLevel: true }
    }) => Promise<{ grantedLevel: MediaAccessLevel } | null>
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

  let grant: { grantedLevel: MediaAccessLevel } | null = null
  try {
    grant = await client.consentGrant.findFirst({
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

  if (!grant) {
    return { granted: false, requiredLevel, effectiveLevel: null, reason: 'NO_GRANT' }
  }

  const effective = (grant.grantedLevel ?? 'L0_TEXT') as MediaAccessLevel
  const effectiveRank = MEDIA_LEVEL_RANK[effective] ?? -1
  const requiredRank = MEDIA_LEVEL_RANK[requiredLevel] ?? Number.POSITIVE_INFINITY

  if (effectiveRank < requiredRank) {
    return { granted: false, requiredLevel, effectiveLevel: effective, reason: 'INSUFFICIENT_LEVEL' }
  }

  return { granted: true, requiredLevel, effectiveLevel: effective, reason: 'GRANTED' }
}

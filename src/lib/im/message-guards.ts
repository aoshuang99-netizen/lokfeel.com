/**
 * ✅ [P1-6 阶段 3 — TARGET/KEEP] 消息发送权限守卫（单一数据源）
 *
 * 为什么需要这个模块（这是一个真实缺陷的修复，不只是重构）：
 *
 *   改造前，这些业务规则**只写在 `/api/chat/[id]/messages` 的 Legacy ChatRoom 分支里**：
 *     · 免费男性用户每个会话最多 2 条消息（超出需升级 Premium）
 *     · 非 Premium 用户累计 3 条消息后必须完成卡片验证
 *   而 IM Conversation 分支**完全没有这两道校验**。
 *
 *   阶段 3 把分发顺序反转为"Conversation 优先"后，任何以 Conversation.id 进入的请求
 *   都会走 IM 分支 —— 若不抽取，等于**免费用户限制被静默取消**，且可能产生
 *   绕过付费的漏洞。这是必须在同一批改动中修掉的（D4 业务规则双份/缺失）。
 *
 * 计数口径（迁移安全）：
 *
 *   迁移窗口期内本模块曾按 **max(Legacy, IM)** 计数（B4 门禁保证 1:1 血缘，
 *   max 在三个阶段都不低估）。阶段 5 删表后 Legacy 分支已按阶段 5 标注移除，
 *   标注移除，口径退化为纯 IM 计数 —— 不会让任何计数变小，付费墙不被绕过。
 *
 * @module lib/im/message-guards
 */

import { db } from '@/lib/db';
import { isFemaleGender } from '@/lib/gender-utils';

/** 免费男性用户每个会话可发送的消息条数上限 */
export const FREE_MALE_MESSAGE_LIMIT = 2;

/** 触发卡片验证的累计消息条数阈值 */
export const CARD_VERIFICATION_MESSAGE_THRESHOLD = 3;

/** 视为"无限消息"的付费套餐 */
const UNLIMITED_PLANS = ['PREMIUM_MONTHLY', 'PREMIUM_YEARLY', 'LIFETIME'];

/** 发送权限判定结果。ok=false 时调用方直接返回 status + body。 */
export type SendGuardVerdict =
  | { ok: true }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * 统计某用户在指定范围内的消息数。
 *
 * @param userId     发送者
 * @param scope      会话范围。两者都传时按会话计数；都不传时返回 0。
 *                   `chatRoomId`（旧 ChatRoom 侧）在阶段 5 删表后不再参与计数，
 *                   仅保留在签名中以兼容既有调用方。
 */
export async function countScopedMessages(
  userId: string,
  scope: { chatRoomId?: string | null; conversationId?: string | null },
): Promise<number> {
  if (!scope.conversationId) return 0;
  return db.iMMessage.count({
    where: { conversationId: scope.conversationId, senderId: userId },
  });
}

/**
 * 统计某用户的全局消息数。
 */
export async function countTotalMessages(userId: string): Promise<number> {
  return db.iMMessage.count({ where: { senderId: userId } });
}

/**
 * 判定用户是否有权在当前会话发送消息。
 *
 * 语义与改造前 Legacy 分支**逐条等价**（含边界条件）：
 *   1. 无生效订阅 且 非女性 → 本会话已发 >= 2 条 → UPGRADE_REQUIRED (403)
 *      （女性用户、以及任何有生效订阅的用户豁免此条）
 *   2. 非 UNLIMITED_PLANS 套餐 → 全站累计 >= 3 条 且 未完成卡片验证 → CARD_VERIFICATION_REQUIRED (403)
 *
 * 注意：本函数**不做**头像门禁（AVATAR_REQUIRED）。头像门禁作用于所有分支，
 *      已在路由入口统一处理，避免重复查询。
 */
export async function checkSendPermission(args: {
  userId: string;
  chatRoomId?: string | null;
  conversationId?: string | null;
}): Promise<SendGuardVerdict> {
  const { userId, chatRoomId, conversationId } = args;

  const [user, profile, activeSub] = await Promise.all([
    db.user.findFirst({ where: { id: userId }, select: { cardVerified: true } }),
    db.profile.findUnique({ where: { userId }, select: { gender: true } }),
    db.subscription.findFirst({
      where: { userId, status: 'ACTIVE' },
      select: { plan: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const hasActiveSub = !!activeSub;
  const plan = activeSub?.plan ?? null;
  const isFemale = isFemaleGender(profile?.gender);
  const cardVerified = user?.cardVerified ?? false;

  // ── 规则 1：免费男性限 2 条 / 会话 ──
  if (!hasActiveSub && !isFemale) {
    const scoped = await countScopedMessages(userId, { chatRoomId, conversationId });
    if (scoped >= FREE_MALE_MESSAGE_LIMIT) {
      return {
        ok: false,
        status: 403,
        body: {
          message:
            'Free users can send up to 2 messages per conversation. Upgrade to Premium for unlimited messaging.',
          code: 'UPGRADE_REQUIRED',
          upgradeUrl: '/dashboard/subscription',
        },
      };
    }
  }

  // ── 规则 2：累计 3 条后要求卡片验证（Premium 豁免）──
  const isUnlimitedPlan = hasActiveSub && plan !== null && UNLIMITED_PLANS.includes(plan);
  if (!isUnlimitedPlan) {
    const total = await countTotalMessages(userId);
    if (!cardVerified && total >= CARD_VERIFICATION_MESSAGE_THRESHOLD) {
      return {
        ok: false,
        status: 403,
        body: {
          message:
            'Please verify your card to continue messaging. Identity verification only — no charges.',
          code: 'CARD_VERIFICATION_REQUIRED',
        },
      };
    }
  }

  return { ok: true };
}

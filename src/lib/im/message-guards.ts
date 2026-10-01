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
import { PLANS, PLAN_IDS, type PlanId } from '@/config/plans';

/** 免费男性用户每个会话可发送的消息条数上限 */
export const FREE_MALE_MESSAGE_LIMIT = 2;

/** 触发卡片验证的累计消息条数阈值 */
export const CARD_VERIFICATION_MESSAGE_THRESHOLD = 3;

/**
 * 视为"无限消息"的档位 —— **由定价单一配置源派生，不再手写名单**。
 *
 * 背景（2026-10-01 QA 实证的 P1 缺陷）：
 *   改造前这里是手写字面量 `['PREMIUM_MONTHLY','PREMIUM_YEARLY','LIFETIME']`，
 *   漏掉了 `LADY_FREE`。后果是：女性用户（`messagesPerMatch: -1`、
 *   文案「always free for women」、`/api/user/limits` 也自报 `-1`）在累计
 *   3 条消息后仍会撞上「验卡墙」—— 同一系统里三个子系统结论互相矛盾。
 *
 * 现在改为从 `@/config/plans` 派生：凡是声明「每会话不限条数」的档位
 * 天然豁免验卡墙。这样 LADY_FREE 会自动保持一致，
 * 未来新增/调整档位只需改定价配置一处，不会再次漏名单。
 */
const UNLIMITED_PLANS: readonly PlanId[] = PLAN_IDS.filter(
  (id) => PLANS[id].features.messagesPerMatch === -1,
);

/** 发送权限判定结果。ok=false 时调用方直接返回 status + body。 */
export type SendGuardVerdict =
  | { ok: true }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * 统计某用户在指定范围内的**用户产出消息**数。
 *
 * ⚠️ 必须排除 `msgType = SYSTEM`（2026-10-01 QA 实证的 P1 缺陷）：
 *   匹配成功时 `matches/react` 会插入一条 SYSTEM 消息，并把 `senderId`
 *   记为**匹配发起人**。若把 SYSTEM 计入配额，发起方的免费男用户一开局
 *   就被记 1 条，**实际只能发 1 条真消息**（文案承诺 2 条），
 *   且发起方比被发起方少一条额度 —— 不公平且极难排查。
 *
 *   生产库实测分布：`TEXT 209 / SYSTEM 2`，无 TYPING / READ_RECEIPT 落库，
 *   因此这里只需排除 SYSTEM 即可精确还原"用户真实发言数"。
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
    where: {
      conversationId: scope.conversationId,
      senderId: userId,
      msgType: { not: 'SYSTEM' },
    },
  });
}

/**
 * 统计某用户的全局**用户产出消息**数（同样排除 SYSTEM，口径与
 * `countScopedMessages` 保持一致，否则两处会算出不同的"已用条数"）。
 */
export async function countTotalMessages(userId: string): Promise<number> {
  return db.iMMessage.count({
    where: { senderId: userId, msgType: { not: 'SYSTEM' } },
  });
}

/**
 * 判定用户是否有权在当前会话发送消息。
 *
 * 语义与改造前 Legacy 分支**逐条等价**（含边界条件），并叠加两处已修复的缺陷：
 *
 *   1. 无生效订阅 且 非女性 → 本会话**用户产出消息**已发 >= 2 条 → UPGRADE_REQUIRED (403)
 *      （女性用户、以及任何有生效订阅的用户豁免此条）
 *   2. **非无限档且非女性** → 全站累计**用户产出消息** >= 3 条 且 未完成卡片验证
 *      → CARD_VERIFICATION_REQUIRED (403)
 *
 * 两处口径修正（2026-10-01 QA 实证）：
 *   · 计数一律排除 `msgType = SYSTEM` —— 否则匹配发起人会被系统消息占掉 1 条额度；
 *   · 规则 2 的豁免名单由 `@/config/plans` 派生并叠加性别兜底 ——
 *     否则 LADY_FREE 女性会撞验卡墙，与 `/api/user/limits` 自报的"无限"矛盾。
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

  // ── 规则 2：累计 3 条后要求卡片验证 ──
  //
  // 豁免口径必须与 `/api/user/limits`、`/api/matches/request`、`/api/payments/status`
  // 同源 —— 这三处都是 `isPremium ? PREMIUM : isFemale ? LADY_FREE : FREE`
  // （即性别兜底）。因此这里接受两条通道：
  //   ① 女性用户：既是 LADY_FREE 档，也涵盖历史遗留、**没有订阅记录**的女号
  //      （生产库实测 3625 名女性中仅 2174 名有 LADY_FREE 记录，40% 没有）；
  //   ② 任何"每会话不限条数"的档位（由 `@/config/plans` 派生，含 LADY_FREE）。
  const isUnlimitedPlan =
    isFemale ||
    (hasActiveSub && plan !== null && (UNLIMITED_PLANS as readonly string[]).includes(plan));
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

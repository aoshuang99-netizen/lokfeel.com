/**
 * ✅ [P1-6 阶段 5 — TARGET/KEEP] Bot 回复准入判定（单一数据源）
 *
 * 为什么需要独立模块（G-3 / G-6 的修复）：
 *
 *   改造前，**Legacy 分发器分支完全不做出准入判定** —— 只要对方 `User.isBot = true`
 *   就直接回一条。而 IM 侧（`lib/im/bot-reply.ts`）会额外检查：
 *     · `BotProfile.sleepUntil` 未到期 → 不应回复
 *     · `BotProfile.isActive === false` → 不应回复
 *
 *   两份实现意味着**被停用/休眠中的 Bot，在 Legacy 路径上仍在回复用户**。
 *   阶段 4 前端换源后 Legacy 路径只剩旧书签流量，但这条分歧仍然是真实的
 *   （旧书签用户会看到本该沉默的 Bot 在讲话）。此模块把判定收敛成一份，
 *   两侧共用，同时把 `botType` 透出给调用方做差异化回复（预留）。
 *
 * 本模块只读数据库，不写任何东西。写入分别在：
 *   · IM 侧    → `lib/im/bot-reply.ts:sendBotReply`
 *   · Legacy 侧 → 分发器内联（写入 `Message` 后镜像到 `IMMessage`）
 *
 * @module lib/im/bot-gate
 */

import { db } from '@/lib/db';

/** 准入判定结果 */
export interface BotReplyEligibility {
  /** 是否应当让该 Bot 自动回复 */
  shouldReply: boolean;
  /** Bot 类型（`User.botType`），非 Bot 时为 null */
  botType: string | null;
  /** 不回复的原因，便于日志与排障 */
  reason?: 'not_bot' | 'sleeping' | 'inactive' | 'eligible';
}

/**
 * 判断 `userId` 是否为"当前应当自动回复"的 Bot。
 *
 * 语义（与改造前 IM 侧 `shouldBotReply` 逐条等价，含边界）：
 *   1. `User.isBot` 非真 → 不回复（`reason: 'not_bot'`）
 *   2. 存在 `BotProfile` 且 `sleepUntil > now` → 不回复（`reason: 'sleeping'`）
 *   3. 存在 `BotProfile` 且 `isActive === false` → 不回复（`reason: 'inactive'`）
 *   4. 其余 → 回复（`reason: 'eligible'`）
 *
 * `BotProfile` 是**可选**的：DEMO / 导入的 Bot 大多没有 BOTPROFILE 行，
 * 此时视为"无约束"，继续回复（与改造前一致，不改变线上行为）。
 */
export async function checkBotReplyEligibility(
  userId: string,
): Promise<BotReplyEligibility> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isBot: true, botType: true },
  });

  if (!user?.isBot) {
    return { shouldReply: false, botType: null, reason: 'not_bot' };
  }

  // BotProfile 缺失是正常情况（DEMO / 导入 Bot），不应阻断回复
  try {
    // P0-5 schema 拆分后 BotProfile 不再持有对 Profile 的 Prisma 关系
    // （profileId 为普通列），改两步查询：userId → Profile.id → BotProfile。
    const profile = await db.profile.findUnique({
      where: { userId },
      select: { id: true },
    });
    const botProfile = profile
      ? await db.botProfile.findFirst({
          where: { profileId: profile.id },
          select: { sleepUntil: true, isActive: true },
        })
      : null;

    if (botProfile?.sleepUntil && botProfile.sleepUntil > new Date()) {
      return { shouldReply: false, botType: user.botType, reason: 'sleeping' };
    }

    if (botProfile?.isActive === false) {
      return { shouldReply: false, botType: user.botType, reason: 'inactive' };
    }
  } catch {
    // BotProfile 表在该租户不存在 → 视为无约束，继续回复
  }

  return { shouldReply: true, botType: user.botType, reason: 'eligible' };
}

/**
 * 兼容别名 —— 保留改造前的函数名与返回形状，避免调用方大面积改动。
 * 新代码请直接用 `checkBotReplyEligibility`（多一个 `reason` 字段）。
 */
export async function shouldBotReply(userId: string): Promise<{
  shouldReply: boolean;
  botType: string | null;
}> {
  const { shouldReply, botType } = await checkBotReplyEligibility(userId);
  return { shouldReply, botType };
}

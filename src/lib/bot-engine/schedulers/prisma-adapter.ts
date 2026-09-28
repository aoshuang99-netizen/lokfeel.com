/**
 * LokFee! Bot Behavior Engine — Prisma Database Adapter
 *
 * Concrete implementation of BotEngineDbAdapter using Prisma ORM.
 * Bridges the behavior engine with the existing Nexus database schema.
 */

import type { BotEngineDbAdapter } from '../schedulers/engine';
import type { PersonalityType } from '../types';
import { createMessage } from '@/lib/im/queries';

export interface PrismaDbAdapterConfig {
  /** Custom Prisma client instance (for testing or DI) */
  prisma?: any;
  /** Default timezone for bots without one set */
  defaultTimezone?: string;
}

/**
 * Create a BotEngineDbAdapter backed by Prisma.
 *
 * Usage:
 * ```ts
 * import { PrismaClient } from '@/generated';
 * import { createPrismaAdapter } from '@/lib/bot-engine/schedulers/prisma-adapter';
 *
 * const prisma = new PrismaClient();
 * const adapter = createPrismaAdapter(prisma);
 * ```
 */
export function createPrismaAdapter(
  prisma: any,
  config: PrismaDbAdapterConfig = {},
): BotEngineDbAdapter {
  const defaultTimezone = config.defaultTimezone ?? 'America/New_York';

  return {
    // ─── Bot User Loading ──────────────────────────────────

    async loadBotUsers() {
      const bots = await prisma.user.findMany({
        where: { isBot: { not: false }, role: 'USER' },
        include: {
          profile: {
            select: {
              gender: true,
              city: true,
              country: true,
            },
          },
        },
      });

      return bots.map((bot: any) => {
        const genderMap: Record<string, 'male' | 'female' | 'non_binary'> = {
          MALE: 'male',
          FEMALE: 'female',
          NON_BINARY: 'non_binary',
          OTHER: 'non_binary',
        };

        // Extract personality from botConfig JSON or default
        let personalityType: PersonalityType = 'passive';
        let timezone = defaultTimezone;

        if (bot.botConfig) {
          try {
            const parsed = JSON.parse(bot.botConfig);
            personalityType = parsed.personalityType || 'passive';
          } catch { /* ignore parse errors */ }
        }

        // Try to infer timezone from profile location
        if (bot.profile?.country === 'US' && bot.profile?.city) {
          const tz = cityToTimezone(bot.profile.city);
          if (tz) timezone = tz;
        }

        return {
          userId: bot.id,
          personalityType,
          gender: genderMap[bot.profile?.gender] || 'non_binary',
          timezone,
          botConfig: bot.botConfig,
          createdAt: bot.createdAt,
        };
      });
    },

    // ─── Online Status ─────────────────────────────────────

    async updateOnlineStatus(botUserId: string, isOnline: boolean) {
      // Use AnalyticsEvent to track online status changes
      await prisma.analyticsEvent.create({
        data: {
          userId: botUserId,
          event: isOnline ? 'bot.online' : 'bot.offline',
          properties: JSON.stringify({ isOnline }),
        },
      });
    },

    // ─── Profile Browsing ──────────────────────────────────

    async getBrowsableProfiles(botUserId: string) {
      // Get approved profiles that aren't the bot and haven't been matched
      const profiles = await prisma.profile.findMany({
        where: {
          userId: { not: botUserId },
          profileStatus: 'APPROVED',
          user: { isBot: { not: { not: false } }, }, // Prioritize real users (isBot=false or null)
        },
        select: { userId: true },
        take: 50,
      });

      return profiles.map((p: any) => p.userId);
    },

    async getPreviouslyViewedProfiles(botUserId: string) {
      const events = await prisma.analyticsEvent.findMany({
        where: {
          userId: botUserId,
          event: 'bot.profile_view',
        },
        select: { properties: true },
        take: 200,
      });

      return events
        .map((e: any) => {
          try {
            const props = JSON.parse(e.properties);
            return props.profileId;
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    },

    async recordProfileViews(botUserId: string, profileIds: string[]) {
      // Record each profile view as an analytics event
      await prisma.analyticsEvent.createMany({
        data: profileIds.map(profileId => ({
          userId: botUserId,
          event: 'bot.profile_view',
          properties: JSON.stringify({ profileId }),
        })),
        skipDuplicates: true,
      });
    },

    // ─── Match Reactions ───────────────────────────────────

    async getPendingMatches(botUserId: string) {
      // Get matches where this bot hasn't reacted yet
      const matches = await prisma.match.findMany({
        where: {
          OR: [
            { senderId: botUserId, senderAction: null },
            { receiverId: botUserId, receiverAction: null },
          ],
          status: 'PENDING',
        },
        select: {
          id: true,
          matchScore: true,
          createdAt: true,
        },
      });

      return matches.map((m: any) => ({
        matchId: m.id,
        matchScore: m.matchScore,
        createdAt: m.createdAt,
      }));
    },

    async submitMatchReaction(botUserId: string, matchId: string, decision: string, reason?: string) {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
      });

      if (!match) throw new Error(`Match ${matchId} not found`);

      // Map decision to MatchAction enum
      const actionMap: Record<string, string> = {
        accept: 'INTERESTED',
        reject: 'PASS',
        maybe: 'MAYBE',
        super_like: 'INTERESTED',
      };

      const action = actionMap[decision] || 'PASS';
      const isSender = match.senderId === botUserId;

      // Check if there's already a reaction from a real user
      const otherAction = isSender ? match.receiverAction : match.senderAction;

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (isSender) {
        updateData.senderAction = action;
      } else {
        updateData.receiverAction = action;
      }

      // If super_like, mark as boosted
      if (decision === 'super_like') {
        updateData.matchType = 'BOOSTED';
      }

      // If both have reacted, update match status
      if (otherAction) {
        const otherAccepts = otherAction === 'INTERESTED' || otherAction === 'MAYBE';
        const thisAccepts = action === 'INTERESTED' || action === 'MAYBE';

        if (otherAccepts && thisAccepts) {
          updateData.status = 'ACCEPTED';
        } else if (!thisAccepts) {
          updateData.status = 'REJECTED';
        }
      }

      await prisma.match.update({
        where: { id: matchId },
        data: updateData,
      });

      // Create match reaction record
      await prisma.matchReaction.create({
        data: {
          matchId,
          userId: botUserId,
          reaction: action as any,
          feedback: reason,
        },
      });
    },

    async expireMatch(matchId: string) {
      await prisma.match.update({
        where: { id: matchId },
        data: {
          status: 'EXPIRED',
          updatedAt: new Date(),
        },
      });
    },

    // ─── Chat ──────────────────────────────────────────────

    async getPendingChatResponses(botUserId: string) {
      // P1-6 阶段 5：原经 `ChatRoomMember` → `ChatRoom.messages` 两步取数据（B9 阻断点）。
      // 现直接查终局模型：
      //   · 「需要回应」= 该用户所在会话里 **自己有未读**（`unreadCountA/B`，与徽章同源）
      //   · 「对方是谁」= 会话的另一个 `userId`（本产品会话恒为 1:1，无需成员表）
      //   · 「归档」= `ConversationParticipant.isArchived`（每用户维度，比 Legacy 的房间级更准）
      const conversations = await prisma.conversation.findMany({
        where: {
          state: { in: ['ACTIVE', 'PAUSED'] },
          participants: {
            some: { userId: botUserId, isArchived: false },
          },
          OR: [
            { userAId: botUserId, unreadCountA: { gt: 0 } },
            { userBId: botUserId, unreadCountB: { gt: 0 } },
          ],
        },
        include: {
          participants: {
            where: { userId: { not: botUserId } },
            include: {
              user: {
                select: { id: true, name: true, profile: { select: { displayName: true } } },
              },
            },
          },
          imMessages: {
            orderBy: { seq: 'desc' },
            take: 20,
          },
        },
      });

      // matchScore 只存在于 `Match` 表，而 `Conversation` 与 `Match` 无 relation，
      // 因此单独批量回查一次（与 lib/im/list.ts §2.5 同一策略，避免 N+1）。
      // 本适配器的 `prisma` 是 DI 注入（类型为 any），查询结果不带类型 ——
      // 回调参数必须显式标注（noImplicitAny），形状以下方消费为准。
      const matchIds = (conversations as Array<{ matchId: string | null }>)
        .map((c) => c.matchId)
        .filter((id): id is string => !!id);
      const matches: Array<{
        id: string;
        matchScore: number;
        senderId: string;
        receiverId: string;
      }> =
        matchIds.length > 0
          ? await prisma.match.findMany({
              where: { id: { in: matchIds } },
              select: { id: true, matchScore: true, senderId: true, receiverId: true },
            })
          : [];
      const matchById = new Map(matches.map((m) => [m.id, m]));

      return (conversations as Array<{
        id: string;
        matchId: string | null;
        participants?: Array<{
          userId: string;
          user?: { id: string; name: string | null; profile?: { displayName: string | null } | null };
        }>;
        imMessages?: Array<{ senderId: string; payload: string; createdAt: Date | string }>;
      }>)
        .map((conv) => {
          const partner = conv.participants?.[0];
          const partnerName =
            partner?.user?.profile?.displayName || partner?.user?.name || 'Someone';
          const lastMessage = conv.imMessages?.[0];
          const minutesSinceLastMessage = lastMessage
            ? (Date.now() - new Date(lastMessage.createdAt).getTime()) / 60_000
            : Infinity;

          const match: { matchScore: number; receiverId: string } | undefined =
            conv.matchId ? matchById.get(conv.matchId) : undefined;
          const isReceiver = match ? match.receiverId === botUserId : false;

          return {
            botUserId,
            conversationId: conv.id,
            partnerId: partner?.userId || '',
            partnerName,
            matchScore: match?.matchScore || 50,
            conversationHistory: (conv.imMessages || [])
              .reverse() // Oldest first
              .map((msg) => ({
                senderId: msg.senderId,
                content: msg.payload,
                sentAt: new Date(msg.createdAt),
              })),
            isInitiating: !lastMessage || lastMessage.senderId === botUserId,
            followUpCount: 0, // Could be calculated from message gaps
            isReceiver,
            minutesSinceLastMessage,
          };
        });
    },

    async sendChatMessage(botUserId: string, conversationId: string, content: string) {
      // P1-6 阶段 5：原为裸写 Legacy `Message` + 推进 `ChatRoom.lastMessageAt`（B9 阻断点）。
      // 现走 IM 的**唯一写入路径** —— `createMessage` 一次完成
      // 「消息 + seq 分配 + 会话元数据 + 未读计数」，无需再手工维护 `lastMessageAt`
      // （那正是旧实现容易漏掉的一半：只写消息不推进时间戳）。
      //
      // ⚠️ DI 说明：`createMessage` 内部使用模块级 `db`，而不走本适配器的注入 client。
      //    生产环境二者是同一个实例（`/api/cron/bot-tick` 传的就是 `db`），
      //    因此行为一致；只有在测试里注入 mock client 时，本方法的写入会绕过 mock。
      //    这样取舍是为了**不出现第二套 seq/未读计数的实现**（那会造成两套口径漂移）。
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { userAId: true, userBId: true },
      });
      if (!conv) {
        throw new Error(`[bot-engine/adapter] conversation not found: ${conversationId}`);
      }

      const receiverId = conv.userAId === botUserId ? conv.userBId : conv.userAId;
      await createMessage(conversationId, botUserId, receiverId, content);
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Rough US city → timezone mapping.
 * In production, use a library like city-timezone.
 */
function cityToTimezone(city: string): string | null {
  const map: Record<string, string> = {
    'New York': 'America/New_York',
    'Los Angeles': 'America/Los_Angeles',
    'Chicago': 'America/Chicago',
    'Houston': 'America/Chicago',
    'Phoenix': 'America/Phoenix',
    'San Francisco': 'America/Los_Angeles',
    'Seattle': 'America/Los_Angeles',
    'Denver': 'America/Denver',
    'Boston': 'America/New_York',
    'Miami': 'America/New_York',
    'Atlanta': 'America/New_York',
    'Dallas': 'America/Chicago',
    'Philadelphia': 'America/New_York',
    'Portland': 'America/Los_Angeles',
    'Austin': 'America/Chicago',
    'Nashville': 'America/Chicago',
    'San Diego': 'America/Los_Angeles',
    'Washington': 'America/New_York',
    'DC': 'America/New_York',
  };

  for (const [key, tz] of Object.entries(map)) {
    if (city.toLowerCase().includes(key.toLowerCase())) {
      return tz;
    }
  }

  return null;
}

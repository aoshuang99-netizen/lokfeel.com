/**
 * LokFee! Bot Behavior Engine — Prisma Database Adapter
 *
 * Concrete implementation of BotEngineDbAdapter using Prisma ORM.
 * Bridges the behavior engine with the existing Nexus database schema.
 */

import type { BotEngineDbAdapter } from '../schedulers/engine';
import type { PersonalityType } from '../types';

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
        where: { isBot: true, role: 'USER' },
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
          user: { isBot: false }, // Prioritize real users for browsing
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
      // Get chat rooms where bot is a member and there are unread messages
      const memberships = await prisma.chatRoomMember.findMany({
        where: {
          userId: botUserId,
          isMuted: false,
          room: {
            isArchived: false,
          },
        },
        include: {
          room: {
            include: {
              match: {
                select: { matchScore: true, senderId: true, receiverId: true },
              },
              members: {
                where: { userId: { not: botUserId } },
                include: {
                  user: {
                    select: { name: true, profile: { select: { displayName: true } } },
                  },
                },
              },
              messages: {
                orderBy: { createdAt: 'desc' },
                take: 20,
              },
            },
          },
        },
      });

      return memberships
        .filter((m: any) => {
          const room = m.room;
          // Skip rooms with no messages
          if (!room.messages || room.messages.length === 0) return true; // New room, might need initiation
          return true;
        })
        .map((m: any) => {
          const room = m.room;
          const partner = room.members?.[0];
          const partnerName = partner?.user?.profile?.displayName || partner?.user?.name || 'Someone';
          const lastMessage = room.messages?.[0];
          const minutesSinceLastMessage = lastMessage
            ? (Date.now() - new Date(lastMessage.createdAt).getTime()) / 60_000
            : Infinity;

          const isReceiver = room.match
            ? room.match.receiverId === botUserId
            : false;

          return {
            botUserId,
            chatRoomId: room.id,
            partnerId: partner?.userId || '',
            partnerName,
            matchScore: room.match?.matchScore || 50,
            conversationHistory: (room.messages || [])
              .reverse() // Oldest first
              .map((msg: any) => ({
                senderId: msg.senderId,
                content: msg.content,
                sentAt: new Date(msg.createdAt),
              })),
            isInitiating: !lastMessage || lastMessage.senderId === botUserId,
            followUpCount: 0, // Could be calculated from message gaps
            isReceiver,
            minutesSinceLastMessage,
          };
        });
    },

    async sendChatMessage(botUserId: string, chatRoomId: string, content: string) {
      await prisma.message.create({
        data: {
          roomId: chatRoomId,
          senderId: botUserId,
          content,
          messageType: 'TEXT',
        },
      });

      // Update room's last message timestamp
      await prisma.chatRoom.update({
        where: { id: chatRoomId },
        data: { lastMessageAt: new Date(), updatedAt: new Date() },
      });
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

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { handleApiError } from '@/lib/api-handler'

// NOTE: This endpoint is the canonical chat list API.
// /api/chats (ChatRoom-only) and /api/im/conversations (IM-only) are legacy.
// Prefer this endpoint for new frontend code.

export const dynamic = 'force-dynamic'

// GET /api/chat — Get chat list (combines ChatRoom + IM Conversation)
export async function GET() {
  return handleApiError(async () => {
    const { user } = await requireAuth()

    // ═══ 1. ChatRoom system (legacy) ═══
    // C-01 fix: Reduce nested include depth — load members+lastMessage separately
    const memberships = await db.chatRoomMember.findMany({
      where: { userId: user.id },
      orderBy: { room: { lastMessageAt: 'desc' } },
      take: 50,
      select: {
        id: true,
        userId: true,
        roomId: true,
        lastReadAt: true,
        room: {
          select: {
            id: true,
            matchId: true,
            lastMessageAt: true,
            vaultExpiry: true,
            isArchived: true,
            match: {
              select: { id: true, matchScore: true },
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, content: true, createdAt: true, senderId: true },
            },
            _count: {
              select: {
                messages: {
                  where: {
                    senderId: { not: user.id },
                    isRead: false,
                  },
                },
              },
            },
          },
        },
      },
    })

    // Batch load other members for all rooms (single query instead of nested include)
    const roomIds = memberships.map(m => m.room.id)
    const allMembers = roomIds.length > 0
      ? await db.chatRoomMember.findMany({
          where: {
            roomId: { in: roomIds },
            userId: { not: user.id },
          },
          select: {
            roomId: true,
            userId: true,
            user: {
              select: { id: true, name: true, image: true, isBot: true, profile: { select: { displayName: true, age: true, avatar: true } } },
            },
          },
        })
      : []
    const membersByRoom = new Map(allMembers.map(m => [m.roomId, m]))

    const chatRoomChats = memberships
      .filter((m) => !m.room.isArchived)
      .map((m) => {
        const otherMember = membersByRoom.get(m.room.id)
        const lastMessage = m.room.messages[0]
        const unreadCount = m.room._count.messages
        const match = m.room.match

        return {
          id: m.room.id,
          matchId: m.room.matchId,
          matchScore: match?.matchScore ?? undefined,
          otherUser: otherMember ? {
            id: otherMember.user.id,
            name: otherMember.user.profile?.displayName || otherMember.user.name,
            age: otherMember.user.profile?.age,
            avatar: otherMember.user.profile?.avatar || otherMember.user.image,
            isOnline: false,
            isBot: otherMember.user.isBot,
          } : { id: '', name: 'Unknown', age: 0, avatar: null, isOnline: false, isBot: false },
          lastMessage: lastMessage ? {
            content: lastMessage.content,
            msgType: "TEXT",
            timestamp: lastMessage.createdAt,
            isFromMe: lastMessage.senderId === user.id,
          } : null,
          unreadCount,
          isVault: !!(m.room.vaultExpiry && new Date(m.room.vaultExpiry) > new Date()),
          vaultExpiresAt: m.room.vaultExpiry?.toISOString(),
          lastReadAt: m.lastReadAt,
          _source: 'chatroom' as const,
        }
      })

    // ═══ 2. IM Conversation system ═══
    const imConversations = await db.conversation.findMany({
      where: {
        OR: [{ userAId: user.id }, { userBId: user.id }],
        state: { not: 'ARCHIVED' },
      },
      include: {
        userA: {
          select: {
            id: true,
            name: true,
            image: true,
            isBot: true,
            profile: {
              select: { displayName: true, age: true, avatar: true },
            },
          },
        },
        userB: {
          select: {
            id: true,
            name: true,
            image: true,
            isBot: true,
            profile: {
              select: { displayName: true, age: true, avatar: true },
            },
          },
        },
        imMessages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            payload: true,
            msgType: true,
            senderId: true,
            createdAt: true,
          },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
    })

    const imChats = imConversations.map((conv) => {
      const isUserA = conv.userAId === user.id
      const otherUser = isUserA ? conv.userB : conv.userA
      const unreadCount = isUserA ? conv.unreadCountA : conv.unreadCountB
      const lastMessage = conv.imMessages[0]

      // Check if this conversation already has a ChatRoom entry
      // We'll filter duplicates later
      return {
        id: conv.id,
        matchId: null as string | null,
        matchScore: undefined as number | undefined,
        otherUser: {
          id: otherUser.id,
          name: otherUser.profile?.displayName || otherUser.name || 'Unknown',
          age: otherUser.profile?.age,
          avatar: otherUser.profile?.avatar || otherUser.image,
          isOnline: false,
          isBot: otherUser.isBot,
        },
        lastMessage: lastMessage ? {
          content: lastMessage.payload.slice(0, 100),
          msgType: lastMessage.msgType,
          timestamp: lastMessage.createdAt,
          isFromMe: lastMessage.senderId === user.id,
        } : null,
        unreadCount,
        isVault: false,
        vaultExpiresAt: undefined as string | undefined,
        lastReadAt: null as string | null,
        _source: 'im' as const,
      }
    })

    // ═══ 3. Merge and deduplicate ═══
    // If a user has both ChatRoom and IM conversation with the same person, prefer ChatRoom
    const chatRoomOtherUserIds = new Set(
      chatRoomChats.map((c) => c.otherUser.id)
    )

    // Only add IM conversations that don't have a ChatRoom counterpart
    const uniqueImChats = imChats.filter(
      (c) => !chatRoomOtherUserIds.has(c.otherUser.id)
    )

    const allChats = [...chatRoomChats, ...uniqueImChats]

    // Sort by last message timestamp (most recent first)
    allChats.sort((a, b) => {
      const timeA = a.lastMessage ? new Date(a.lastMessage.timestamp).getTime() : 0
      const timeB = b.lastMessage ? new Date(b.lastMessage.timestamp).getTime() : 0
      return timeB - timeA
    })

    // Remove internal _source field from response
    const chats = allChats.map(({ _source, ...chat }) => chat)

    return NextResponse.json({ chats })
  })
}

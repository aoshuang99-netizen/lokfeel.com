import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/chat — Get chat list (rooms where user is a member)
export async function GET() {
  try {
    const { user } = await requireAuth()

    const memberships = await db.chatRoomMember.findMany({
      where: { userId: user.id },
      include: {
        room: {
          include: {
            match: {
              include: {
                sender: {
                  select: { id: true, name: true, image: true, profile: { select: { displayName: true, age: true, avatar: true } } },
                },
                receiver: {
                  select: { id: true, name: true, image: true, profile: { select: { displayName: true, age: true, avatar: true } } },
                },
              },
            },
            members: {
              where: { userId: { not: user.id } },
              include: {
                user: {
                  select: { id: true, name: true, image: true, profile: { select: { displayName: true, age: true, avatar: true } } },
                },
              },
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
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
      orderBy: { room: { lastMessageAt: 'desc' } },
    })

    const chats = memberships
      .filter((m) => !m.room.isArchived)
      .map((m) => {
        const otherMember = m.room.members[0]
        const lastMessage = m.room.messages[0]
        const unreadCount = m.room._count.messages

        return {
          id: m.room.id,
          matchId: m.room.matchId,
          otherUser: {
            id: otherMember.user.id,
            name: otherMember.user.profile?.displayName || otherMember.user.name,
            age: otherMember.user.profile?.age,
            avatar: otherMember.user.profile?.avatar || otherMember.user.image,
          },
          lastMessage: lastMessage ? {
            content: lastMessage.content,
            timestamp: lastMessage.createdAt,
          } : null,
          unreadCount,
          lastReadAt: m.lastReadAt,
        }
      })

    return NextResponse.json({ chats })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    console.error('Get chats error:', error)
    return NextResponse.json({ message: 'Failed to fetch chats' }, { status: 500 })
  }
}

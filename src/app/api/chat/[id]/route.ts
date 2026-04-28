import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/chat/[id] — Get chat room info
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireAuth()
    const { id: roomId } = await params

    // Verify user is a member of this room
    const member = await db.chatRoomMember.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
    })

    if (!member) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
    }

    // Get room info with other participant
    const room = await db.chatRoom.findUnique({
      where: { id: roomId },
      include: {
        members: {
          where: { userId: { not: user.id } },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                image: true,
                isBot: true,
                profile: {
                  select: {
                    displayName: true,
                    avatar: true,
                    avatarType: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!room) {
      return NextResponse.json({ message: 'Room not found' }, { status: 404 })
    }

    const otherParticipant = room.members[0]
    
    // Check if other user is a bot — use isBot field from User model
    const isBot = otherParticipant?.user.isBot === true || 
                  otherParticipant?.user.profile?.avatarType === 'bot'

    return NextResponse.json({
      room: {
        id: room.id,
        otherUser: {
          id: otherParticipant?.user.id || 'unknown',
          name: otherParticipant?.user.profile?.displayName || 
                otherParticipant?.user.name || 
                'Unknown User',
          avatar: otherParticipant?.user.profile?.avatar || 
                  otherParticipant?.user.image ||
                  null,
          isOnline: isBot || Math.random() > 0.5, // Bots are always "online"
          isBot: isBot,
          lastSeen: isBot ? 'Active now' : 'Recently',
        },
        isVault: false,
        vaultExpiresAt: null,
      },
    })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    console.error('Get room info error:', error)
    return NextResponse.json({ message: 'Failed to fetch room info' }, { status: 500 })
  }
}

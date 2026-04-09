import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/matches/[id] — Get a specific match detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireAuth()
    const { id } = await params

    const match = await db.match.findUnique({
      where: { id },
      include: {
        sender: {
          select: {
            id: true, name: true, image: true,
            profile: { select: { displayName: true, age: true, avatar: true, city: true, bio: true, relationshipGoal: true, attachmentStyle: true, communicationStyle: true, loveLanguage: true } },
          },
        },
        receiver: {
          select: {
            id: true, name: true, image: true,
            profile: { select: { displayName: true, age: true, avatar: true, city: true, bio: true, relationshipGoal: true, attachmentStyle: true, communicationStyle: true, loveLanguage: true } },
          },
        },
        matchReactions: true,
        chatRoom: {
          select: { id: true },
        },
      },
    })

    if (!match) {
      return NextResponse.json({ message: 'Match not found' }, { status: 404 })
    }

    // Check access: must be sender or receiver
    if (match.senderId !== user.id && match.receiverId !== user.id) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
    }

    const isSender = match.senderId === user.id
    const otherUser = isSender ? match.receiver : match.sender
    const myReaction = match.matchReactions.find((r) => r.userId === user.id)
    const otherReaction = match.matchReactions.find((r) => r.userId !== user.id)

    return NextResponse.json({
      id: match.id,
      otherUser: {
        id: otherUser.id,
        name: otherUser.profile?.displayName || otherUser.name,
        age: otherUser.profile?.age,
        avatar: otherUser.profile?.avatar || otherUser.image,
        city: otherUser.profile?.city,
        bio: otherUser.profile?.bio,
        relationshipGoal: otherUser.profile?.relationshipGoal,
        attachmentStyle: otherUser.profile?.attachmentStyle,
        communicationStyle: otherUser.profile?.communicationStyle,
        loveLanguage: otherUser.profile?.loveLanguage,
      },
      matchScore: match.matchScore,
      matchReason: match.matchReason,
      conflictWarnings: match.conflictWarnings,
      compatibilityBreakdown: {
        attachment: match.attachmentCompat,
        communication: match.communicationCompat,
        conflict: match.conflictCompat,
        values: match.valuesCompat,
        lifestyle: match.lifestyleCompat,
      },
      status: match.status,
      myReaction: myReaction?.reaction || null,
      otherReaction: otherReaction?.reaction || null,
      matchType: match.matchType,
      expiresAt: match.expiresAt,
      hasChatRoom: !!match.chatRoom,
      chatRoomId: match.chatRoom?.id || null,
      createdAt: match.createdAt,
    })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    console.error('Get match detail error:', error)
    return NextResponse.json({ message: 'Failed to fetch match' }, { status: 500 })
  }
}

// POST /api/matches/[id]/react — React to a match (INTERESTED / PASS / MAYBE / BLOCK)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireAuth()
    const { id } = await params
    const { reaction, feedback } = await request.json()

    if (!['INTERESTED', 'PASS', 'MAYBE', 'BLOCK'].includes(reaction)) {
      return NextResponse.json({ message: 'Invalid reaction' }, { status: 400 })
    }

    const match = await db.match.findUnique({
      where: { id },
    })

    if (!match) {
      return NextResponse.json({ message: 'Match not found' }, { status: 404 })
    }

    if (match.senderId !== user.id && match.receiverId !== user.id) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
    }

    // Upsert reaction
    const matchReaction = await db.matchReaction.upsert({
      where: {
        matchId_userId: { matchId: id, userId: user.id },
      },
      update: { reaction, feedback },
      create: {
        matchId: id,
        userId: user.id,
        reaction,
        feedback,
      },
    })

    // Update match action
    const isSender = match.senderId === user.id
    await db.match.update({
      where: { id },
      data: isSender ? { senderAction: reaction } : { receiverAction: reaction },
    })

    // Check if both have reacted — update status
    const allReactions = await db.matchReaction.findMany({
      where: { matchId: id },
    })

    if (allReactions.length === 2) {
      const reactions = allReactions.map((r) => r.reaction)

      if (reactions.includes('BLOCK')) {
        await db.match.update({
          where: { id },
          data: { status: 'REJECTED' },
        })
      } else if (reactions.every((r) => r === 'INTERESTED')) {
        // Both interested — create chat room
        const chatRoom = await db.chatRoom.create({
          data: {
            matchId: id,
            members: {
              create: [
                { userId: match.senderId },
                { userId: match.receiverId },
              ],
            },
          },
        })

        // System message
        await db.message.create({
          data: {
            roomId: chatRoom.id,
            senderId: match.senderId,
            content: "You matched! Start your conversation. Remember: this match is based on your relationship blueprints. Take time to explore your connection.",
            messageType: 'SYSTEM',
          },
        })

        await db.match.update({
          where: { id },
          data: { status: 'ACCEPTED' },
        })
      } else if (reactions.some((r) => r === 'PASS')) {
        await db.match.update({
          where: { id },
          data: { status: 'REJECTED' },
        })
      }
    }

    return NextResponse.json({
      reaction: matchReaction,
      message: `Reaction recorded: ${reaction}`,
    })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    console.error('React to match error:', error)
    return NextResponse.json({ message: 'Failed to record reaction' }, { status: 500 })
  }
}

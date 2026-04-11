import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireVerifiedUser, verificationErrorResponse } from '@/lib/auth/verification'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/chat/[id]/messages — Get messages for a chat room
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

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const before = searchParams.get('before')

    const where: any = { roomId }
    if (before) {
      where.createdAt = { lt: new Date(before) }
    }

    const messages = await db.message.findMany({
      where,
      include: {
        sender: {
          select: { id: true, name: true, image: true, profile: { select: { displayName: true, avatar: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })

    // Mark messages as read
    await db.message.updateMany({
      where: {
        roomId,
        senderId: { not: user.id },
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    })

    // Update last read timestamp
    await db.chatRoomMember.update({
      where: { roomId_userId: { roomId, userId: user.id } },
      data: { lastReadAt: new Date() },
    })

    return NextResponse.json({
      messages: messages.map((msg) => ({
        id: msg.id,
        content: msg.content,
        messageType: msg.messageType,
        sender: {
          id: msg.sender.id,
          name: msg.sender.profile?.displayName || msg.sender.name,
          avatar: msg.sender.profile?.avatar || msg.sender.image,
          isSelf: msg.senderId === user.id,
        },
        isRead: msg.isRead,
        createdAt: msg.createdAt,
      })),
    })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    console.error('Get messages error:', error)
    return NextResponse.json({ message: 'Failed to fetch messages' }, { status: 500 })
  }
}

// POST /api/chat/[id]/messages — Send a message
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require verified user for sending messages
    let user
    try {
      const result = await requireVerifiedUser()
      user = result.user
    } catch (err: any) {
      if (err.message === 'EMAIL_NOT_VERIFIED') {
        return NextResponse.json(verificationErrorResponse('Please verify your email to send messages'), { status: 403 })
      }
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    // ═══ AVATAR GATE ═══
    // Male users MUST have a real photo before they can send messages
    const userProfile = await db.profile.findUnique({ where: { userId: user.id } })
    if (userProfile) {
      const gender = userProfile.gender?.toUpperCase()
      if ((gender === 'MALE') && (!userProfile.avatar || userProfile.avatarType === 'cartoon')) {
        return NextResponse.json(
          { message: 'Please upload a real profile photo before sending messages. This helps build trust.', code: 'AVATAR_REQUIRED' },
          { status: 403 }
        )
      }
    }

    const { id: roomId } = await params
    const { content, messageType = 'TEXT' } = await request.json()

    if (!content?.trim()) {
      return NextResponse.json({ message: 'Message content is required' }, { status: 400 })
    }

    // Verify membership
    const member = await db.chatRoomMember.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
    })

    if (!member) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
    }

    const message = await db.message.create({
      data: {
        roomId,
        senderId: user.id,
        content: content.trim(),
        messageType,
      },
      include: {
        sender: {
          select: { id: true, name: true, image: true, profile: { select: { displayName: true, avatar: true } } },
        },
      },
    })

    // Update room's last message timestamp
    await db.chatRoom.update({
      where: { id: roomId },
      data: { lastMessageAt: new Date() },
    })

    return NextResponse.json({
      message: {
        id: message.id,
        content: message.content,
        messageType: message.messageType,
        sender: {
          id: message.sender.id,
          name: message.sender.profile?.displayName || message.sender.name,
          avatar: message.sender.profile?.avatar || message.sender.image,
          isSelf: true,
        },
        isRead: false,
        createdAt: message.createdAt,
      },
    })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    console.error('Send message error:', error)
    return NextResponse.json({ message: 'Failed to send message' }, { status: 500 })
  }
}

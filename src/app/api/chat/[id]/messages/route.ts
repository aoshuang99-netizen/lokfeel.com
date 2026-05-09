import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireVerifiedUser, verificationErrorResponse } from '@/lib/auth/verification'
import { handleApiError } from '@/lib/api-handler'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Bot response templates
const BOT_RESPONSES: Record<string, string[]> = {
  greeting: [
    "Hey! 👋 Nice to hear from you!",
    "Hi there! How's your day going?",
    "Hello! 😊 Thanks for reaching out!",
    "Hey! Great to match with you!",
    "Hi! I was hoping you'd message me!",
  ],
  question: [
    "That's a great question! Let me think...",
    "Hmm, interesting! I'd say...",
    "Good point! I think...",
    "Oh, I love that question! ",
    "You know, I've been wondering about that too!",
  ],
  interest: [
    "That sounds amazing! Tell me more! ✨",
    "Wow, I'm really interested in that too!",
    "No way! I love that as well!",
    "We should definitely talk more about this!",
    "You're speaking my language! 😄",
  ],
  casual: [
    "Haha, totally! 😄",
    "I know what you mean!",
    "Right? I was just thinking that!",
    "Exactly! Couldn't agree more.",
    "For sure! 💯",
  ],
  weekend: [
    "I'm thinking of checking out some local spots. You?",
    "Probably going to relax and maybe grab coffee with friends. How about you?",
    "I might go hiking if the weather's nice! 🥾",
    "There's a new restaurant I've been wanting to try!",
    "Just taking it easy, maybe some Netflix and wine. 🍷",
  ],
  food: [
    "I love trying new cuisines! Any recommendations? 🍜",
    "Italian is my weakness, especially pasta!",
    "I'm always down for good sushi! 🍣",
    "Have you tried that new place downtown?",
    "I'm a bit of a foodie, always hunting for hidden gems!",
  ],
  travel: [
    "I just got back from a trip actually! ✈️",
    "Japan is at the top of my bucket list!",
    "I love spontaneous weekend getaways!",
    "Beach or mountains? I'm a beach person! 🏖️",
    "Traveling is my favorite thing to do when I have time off!",
  ],
  fallback: [
    "That's interesting! Tell me more about yourself?",
    "I'd love to hear more about what you're into!",
    "So what brings you to this app? 😊",
    "I'm curious, what's your ideal weekend like?",
    "What kind of things are you passionate about?",
  ],
}

const KEYWORDS: Record<string, string[]> = {
  greeting: ["hi", "hello", "hey", "howdy", "good morning", "good evening", "what's up", "sup"],
  question: ["?", "what", "how", "why", "when", "where", "who", "which", "can you", "do you"],
  interest: ["love", "like", "enjoy", "favorite", "into", "passion", "hobby", "hobbies"],
  weekend: ["weekend", "saturday", "sunday", "plans", "doing this weekend", "free time"],
  food: ["food", "eat", "restaurant", "cooking", "dinner", "lunch", "breakfast", "cuisine", "sushi", "pizza"],
  travel: ["travel", "trip", "vacation", "country", "place", "visited", "going to", "flying"],
}

function categorizeMessage(content: string): string {
  const lower = content.toLowerCase()
  for (const [category, words] of Object.entries(KEYWORDS)) {
    if (words.some(word => lower.includes(word))) return category
  }
  return "fallback"
}

function getRandomResponse(category: string): string {
  const responses = BOT_RESPONSES[category] || BOT_RESPONSES.fallback
  return responses[Math.floor(Math.random() * responses.length)]
}

// GET /api/chat/[id]/messages — Get messages for a chat room
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleApiError(async () => {
    const { user } = await requireAuth()
    const { id: roomId } = await params

    // Try ChatRoom first, fall back to Conversation (IM)
    const member = await db.chatRoomMember.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
    })

    if (member) {
      // Legacy ChatRoom system
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
            select: { id: true, name: true, image: true, isBot: true, profile: { select: { displayName: true, avatar: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      })

      // Mark messages as read
      await db.message.updateMany({
        where: { roomId, senderId: { not: user.id }, isRead: false },
        data: { isRead: true, readAt: new Date() },
      })

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
            isBot: msg.sender.isBot,
          },
          isRead: msg.isRead,
          createdAt: msg.createdAt,
        })),
      })
    }

    // IM Conversation system
    const conversation = await db.conversation.findFirst({
      where: {
        id: roomId,
        OR: [{ userAId: user.id }, { userBId: user.id }],
      },
    })

    if (!conversation) {
      return NextResponse.json({ message: 'Not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')

    const imMessages = await db.iMMessage.findMany({
      where: { conversationId: roomId },
      orderBy: { seq: 'asc' },
      take: limit,
    })

    const otherUserId = conversation.userAId === user.id ? conversation.userBId : conversation.userAId
    const otherUser = await db.user.findUnique({
      where: { id: otherUserId },
      include: { profile: { select: { displayName: true, avatar: true } } },
    })

    return NextResponse.json({
      messages: imMessages.map((msg) => ({
        id: msg.id,
        content: msg.payload,
        messageType: msg.msgType === 'TEXT' ? 'TEXT' : msg.msgType,
        sender: {
          id: msg.senderId,
          name: msg.senderId === otherUserId ? (otherUser?.profile?.displayName || otherUser?.name || 'Unknown') : 'You',
          avatar: msg.senderId === otherUserId ? otherUser?.profile?.avatar : null,
          isSelf: msg.senderId === user.id,
          isBot: otherUser?.isBot || false,
        },
        isRead: true,
        createdAt: msg.createdAt,
      })),
    })
  })
}

// POST /api/chat/[id]/messages — Send a message
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleApiError(async () => {
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

    // ═══ Try ChatRoom system first ═══
    const member = await db.chatRoomMember.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
    })

    if (member) {
      // ═══ MESSAGE LIMIT CHECK — Plan-based ═══
      // Lady Free (women) & Premium: unlimited messages
      // Free (men): 2 messages per conversation
      const userWithSub = await db.user.findUnique({
        where: { id: user.id },
        include: {
          subscriptions: { where: { status: 'ACTIVE' }, take: 1 },
          profile: { select: { gender: true, cardVerified: true } },
        },
      })
      const hasActiveSub = userWithSub?.subscriptions && userWithSub.subscriptions.length > 0
      const isLadyFree = userWithSub?.subscriptions?.[0]?.plan === 'LADY_FREE'
      const isFemale = userWithSub?.profile?.gender === 'FEMALE'
      const cardVerified = userWithSub?.cardVerified ?? false

      // Skip limit for Lady Free and Premium users
      if (!hasActiveSub && !isFemale) {
        // Free male users: 2 messages per conversation
        const messageCount = await db.message.count({ where: { roomId, senderId: user.id } })
        if (messageCount >= 2) {
          return NextResponse.json(
            { message: 'Free users can send up to 2 messages per conversation. Upgrade to Premium for unlimited messaging.', code: 'UPGRADE_REQUIRED', upgradeUrl: '/dashboard/subscription' },
            { status: 403 }
          )
        }
      }

      // Card verification check — all non-premium users must verify after 3 total messages
      const isPremiumPlan = hasActiveSub && (userWithSub?.subscriptions?.[0]?.plan === 'PREMIUM_MONTHLY' || userWithSub?.subscriptions?.[0]?.plan === 'PREMIUM_YEARLY')
      if (!isPremiumPlan) {
        const totalMessages = await db.message.count({ where: { senderId: user.id } })
        if (!cardVerified && totalMessages >= 3) {
          return NextResponse.json(
            { message: 'Please verify your card to continue messaging. Identity verification only — no charges.', code: 'CARD_VERIFICATION_REQUIRED' },
            { status: 403 }
          )
        }
      }

      const message = await db.message.create({
        data: { roomId, senderId: user.id, content: content.trim(), messageType },
        include: { sender: { select: { id: true, name: true, image: true, isBot: true, profile: { select: { displayName: true, avatar: true } } } } },
      })

      await db.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: new Date() } })

      // ═══ BOT AUTO-REPLY ═══
      // Check if the other member is a bot user
      const otherMember = await db.chatRoomMember.findFirst({
        where: { roomId, userId: { not: user.id } },
        include: { user: { select: { id: true, isBot: true, name: true, profile: { select: { displayName: true, avatar: true } } } } },
      })

      if (otherMember?.user?.isBot) {
        const botUser = otherMember.user
        const category = categorizeMessage(content)
        const botResponse = getRandomResponse(category)

        // Create bot reply message
        const botMessage = await db.message.create({
          data: {
            roomId,
            senderId: botUser.id,
            content: botResponse,
            messageType: 'TEXT',
          },
          include: {
            sender: { select: { id: true, name: true, image: true, isBot: true, profile: { select: { displayName: true, avatar: true } } } },
          },
        })

        await db.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: new Date() } })

        console.log(`[Chat Bot Reply] ${botUser.id} replied to ${user.id}: "${botResponse.substring(0, 50)}..."`)
      }

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
            isBot: message.sender.isBot,
          },
          isRead: false,
          createdAt: message.createdAt,
        },
      })
    }

    // ═══ IM Conversation system ═══
    const conversation = await db.conversation.findFirst({
      where: {
        id: roomId,
        OR: [{ userAId: user.id }, { userBId: user.id }],
      },
    })

    if (!conversation) {
      return NextResponse.json({ message: 'Conversation not found' }, { status: 404 })
    }

    const receiverId = conversation.userAId === user.id ? conversation.userBId : conversation.userAId

    // Get next sequence number
    const lastMessage = await db.iMMessage.findFirst({
      where: { conversationId: roomId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    })
    const nextSeq = (lastMessage?.seq || 0) + 1

    // Create IM message
    const imMessage = await db.iMMessage.create({
      data: {
        conversationId: roomId,
        senderId: user.id,
        receiverId,
        seq: nextSeq,
        msgType: messageType,
        payload: content.trim(),
        encryptionMode: 'SERVER',
        consentState: 'CONSENT_NONE',
        mediaLevel: 'L0_TEXT',
        ruleResult: 'PASS',
      },
    })

    // Update conversation
    const unreadField = conversation.userAId === receiverId ? 'unreadCountA' : 'unreadCountB'
    await db.conversation.update({
      where: { id: roomId },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 1 },
        [unreadField]: { increment: 1 },
      },
    })

    // ═══ BOT AUTO-REPLY for IM ═══
    const receiver = await db.user.findUnique({
      where: { id: receiverId },
      select: { id: true, isBot: true, name: true, profile: { select: { displayName: true, avatar: true } } },
    })

    if (receiver?.isBot) {
      const category = categorizeMessage(content)
      const botResponse = getRandomResponse(category)

      // Bot reply seq = user message seq + 1 (no re-query needed)
      const botSeq = nextSeq + 1

      await db.iMMessage.create({
        data: {
          conversationId: roomId,
          senderId: receiverId,
          receiverId: user.id,
          seq: botSeq,
          msgType: 'TEXT',
          payload: botResponse,
          encryptionMode: 'SERVER',
          consentState: 'CONSENT_NONE',
          mediaLevel: 'L0_TEXT',
          ruleResult: 'PASS',
        },
      })

      // Update conversation unread for sender
      const senderUnreadField = conversation.userAId === user.id ? 'unreadCountA' : 'unreadCountB'
      await db.conversation.update({
        where: { id: roomId },
        data: {
          lastMessageAt: new Date(),
          messageCount: { increment: 1 },
          [senderUnreadField]: { increment: 1 },
        },
      })

      console.log(`[IM Bot Reply] ${receiverId} replied to ${user.id}: "${botResponse.substring(0, 50)}..."`)
    }

    const receiverName = receiver?.profile?.displayName || receiver?.name || 'Unknown'
    return NextResponse.json({
      message: {
        id: imMessage.id,
        content: content.trim(),
        messageType,
        sender: {
          id: user.id,
          name: 'You',
          avatar: userProfile?.avatar || null,
          isSelf: true,
          isBot: false,
        },
        isRead: false,
        createdAt: imMessage.createdAt,
      },
    })
  })
}

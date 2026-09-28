import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireVerifiedUser, verificationErrorResponse } from '@/lib/auth/verification'
import { handleApiError } from '@/lib/api-handler'
import { db } from '@/lib/db'
import { createConversation } from '@/lib/im/queries'
import { isMaleGender } from '@/lib/gender-utils'

export const dynamic = 'force-dynamic'

// GET /api/matches/[id] — Get a specific match detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleApiError(async () => {
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
      },
    }) as any

    if (!match) {
      return NextResponse.json({ message: 'Match not found' }, { status: 404 })
    }

    // Check access: must be sender or receiver
    if (match.senderId !== user.id && match.receiverId !== user.id) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
    }

    const isSender = match.senderId === user.id
    const otherUser = isSender ? match.receiver : match.sender
    const myReaction = match.matchReactions.find((r: any) => r.userId === user.id)
    const otherReaction = match.matchReactions.find((r: any) => r.userId !== user.id)

    // P1-6 阶段 5（G-10）：ChatRoom 表已删除，会话入口改按 matchId 反查 Conversation。
    // chatRoomId 优先返回旧房间 id —— 老书签 /dashboard/chats/<ChatRoom.id> 靠
    // Conversation.chatRoomId 的 @unique 索引做别名回退（lib/im/resolve.ts 路径 2）；
    // 无旧房间的会话返回 Conversation.id 本身。
    const conversation = await db.conversation.findFirst({
      where: { matchId: match.id },
      select: { id: true, chatRoomId: true },
      orderBy: { createdAt: 'desc' },
    })

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
      hasChatRoom: !!conversation,
      chatRoomId: conversation?.chatRoomId || conversation?.id || null,
      createdAt: match.createdAt,
    })
  })
}

// POST /api/matches/[id]/react — React to a match (INTERESTED / PASS / MAYBE / BLOCK)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleApiError(async () => {
    // Require verified user for match reactions
    let user
    try {
      const result = await requireVerifiedUser()
      user = result.user
    } catch (err: any) {
      if (err.message === 'EMAIL_NOT_VERIFIED') {
        return NextResponse.json(verificationErrorResponse('Please verify your email to react to matches'), { status: 403 })
      }
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    // ═══ AVATAR GATE ═══
    // Male users MUST have a real photo before they can react to matches
    const userProfile = await db.profile.findUnique({ where: { userId: user.id } })
    if (userProfile) {
      const gender = userProfile.gender?.toUpperCase()
      if ((isMaleGender(gender)) && (!userProfile.avatar || userProfile.avatarType === 'cartoon')) {
        return NextResponse.json(
          { message: 'Please upload a real profile photo before reacting to matches. This helps build trust.', code: 'AVATAR_REQUIRED' },
          { status: 403 }
        )
      }
    }

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
        // Both interested —— 建立会话（IM 终局模型为主，Legacy 为可选兼容副本）
        //
        // P1-6 阶段 5：本处是 B9 门禁的阻断引用点。改造模式与 `/api/matches/react`
        // 完全一致（该路由在阶段 3 已改完，此处照其规格复刻，避免两条匹配路径行为分叉）。
        const matchMsg =
          "You matched! Start your conversation. Remember: this match is based on your relationship blueprints. Take time to explore your connection."

        // ── IM 侧（终局模型）──
        // 用 try/catch 包住：与 `matches/react` 同一策略 —— 双写遇到瞬时错误
        // 不应让"匹配已成立"这个事实丢失（Legacy 侧此刻仍是主数据源）。
        try {
          const conversation = await createConversation(
            match.senderId,
            match.receiverId,
            match.senderId,
            { matchId: match.id }
          )

          // 开场系统消息只在会话还没有任何消息时写入，避免重复接受导致刷屏
          const existingMsg = await db.iMMessage.findFirst({
            where: { conversationId: conversation.convId },
            select: { id: true },
          })
          if (!existingMsg) {
            const last = await db.iMMessage.findFirst({
              where: { conversationId: conversation.convId },
              orderBy: { seq: 'desc' },
              select: { seq: true },
            })
            await db.iMMessage.create({
              data: {
                conversationId: conversation.convId,
                senderId: match.senderId,
                receiverId: match.receiverId,
                seq: (last?.seq || 0) + 1,
                msgType: 'SYSTEM',
                payload: matchMsg,
                encryptionMode: 'SERVER',
                consentState: 'CONSENT_NONE',
                mediaLevel: 'L0_TEXT',
                ruleResult: 'PASS',
              },
            })
            await db.conversation.update({
              where: { id: conversation.convId },
              data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
            })
          }
        } catch (twinErr) {
          console.error('[Match Detail] Twin-chat (Conversation) creation failed:', twinErr)
        }

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
  })
}

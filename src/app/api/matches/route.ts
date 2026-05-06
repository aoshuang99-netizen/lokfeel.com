import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-handler'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/matches — Get current user's matches
export async function GET(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth()
    const { searchParams } = new URL(request.url)

    const status = searchParams.get('status') // PENDING | ACCEPTED | REJECTED | EXPIRED
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Build where clause — matches where user is sender OR receiver
    const where: any = {
      OR: [
        { senderId: user.id },
        { receiverId: user.id },
      ],
    }

    if (status) {
      where.status = status
    }

    const [matches, total] = await Promise.all([
      db.match.findMany({
        where,
        include: {
          sender: {
            select: { id: true, name: true, image: true, profile: { select: { displayName: true, age: true, avatar: true, city: true } } },
          },
          receiver: {
            select: { id: true, name: true, image: true, profile: { select: { displayName: true, age: true, avatar: true, city: true } } },
          },
          matchReactions: {
            where: { userId: user.id },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.match.count({ where }),
    ])

    // Enrich matches with the other user's info
    const enrichedMatches = matches.map((match) => {
      const isSender = match.senderId === user.id
      const otherUser = isSender ? match.receiver : match.sender
      const myReaction = match.matchReactions.find((r) => r.userId === user.id)
      const otherReaction = match.matchReactions.find((r) => r.userId !== user.id)

      return {
        id: match.id,
        otherUser: {
          id: otherUser.id,
          name: otherUser.profile?.displayName || otherUser.name,
          age: otherUser.profile?.age,
          avatar: otherUser.profile?.avatar || otherUser.image,
          city: otherUser.profile?.city,
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
        createdAt: match.createdAt,
      }
    })

    return NextResponse.json({
      matches: enrichedMatches,
      pagination: { total, limit, offset },
    })
  })
}

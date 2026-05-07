import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-handler'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/who-liked-me — Find everyone who liked the current user
export async function GET() {
  return handleApiError(async () => {
    const { user } = await requireAuth()

    const matches = await db.match.findMany({
      where: {
        receiverId: user.id,
        senderAction: 'INTERESTED',
        status: {
          notIn: ['ACCEPTED', 'REJECTED'],
        },
      },
      include: {
        sender: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
                avatar: true,
                age: true,
                city: true,
                gender: true,
                relationshipGoal: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    const result = matches.map((match) => ({
      id: match.sender.id,
      matchId: match.id,
      matchScore: Math.round(match.matchScore),
      matchReason: match.matchReason,
      sender: {
        id: match.sender.id,
        displayName: match.sender.profile?.displayName || 'Someone',
        avatar: match.sender.profile?.avatar,
        age: match.sender.profile?.age,
        city: match.sender.profile?.city,
        gender: match.sender.profile?.gender,
        relationshipGoal: match.sender.profile?.relationshipGoal,
      },
    }))

    return NextResponse.json({ likes: result })
  })
}

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-handler'
import { db } from '@/lib/db'
import { cache } from '@/lib/cache'

export const dynamic = 'force-dynamic'

// GET /api/who-liked-me — Find everyone who liked the current user
// Cached for 60s per user (Redis cross-instance, or in-memory fallback)
export async function GET() {
  return handleApiError(async () => {
    const { user } = await requireAuth()

    const result = await cache.get(
      `who-liked-me:${user.id}`,
      async () => {
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

        return matches.map((match) => ({
          id: match.sender.id,
          matchId: match.id,
          matchScore: Math.round(match.matchScore),
          matchReason: match.matchReason,
          isSuperLike: match.senderAction === 'SUPER_LIKE', // ★ New
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
      },
      60 // 60s TTL
    )

    const res = NextResponse.json({ likes: result })
    // Cache-Control: private (user-specific), max-age matches Redis TTL (60s),
    // stale-while-revalidate allows serving stale while refreshing in background
    res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120')
    return res
  })
}

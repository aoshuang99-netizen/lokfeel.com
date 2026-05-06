import { NextResponse } from 'next/server'
import { requireAuth, requireAdminAuth } from '@/lib/auth'
import { generateMatchesForUser, generateAllWeeklyMatches } from '@/lib/matching'
import { handleApiError } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'

// GET /api/matching/generate — Generate matches for current user or all users (admin)
export async function GET(request: Request) {
  return handleApiError(async () => {
    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope') // 'me' | 'all'
    const limit = parseInt(searchParams.get('limit') || '5')

    if (scope === 'all') {
      // Admin only
      await requireAdminAuth()
      const results = await generateAllWeeklyMatches()
      return NextResponse.json({
        message: 'Weekly matches generated for all users',
        results,
      })
    }

    // Generate for current user
    const { user } = await requireAuth()
    const matches = await generateMatchesForUser(user.id, limit)

    return NextResponse.json({
      message: `${matches.length} new matches generated`,
      matches,
    })
  })
}

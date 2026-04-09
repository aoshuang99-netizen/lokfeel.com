import { NextResponse } from 'next/server'
import { requireAuth, requireAdminAuth } from '@/lib/auth'
import { generateMatchesForUser, generateAllWeeklyMatches } from '@/lib/matching'

export const dynamic = 'force-dynamic'

// GET /api/matching/generate — Generate matches for current user or all users (admin)
export async function GET(request: Request) {
  try {
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
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    if (error.message === 'Forbidden: Admin access required') {
      return NextResponse.json({ message: 'Admin access required' }, { status: 403 })
    }
    console.error('Generate matches error:', error)
    return NextResponse.json({ message: error.message || 'Failed to generate matches' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { requireAuth, requireAdminAuth } from '@/lib/auth'
import { 
  generateEnhancedMatchesForUser, 
  generateAllEnhancedWeeklyMatches 
} from '@/lib/matching/index-enhanced'
import { getMatchCompatibilityDetails } from '@/lib/matching/index-enhanced'

export const dynamic = 'force-dynamic'

/**
 * GET /api/matching/enhanced
 * 
 * 生成增强版匹配或获取匹配详情
 * 
 * Query参数:
 * - action: 'generate' | 'details' | 'batch'
 * - scope: 'me' | 'all' (for generate)
 * - matchId: string (for details)
 * - limit: number (default: 5)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'generate'
    const scope = searchParams.get('scope') // 'me' | 'all'
    const matchId = searchParams.get('matchId')
    const limit = parseInt(searchParams.get('limit') || '5')

    // 批量生成（仅管理员）
    if (action === 'batch' || scope === 'all') {
      await requireAdminAuth()
      const results = await generateAllEnhancedWeeklyMatches()
      return NextResponse.json({
        message: 'Enhanced weekly matches generated for all users',
        results,
      })
    }

    // 获取匹配详情
    if (action === 'details' && matchId) {
      const { user } = await requireAuth()
      const details = await getMatchCompatibilityDetails(matchId, user.id)
      return NextResponse.json({
        message: 'Match compatibility details retrieved',
        data: details,
      })
    }

    // 为当前用户生成匹配
    const { user } = await requireAuth()
    const matches = await generateEnhancedMatchesForUser(user.id, limit)

    return NextResponse.json({
      message: `${matches.length} enhanced matches generated`,
      matches: matches.map(m => ({
        id: m.id,
        matchScore: m.matchScore,
        matchReason: m.matchReason,
        conflictWarnings: m.conflictWarnings,
        status: m.status,
        expiresAt: m.expiresAt,
        enhancedScore: (m as any).enhancedScore,
      })),
    })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    if (error.message === 'Forbidden: Admin access required') {
      return NextResponse.json({ message: 'Admin access required' }, { status: 403 })
    }
    console.error('Enhanced matching error:', error)
    return NextResponse.json(
      { message: error.message || 'Failed to process enhanced matching' }, 
      { status: 500 }
    )
  }
}

/**
 * POST /api/matching/enhanced
 * 
 * 手动触发匹配生成或测试匹配算法
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireAuth()
    const body = await request.json()
    const { action, targetUserId } = body

    if (action === 'test') {
      // 测试两个用户之间的匹配分数
      const { calculateEnhancedMatchScore } = await import('@/lib/matching/enhanced-engine')
      const { db } = await import('@/lib/db')

      const [profileA, profileB] = await Promise.all([
        db.profile.findUnique({ where: { userId: user.id } }),
        db.profile.findUnique({ where: { userId: targetUserId } }),
      ])

      if (!profileA || !profileB) {
        return NextResponse.json(
          { message: 'Profile not found' }, 
          { status: 404 }
        )
      }

      const userA = {
        id: user.id,
        attachmentStyle: profileA.attachmentStyle,
        communicationStyle: profileA.communicationStyle,
        conflictResolution: profileA.conflictResolution,
        loveLanguage: profileA.loveLanguage,
        lifePriorities: profileA.lifePriorities,
        relationshipGoal: profileA.relationshipGoal,
        boundaries: profileA.boundaries,
        dealbreakers: profileA.dealbreakers,
        emotionalAvailability: profileA.emotionalAvailability,
        preferredAgeMin: profileA.preferredAgeMin,
        preferredAgeMax: profileA.preferredAgeMax,
        preferredGender: profileA.preferredGender,
        preferredDistance: profileA.preferredDistance,
        age: profileA.age,
        gender: profileA.gender,
        city: profileA.city,
        country: profileA.country,
        relationshipType: (profileA as any).relationshipType,
        sexualOrientation: (profileA as any).sexualOrientation,
      }

      const userB = {
        id: targetUserId,
        attachmentStyle: profileB.attachmentStyle,
        communicationStyle: profileB.communicationStyle,
        conflictResolution: profileB.conflictResolution,
        loveLanguage: profileB.loveLanguage,
        lifePriorities: profileB.lifePriorities,
        relationshipGoal: profileB.relationshipGoal,
        boundaries: profileB.boundaries,
        dealbreakers: profileB.dealbreakers,
        emotionalAvailability: profileB.emotionalAvailability,
        preferredAgeMin: profileB.preferredAgeMin,
        preferredAgeMax: profileB.preferredAgeMax,
        preferredGender: profileB.preferredGender,
        preferredDistance: profileB.preferredDistance,
        age: profileB.age,
        gender: profileB.gender,
        city: profileB.city,
        country: profileB.country,
        relationshipType: (profileB as any).relationshipType,
        sexualOrientation: (profileB as any).sexualOrientation,
      }

      const score = calculateEnhancedMatchScore({
        userA,
        userB,
      })

      return NextResponse.json({
        message: 'Compatibility test completed',
        data: {
          userA: { id: user.id, name: profileA.displayName },
          userB: { id: targetUserId, name: profileB.displayName },
          score,
        },
      })
    }

    // 默认：生成匹配
    const matches = await generateEnhancedMatchesForUser(user.id, 5)

    return NextResponse.json({
      message: `${matches.length} enhanced matches generated`,
      matches,
    })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    console.error('Enhanced matching POST error:', error)
    return NextResponse.json(
      { message: error.message || 'Failed to process request' }, 
      { status: 500 }
    )
  }
}

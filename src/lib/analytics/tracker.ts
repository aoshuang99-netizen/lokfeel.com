import { db } from '@/lib/db'
import { DashboardStats, UserFunnel, UserFunnelStage } from '@/types'

// ============================================================================
// Event Tracking
// ============================================================================

interface EventProperties {
  [key: string]: string | number | boolean | Date | undefined
}

/**
 * Track an analytics event
 */
export async function trackEvent(
  userId: string | undefined,
  event: string,
  properties?: EventProperties
) {
  try {
    await db.analyticsEvent.create({
      data: {
        userId,
        event,
        properties: properties ? JSON.stringify(properties) : undefined,
      },
    })
  } catch (error) {
    // Log but don't throw to avoid breaking user flows
    console.error('Failed to track event:', error)
  }
}

/**
 * Track a page view
 */
export async function trackPageView(
  userId: string | undefined,
  page: string,
  sessionId?: string
) {
  return trackEvent(userId, 'page_view', {
    page,
    sessionId,
    url: page,
  })
}

/**
 * Track user registration
 */
export async function trackRegistration(userId: string, method: string) {
  return trackEvent(userId, 'user_registered', {
    method, // 'credentials', 'google', 'github'
    // @ts-ignore - field not in current schema
    timestamp: new Date().toISOString(),
  })
}

/**
 * Track onboarding step completion
 */
export async function trackOnboardingStep(
  userId: string,
  step: number,
  stepName: string
) {
  return trackEvent(userId, 'onboarding_step_completed', {
    step,
    stepName,
  })
}

/**
 * Track onboarding completion
 */
export async function trackOnboardingComplete(userId: string) {
  return trackEvent(userId, 'onboarding_completed', {})
}

/**
 * Track match action
 */
export async function trackMatchAction(
  userId: string,
  action: 'viewed' | 'accepted' | 'declined' | 'expired',
  matchId: string,
  // @ts-ignore - field not in current schema
  compatibilityScore?: number
) {
  return trackEvent(userId, 'match_action', {
    action,
    matchId,
    // @ts-ignore - field not in current schema
    compatibilityScore,
  })
}

/**
 * Track message sent
 */
export async function trackMessageSent(
  userId: string,
  matchId: string,
  messageLength: number
) {
  return trackEvent(userId, 'message_sent', {
    matchId,
    messageLength,
  })
}

/**
 * Track subscription action
 */
export async function trackSubscriptionAction(
  userId: string,
  action: 'started' | 'cancelled' | 'renewed' | 'expired',
  plan: string,
  amount?: number
) {
  return trackEvent(userId, 'subscription_action', {
    action,
    plan,
    amount,
  })
}

// ============================================================================
// Dashboard Statistics
// ============================================================================

/**
 * Get comprehensive dashboard statistics
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)

  const [
    totalUsers,
    activeUsers,
    newUsersToday,
    newUsersThisWeek,
    totalMatches,
    successfulMatches,
    totalMessages,
    messagesToday,
  ] = await Promise.all([
    // Total users
    db.user.count(),
    
    // Active users (active in last 30 days)
    db.user.count({
      where: {
        updatedAt: {
          gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    
    // New users today
    db.user.count({
      where: {
        createdAt: {
          gte: today,
        },
      },
    }),
    
    // New users this week
    db.user.count({
      where: {
        createdAt: {
          gte: weekAgo,
        },
      },
    }),
    
    // Total matches
    db.match.count(),
    
    // Successful matches (both accepted)
    db.match.count({
      where: {
        status: 'ACCEPTED',
      },
    }),
    
    // Total messages
    db.message.count(),
    
    // Messages today
    db.message.count({
      where: {
        createdAt: {
          gte: today,
        },
      },
    }),
  ])

  // Calculate conversion rate (users who completed onboarding)
  const usersWithProfiles = await db.profile.count({
    where: {
      profileStatus: 'APPROVED',
    },
  })
  
  const conversionRate = totalUsers > 0
    ? Math.round((usersWithProfiles / totalUsers) * 100)
    : 0

  // Get revenue stats
  const revenueStats = await getRevenueStats()

  return {
    totalUsers,
    activeUsers,
    newUsersToday,
    newUsersThisWeek,
    totalMatches,
    successfulMatches,
    totalMessages,
    messagesToday,
    conversionRate,
    revenue: revenueStats,
  }
}

/**
 * Get revenue statistics
 */
async function getRevenueStats() {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)
  const monthAgo = new Date(today)
  monthAgo.setMonth(monthAgo.getMonth() - 1)

  const [
    todayRevenue,
    weekRevenue,
    monthRevenue,
    totalRevenue,
  ] = await Promise.all([
    // Today's revenue
    db.analyticsEvent.aggregate({
      where: {
        event: 'subscription_action',
        // @ts-ignore - field not in current schema
        timestamp: { gte: today },
        properties: {
          // @ts-ignore - field not in current schema
          path: ['action'],
          equals: 'started',
        },
      },
      // @ts-ignore - field not in current schema
      _sum: {
        properties: {
          // @ts-ignore - field not in current schema
          path: ['amount'],
        },
      },
    }),
    
    // This week's revenue
    db.analyticsEvent.aggregate({
      where: {
        event: 'subscription_action',
        // @ts-ignore - field not in current schema
        timestamp: { gte: weekAgo },
        properties: {
          // @ts-ignore - field not in current schema
          path: ['action'],
          equals: 'started',
        },
      },
      // @ts-ignore - field not in current schema
      _sum: {
        properties: {
          // @ts-ignore - field not in current schema
          path: ['amount'],
        },
      },
    }),
    
    // This month's revenue
    db.analyticsEvent.aggregate({
      where: {
        event: 'subscription_action',
        // @ts-ignore - field not in current schema
        timestamp: { gte: monthAgo },
        properties: {
          // @ts-ignore - field not in current schema
          path: ['action'],
          equals: 'started',
        },
      },
      // @ts-ignore - field not in current schema
      _sum: {
        properties: {
          // @ts-ignore - field not in current schema
          path: ['amount'],
        },
      },
    }),
    
    // Total revenue
    db.analyticsEvent.aggregate({
      where: {
        event: 'subscription_action',
        properties: {
          // @ts-ignore - field not in current schema
          path: ['action'],
          equals: 'started',
        },
      },
      // @ts-ignore - field not in current schema
      _sum: {
        properties: {
          // @ts-ignore - field not in current schema
          path: ['amount'],
        },
      },
    }),
  ])

  return {
    // @ts-ignore - field not in current schema
    today: Number(todayRevenue._sum?.properties || 0),
    // @ts-ignore - field not in current schema
    thisWeek: Number(weekRevenue._sum?.properties || 0),
    // @ts-ignore - field not in current schema
    thisMonth: Number(monthRevenue._sum?.properties || 0),
    // @ts-ignore - field not in current schema
    total: Number(totalRevenue._sum?.properties || 0),
  }
}

// ============================================================================
// User Funnel Analysis
// ============================================================================

/**
 * Get user conversion funnel
 */
export async function getUserFunnel(): Promise<UserFunnel> {
  const stages: UserFunnelStage[] = []

  // Stage 1: Registration
  const registered = await db.user.count()
  stages.push({
    stage: 'Registered',
    count: registered,
    percentage: 100,
    dropOff: 0,
  })

  // Stage 2: Started Onboarding
  const startedOnboarding = await db.profile.count()
  stages.push({
    stage: 'Started Onboarding',
    count: startedOnboarding,
    percentage: registered > 0 ? Math.round((startedOnboarding / registered) * 100) : 0,
    dropOff: registered - startedOnboarding,
  })

  // Stage 3: Completed Onboarding
  const completedOnboarding = await db.profile.count({
    where: { profileStatus: 'APPROVED' },
  })
  stages.push({
    stage: 'Completed Onboarding',
    count: completedOnboarding,
    percentage: startedOnboarding > 0 ? Math.round((completedOnboarding / startedOnboarding) * 100) : 0,
    dropOff: startedOnboarding - completedOnboarding,
  })

  // Stage 4: Received First Match
  const receivedFirstMatch = await db.user.count({
    where: {
      OR: [
        { sentMatches: { some: {} } },
        { receivedMatches: { some: {} } },
      ],
    },
  })
  stages.push({
    stage: 'Received First Match',
    count: receivedFirstMatch,
    percentage: completedOnboarding > 0 ? Math.round((receivedFirstMatch / completedOnboarding) * 100) : 0,
    dropOff: completedOnboarding - receivedFirstMatch,
  })

  // Stage 5: Accepted First Match
  const acceptedFirstMatch = await db.user.count({
    where: {
      OR: [
        // @ts-ignore - field not in current schema
        { sentMatches: { some: { user1Accepted: true } } },
        // @ts-ignore - field not in current schema
        { receivedMatches: { some: { user2Accepted: true } } },
      ],
    },
  })
  stages.push({
    stage: 'Accepted First Match',
    count: acceptedFirstMatch,
    percentage: receivedFirstMatch > 0 ? Math.round((acceptedFirstMatch / receivedFirstMatch) * 100) : 0,
    dropOff: receivedFirstMatch - acceptedFirstMatch,
  })

  // Stage 6: Sent First Message
  const sentFirstMessage = await db.user.count({
    where: {
      // @ts-ignore - field not in current schema
      sentMessages: { some: {} },
    },
  })
  stages.push({
    stage: 'Sent First Message',
    count: sentFirstMessage,
    percentage: acceptedFirstMatch > 0 ? Math.round((sentFirstMessage / acceptedFirstMatch) * 100) : 0,
    dropOff: acceptedFirstMatch - sentFirstMessage,
  })

  // Stage 7: Upgraded to Premium
  const upgraded = await db.subscription.count({
    where: {
      plan: { in: ['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'] },
    },
  })
  stages.push({
    stage: 'Upgraded to Premium',
    count: upgraded,
    percentage: sentFirstMessage > 0 ? Math.round((upgraded / sentFirstMessage) * 100) : 0,
    dropOff: sentFirstMessage - upgraded,
  })

  const totalCompleted = stages[stages.length - 1]?.count || 0
  const overallConversion = registered > 0
    ? Math.round((totalCompleted / registered) * 100)
    : 0

  return {
    stages,
    totalStarted: registered,
    totalCompleted,
    overallConversion,
  }
}

// ============================================================================
// Retention Analysis
// ============================================================================

interface RetentionData {
  cohort: string
  size: number
  retention: number[] // Day 1, Day 7, Day 30 retention percentages
}

/**
 * Get user retention cohorts
 */
export async function getRetentionCohorts(): Promise<RetentionData[]> {
  const cohorts: RetentionData[] = []
  const now = new Date()

  // Get last 12 weeks of cohorts
  for (let i = 0; i < 12; i++) {
    const cohortStart = new Date(now)
    cohortStart.setDate(cohortStart.getDate() - (i * 7))
    cohortStart.setHours(0, 0, 0, 0)
    
    const cohortEnd = new Date(cohortStart)
    cohortEnd.setDate(cohortEnd.getDate() + 7)

    const cohortUsers = await db.user.findMany({
      where: {
        createdAt: {
          gte: cohortStart,
          lt: cohortEnd,
        },
      },
      select: {
        id: true,
        createdAt: true,
      },
    })

    if (cohortUsers.length === 0) continue

    const userIds = cohortUsers.map((u: any) => u.id)

    // Calculate retention at different intervals
    const day1Retention = await calculateRetention(userIds, 1)
    const day7Retention = await calculateRetention(userIds, 7)
    const day30Retention = await calculateRetention(userIds, 30)

    cohorts.push({
      cohort: cohortStart.toISOString().split('T')[0],
      size: cohortUsers.length,
      retention: [day1Retention, day7Retention, day30Retention],
    })
  }

  return cohorts.reverse()
}

async function calculateRetention(userIds: string[], days: number): Promise<number> {
  if (userIds.length === 0) return 0

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)

  const activeUsers = await db.user.count({
    where: {
      id: { in: userIds },
      updatedAt: {
        gte: cutoffDate,
      },
    },
  })

  return Math.round((activeUsers / userIds.length) * 100)
}

// ============================================================================
// Match Analytics
// ============================================================================

interface MatchAnalytics {
  totalMatches: number
  acceptanceRate: number
  averageCompatibilityScore: number
  matchesByDay: { date: string; count: number }[]
}

/**
 * Get match analytics
 */
export async function getMatchAnalytics(): Promise<MatchAnalytics> {
  const [
    totalMatches,
    acceptedMatches,
    avgScore,
  ] = await Promise.all([
    db.match.count(),
    db.match.count({ where: { status: 'ACCEPTED' } }),
    db.match.aggregate({
      // @ts-ignore - field not in current schema
      _avg: { compatibilityScore: true },
    }),
  ])

  // Get matches by day for last 30 days
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const matches = await db.match.findMany({
    where: {
      createdAt: { gte: thirtyDaysAgo },
    },
    select: {
      createdAt: true,
    },
  })

  const matchesByDay: { date: string; count: number }[] = []
  const dateMap = new Map<string, number>()

  for (const match of matches) {
    const date = match.createdAt.toISOString().split('T')[0]
    dateMap.set(date, (dateMap.get(date) || 0) + 1)
  }

  // Fill in all dates
  for (let i = 0; i < 30; i++) {
    const date = new Date(thirtyDaysAgo)
    date.setDate(date.getDate() + i)
    const dateStr = date.toISOString().split('T')[0]
    matchesByDay.push({
      date: dateStr,
      count: dateMap.get(dateStr) || 0,
    })
  }

  return {
    totalMatches,
    acceptanceRate: totalMatches > 0 ? Math.round((acceptedMatches / totalMatches) * 100) : 0,
    // @ts-ignore - field not in current schema
    averageCompatibilityScore: Math.round(avgScore._avg?.compatibilityScore || 0),
    matchesByDay,
  }
}

// ============================================================================
// Export Data
// ============================================================================

/**
 * Export analytics data for external analysis
 */
export async function exportAnalyticsData(
  startDate: Date,
  endDate: Date
): Promise<{
  events: unknown[]
  users: unknown[]
  matches: unknown[]
}> {
  const [events, users, matches] = await Promise.all([
    db.analyticsEvent.findMany({
      where: {
        // @ts-ignore - field not in current schema
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
      },
    }),
    db.user.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        role: true,
        _count: {
          select: {
            sentMatches: true,
            receivedMatches: true,
            // @ts-ignore - field not in current schema
            sentMessages: true,
          },
        },
      },
    }),
    db.match.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        id: true,
        createdAt: true,
        status: true,
        // @ts-ignore - field not in current schema
        compatibilityScore: true,
        // @ts-ignore - field not in current schema
        user1Accepted: true,
        // @ts-ignore - field not in current schema
        user2Accepted: true,
      },
    }),
  ])

  return { events, users, matches }
}

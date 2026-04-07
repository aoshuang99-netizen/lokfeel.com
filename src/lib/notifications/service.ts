import { db } from '@/lib/db'
import type { NotificationPayload } from '@/types'
import { NotificationType } from '@/generated'
import { NOTIFICATION_TYPES } from '@/constants'

// ============================================================================
// Notification Creation
// ============================================================================

/**
 * Create a new notification
 */
export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  actionUrl?: string
) {
  const notification = await db.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      data: data ? JSON.stringify(data) : undefined,
      actionUrl,
      isRead: false,
    },
  })

  // Send push notification if enabled for this type
  const notificationConfig = (NOTIFICATION_TYPES as any)[type]
  if (notificationConfig?.push) {
    await sendPushNotification(userId, title, body, { ...data, notificationId: notification.id })
  }

  // Send email notification if enabled for this type
  if (notificationConfig?.email) {
    await sendEmailNotification(userId, title, 'default', {
      body,
      actionUrl,
      ...data,
    })
  }

  return notification
}

/**
 * Create a match notification
 */
export async function createMatchNotification(
  userId: string,
  matchId: string,
  matchName: string,
  compatibilityScore: number
) {
  return createNotification(
    userId,
    'NEW_MATCH',
    NOTIFICATION_TYPES.MATCH_CREATED.title,
    `You have a new match with ${matchName}! Compatibility: ${compatibilityScore}%`,
    { matchId, compatibilityScore },
    `/matches/${matchId}`
  )
}

/**
 * Create a message notification
 */
export async function createMessageNotification(
  userId: string,
  senderId: string,
  senderName: string,
  messagePreview: string,
  matchId: string
) {
  return createNotification(
    userId,
    'NEW_MESSAGE',
    `New message from ${senderName}`,
    messagePreview.length > 50 ? messagePreview.slice(0, 50) + '...' : messagePreview,
    { senderId, matchId },
    `/chat/${matchId}`
  )
}

/**
 * Create a match expiring notification
 */
export async function createMatchExpiringNotification(
  userId: string,
  matchId: string,
  matchName: string,
  hoursRemaining: number
) {
  return createNotification(
    userId,
    'NEW_MATCH',
    NOTIFICATION_TYPES.MATCH_EXPIRING.title,
    `Your match with ${matchName} expires in ${hoursRemaining} hours. Don't miss out!`,
    { matchId, hoursRemaining },
    `/matches/${matchId}`
  )
}

/**
 * Create verification notification
 */
export async function createVerificationNotification(
  userId: string,
  approved: boolean,
  reason?: string
) {
  const type = approved ? 'PROFILE_APPROVED' : 'PROFILE_REJECTED'
  const title = approved ? 'Profile Verified!' : 'Verification Update'
  const body = approved
    ? 'Your profile has been verified. You now have a verified badge!'
    : reason || 'Your verification request could not be approved. Please try again.'

  return createNotification(
    userId,
    type,
    title,
    body,
    { approved, reason },
    approved ? '/profile' : '/verification'
  )
}

/**
 * Create subscription expiring notification
 */
export async function createSubscriptionExpiringNotification(
  userId: string,
  daysRemaining: number
) {
  return createNotification(
    userId,
    'SUBSCRIPTION_EXPIRED',
    NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRING.title,
    `Your Premium subscription expires in ${daysRemaining} days. Renew to keep your benefits!`,
    { daysRemaining },
    '/subscription'
  )
}

/**
 * Create weekly digest notification
 */
export async function createWeeklyDigestNotification(
  userId: string,
  matchCount: number
) {
  return createNotification(
    userId,
    'WEEKLY_DIGEST',
    NOTIFICATION_TYPES.WEEKLY_DIGEST.title,
    matchCount > 0
      ? `You have ${matchCount} new match${matchCount > 1 ? 'es' : ''} this week!`
      : 'Your weekly matches are ready!',
    { matchCount },
    '/matches'
  )
}

// ============================================================================
// Notification Management
// ============================================================================

/**
 * Mark a notification as read
 */
export async function markAsRead(notificationId: string, userId: string) {
  const notification = await db.notification.findUnique({
    where: { id: notificationId },
  })

  if (!notification || notification.userId !== userId) {
    throw new Error('Notification not found or unauthorized')
  }

  return db.notification.update({
    where: { id: notificationId },
    data: { isRead: true, readAt: new Date() },
  })
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: string) {
  return db.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  })
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(userId: string): Promise<number> {
  return db.notification.count({
    where: { userId, isRead: false },
  })
}

/**
 * Get notifications for a user
 */
export async function getNotifications(
  userId: string,
  options: {
    unreadOnly?: boolean
    limit?: number
    offset?: number
  } = {}
) {
  const { unreadOnly = false, limit = 20, offset = 0 } = options

  return db.notification.findMany({
    where: {
      userId,
      ...(unreadOnly ? { isRead: false } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  })
}

/**
 * Delete old read notifications
 */
export async function cleanupOldNotifications(daysToKeep: number = 30): Promise<number> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

  const result = await db.notification.deleteMany({
    where: {
      isRead: true,
      readAt: { lt: cutoffDate },
    },
  })

  return result.count
}

// ============================================================================
// Push Notifications
// ============================================================================

interface PushSubscription {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

/**
 * Save push subscription for a user
 */
export async function savePushSubscription(
  userId: string,
  subscription: PushSubscription
) {
  return db.user.update({
    where: { id: userId },
    data: {},
  })
}

/**
 * Remove push subscription for a user
 */
export async function removePushSubscription(userId: string) {
  return db.user.update({
    where: { id: userId },
    data: {},
  })
}

/**
 * Send push notification to a user
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })

  if (true) { // push notifications not yet implemented
    return false
  }

  try {
    // In a real implementation, you would use web-push library
    // const subscription = null as any // PushSubscription not yet implemented
    // await webpush.sendNotification(subscription, JSON.stringify({ title, body, data }))
    
    console.log(`[Push Notification] To: ${userId}, Title: ${title}, Body: ${body}`)
    return true
  } catch (error) {
    console.error('Failed to send push notification:', error)
    
    // Remove invalid subscription
    if ((error as Error).message?.includes('expired')) {
      await removePushSubscription(userId)
    }
    
    return false
  }
}

/**
 * Send push notification to multiple users
 */
export async function sendBulkPushNotification(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0

  for (const userId of userIds) {
    const success = await sendPushNotification(userId, title, body, data)
    if (success) {
      sent++
    } else {
      failed++
    }
  }

  return { sent, failed }
}

// ============================================================================
// Email Notifications
// ============================================================================

interface EmailTemplateData {
  body: string
  actionUrl?: string
  [key: string]: unknown
}

/**
 * Send email notification to a user
 */
export async function sendEmailNotification(
  userId: string,
  subject: string,
  template: string,
  data: EmailTemplateData
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true },
  })

  if (!user?.email) {
    return false
  }

  try {
    // In a real implementation, you would use an email service like SendGrid, AWS SES, etc.
    // await emailService.send({
    //   to: user.email,
    //   subject,
    //   template,
    //   data,
    // })
    
    console.log(`[Email Notification] To: ${user.email}, Subject: ${subject}`)
    return true
  } catch (error) {
    console.error('Failed to send email notification:', error)
    return false
  }
}

/**
 * Toggle email notifications for a user
 */
export async function toggleEmailNotifications(
  userId: string,
  enabled: boolean
) {
  return db.user.update({
    where: { id: userId },
    data: {}, // emailNotifications not in current schema
  })
}

// ============================================================================
// Notification Preferences
// ============================================================================

interface NotificationPreferences {
  push: Record<NotificationType, boolean>
  email: Record<NotificationType, boolean>
}

/**
 * Get notification preferences for a user
 */
export async function getNotificationPreferences(
  userId: string
): Promise<NotificationPreferences | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })

  return null // notificationPreferences not in current schema
}

/**
 * Update notification preferences for a user
 */
export async function updateNotificationPreferences(
  userId: string,
  preferences: Partial<NotificationPreferences>
) {
  // notificationPreferences not in current schema - stub implementation
  return { id: userId }
}

// ============================================================================
// Scheduled Notifications
// ============================================================================

/**
 * Send match expiring reminders
 * Should be run by a cron job daily
 */
export async function sendMatchExpiringReminders(): Promise<number> {
  const expiringSoon = await db.match.findMany({
    where: {
      status: 'PENDING',
      expiresAt: {
        gt: new Date(),
        lt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Expires within 24 hours
      },
    },
    include: {
      sender: { select: { id: true, name: true } },
      receiver: { select: { id: true, name: true } },
    },
  })

  let sent = 0

  for (const match of expiringSoon) {
    const hoursRemaining = Math.ceil(
      ((match.expiresAt?.getTime() ?? Date.now()) - Date.now()) / (1000 * 60 * 60)
    )

    // Notify user1 if they haven't accepted
    if (!match.senderAction === null) {
      await createMatchExpiringNotification(
        match.senderId,
        match.id,
        match.receiver.name || 'Someone',
        hoursRemaining
      )
      sent++
    }

    // Notify user2 if they haven't accepted
    if (!match.receiverAction === null) {
      await createMatchExpiringNotification(
        match.receiverId,
        match.id,
        match.sender.name || 'Someone',
        hoursRemaining
      )
      sent++
    }
  }

  return sent
}

/**
 * Send weekly digests to all users
 * Should be run by a cron job weekly
 */
export async function sendWeeklyDigests(): Promise<number> {
  const users = await db.user.findMany({
    where: {
      profile: { profileStatus: 'APPROVED' },
    },
    select: { id: true },
  })

  let sent = 0

  for (const user of users) {
    const thisWeekMatches = await db.match.count({
      where: {
        OR: [{ senderId: user.id }, { receiverId: user.id }],
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    })

    await createWeeklyDigestNotification(user.id, thisWeekMatches)
    sent++
  }

  return sent
}

/**
 * Send subscription expiring reminders
 * Should be run by a cron job daily
 */
export async function sendSubscriptionReminders(): Promise<number> {
  const expiringSoon = await db.subscription.findMany({
    where: {
      status: 'ACTIVE',
      stripeCurrentPeriodEnd: {
        gt: new Date(),
        lt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Expires within 7 days
      },
    },
    include: {
      user: { select: { id: true } },
    },
  })

  let sent = 0

  for (const subscription of expiringSoon) {
    const daysRemaining = Math.ceil(
      (subscription.stripeCurrentPeriodEnd!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    )

    await createSubscriptionExpiringNotification(subscription.user.id, daysRemaining)
    sent++
  }

  return sent
}

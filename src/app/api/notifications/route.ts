import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { handleApiError } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'

// GET /api/notifications — Get current user's notifications
export async function GET(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth()
    const { searchParams } = new URL(request.url)

    const filter = searchParams.get('filter') // 'unread' or 'all'
    const limit = parseInt(searchParams.get('limit') || '20')

    const where: any = { userId: user.id }
    if (filter === 'unread') {
      where.isRead = false
    }

    const notifications = await db.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, type: true, title: true, body: true,
        data: true, actionUrl: true, isRead: true, readAt: true, createdAt: true,
      },
    })

    const unreadCount = await db.notification.count({
      where: { userId: user.id, isRead: false },
    })

    return NextResponse.json({ notifications, unreadCount })
  })
}

// PUT /api/notifications — Mark notifications as read
export async function PUT(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth()
    const { ids, markAll } = await request.json()

    if (markAll) {
      await db.notification.updateMany({
        where: { userId: user.id, isRead: false },
        data: { isRead: true, readAt: new Date() },
      })
    } else if (ids && Array.isArray(ids)) {
      await db.notification.updateMany({
        where: { id: { in: ids }, userId: user.id },
        data: { isRead: true, readAt: new Date() },
      })
    }

    return NextResponse.json({ message: 'Notifications marked as read' })
  })
}

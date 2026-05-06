import { NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Database connectivity check endpoint.
 * GET /api/db-check
 * ADMIN ONLY — Protected endpoint
 */
export async function GET() {
  try {
    await requireAdminAuth()

    const userCount = await db.user.count()
    const profileCount = await db.profile.count()

    return NextResponse.json({
      status: 'connected',
      engine: 'libsql',
      stats: {
        users: userCount,
        profiles: profileCount,
      }
    })
  } catch (error: any) {
    if (error?.message?.includes('Unauthorized') || error?.message?.includes('Forbidden') || error?.message?.includes('Admin')) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

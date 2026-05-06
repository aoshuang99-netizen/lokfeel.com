import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/health — Health check endpoint
export async function GET() {
  try {
    // Check database connection — use count() for Turso/libSQL compatibility
    // (SQLite/Turso doesn't support $queryRaw)
    const start = Date.now()
    await db.user.count()
    const dbLatency = Date.now() - start

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        latencyMs: dbLatency,
      },
    })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        error: errMsg || 'DATABASE_URL is not configured or database is unreachable',
      },
    }, { status: 503 })
  }
}

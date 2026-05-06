import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/health — Lightweight health check
export async function GET() {
  try {
    const start = Date.now()
    // Use findFirst with select (no count scan) for faster Turso check
    await db.user.findFirst({ select: { id: true } })
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
        error: errMsg || 'Database unreachable',
      },
    }, { status: 503 })
  }
}

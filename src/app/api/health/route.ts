import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

const DB_TIMEOUT_MS = 100

// GET /api/health — Lightweight health check
export async function GET() {
  const requestStart = Date.now()

  // Response headers for timing and caching
  const responseHeaders = new Headers()
  responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate')

  let dbConnected = false
  let dbLatency = 0
  let dbError: string | undefined

  try {
    const dbStart = Date.now()

    // Use AbortController timeout to prevent blocking on slow DB
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), DB_TIMEOUT_MS)

    try {
      // Use $queryRaw for lightweight SELECT 1 instead of ORM query
      await getDb().$queryRaw`SELECT 1`
      clearTimeout(timeoutId)

      dbConnected = true
      dbLatency = Date.now() - dbStart
    } catch (rawError) {
      clearTimeout(timeoutId)
      if (rawError instanceof Error && rawError.name === 'AbortError') {
        dbError = `Database check timed out after ${DB_TIMEOUT_MS}ms`
      } else {
        throw rawError
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    const totalLatency = Date.now() - requestStart
    responseHeaders.set('X-Response-Time', `${totalLatency}ms`)

    return NextResponse.json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        error: errMsg || 'Database unreachable',
      },
    }, { status: 503, headers: responseHeaders })
  }

  const totalLatency = Date.now() - requestStart
  responseHeaders.set('X-Response-Time', `${totalLatency}ms`)

  return NextResponse.json({
    status: dbConnected ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    database: {
      connected: dbConnected,
      latencyMs: dbLatency,
      ...(dbError && { error: dbError }),
    },
  }, { headers: responseHeaders })
}

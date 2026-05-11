import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

const DB_TIMEOUT_MS = 3000  // 3s timeout for Turso cold starts

// Cache DB check result for 30 seconds to reduce load
let lastDbCheck: { connected: boolean; latency: number; timestamp: number } | null = null
const CACHE_TTL_MS = 30000  // 30 seconds

// GET /api/health — Lightweight health check with caching
export async function GET() {
  const requestStart = Date.now()

  // Response headers for timing and caching
  const responseHeaders = new Headers()
  responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate')

  // Use cached DB result if fresh
  if (lastDbCheck && Date.now() - lastDbCheck.timestamp < CACHE_TTL_MS) {
    const totalLatency = Date.now() - requestStart
    responseHeaders.set('X-Response-Time', `${totalLatency}ms`)
    responseHeaders.set('X-DB-Cache', 'hit')

    return NextResponse.json({
      status: lastDbCheck.connected ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database: {
        connected: lastDbCheck.connected,
        latencyMs: lastDbCheck.latency,
        cached: true,
      },
    }, { headers: responseHeaders })
  }

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

      // Cache successful result
      lastDbCheck = { connected: true, latency: dbLatency, timestamp: Date.now() }
    } catch (rawError) {
      clearTimeout(timeoutId)
      if (rawError instanceof Error && rawError.name === 'AbortError') {
        dbError = `Database check timed out after ${DB_TIMEOUT_MS}ms`
        lastDbCheck = { connected: false, latency: DB_TIMEOUT_MS, timestamp: Date.now() }
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
  responseHeaders.set('X-DB-Cache', 'miss')

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

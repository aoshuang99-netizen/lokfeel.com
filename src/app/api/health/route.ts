import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { cache } from '@/lib/cache'

export const dynamic = 'force-dynamic'
export const revalidate = 60  // ISR: revalidate every 60 seconds

const DB_TIMEOUT_MS = 3000  // 3s timeout for Turso cold starts
const DB_CHECK_TTL = 30  // 30 seconds (Redis or in-memory)

type DbCheckResult = { connected: boolean; latency: number }

// GET /api/health — Lightweight health check with Redis-backed caching
export async function GET() {
  const requestStart = Date.now()

  // Response headers for timing and caching
  // Allow CDN caching: cache for 60s, serve stale for up to 24h while revalidating
  const responseHeaders = new Headers()
  responseHeaders.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=86400')
  responseHeaders.set('Surrogate-Control', 'public, max-age=60')  // Explicit CDN caching

  // Use Redis-backed cache for DB check result (30s TTL, shared across instances)
  const dbResult = await cache.get<DbCheckResult>(
    'health:db-check',
    async () => {
      try {
        const dbStart = Date.now()
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), DB_TIMEOUT_MS)

        try {
          await getDb().$queryRaw`SELECT 1`
          clearTimeout(timeoutId)
          return { connected: true, latency: Date.now() - dbStart }
        } catch (rawError) {
          clearTimeout(timeoutId)
          if (rawError instanceof Error && rawError.name === 'AbortError') {
            return { connected: false, latency: DB_TIMEOUT_MS }
          }
          throw rawError
        }
      } catch {
        return { connected: false, latency: 0 }
      }
    },
    DB_CHECK_TTL
  )

  const totalLatency = Date.now() - requestStart
  responseHeaders.set('X-Response-Time', `${totalLatency}ms`)
  responseHeaders.set('X-DB-Cache', dbResult.latency < totalLatency ? 'hit' : 'miss')

  if (dbResult.connected) {
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        latencyMs: dbResult.latency,
        cached: dbResult.latency < totalLatency,
      },
      payment: getPaymentStatus(),
    }, { headers: responseHeaders })
  }

  return NextResponse.json({
    status: 'degraded',
    timestamp: new Date().toISOString(),
    database: {
      connected: false,
      error: dbResult.latency >= DB_TIMEOUT_MS
        ? `Database check timed out after ${DB_TIMEOUT_MS}ms`
        : 'Database unreachable',
    },
    payment: getPaymentStatus(),
  }, { status: 503, headers: responseHeaders })
}

function getPaymentStatus() {
  const apiKey = process.env.CREEM_API_KEY
  const env = process.env.CREEM_ENV || 'not set'
  const monthlyId = process.env.CREEM_MONTHLY_PRODUCT_ID
  const yearlyId = process.env.CREEM_YEARLY_PRODUCT_ID
  const webhookSecret = process.env.CREEM_WEBHOOK_SECRET

  if (!apiKey) {
    return {
      provider: 'creem',
      configured: false,
      reason: 'CREEM_API_KEY not set',
      vars: { CREEM_API_KEY: false, CREEM_ENV: env, CREEM_MONTHLY_PRODUCT_ID: !!monthlyId, CREEM_YEARLY_PRODUCT_ID: !!yearlyId, CREEM_WEBHOOK_SECRET: !!webhookSecret }
    }
  }

  return {
    provider: 'creem',
    configured: true,
    environment: env,
    apiKeyPrefix: apiKey.substring(0, 8) + '...',
    vars: {
      CREEM_API_KEY: true,
      CREEM_ENV: env,
      CREEM_MONTHLY_PRODUCT_ID: !!monthlyId,
      CREEM_YEARLY_PRODUCT_ID: !!yearlyId,
      CREEM_WEBHOOK_SECRET: !!webhookSecret,
    }
  }
}

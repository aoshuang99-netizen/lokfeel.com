/**
 * Wrap an async API handler with proper error handling.
 * Catches ApiError (UnauthorizedError, ForbiddenError, etc.) and returns
 * the correct HTTP status code. Non-ApiError exceptions return 500.
 *
 * Usage:
 *   export async function GET(req: NextRequest) {
 *     return handleApiError(async () => {
 *       const { user } = await requireAuth()
 *       return NextResponse.json({ data: 'ok' })
 *     })
 *   }
 */
import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/errors'

type HandlerResult = NextResponse | Response

export async function handleApiError(fn: () => Promise<HandlerResult>): Promise<HandlerResult> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          ...(error.details && { details: error.details }),
        },
        { status: error.statusCode }
      )
    }
    console.error('[API Error]', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * Custom error class for API errors with HTTP status codes
 * Use in route handlers' catch blocks to return proper status codes
 */
export class ApiError extends Error {
  public readonly statusCode: number
  public readonly details?: any

  constructor(statusCode: number, message: string, details?: any) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.details = details
  }
}

/**
 * 401 Unauthorized
 */
export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized', details?: any) {
    super(401, message, details)
    this.name = 'UnauthorizedError'
  }
}

/**
 * 403 Forbidden
 */
export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden', details?: any) {
    super(403, message, details)
    this.name = 'ForbiddenError'
  }
}

/**
 * 404 Not Found
 */
export class NotFoundError extends ApiError {
  constructor(message = 'Not found', details?: any) {
    super(404, message, details)
    this.name = 'NotFoundError'
  }
}

/**
 * 429 Too Many Requests
 */
export class RateLimitError extends ApiError {
  constructor(message = 'Too many requests', details?: any) {
    super(429, message, details)
    this.name = 'RateLimitError'
  }
}

/**
 * Helper: format an error into a NextResponse-compatible JSON shape
 * Pass any caught error; if it's an ApiError, use its statusCode.
 */
export function formatErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return {
      json: {
        success: false,
        error: error.message,
        ...(error.details && { details: error.details }),
      },
      status: error.statusCode,
    }
  }
  // Non-ApiError: genuine server error → 500
  return {
    json: {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    },
    status: 500,
  }
}

import { NextResponse } from "next/server";
import { ApiError } from "./errors";

// ============================================================================
// API Error Codes
// ============================================================================

export enum ApiErrorCode {
  PERMISSION_DENIED = "PERMISSION_DENIED",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  RATE_LIMITED = "RATE_LIMITED",
  CONFLICT = "CONFLICT",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  BAD_REQUEST = "BAD_REQUEST",
}

// ============================================================================
// Pagination Meta
// ============================================================================

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ============================================================================
// Standardized API Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T | null;
  error?: {
    code: ApiErrorCode | string;
    message: string;
    details?: unknown;
  };
  meta?: PaginationMeta;
}

export interface BatchResult {
  total: number;
  succeeded: number;
  failed: number;
  details: Array<{
    id: string;
    success: boolean;
    error?: string;
  }>;
}

// ============================================================================
// Pagination Helpers
// ============================================================================

export function createMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export function parsePagination(
  searchParams: URLSearchParams,
  defaults: { page?: number; pageSize?: number } = {}
): { page: number; pageSize: number; skip: number; take: number } {
  const page = Math.max(1, parseInt(searchParams.get("page") || String(defaults.page || 1), 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || String(defaults.pageSize || 20), 10)));
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

// ============================================================================
// Response Helpers (Enhanced)
// ============================================================================

export function success<T>(data: T, meta?: PaginationMeta, status: number = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data, meta }, { status });
}

export function created<T>(data: T): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data }, { status: 201 });
}

export function paginated<T>(data: T[], meta: PaginationMeta): NextResponse<ApiResponse<T[]>> {
  return NextResponse.json({ success: true, data, meta }, { status: 200 });
}

export function badRequest(message: string, details?: unknown): NextResponse<ApiResponse> {
  return NextResponse.json(
    { success: false, data: null, error: { code: ApiErrorCode.BAD_REQUEST, message, details } },
    { status: 400 }
  );
}

export function validationError(message: string, details?: unknown): NextResponse<ApiResponse> {
  return NextResponse.json(
    { success: false, data: null, error: { code: ApiErrorCode.VALIDATION_ERROR, message, details } },
    { status: 400 }
  );
}

export function unauthorized(message: string = "Authentication required"): NextResponse<ApiResponse> {
  return NextResponse.json(
    { success: false, data: null, error: { code: ApiErrorCode.UNAUTHORIZED, message } },
    { status: 401 }
  );
}

export function forbidden(message: string = "You do not have permission to perform this action"): NextResponse<ApiResponse> {
  return NextResponse.json(
    { success: false, data: null, error: { code: ApiErrorCode.PERMISSION_DENIED, message } },
    { status: 403 }
  );
}

export function notFound(message: string = "Resource not found"): NextResponse<ApiResponse> {
  return NextResponse.json(
    { success: false, data: null, error: { code: ApiErrorCode.NOT_FOUND, message } },
    { status: 404 }
  );
}

export function conflict(message: string, details?: unknown): NextResponse<ApiResponse> {
  return NextResponse.json(
    { success: false, data: null, error: { code: ApiErrorCode.CONFLICT, message, details } },
    { status: 409 }
  );
}

export function rateLimited(message: string = "Too many requests. Please try again later."): NextResponse<ApiResponse> {
  return NextResponse.json(
    { success: false, data: null, error: { code: ApiErrorCode.RATE_LIMITED, message } },
    { status: 429 }
  );
}

export function serverError(message: string = "Internal server error", details?: unknown): NextResponse<ApiResponse> {
  if (details && process.env.NODE_ENV === "development") {
    return NextResponse.json(
      { success: false, data: null, error: { code: ApiErrorCode.INTERNAL_ERROR, message, details } },
      { status: 500 }
    );
  }
  return NextResponse.json(
    { success: false, data: null, error: { code: ApiErrorCode.INTERNAL_ERROR, message } },
    { status: 500 }
  );
}

export function batchResult(result: BatchResult, status: number = 200): NextResponse<ApiResponse<BatchResult>> {
  return NextResponse.json({ success: true, data: result }, { status });
}

// ============================================================================
// Batch Operation Helper
// ============================================================================

export async function executeBatchOperation<T>(
  ids: string[],
  operation: (id: string) => Promise<T>,
  operationName: string = "operation"
): Promise<BatchResult> {
  const details: BatchResult["details"] = [];
  let succeeded = 0;
  let failed = 0;

  for (const id of ids) {
    try {
      await operation(id);
      details.push({ id, success: true });
      succeeded++;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unknown error during ${operationName}`;
      details.push({ id, success: false, error: message });
      failed++;
    }
  }

  return {
    total: ids.length,
    succeeded,
    failed,
    details,
  };
}

// Backward compatibility: export simple versions that existing code uses
export { success as apiSuccess, badRequest as apiBadRequest, unauthorized as apiUnauthorized, forbidden as apiForbidden, notFound as apiNotFound, serverError as apiServerError, created as apiCreated };

// ============================================================================
// Unified error → response mapping
// ============================================================================

/**
 * 把任意抛出的错误映射成本仓统一的响应信封。
 *
 * 为什么需要它：`ApiError` 家族（`src/lib/errors.ts`）带 `statusCode`，
 * 但各路由若自行 `if (e instanceof ApiError) ... else ...`，很容易漏掉某个状态码
 * 而把 400/404/409 一律错报成 500。集中映射后，"新增一个错误类型"只需要改这一处。
 *
 * ⚠️ 未经识别的错误一律 500，且**不回显** `error.message`
 * （避免把内部实现细节/栈信息泄露给调用方）。
 */
export function errorResponse(error: unknown): NextResponse<ApiResponse> {
  if (error instanceof ApiError) {
    switch (error.statusCode) {
      case 400:
        return validationError(error.message, error.details);
      case 401:
        return unauthorized(error.message);
      case 403:
        return forbidden(error.message);
      case 404:
        return notFound(error.message);
      case 409:
        return conflict(error.message, error.details);
      case 429:
        return rateLimited(error.message);
      default:
        return serverError(error.message);
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    console.error('[api] unhandled error:', error);
  }
  return serverError('Internal server error');
}

/** 路由级兜底：把 handler 包成"永不抛出、永远返回统一信封"的形式。 */
export async function withErrorEnvelope(
  fn: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    return errorResponse(error);
  }
}

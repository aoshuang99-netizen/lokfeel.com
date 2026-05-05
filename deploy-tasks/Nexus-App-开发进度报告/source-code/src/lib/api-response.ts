import { NextResponse } from "next/server";

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

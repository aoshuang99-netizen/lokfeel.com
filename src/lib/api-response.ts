import { NextResponse } from "next/server";

/**
 * Standardized API response helpers.
 * Used across all API routes for consistent response format.
 */
export function success(data: any, status: number = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function created(data: any) {
  return NextResponse.json({ success: true, data }, { status: 201 });
}

export function badRequest(message: string, errors?: any) {
  return NextResponse.json(
    { success: false, message, errors },
    { status: 400 }
  );
}

export function unauthorized(message: string = "Unauthorized") {
  return NextResponse.json(
    { success: false, message },
    { status: 401 }
  );
}

export function forbidden(message: string = "Forbidden") {
  return NextResponse.json(
    { success: false, message },
    { status: 403 }
  );
}

export function notFound(message: string = "Not found") {
  return NextResponse.json(
    { success: false, message },
    { status: 404 }
  );
}

export function serverError(message: string = "Internal server error") {
  return NextResponse.json(
    { success: false, message },
    { status: 500 }
  );
}

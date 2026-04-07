import { NextResponse } from 'next/server'

export function badRequest(message: string = 'Bad request', errors?: unknown[]) {
  return NextResponse.json({ error: message, errors }, { status: 400 })
}

export function unauthorized(message: string = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 })
}

export function forbidden(message: string = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function notFound(message: string = 'Not found') {
  return NextResponse.json({ error: message }, { status: 404 })
}

export function serverError(message: string = 'Internal server error') {
  return NextResponse.json({ error: message }, { status: 500 })
}

export function success<T>(data: T, status: number = 200) {
  return NextResponse.json(data, { status })
}

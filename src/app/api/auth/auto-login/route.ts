import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/auto-login
 * Exchange auto-login token for user credentials
 * This is called by the frontend after successful registration
 * 
 * 🔐 BUG-P0-2 FIX: Added atomic token consumption to prevent replay attacks
 * - Uses transaction with atomic updateMany to prevent race conditions
 * - Strict useCount check to ensure one-time use only
 * - Immediate deletion after successful use
 */
export async function POST(request: NextRequest) {
  try {
    const { token, email } = await request.json()

    if (!token || !email) {
      return NextResponse.json(
        { message: 'Token and email required' },
        { status: 400 }
      )
    }

    // Find the user by email
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, email: true, name: true, role: true },
    })

    if (!user) {
      // EP-S2 (2026-09-04): do NOT distinguish "user not found" (404) from
      // "invalid token" (401) — a distinct 404 enables email enumeration.
      // Return the same generic 401 used for an invalid/expired token.
      return NextResponse.json(
        { message: 'Invalid or expired auto-login link' },
        { status: 401 }
      )
    }

    // 🔐 BUG-P0-2 FIX: Atomic token consumption with transaction
    // This prevents race conditions where token could be used multiple times
    const tokenResult = await db.$transaction(async (tx) => {
      // Find valid token with strict one-time conditions
      const tokenRecord = await tx.verificationToken.findFirst({
        where: {
          identifier: `auto-login:${user.id}`,
          token,
          expires: { gt: new Date() },
          used: false,
          useCount: 0,  // Strict: must be completely unused
          maxUses: 1,   // Strict: exactly 1 use allowed
        },
      })

      if (!tokenRecord) {
        // Check specific reason for better error messaging
        const existingToken = await tx.verificationToken.findFirst({
          where: {
            identifier: `auto-login:${user.id}`,
            token,
          },
        })

        if (existingToken) {
          if (existingToken.expires < new Date()) {
            throw new Error('AUTO_LOGIN_TOKEN_EXPIRED')
          }
          if (existingToken.useCount >= existingToken.maxUses || existingToken.used) {
            throw new Error('AUTO_LOGIN_TOKEN_ALREADY_USED')
          }
        }

        throw new Error('AUTO_LOGIN_TOKEN_INVALID')
      }

      // Atomically consume the token (mark as used and increment count)
      // This prevents race conditions
      const updated = await tx.verificationToken.updateMany({
        where: {
          id: tokenRecord.id,
          useCount: 0,  // Ensure still unused
          used: false,  // Ensure still unused
        },
        data: {
          used: true,
          useCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      })

      // If no rows updated, token was consumed by another request
      if (updated.count === 0) {
        throw new Error('AUTO_LOGIN_TOKEN_CONSUMED_CONCURRENTLY')
      }

      // Delete the token immediately after successful use
      // This provides defense-in-depth even if the update succeeded
      await tx.verificationToken.delete({
        where: { id: tokenRecord.id },
      }).catch(() => {
        // Ignore deletion errors - token is already marked as used
      })

      return tokenRecord
    })

    // Return user info for frontend to create session
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // 🔐 BUG-P0-2 FIX: Specific error handling for auto-login
    if (errorMessage === 'AUTO_LOGIN_TOKEN_EXPIRED') {
      return NextResponse.json(
        { message: 'Auto-login link has expired. Please log in manually.' },
        { status: 401 }
      )
    }

    if (errorMessage === 'AUTO_LOGIN_TOKEN_ALREADY_USED') {
      return NextResponse.json(
        { message: 'Auto-login link has already been used. Please log in manually.' },
        { status: 401 }
      )
    }

    if (errorMessage === 'AUTO_LOGIN_TOKEN_CONSUMED_CONCURRENTLY') {
      return NextResponse.json(
        { message: 'Auto-login link is being processed. Please try again or log in manually.' },
        { status: 409 }
      )
    }

    if (errorMessage === 'AUTO_LOGIN_TOKEN_INVALID') {
      return NextResponse.json(
        { message: 'Invalid auto-login link' },
        { status: 401 }
      )
    }

    console.error('Auto-login error:', error)
    return NextResponse.json(
      { message: 'Server error' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { token, email, password, confirmPassword } = await request.json()

    // Validate inputs
    if (!token || !email || !password) {
      return NextResponse.json(
        { message: 'Token, email, and new password are required' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { message: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    if (confirmPassword && password !== confirmPassword) {
      return NextResponse.json(
        { message: 'Passwords do not match' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Find user by email
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    })

    if (!user) {
      return NextResponse.json(
        { message: 'Invalid or expired reset link' },
        { status: 400 }
      )
    }

    // Find valid reset token using atomic transaction (same pattern as registration)
    const verificationRecord = await db.$transaction(async (tx) => {
      const record = await tx.verificationToken.findFirst({
        where: {
          identifier: `reset-password:${user.id}`,
          token,
          expires: { gt: new Date() },
          used: false,
          useCount: 0,
        },
      })

      if (!record) {
        // Check if token exists but is expired or used
        const existingToken = await tx.verificationToken.findFirst({
          where: { identifier: `reset-password:${user.id}`, token },
        })

        if (existingToken) {
          if (existingToken.expires < new Date()) {
            throw new Error('RESET_LINK_EXPIRED')
          }
          if (existingToken.used || existingToken.useCount >= existingToken.maxUses) {
            throw new Error('RESET_LINK_ALREADY_USED')
          }
        }

        throw new Error('RESET_LINK_INVALID')
      }

      // Atomically mark token as used
      const updated = await tx.verificationToken.updateMany({
        where: {
          id: record.id,
          useCount: 0,
          used: false,
        },
        data: {
          used: true,
          useCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      })

      if (updated.count === 0) {
        throw new Error('RESET_LINK_CONSUMED')
      }

      return record
    })

    // Hash new password and update user
    const hashedPassword = await hashPassword(password)
    await db.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    })

    // Invalidate all other reset tokens for this user
    await db.verificationToken.updateMany({
      where: {
        identifier: `reset-password:${user.id}`,
        used: false,
      },
      data: { used: true },
    })

    if (process.env.NODE_ENV === 'development') {
      console.log(`[Reset Password] Password updated for user: ${normalizedEmail}`)
    }

    return NextResponse.json({
      message: 'Password has been reset successfully. You can now sign in with your new password.',
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    if (errorMessage === 'RESET_LINK_EXPIRED') {
      return NextResponse.json(
        { message: 'This reset link has expired. Please request a new one.' },
        { status: 400 }
      )
    }

    if (errorMessage === 'RESET_LINK_ALREADY_USED') {
      return NextResponse.json(
        { message: 'This reset link has already been used. Please request a new one.' },
        { status: 400 }
      )
    }

    if (errorMessage === 'RESET_LINK_CONSUMED') {
      return NextResponse.json(
        { message: 'This reset link is being processed. Please try again.' },
        { status: 409 }
      )
    }

    if (errorMessage === 'RESET_LINK_INVALID') {
      return NextResponse.json(
        { message: 'Invalid reset link. Please request a new one.' },
        { status: 400 }
      )
    }

    console.error('Reset password error:', error)
    return NextResponse.json(
      { message: 'An error occurred. Please try again.' },
      { status: 500 }
    )
  }
}

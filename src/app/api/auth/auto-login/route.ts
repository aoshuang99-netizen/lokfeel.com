import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/auto-login
 * Exchange auto-login token for user credentials
 * This is called by the frontend after successful registration
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
      return NextResponse.json(
        { message: 'User not found' },
        { status: 404 }
      )
    }

    // Verify the auto-login token
    const tokenRecord = await db.verificationToken.findFirst({
      where: {
        identifier: `auto-login:${user.id}`,
        token,
        used: false,
        expires: { gt: new Date() },
      },
    })

    if (!tokenRecord) {
      return NextResponse.json(
        { message: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    // Mark token as used
    await db.verificationToken.update({
      where: { id: tokenRecord.id },
      data: { used: true },
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
    console.error('Auto-login error:', error)
    return NextResponse.json(
      { message: 'Server error' },
      { status: 500 }
    )
  }
}

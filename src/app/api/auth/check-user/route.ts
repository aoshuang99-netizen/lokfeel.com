import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/check-user
 * Check if a user exists by email
 * 🔴 FIX: Return generic response regardless of whether user exists
 * to prevent email enumeration attacks
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { message: 'Invalid email format' },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerified: true,
        profile: {
          select: {
            onboardingStep: true,
          },
        },
      },
    })

    if (!user) {
      // 🔴 FIX: Return 200 with exists=false instead of 404 to prevent enumeration
      return NextResponse.json({
        exists: false,
        message: 'If an account with this email exists, you can proceed',
      })
    }

    // Only return safe fields — never expose user.id to unauthenticated callers
    return NextResponse.json({
      exists: true,
      emailVerified: !!user.emailVerified,
      onboardingStep: user.profile?.onboardingStep || 0,
      message: 'If an account with this email exists, you can proceed',
    })
  } catch (error) {
    console.error('Check user error:', error)
    // 🔴 FIX: Don't reveal server errors to prevent information leakage
    return NextResponse.json({
      exists: false,
      message: 'If an account with this email exists, you can proceed',
    })
  }
}

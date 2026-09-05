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

    // 🔴 FIX: Always return a generic response — never reveal whether the email is
    // registered (prevents unauthenticated account enumeration / scraping).
    return NextResponse.json({
      exists: false,
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

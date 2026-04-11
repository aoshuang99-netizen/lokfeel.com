import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { signIn } from '@/lib/auth/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/magic-link?token=xxx&email=xxx
 * Validates magic link token and auto-logs in the user
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')
    const email = searchParams.get('email')

    if (!token || !email) {
      return NextResponse.redirect(new URL('/login?error=invalid_magic_link', request.url))
    }

    // Find the verification token
    const verificationRecord = await db.verificationToken.findFirst({
      where: {
        identifier: email.toLowerCase(),
        token,
        used: false,
        expires: { gt: new Date() },
      },
    })

    if (!verificationRecord) {
      // Token invalid, expired, or already used
      return NextResponse.redirect(new URL('/login?error=expired_magic_link', request.url))
    }
    
    // Check if user exists (they might have already completed registration)
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { profile: true }
    })

    if (!user) {
      // User hasn't completed registration yet
      // Mark token as used and redirect to registration completion
      await db.verificationToken.update({
        where: { id: verificationRecord.id },
        data: { used: true },
      })
      
      // For now, redirect to login with a message
      // In the future, could redirect to a "complete registration" page
      return NextResponse.redirect(
        new URL(`/login?message=email_verified&email=${encodeURIComponent(email)}`, request.url)
      )
    }

    // User exists - mark email as verified and auto-login
    await Promise.all([
      db.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      }),
      db.verificationToken.update({
        where: { id: verificationRecord.id },
        data: { used: true },
      }),
    ])

    // Determine redirect based on onboarding status
    const onboardingStep = user.profile?.onboardingStep || 0
    const redirectUrl = onboardingStep >= 8 
      ? '/dashboard' 
      : '/dashboard/onboarding'

    // Create a session by redirecting with a special cookie
    // The actual sign-in happens via NextAuth credentials
    // We'll redirect to a client-side handler that calls signIn
    const callbackUrl = encodeURIComponent(redirectUrl)
    
    // Redirect to auto-login page that will handle the session creation
    return NextResponse.redirect(
      new URL(`/auth/auto-login?email=${encodeURIComponent(email)}&callbackUrl=${callbackUrl}`, request.url)
    )

  } catch (error) {
    console.error('Magic link error:', error)
    return NextResponse.redirect(new URL('/login?error=magic_link_failed', request.url))
  }
}

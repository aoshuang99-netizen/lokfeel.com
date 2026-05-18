import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateMagicToken, sendPasswordResetEmail } from '@/lib/email'
import { getRedis } from '@/lib/im/redis'

export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.lokfeel.com'

// Rate limit: max 3 requests per email per hour (Redis-backed, survives cold starts)
const MAX_ATTEMPTS = 3
const WINDOW_SECONDS = 3600 // 1 hour

function rateLimitKey(email: string): string {
  return `ratelimit:forgot-password:${email}`
}

async function checkRateLimit(email: string): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const redis = getRedis()
    const key = rateLimitKey(email)
    const current = await redis.incr(key)
    if (current === 1) {
      // First request — set TTL
      await redis.expire(key, WINDOW_SECONDS)
    }
    if (current > MAX_ATTEMPTS) {
      const ttl = await redis.ttl(key)
      return { allowed: false, remaining: ttl > 0 ? ttl : WINDOW_SECONDS }
    }
    return { allowed: true, remaining: MAX_ATTEMPTS - current }
  } catch {
    // Redis unavailable — allow request (fail open)
    return { allowed: true, remaining: MAX_ATTEMPTS }
  }
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { message: 'Please enter a valid email address' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Rate limiting (Redis-backed)
    const { allowed, remaining } = await checkRateLimit(normalizedEmail)
    if (!allowed) {
      return NextResponse.json(
        { message: `Too many reset requests. Please try again in ${Math.ceil(remaining / 60)} minutes.` },
        { status: 429 }
      )
    }

    // Find user — always return success message to prevent email enumeration
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, name: true, email: true },
    })

    // If user doesn't exist, still return success (prevent enumeration)
    if (!user) {
      console.log(`[Forgot Password] No account found for: ${normalizedEmail}`)
      return NextResponse.json({
        message: 'If an account with this email exists, we\'ve sent a reset link.',
        maskedEmail: normalizedEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3'),
      })
    }

    // Invalidate any existing reset tokens for this user
    await db.verificationToken.updateMany({
      where: {
        identifier: `reset-password:${user.id}`,
        used: false,
      },
      data: { used: true },
    })

    // Generate reset token (32-char random string)
    const resetToken = generateMagicToken()
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes

    await db.verificationToken.create({
      data: {
        identifier: `reset-password:${user.id}`,
        token: resetToken,
        expires: expiresAt,
        userId: user.id,
        maxUses: 1,
      },
    })

    // Build reset URL
    const resetUrl = `${APP_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(normalizedEmail)}`

    // Send reset email
    const result = await sendPasswordResetEmail(normalizedEmail, resetUrl, user.name || undefined)

    // Dev mode: return token for testing
    const isDev = !process.env.RESEND_API_KEY || !process.env.RESEND_API_KEY.startsWith('re_')
    if (!result.success && isDev) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`\n🔑 PASSWORD RESET LINK (dev mode)`)
        console.log(`   Email: ${normalizedEmail}`)
        console.log(`   Reset URL: ${resetUrl}`)
        console.log(`   Token: ${resetToken}`)
        console.log(`   Expires: ${expiresAt.toISOString()}\n`)
      }
    }

    return NextResponse.json({
      message: 'If an account with this email exists, we\'ve sent a reset link.',
      maskedEmail: normalizedEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3'),
      // Dev mode: include token and reset URL for testing
      ...(isDev && !result.success ? { devToken: resetToken, devResetUrl: resetUrl } : {}),
    })
  } catch (error) {
    console.error('Forgot password error:', error)
    return NextResponse.json(
      { message: 'An error occurred. Please try again.' },
      { status: 500 }
    )
  }
}

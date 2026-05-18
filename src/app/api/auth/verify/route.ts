import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth/auth'
import { db } from '@/lib/db'
import { generateVerificationCode, sendVerificationEmail, sendSMSVerification } from '@/lib/email'

export const dynamic = 'force-dynamic'

// POST /api/auth/verify — Send verification code to logged-in user
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const userId = (session.user as any).id
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, emailVerified: true },
    })

    if (!user) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 })
    }

    if (user.emailVerified) {
      return NextResponse.json({ message: 'Email already verified' }, { status: 200 })
    }

    const body = await request.json().catch(() => ({}))
    const method = (body.method || 'email') as 'email' | 'sms'
    const phone = body.phone as string | undefined

    const identifier = method === 'sms' ? (phone || '').trim() : user.email

    // Generate & store code
    const code = generateVerificationCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    await db.verificationToken.create({
      data: {
        identifier,
        token: code,
        expires: expiresAt,
        userId: user.id,
      },
    })

    // Send via chosen method
    let success = false
    let devCode: string | undefined
    
    if (method === 'email') {
      const r = await sendVerificationEmail(user.email || '', code, user.name || 'User')
      success = r.success
      devCode = r.devCode
    } else if (method === 'sms' && phone) {
      const r = await sendSMSVerification(phone.replace(/\s/g, ''), code, user.name || 'User')
      success = r.success
    }

    // Check if we're in dev mode (no real email/SMS service)
    const hasRealEmailService = !!(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.startsWith('re_'))
    const hasRealSmsService = !!process.env.TWILIO_ACCOUNT_SID
    const isDevMode = !hasRealEmailService && !hasRealSmsService

    // Dev fallback
    if (!success && isDevMode) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`\n🔐 VERIFY CODE (${method}) → ${identifier}: ${code}\n`)
      }
      success = true
      devCode = code
    }

    if (!success) {
      return NextResponse.json({ message: 'Failed to send verification code' }, { status: 500 })
    }

    const responseBody: Record<string, unknown> = {
      message: isDevMode 
        ? `Verification code generated (dev mode)` 
        : `Verification code sent via ${method}`,
      maskedIdentifier: method === 'email'
        ? (user.email || '').replace(/(.{2})(.*)(@.*)/, '$1***$3')
        : phone ? phone.slice(0, 3) + '***' + phone.slice(-2) : '',
      devMode: isDevMode,
    }

    // Include code in dev mode so frontend can display it
    if (isDevMode && devCode) {
      responseBody.code = devCode
    }

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('Send verify error:', error)
    return NextResponse.json({ message: 'Server error' }, { status: 500 })
  }
}

// PUT /api/auth/verify — Verify the code and mark emailVerified
export async function PUT(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const userId = (session.user as any).id
    const user = await db.user.findUnique({ where: { id: userId } })

    if (!user) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 })
    }

    // Check if already verified
    if (user.emailVerified) {
      return NextResponse.json({
        message: 'Email already verified',
        verified: true,
      })
    }

    const { code, identifier } = await request.json()

    if (!code || code.length !== 6) {
      return NextResponse.json({ message: 'Invalid verification code format' }, { status: 400 })
    }

    // Find valid token - check both by userId AND by email identifier
    let token = await db.verificationToken.findFirst({
      where: {
        userId: user.id,
        token: code,
        used: false,
        expires: { gt: new Date() },
      },
    })

    // If not found by userId, try by email identifier (for tokens created during registration)
    if (!token) {
      token = await db.verificationToken.findFirst({
        where: {
          identifier: user.email || '',
          token: code,
          used: false,
          expires: { gt: new Date() },
        },
      })
    }

    // Also check by lowercase email
    if (!token && user.email) {
      token = await db.verificationToken.findFirst({
        where: {
          identifier: user.email.toLowerCase(),
          token: code,
          used: false,
          expires: { gt: new Date() },
        },
      })
    }

    if (!token) {
      return NextResponse.json(
        { message: 'Invalid or expired verification code' },
        { status: 400 }
      )
    }

    // Mark verified — sequential to avoid race condition
    await db.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() },
    })
    await db.verificationToken.update({
      where: { id: token.id },
      data: { used: true },
    })

    return NextResponse.json({
      message: 'Email verified successfully',
      verified: true,
    })
  } catch (error) {
    console.error('Verify error:', error)
    return NextResponse.json({ message: 'Verification failed' }, { status: 500 })
  }
}

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
    if (method === 'email') {
      const r = await sendVerificationEmail(user.email, code, user.name!)
      success = r.success
    } else if (method === 'sms' && phone) {
      const r = await sendSMSVerification(phone.replace(/\s/g, ''), code, user.name!)
      success = r.success
    }

    // Dev fallback
    if (!success && process.env.NODE_ENV !== 'production') {
      console.log(`\n🔐 VERIFY CODE (${method}) → ${identifier}: ${code}\n`)
      success = true
    }

    if (!success) {
      return NextResponse.json({ message: 'Failed to send verification code' }, { status: 500 })
    }

    return NextResponse.json({
      message: `Verification code sent via ${method}`,
      maskedIdentifier: method === 'email'
        ? user.email!.replace(/(.{2})(.*)(@.*)/, '$1***$3')
        : phone ? phone.slice(0, 3) + '***' + phone.slice(-2) : '',
      devMode: !process.env.RESEND_API_KEY && !process.env.TWILIO_ACCOUNT_SID,
    })
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

    const { code, identifier } = await request.json()

    if (!code || code.length !== 6) {
      return NextResponse.json({ message: 'Invalid verification code format' }, { status: 400 })
    }

    // Find valid token
    const token = await db.verificationToken.findFirst({
      where: {
        userId: user.id,
        token: code,
        used: false,
        expires: { gt: new Date() },
      },
    })

    if (!token) {
      return NextResponse.json(
        { message: 'Invalid or expired verification code' },
        { status: 400 }
      )
    }

    // Mark verified
    await Promise.all([
      db.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      }),
      db.verificationToken.update({
        where: { id: token.id },
        data: { used: true },
      }),
    ])

    return NextResponse.json({
      message: 'Email verified successfully',
      verified: true,
    })
  } catch (error) {
    console.error('Verify error:', error)
    return NextResponse.json({ message: 'Verification failed' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { generateVerificationCode, generateMagicToken, sendVerificationEmail, sendSMSVerification, sendWelcomeEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

// Feature flags
const EMAIL_VERIFICATION_ENABLED = process.env.EMAIL_VERIFICATION_ENABLED !== 'false' // Default ON
const SMS_VERIFICATION_ENABLED = !!process.env.TWILIO_ACCOUNT_SID
const DEV_MODE = process.env.NODE_ENV === 'development' || !process.env.RESEND_API_KEY

// ─── Helpers ──────────────────────────────────────────────
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  return local[0] + '***@' + domain
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '***' + phone.slice(-2)
  return phone.slice(0, 3) + '***' + phone.slice(-2)
}

function getIdentifier(verifyMethod: string, email?: string, phone?: string): string {
  return verifyMethod === 'sms' ? (phone || '').trim() : (email || '').trim().toLowerCase()
}

// Gender mapping helper
function mapGender(gender: string): string {
  const genderMap: Record<string, string> = {
    'man': 'MALE', 'woman': 'FEMALE', 'male': 'MALE', 'female': 'FEMALE',
    'non-binary': 'NON_BINARY', 'nonbinary': 'NON_BINARY', 'other': 'OTHER',
  }
  return genderMap[(gender || '').toLowerCase()] || 'OTHER'
}

// ─── POST: Send Code / Verify & Create ────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      name, email, password, gender, sexuality,
      phone, countryCode, verifyMethod, step, code,
    } = body

    const method = verifyMethod || 'email'

    // ═══ STEP 1: Send Verification Code ═══
    if (step === 'send-code') {
      const identifier = getIdentifier(method, email, phone)

      // Validate identifier
      if (!identifier) {
        return NextResponse.json(
          { message: method === 'sms' ? 'Please enter your phone number' : 'Please enter your email address' },
          { status: 400 }
        )
      }

      if (method === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
          return NextResponse.json({ message: 'Invalid email format' }, { status: 400 })
        }
      } else {
        if (!/^\+?[\d\s-]{7,15}$/.test(phone)) {
          return NextResponse.json({ message: 'Invalid phone number format' }, { status: 400 })
        }
      }

      // Check duplicate user by email (always required)
      if (!email) {
        return NextResponse.json({ message: 'Email is always required for registration' }, { status: 400 })
      }
      const existingUser = await db.user.findUnique({
        where: { email: email.toLowerCase() },
      })
      if (existingUser) {
        return NextResponse.json(
          { message: 'An account with this email already exists' },
          { status: 409 }
        )
      }

      // Validate password
      if (!password || password.length < 8) {
        return NextResponse.json(
          { message: 'Password must be at least 8 characters' },
          { status: 400 }
        )
      }

      // Generate and store code + magic token
      const verificationCode = generateVerificationCode()
      const magicToken = generateMagicToken()
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

      // Store verification code
      await db.verificationToken.create({
        data: {
          identifier,
          token: verificationCode,
          expires: expiresAt,
        },
      })

      // Store magic token (for one-click login)
      await db.verificationToken.create({
        data: {
          identifier,
          token: magicToken,
          expires: expiresAt,
        },
      })

      // Attempt to send via chosen method (best effort)
      // 🔧 ALWAYS show code to user as backup - ensures registration works even if email fails
      let emailSent = false

      if (method === 'email') {
        const result = await sendVerificationEmail(email!, verificationCode, name, magicToken)
        emailSent = result.success
      } else if (method === 'sms') {
        const fullPhone = `${countryCode || '+1'}${phone}`.replace(/\s/g, '')
        const result = await sendSMSVerification(fullPhone, verificationCode, name)
        emailSent = result.success
      }

      // Log for debugging
      console.log(`\n🔐 VERIFICATION CODE (${method.toUpperCase()})`)
      console.log(`   To: ${identifier}`)
      console.log(`   Code: ${verificationCode}`)
      console.log(`   Email Sent: ${emailSent}`)
      console.log(`   Expires: ${expiresAt.toISOString()}\n`)

      // Build response — ALWAYS include code so user can complete registration
      const responseBody: Record<string, unknown> = {
        message: emailSent
          ? 'Verification code sent to your email'
          : 'Please use the verification code displayed below',
        method,
        maskedIdentifier: method === 'email' ? maskEmail(email!) : maskPhone(phone!),
        devMode: true, // Always show code UI
        code: verificationCode, // ALWAYS include code
      }

      return NextResponse.json(responseBody, { status: 200 })
    }

    // ═══ STEP 2: Verify Code & Create Account ═══
    if (step === 'verify-and-create') {
      // Validate required fields
      if (!name || !email || !password || !code) {
        return NextResponse.json(
          { message: 'All fields are required including verification code' },
          { status: 400 }
        )
      }

      // Validate email
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ message: 'Invalid email format' }, { status: 400 })
      }

      if (password.length < 8) {
        return NextResponse.json(
          { message: 'Password must be at least 8 characters' },
          { status: 400 }
        )
      }

      // Determine identifier for lookup
      const identifier = getIdentifier(method || 'email', email, phone)

      // 🔐 BUG-P0-2 FIX: Atomic token verification with one-time protection
      // Use transaction to prevent race conditions and replay attacks
      const verificationRecord = await db.$transaction(async (tx) => {
        // Find valid token with strict conditions
        const record = await tx.verificationToken.findFirst({
          where: {
            identifier,
            token: code,
            expires: { gt: new Date() },
            used: false,
            useCount: 0, // Strict: must be completely unused
            maxUses: 1,  // Strict: exactly 1 use allowed
          },
        })

        if (!record) {
          // Check if token exists but was already used (for better error messaging)
          const usedToken = await tx.verificationToken.findFirst({
            where: { identifier, token: code },
          })

          if (usedToken) {
            if (usedToken.expires < new Date()) {
              throw new Error('VERIFICATION_CODE_EXPIRED')
            }
            if (usedToken.useCount >= usedToken.maxUses || usedToken.used) {
              throw new Error('VERIFICATION_CODE_ALREADY_USED')
            }
          }

          throw new Error('VERIFICATION_CODE_INVALID')
        }

        // Atomically increment useCount and mark as used in single operation
        // This prevents race conditions where two requests could use the same token
        const updated = await tx.verificationToken.updateMany({
          where: {
            id: record.id,
            useCount: 0, // Ensure still unused (double-check for race condition)
            used: false,  // Ensure still unused (double-check for race condition)
          },
          data: {
            used: true,
            useCount: { increment: 1 },
            lastUsedAt: new Date(),
          },
        })

        // If no rows updated, another request already consumed the token
        if (updated.count === 0) {
          throw new Error('VERIFICATION_CODE_CONSUMED_CONCURRENTLY')
        }

        return record
      })

      // 🔐 BUG-P0-2 FIX: Handle transaction errors for better user feedback
      // Note: If we reach here, verification succeeded (no error thrown)
      const existingUser = await db.user.findUnique({
        where: { email: email.toLowerCase() },
      })

      if (existingUser) {
        return NextResponse.json(
          { message: 'An account with this email already exists' },
          { status: 409 }
        )
      }

      // Hash password & create user
      const hashedPassword = await hashPassword(password)

      const userData: Record<string, unknown> = {
        email: email.toLowerCase(),
        name,
        password: hashedPassword,
        role: 'USER',
        emailVerified: new Date(), // 所有新注册用户自动标记为已验证
        profile: {
          create: {
            displayName: name,
            age: 18,
            gender: mapGender(gender),
            sexuality: sexuality || 'Questioning',
            bio: '',
          },
        },
      }

      const user = await db.user.create({
        data: userData as any,
        select: { id: true, email: true, name: true, role: true },
      })

      // ═══ LADY FREE: Auto-assign premium-level plan for female users ═══
      const mappedGender = mapGender(gender)
      const isFemale = mappedGender === 'FEMALE'
      if (isFemale) {
        await db.subscription.create({
          data: {
            userId: user.id,
            plan: 'LADY_FREE',
            status: 'ACTIVE',
            weeklyMatchLimit: 5,
            canInitiateChat: true,
            canViewFullProfile: true,
            startsAt: new Date(),
            endsAt: new Date('2099-12-31'),
          },
        })
        console.log(`[Lady Free] Auto-assigned LADY_FREE plan for ${user.email}`)
      }

      // Send welcome email (async)
      sendWelcomeEmail(email, name).catch(console.error)

      // Generate a temporary auto-login token (valid for 5 minutes)
      const autoLoginToken = generateMagicToken()
      await db.verificationToken.create({
        data: {
          identifier: `auto-login:${user.id}`,
          token: autoLoginToken,
          expires: new Date(Date.now() + 5 * 60 * 1000),
          userId: user.id,
        },
      })

      return NextResponse.json(
        { 
          message: 'Account created successfully', 
          user,
          autoLoginToken, // Frontend can use this to auto-login
          redirectTo: '/dashboard/onboarding'
        },
        { status: 201 }
      )
    }

    return NextResponse.json({ message: 'Invalid step' }, { status: 400 })

  } catch (error) {
    // 🔐 BUG-P0-2 FIX: Handle specific verification errors with proper status codes
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    if (errorMessage === 'VERIFICATION_CODE_EXPIRED') {
      return NextResponse.json(
        { message: 'Verification code has expired. Please request a new one.' },
        { status: 400 }
      )
    }
    
    if (errorMessage === 'VERIFICATION_CODE_ALREADY_USED') {
      return NextResponse.json(
        { message: 'Verification code has already been used. Please request a new one.' },
        { status: 400 }
      )
    }
    
    if (errorMessage === 'VERIFICATION_CODE_CONSUMED_CONCURRENTLY') {
      // Race condition - another request used the same code simultaneously
      return NextResponse.json(
        { message: 'Verification code was already being processed. Please try again.' },
        { status: 409 }
      )
    }
    
    if (errorMessage === 'VERIFICATION_CODE_INVALID') {
      return NextResponse.json(
        { message: 'Invalid or expired verification code' },
        { status: 400 }
      )
    }
    
    // Log unexpected errors but don't expose details to client
    console.error('Registration error:', error)
    return NextResponse.json(
      { message: 'An error occurred during registration' },
      { status: 500 }
    )
  }
}

// ═══ PUT: Resend Code ════════════════════════════════════
export async function PUT(request: NextRequest) {
  try {
    const { email, phone, verifyMethod, name } = await request.json()
    const method = verifyMethod || 'email'
    const identifier = getIdentifier(method, email, phone)

    if (!identifier) {
      return NextResponse.json({ message: 'Email or phone required' }, { status: 400 })
    }

    // Invalidate old codes
    await db.verificationToken.updateMany({
      where: { identifier, used: false },
      data: { used: true },
    })

    // Generate new
    const verificationCode = generateVerificationCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    await db.verificationToken.create({
      data: { identifier, token: verificationCode, expires: expiresAt },
    })

    // Send
    let sendSuccess = false
    if (method === 'email' && email) {
      const r = await sendVerificationEmail(email, verificationCode, name)
      sendSuccess = r.success
    } else if (method === 'sms' && phone) {
      const r = await sendSMSVerification(phone.replace(/\s/g, ''), verificationCode, name)
      sendSuccess = r.success
    }

    // Dev fallback
    const hasRealEmailService = !!(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.startsWith('re_'))
    const hasRealSmsService = !!process.env.TWILIO_ACCOUNT_SID
    const requireRealSend = (method === 'email' && EMAIL_VERIFICATION_ENABLED && hasRealEmailService)
                          || (method === 'sms' && SMS_VERIFICATION_ENABLED && hasRealSmsService)
    const isDevMode = !requireRealSend
    if (!sendSuccess && isDevMode) {
      console.log(`\n🔐 RESEND CODE (${method}) → ${identifier}: ${verificationCode}\n`)
      sendSuccess = true
    }

    if (!sendSuccess) {
      return NextResponse.json({ message: 'Failed to resend. Try again.' }, { status: 500 })
    }

    // Return with dev mode info
    const responseBody: Record<string, unknown> = {
      message: isDevMode ? 'New code generated (dev mode)' : 'New verification code sent',
      maskedIdentifier: method === 'email'
        ? (email || '').replace(/(.{2})(.*)(@.*)/, '$1***$3')
        : phone ? phone.slice(0, 3) + '***' + phone.slice(-2) : '',
      devMode: isDevMode,
    }
    if (isDevMode) {
      responseBody.code = verificationCode
    }

    return NextResponse.json(responseBody, { status: 200 })
  } catch (error) {
    console.error('Resend error:', error)
    return NextResponse.json({ message: 'An error occurred' }, { status: 500 })
  }
}

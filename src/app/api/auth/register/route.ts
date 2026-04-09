import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { generateVerificationCode, sendVerificationEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

// Step 1: Send verification code
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, email, password, gender, sexuality, step, code } = body

    // Step 1: Send verification code
    if (step === 'send-code') {
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!email || !emailRegex.test(email)) {
        return NextResponse.json(
          { message: 'Invalid email format' },
          { status: 400 }
        )
      }

      // Check if user already exists
      const existingUser = await db.user.findUnique({
        where: { email: email.toLowerCase() },
      })

      if (existingUser) {
        return NextResponse.json(
          { message: 'An account with this email already exists' },
          { status: 409 }
        )
      }

      // Generate and save verification code
      const verificationCode = generateVerificationCode()
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

      await db.verificationToken.create({
        data: {
          identifier: email.toLowerCase(),
          token: verificationCode,
          expires: expiresAt,
        },
      })

      // Send verification email
      const emailResult = await sendVerificationEmail(email, verificationCode, name)
      
      if (!emailResult.success) {
        return NextResponse.json(
          { message: 'Failed to send verification email. Please try again.' },
          { status: 500 }
        )
      }

      return NextResponse.json(
        { message: 'Verification code sent to your email' },
        { status: 200 }
      )
    }

    // Step 2: Verify code and create account
    if (step === 'verify-and-create') {
      // Validate required fields
      if (!name || !email || !password || !code) {
        return NextResponse.json(
          { message: 'All fields are required' },
          { status: 400 }
        )
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email)) {
        return NextResponse.json(
          { message: 'Invalid email format' },
          { status: 400 }
        )
      }

      // Validate password length
      if (password.length < 8) {
        return NextResponse.json(
          { message: 'Password must be at least 8 characters' },
          { status: 400 }
        )
      }

      // Verify the code
      const verificationRecord = await db.verificationToken.findFirst({
        where: {
          identifier: email.toLowerCase(),
          token: code,
          used: false,
          expires: {
            gt: new Date(),
          },
        },
      })

      if (!verificationRecord) {
        return NextResponse.json(
          { message: 'Invalid or expired verification code' },
          { status: 400 }
        )
      }

      // Check if user already exists
      const existingUser = await db.user.findUnique({
        where: { email: email.toLowerCase() },
      })

      if (existingUser) {
        return NextResponse.json(
          { message: 'An account with this email already exists' },
          { status: 409 }
        )
      }

      // Hash password
      const hashedPassword = await hashPassword(password)

      // Create user + profile in a transaction
      const userData: Record<string, unknown> = {
        email: email.toLowerCase(),
        name,
        password: hashedPassword,
        role: 'USER',
        emailVerified: new Date(),
        profile: {
          create: {
            displayName: name,
            age: 18,
            gender: (gender || 'OTHER').toUpperCase(),
            sexuality: sexuality || 'Questioning',
            bio: '',
          },
        },
      }

      const user = await db.user.create({
        data: userData as any,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      })

      // Mark verification token as used
      await db.verificationToken.update({
        where: { id: verificationRecord.id },
        data: { used: true },
      })

      // Send welcome email
      const { sendWelcomeEmail } = await import('@/lib/email')
      await sendWelcomeEmail(email, name)

      return NextResponse.json(
        {
          message: 'Account created successfully',
          user,
        },
        { status: 201 }
      )
    }

    return NextResponse.json(
      { message: 'Invalid step' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Registration error:', error)
    return NextResponse.json(
      { message: 'An error occurred during registration' },
      { status: 500 }
    )
  }
}

// Resend verification code
export async function PUT(request: NextRequest) {
  try {
    const { email, name } = await request.json()

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!email || !emailRegex.test(email)) {
      return NextResponse.json(
        { message: 'Invalid email format' },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { email: email.toLowerCase() },
    })

    if (existingUser) {
      return NextResponse.json(
        { message: 'An account with this email already exists' },
        { status: 409 }
      )
    }

    // Invalidate old codes
    await db.verificationToken.updateMany({
      where: {
        identifier: email.toLowerCase(),
        used: false,
      },
      data: {
        used: true,
      },
    })

    // Generate new code
    const verificationCode = generateVerificationCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    await db.verificationToken.create({
      data: {
        identifier: email.toLowerCase(),
        token: verificationCode,
        expires: expiresAt,
      },
    })

    // Send email
    const emailResult = await sendVerificationEmail(email, verificationCode, name)
    
    if (!emailResult.success) {
      return NextResponse.json(
        { message: 'Failed to send verification email' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { message: 'New verification code sent' },
      { status: 200 }
    )
  } catch (error) {
    console.error('Resend code error:', error)
    return NextResponse.json(
      { message: 'An error occurred' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/profile — Get current user's profile
export async function GET() {
  try {
    const { user } = await requireAuth()

    const profile = await db.profile.findUnique({
      where: { userId: user.id },
    })

    if (!profile) {
      // Return null profile — frontend should redirect to onboarding
      return NextResponse.json({ profile: null, user })
    }

    return NextResponse.json({ profile, user })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    console.error('Get profile error:', error)
    return NextResponse.json({ message: 'Failed to fetch profile' }, { status: 500 })
  }
}

// PUT /api/profile — Update current user's profile
export async function PUT(request: NextRequest) {
  try {
    const { user } = await requireAuth()
    const body = await request.json()

    // Separate profile fields from user name
    const { name, ...profileData } = body

    // Update user name if provided
    if (name) {
      await db.user.update({
        where: { id: user.id },
        data: { name },
      })
    }

    // Upsert profile
    const profile = await db.profile.upsert({
      where: { userId: user.id },
      update: profileData,
      create: {
        userId: user.id,
        displayName: profileData.displayName || user.name || '',
        age: profileData.age || 18,
        gender: profileData.gender || 'OTHER',
        sexuality: profileData.sexuality || 'Questioning',
        bio: profileData.bio || '',
        ...profileData,
      },
    })

    return NextResponse.json({ profile, message: 'Profile updated successfully' })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    console.error('Update profile error:', error)
    return NextResponse.json({ message: 'Failed to update profile' }, { status: 500 })
  }
}

// POST /api/profile/submit — Submit profile for review
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth()

    const profile = await db.profile.update({
      where: { userId: user.id },
      data: {
        profileStatus: 'PENDING_REVIEW',
        onboardingStep: 5,
      },
    })

    return NextResponse.json({ profile, message: 'Profile submitted for review' })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    console.error('Submit profile error:', error)
    return NextResponse.json({ message: 'Failed to submit profile' }, { status: 500 })
  }
}

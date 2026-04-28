import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/profile — Get current user's profile
export async function GET() {
  try {
    const { user } = await requireAuth()

    // Get full user data including emailVerified
    const fullUser = await db.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        emailVerified: true,
        cardVerified: true,
      },
    })

    const profile = await db.profile.findUnique({
      where: { userId: user.id },
    })

    if (!profile) {
      // Return null profile — frontend should redirect to onboarding
      return NextResponse.json({ 
        profile: null, 
        user: fullUser,
        emailVerified: fullUser?.emailVerified !== null 
      })
    }

    return NextResponse.json({ 
      profile, 
      user: fullUser,
      emailVerified: fullUser?.emailVerified !== null 
    })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    console.error('Get profile error:', error)
    return NextResponse.json({ message: 'Failed to fetch profile' }, { status: 500 })
  }
}

// Prisma Profile schema fields whitelist — only these can be written via API
const PROFILE_WRITABLE_FIELDS = new Set([
  // Basic Info
  'displayName', 'age', 'gender', 'genderIdentity', 'sexuality', 'bio',
  'avatar', 'avatarType', 'galleryPhotos', 'city', 'country',
  // Relationship Blueprint
  'relationshipGoal', 'attachmentStyle', 'communicationStyle', 'conflictResolution',
  'loveLanguage', 'boundaries', 'dealbreakers', 'lifePriorities', 'emotionalAvailability',
  // Preference Tags
  'selectedTags',
  // Matching Preferences
  'preferredAgeMin', 'preferredAgeMax', 'preferredGender', 'preferredDistance', 'preferredLocation',
  // Status
  'profileStatus', 'onboardingStep', 'isApproved', 'isVerified',
  // Professional
  'occupation', 'company', 'industry', 'linkedInVerified', 'verificationBadge',
  // Personality data
  'personalityData', 'adminNotes',
])

function filterProfileFields(data: Record<string, any>): Record<string, any> {
  const filtered: Record<string, any> = {}
  for (const key of Object.keys(data)) {
    if (PROFILE_WRITABLE_FIELDS.has(key)) {
      filtered[key] = data[key]
    }
  }
  return filtered
}

// PUT /api/profile — Update current user's profile
export async function PUT(request: NextRequest) {
  try {
    const { user } = await requireAuth()
    const body = await request.json()

    // Separate profile fields from user name
    const { name, ...rawProfileData } = body

    // CRITICAL: Filter to only known Prisma fields — unknown fields cause PrismaClientValidationError
    const profileData = filterProfileFields(rawProfileData)

    // Log dropped fields for debugging
    const droppedFields = Object.keys(rawProfileData).filter(k => !PROFILE_WRITABLE_FIELDS.has(k) && k !== 'name')
    if (droppedFields.length > 0) {
      console.warn(`[Profile PUT] Dropped unknown fields: ${droppedFields.join(', ')} for user ${user.id}`)
    }

    // Log payload size for debugging large avatar uploads
    const avatarLen = typeof profileData.avatar === 'string' ? profileData.avatar.length : 0
    if (avatarLen > 50000) {
      console.log(`[Profile PUT] Large avatar payload: ${(avatarLen / 1024).toFixed(1)}KB for user ${user.id}`)
    }

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
    // Log full error for debugging
    console.error('[Profile PUT] Update error:', error.message || error.code || 'unknown', error)
    
    // Return specific error messages for known Prisma errors
    if (error.code === 'P2002') {
      return NextResponse.json({ message: 'A profile already exists for this user' }, { status: 409 })
    }
    if (error.code === 'P2025') {
      return NextResponse.json({ message: 'Record not found' }, { status: 404 })
    }
    
    return NextResponse.json({ 
      message: 'Failed to update profile',
      error: process.env.NODE_ENV === 'development' ? (error.message || 'Unknown error') : undefined
    }, { status: 500 })
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

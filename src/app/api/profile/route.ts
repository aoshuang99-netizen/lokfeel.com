import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { toJson, jsonArr } from '@/lib/json-helpers'
import { handleApiError } from '@/lib/api-handler'
import { ApiError } from '@/lib/errors'

export const dynamic = 'force-dynamic'

// GET /api/profile — Get current user's profile
export async function GET() {
  return handleApiError(async () => {
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
      select: {
        id: true, userId: true, displayName: true, age: true, avatar: true, avatarType: true,
        gender: true, genderIdentity: true, sexuality: true, bio: true,
        city: true, country: true, occupation: true, company: true, industry: true,
        relationshipGoal: true, attachmentStyle: true, communicationStyle: true,
        conflictResolution: true, loveLanguage: true, lifePriorities: true,
        boundaries: true, dealbreakers: true, emotionalAvailability: true,
        preferredAgeMin: true, preferredAgeMax: true, preferredGender: true,
        preferredDistance: true, preferredLocation: true, profileStatus: true,
        onboardingStep: true, selectedTags: true, compatibilityScore: true,
        linkedInVerified: true, verificationBadge: true, isVerified: true,
        galleryPhotos: true,
        domSubRole: true, preferredRole: true, kinkExperienceLevel: true,
        createdAt: true, updatedAt: true,
      },
    })

    if (!profile) {
      // Return null profile — frontend should redirect to onboarding
      const res = NextResponse.json({
        profile: null,
        user: fullUser,
        emailVerified: fullUser?.emailVerified !== null
      });
      res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
      return res;
    }

    const res = NextResponse.json({
      profile,
      user: fullUser,
      emailVerified: fullUser?.emailVerified !== null
    });
    res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
    return res;
  })
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
  // Phase B: Kink & Power Dynamics
  'domSubRole', 'preferredRole', 'kinkExperienceLevel', 'kinkInterests', 'hardLimits',
])

function filterProfileFields(data: Record<string, any>): Record<string, any> {
  const filtered: Record<string, any> = {}
  // Fields that are JSON-serialized arrays in SQLite (were String[] in PostgreSQL)
  const JSON_ARRAY_FIELDS = new Set(['selectedTags', 'galleryPhotos', 'interests', 'hobbies', 'musicGenres', 'movieGenres', 'preferredEthnicities', 'preferredOccupations', 'preferredEducation', 'kinkInterests', 'hardLimits'])
  for (const key of Object.keys(data)) {
    if (PROFILE_WRITABLE_FIELDS.has(key)) {
      // Serialize array fields to JSON strings for SQLite
      if (JSON_ARRAY_FIELDS.has(key) && Array.isArray(data[key])) {
        filtered[key] = toJson(data[key])
      } else {
        filtered[key] = data[key]
      }
    }
  }
  // Normalize preferredGender to uppercase for consistent matching
  if (filtered.preferredGender) {
    filtered.preferredGender = filtered.preferredGender.toUpperCase();
  }
  // Normalize gender enum to uppercase (Phase B: expanded Gender enum)
  if (filtered.gender && typeof filtered.gender === 'string') {
    filtered.gender = filtered.gender.toUpperCase();
  }
  return filtered
}

// PUT /api/profile — Update current user's profile
export async function PUT(request: NextRequest) {
  return handleApiError(async () => {
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

    // Upsert profile — handle Prisma-specific errors
    try {
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
      if (error.code === 'P2002') {
        return NextResponse.json({ message: 'A profile already exists for this user' }, { status: 409 })
      }
      if (error.code === 'P2025') {
        return NextResponse.json({ message: 'Record not found' }, { status: 404 })
      }
      throw error // Re-throw for handleApiError
    }
  })
}

// POST /api/profile/submit — Submit profile for review
export async function POST(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth()

    // Validate profile has required fields before submission
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
      select: { displayName: true, gender: true, bio: true, onboardingStep: true },
    })

    if (!profile) {
      return NextResponse.json({ message: 'Profile not found. Complete onboarding first.' }, { status: 404 })
    }

    const missingFields: string[] = []
    if (!profile.displayName) missingFields.push('displayName')
    if (!profile.gender) missingFields.push('gender')
    if (!profile.bio) missingFields.push('bio')

    if (missingFields.length > 0) {
      return NextResponse.json(
        { message: `Missing required fields: ${missingFields.join(', ')}` },
        { status: 400 }
      )
    }

    const updatedProfile = await db.profile.update({
      where: { userId: user.id },
      data: {
        profileStatus: 'PENDING_REVIEW',
        onboardingStep: 5, // Completion step (STEPS.length - 1 in onboarding UI)
      },
    })

    return NextResponse.json({ profile: updatedProfile, message: 'Profile submitted for review' })
  })
}

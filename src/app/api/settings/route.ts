import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth/auth'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { jsonArr, toJson } from '@/lib/json-helpers'

export const dynamic = 'force-dynamic'

// 可用标签配置
export const AVAILABLE_TAGS = [
  // 关系类型
  { id: 'MONOGAMY', label: 'Monogamy', category: 'relationship', icon: 'Heart' },
  { id: 'ETHICAL_NON_MONOGAMY', label: 'Ethical Non-Monogamy', category: 'relationship', icon: 'Users' },
  { id: 'POLYAMORY', label: 'Polyamory', category: 'relationship', icon: 'GitBranch' },
  { id: 'KINK_BDSM', label: 'Kink/BDSM', category: 'relationship', icon: 'Zap' },
  { id: 'CASUAL_DATING', label: 'Casual Dating', category: 'relationship', icon: 'Coffee' },
  { id: 'FRIENDSHIP_FIRST', label: 'Friendship First', category: 'relationship', icon: 'UserPlus' },
  // 性取向
  { id: 'STRAIGHT', label: 'Straight', category: 'orientation', icon: 'ArrowRight' },
  { id: 'GAY', label: 'Gay', category: 'orientation', icon: 'Rainbow' },
  { id: 'LESBIAN', label: 'Lesbian', category: 'orientation', icon: 'Heart' },
  { id: 'BISEXUAL', label: 'Bisexual', category: 'orientation', icon: 'GitMerge' },
  { id: 'PANSEXUAL', label: 'Pansexual', category: 'orientation', icon: 'Infinity' },
  { id: 'QUEER', label: 'Queer', category: 'orientation', icon: 'Sparkles' },
  { id: 'ASEXUAL', label: 'Asexual', category: 'orientation', icon: 'Circle' },
  { id: 'DEMISEXUAL', label: 'Demisexual', category: 'orientation', icon: 'Shield' },
  // 兴趣标签
  { id: 'TRAVEL', label: 'Travel', category: 'interest', icon: 'Plane' },
  { id: 'FITNESS', label: 'Fitness', category: 'interest', icon: 'Dumbbell' },
  { id: 'ART', label: 'Art', category: 'interest', icon: 'Palette' },
  { id: 'MUSIC', label: 'Music', category: 'interest', icon: 'Music' },
  { id: 'FOOD', label: 'Food', category: 'interest', icon: 'Utensils' },
  { id: 'TECH', label: 'Tech', category: 'interest', icon: 'Cpu' },
  { id: 'READING', label: 'Reading', category: 'interest', icon: 'Book' },
  { id: 'GAMING', label: 'Gaming', category: 'interest', icon: 'Gamepad2' },
  { id: 'OUTDOORS', label: 'Outdoors', category: 'interest', icon: 'Mountain' },
  { id: 'PHOTOGRAPHY', label: 'Photography', category: 'interest', icon: 'Camera' },
] as const

// GET /api/settings — Get current user settings
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const [user, profile] = await Promise.all([
      db.user.findUnique({
        where: { id: session.user.id },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          role: true,
          createdAt: true,
        },
      }),
      db.profile.findUnique({
        where: { userId: session.user.id },
        select: {
          displayName: true,
          avatar: true,
          bio: true,
          city: true,
          country: true,
          age: true,
          gender: true,
          sexuality: true,
          relationshipGoal: true,
          attachmentStyle: true,
          communicationStyle: true,
          conflictResolution: true,
          loveLanguage: true,
          lifePriorities: true,
          emotionalAvailability: true,
          boundaries: true,
          dealbreakers: true,
          preferredAgeMin: true,
          preferredAgeMax: true,
          preferredGender: true,
          preferredDistance: true,
          selectedTags: true,
          galleryPhotos: true,
          profileStatus: true,
          onboardingStep: true,
          linkedInVerified: true,
          verificationBadge: true,
          occupation: true,
          company: true,
          industry: true,
        },
      }),
    ])

    if (!user) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      user,
      profile: {
        ...profile,
        selectedTags: jsonArr(profile?.selectedTags),
        galleryPhotos: jsonArr(profile?.galleryPhotos),
      },
      availableTags: AVAILABLE_TAGS,
    })
  } catch (error: any) {
    console.error('[API] Get settings error:', error)
    return NextResponse.json(
      { message: 'Failed to fetch settings' },
      { status: 500 }
    )
  }
}

// PUT /api/settings — Update user settings
export async function PUT(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      // Account settings
      name,
      currentPassword,
      newPassword,
      // Profile settings
      displayName,
      bio,
      city,
      country,
      age,
      gender,
      sexuality,
      // Matching preferences
      relationshipGoal,
      attachmentStyle,
      communicationStyle,
      conflictResolution,
      loveLanguage,
      lifePriorities,
      emotionalAvailability,
      boundaries,
      dealbreakers,
      preferredAgeMin,
      preferredAgeMax,
      preferredGender,
      preferredDistance,
      // Tags (最多5个)
      selectedTags,
      // Professional info
      occupation,
      company,
      industry,
      // Notification settings
      emailNotifications,
      pushNotifications,
      matchNotifications,
      messageNotifications,
      marketingEmails,
      // Privacy settings
      profileVisibility,
      showOnlineStatus,
      readReceipts,
      showDistance,
    } = body

    // Validate tags (最多5个)
    if (selectedTags !== undefined) {
      if (!Array.isArray(selectedTags)) {
        return NextResponse.json(
          { message: 'selectedTags must be an array' },
          { status: 400 }
        )
      }
      if (selectedTags.length > 5) {
        return NextResponse.json(
          { message: 'You can select up to 5 tags only' },
          { status: 400 }
        )
      }
      // Validate tag IDs
      const validTagIds = AVAILABLE_TAGS.map(t => t.id)
      const invalidTags = selectedTags.filter((tag: string) => !(validTagIds as string[]).includes(tag))
      if (invalidTags.length > 0) {
        return NextResponse.json(
          { message: `Invalid tags: ${invalidTags.join(', ')}` },
          { status: 400 }
        )
      }
    }

    // Update user name if provided
    if (name !== undefined) {
      await db.user.update({
        where: { id: session.user.id },
        data: { name },
      })
    }

    // Change password if provided
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json(
          { message: 'Current password is required to set a new password' },
          { status: 400 }
        )
      }

      const fullUser = await db.user.findUnique({
        where: { id: session.user.id },
      })

      if (!fullUser?.password) {
        return NextResponse.json(
          { message: 'Cannot change password for OAuth accounts' },
          { status: 400 }
        )
      }

      const bcrypt = await import('bcryptjs')
      const isValid = await bcrypt.compare(currentPassword, fullUser.password)

      if (!isValid) {
        return NextResponse.json(
          { message: 'Current password is incorrect' },
          { status: 401 }
        )
      }

      if (newPassword.length < 8) {
        return NextResponse.json(
          { message: 'New password must be at least 8 characters' },
          { status: 400 }
        )
      }

      const hashedPassword = await hashPassword(newPassword)
      await db.user.update({
        where: { id: session.user.id },
        data: { password: hashedPassword },
      })
    }

    // Update profile if any profile fields provided
    const profileUpdateData: any = {}
    
    if (displayName !== undefined) profileUpdateData.displayName = displayName
    if (bio !== undefined) profileUpdateData.bio = bio
    if (city !== undefined) profileUpdateData.city = city
    if (country !== undefined) profileUpdateData.country = country
    if (age !== undefined) profileUpdateData.age = age
    if (gender !== undefined) profileUpdateData.gender = gender
    if (sexuality !== undefined) profileUpdateData.sexuality = sexuality
    if (relationshipGoal !== undefined) profileUpdateData.relationshipGoal = relationshipGoal
    if (attachmentStyle !== undefined) profileUpdateData.attachmentStyle = attachmentStyle
    if (communicationStyle !== undefined) profileUpdateData.communicationStyle = communicationStyle
    if (conflictResolution !== undefined) profileUpdateData.conflictResolution = conflictResolution
    if (loveLanguage !== undefined) profileUpdateData.loveLanguage = loveLanguage
    if (lifePriorities !== undefined) profileUpdateData.lifePriorities = JSON.stringify(lifePriorities)
    if (emotionalAvailability !== undefined) profileUpdateData.emotionalAvailability = emotionalAvailability
    if (boundaries !== undefined) profileUpdateData.boundaries = JSON.stringify(boundaries)
    if (dealbreakers !== undefined) profileUpdateData.dealbreakers = JSON.stringify(dealbreakers)
    if (preferredAgeMin !== undefined) profileUpdateData.preferredAgeMin = preferredAgeMin
    if (preferredAgeMax !== undefined) profileUpdateData.preferredAgeMax = preferredAgeMax
    if (preferredGender !== undefined) profileUpdateData.preferredGender = preferredGender.toUpperCase()
    if (preferredDistance !== undefined) profileUpdateData.preferredDistance = preferredDistance
    if (selectedTags !== undefined) profileUpdateData.selectedTags = toJson(selectedTags)
    if (occupation !== undefined) profileUpdateData.occupation = occupation
    if (company !== undefined) profileUpdateData.company = company
    if (industry !== undefined) profileUpdateData.industry = industry

    // Only update profile if there are fields to update
    if (Object.keys(profileUpdateData).length > 0) {
      await db.profile.update({
        where: { userId: session.user.id },
        data: profileUpdateData,
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Settings updated successfully',
    })
  } catch (error: any) {
    console.error('[API] Update settings error:', error)
    return NextResponse.json(
      { message: error.message || 'Failed to update settings' },
      { status: 500 }
    )
  }
}

// DELETE /api/settings — Delete user account
export async function DELETE() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    // Delete user and all related data (CASCADE)
    await db.user.delete({
      where: { id: session.user.id },
    })

    return NextResponse.json({
      success: true,
      message: 'Account deleted successfully',
    })
  } catch (error: any) {
    console.error('[API] Delete account error:', error)
    return NextResponse.json(
      { message: 'Failed to delete account' },
      { status: 500 }
    )
  }
}

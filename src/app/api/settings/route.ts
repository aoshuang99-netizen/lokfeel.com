import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { jsonArr, toJson } from '@/lib/json-helpers'
import { AVAILABLE_TAGS } from '@/constants'
import { cache } from '@/lib/cache'

export const dynamic = 'force-dynamic'

// GET /api/settings — Get current user settings (cached 300s)
export async function GET() {
  try {
    const { user } = await requireAuth()
    if (!user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const data = await cache.get(
      `settings:${user.id}`,
      async () => {
        const [fullUser, profile] = await Promise.all([
          db.user.findUnique({
            where: { id: user.id },
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
            where: { userId: user.id },
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

        if (!fullUser) return null

        return {
          success: true,
          user: fullUser,
          profile: {
            ...profile,
            selectedTags: jsonArr(profile?.selectedTags),
            galleryPhotos: jsonArr(profile?.galleryPhotos),
          },
          availableTags: AVAILABLE_TAGS,
        }
      },
      300 // 300s TTL
    )

    if (!data) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 })
    }

    const res = NextResponse.json(data)
    // Cache-Control: private (user-specific), max-age matches Redis TTL (300s),
    // stale-while-revalidate allows serving stale while refreshing in background
    res.headers.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600')
    return res
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
    const { user } = await requireAuth()
    if (!user?.id) {
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
        where: { id: user.id },
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
        where: { id: user.id },
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
        where: { id: user.id },
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
        where: { userId: user.id },
        data: profileUpdateData,
      })
    }

    // Invalidate cache for this user
    await Promise.all([
      cache.invalidate(`settings:${user.id}`),
      cache.invalidate(`discover:profile:${user.id}`),
    ])

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

// DELETE /api/settings — Delete user account (requires password confirmation)
export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireAuth()
    if (!user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    // Require password confirmation for account deletion
    let body: Record<string, any> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { message: 'Request body with password confirmation is required' },
        { status: 400 }
      );
    }

    const { password } = body;
    if (!password) {
      return NextResponse.json(
        { message: 'Password confirmation is required to delete your account' },
        { status: 400 }
      );
    }

    // Verify password
    const fullUser = await db.user.findUnique({
      where: { id: user.id },
    });

    if (!fullUser?.password) {
      return NextResponse.json(
        { message: 'Cannot delete OAuth-only account from this endpoint. Please contact support.' },
        { status: 400 }
      );
    }

    const bcrypt = await import('bcryptjs');
    const isValid = await bcrypt.compare(password, fullUser.password);
    if (!isValid) {
      return NextResponse.json(
        { message: 'Incorrect password' },
        { status: 401 }
      );
    }

    // Delete user and all related data (CASCADE)
    await db.user.delete({
      where: { id: user.id },
    })

    // Clear all cached data for deleted user
    await cache.invalidateByPrefix(`settings:${user.id}`);
    await cache.invalidateByPrefix(`discover:${user.id}`);
    await cache.invalidateByPrefix(`who-liked-me:${user.id}`);

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

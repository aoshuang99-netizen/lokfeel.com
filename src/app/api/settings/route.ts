import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, hashPassword } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/settings — Get current user settings (profile + preferences)
export async function GET() {
  try {
    const { user } = await requireAuth()

    const fullUser = await db.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        createdAt: true,
      },
    })

    const profile = await db.profile.findUnique({
      where: { userId: user.id },
      select: {
        displayName: true,
        avatar: true,
        bio: true,
        city: true,
        country: true,
      },
    })

    return NextResponse.json({ user: fullUser, profile })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    console.error('Get settings error:', error)
    return NextResponse.json({ message: 'Failed to fetch settings' }, { status: 500 })
  }
}

// PUT /api/settings — Update user settings
export async function PUT(request: NextRequest) {
  try {
    const { user } = await requireAuth()
    const body = await request.json()

    const { name, currentPassword, newPassword } = body

    // Update name
    if (name) {
      await db.user.update({
        where: { id: user.id },
        data: { name },
      })
    }

    // Change password
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json(
          { message: 'Current password is required to set a new password' },
          { status: 400 }
        )
      }

      // Get current user with password
      const fullUser = await db.user.findUnique({
        where: { id: user.id },
      })

      // Verify current password
      const bcrypt = await import('bcryptjs')
      const isValid = await bcrypt.compare(currentPassword, (fullUser as any).password)

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
      await (db.user.update({
        where: { id: user.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { password: hashedPassword } as any,
      }))
    }

    return NextResponse.json({ message: 'Settings updated successfully' })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    console.error('Update settings error:', error)
    return NextResponse.json({ message: 'Failed to update settings' }, { status: 500 })
  }
}

// DELETE /api/settings — Delete user account
export async function DELETE() {
  try {
    const { user } = await requireAuth()

    // Delete user and all related data (CASCADE)
    await db.user.delete({
      where: { id: user.id },
    })

    return NextResponse.json({ message: 'Account deleted successfully' })
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    console.error('Delete account error:', error)
    return NextResponse.json({ message: 'Failed to delete account' }, { status: 500 })
  }
}

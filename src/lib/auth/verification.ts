/**
 * Verification Gate — Controls access based on email/SMS verification status
 *
 * Rules:
 * - READ operations (GET): Always allowed (browse mode)
 * - WRITE operations (POST/PUT/DELETE): Require verification
 * - OAuth users with null emailVerified: Can browse, must verify to act
 * - Credentials users: Auto-verified on registration (emailVerified = now)
 */

import { auth } from './auth'
import { db } from '@/lib/db'

export interface VerifiedUser {
  id: string
  email: string
  name: string | null
  image: string | null
  role: string
  isVerified: boolean // emailVerified !== null
}

/**
 * Get current user + verification status.
 * Does NOT throw if unverified — just marks isVerified: false.
 */
export async function getVerifiedUser(): Promise<VerifiedUser | null> {
  const session = await auth()

  if (!session?.user) return null

  const userId = (session.user as any).id
  if (!userId) return null

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      emailVerified: true,
    },
  })

  if (!user) return null

  return {
    ...user,
    isVerified: user.emailVerified !== null,
  }
}

/**
 * Require verification for write operations.
 * Throws if not authenticated OR not verified.
 * Returns verified user info.
 */
export async function requireVerifiedUser(): Promise<{ user: VerifiedUser; session: any }> {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const userId = (session.user as any).id
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      emailVerified: true,
    },
  })

  if (!user) throw new Error('User not found')

  const verifiedUser: VerifiedUser = {
    ...user,
    isVerified: user.emailVerified !== null,
  }

  if (!verifiedUser.isVerified) {
    throw new Error('EMAIL_NOT_VERIFIED')
  }

  return { user: verifiedUser, session }
}

/**
 * Standard error response for verification-gated endpoints
 */
export function verificationErrorResponse(message?: string) {
  return {
    requiresVerification: true,
    message: message || 'Please verify your email address to use this feature.',
    action: 'verify_email',
  }
}

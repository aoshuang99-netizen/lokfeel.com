import { compare, hash } from 'bcryptjs'
import NextAuth from 'next-auth'
import { authConfig } from './config'
import { db } from '@/lib/db'
import { redisCache } from '@/lib/redis-cache'
import { redirect } from 'next/navigation'
import { UserRole } from "@/generated/client"
import { UnauthorizedError, ForbiddenError } from '@/lib/errors'

// Create NextAuth handler
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)

/**
 * Hash a password for secure storage
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12)
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return compare(password, hashedPassword)
}

/**
 * Require authentication for API routes.
 * Returns user info or throws.
 * Guest sessions are rejected with a specific error.
 */
export async function requireAuth() {
  const session = await auth()
  
  if (!session?.user) {
    throw new UnauthorizedError('Unauthorized')
  }

  // Guest sessions: reject API write operations
  if ((session.user as any).guest === true) {
    throw new UnauthorizedError('Guest sessions cannot perform this action. Please log in.')
  }
  
  const userId = (session.user as any).id
  if (!userId) {
    throw new UnauthorizedError('Unauthorized')
  }

  // ✅ PERF (T01): Cache the per-request user lookup for a short TTL so we don't
  // hit the DB on every authenticated API request. The JWT session is still
  // validated above on every call (auth()); this only caches the existence +
  // profile fields we return. Safe under concurrency: redisCache.get is
  // read-through and only runs fn() on a miss — concurrent misses just do
  // duplicate reads, never return incorrect data.
  const user = await redisCache.get(
    `auth:user:${userId}`,
    () =>
      db.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, role: true, image: true, tokenVersion: true },
      }),
    60 // short TTL (60s) — keeps role/name fresh while cutting DB load
  )
  
  if (!user) {
    throw new UnauthorizedError('User not found')
  }

  // Session invalidation: reject JWTs issued before the user's tokenVersion advanced
  // (e.g. after a password change/reset), so a stolen or old session cannot outlive it.
  const jwtVersion = (session.user as any).tokenVersion
  if (typeof jwtVersion === 'number' && user.tokenVersion !== jwtVersion) {
    throw new UnauthorizedError('Session expired. Please sign in again.')
  }

  return { user, session }
}

/**
 * Require admin role. Throws if not admin.
 */
export async function requireAdminAuth() {
  const { user, session } = await requireAuth()
  
  if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Forbidden: Admin access required')
  }
  
  return { user, session }
}

/**
 * Get the current authenticated user from the session
 * Returns null for guest sessions
 */
export async function getCurrentUser() {
  const session = await auth()
  
  if (!session?.user) return null

  // Guest session: return minimal guest object (read-only)
  if ((session.user as any).guest === true) {
    return {
      id: (session.user as any).id,
      email: null,
      name: "Guest",
      role: "USER",
      image: null,
      isGuest: true,
    }
  }
  
  const userId = (session.user as any).id
  if (!userId) return null
  
  return db.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      subscriptions: true,
      _count: {
        select: {
          sentMatches: true,
          receivedMatches: true,
          messages: true,
        },
      },
    },
  })
}

/**
 * Get the current session
 */
export async function getSession() {
  return auth()
}

/**
 * Check if current user is admin
 */
export async function isAdmin(): Promise<boolean> {
  const session = await auth()
  const role = (session?.user as any)?.role
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

/**
 * Redirect to login if not authenticated
 * For use in server components
 */
export async function redirectIfNotAuthenticated(redirectTo?: string) {
  const session = await auth()
  
  if (!session?.user) {
    const callbackUrl = redirectTo ? `?callbackUrl=${encodeURIComponent(redirectTo)}` : ''
    redirect(`/login${callbackUrl}`)
  }
  
  return session
}

/**
 * Redirect to home if already authenticated
 * For use on auth pages
 */
export async function redirectIfAuthenticated(redirectTo: string = '/dashboard') {
  const session = await auth()
  
  if (session?.user) {
    redirect(redirectTo)
  }
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string) {
  return db.user.findUnique({
    where: { email },
    include: {
      profile: true,
      subscriptions: true,
    },
  })
}

/**
 * Get user by ID
 */
export async function getUserById(id: string) {
  return db.user.findUnique({
    where: { id },
    include: {
      profile: true,
      subscriptions: true,
      _count: {
        select: {
          sentMatches: true,
          receivedMatches: true,
          messages: true,
        },
      },
    },
  })
}

/**
 * Update user profile
 */
export async function updateUserProfile(
  userId: string,
  data: {
    name?: string
    image?: string
  }
) {
  return db.user.update({
    where: { id: userId },
    data,
  })
}

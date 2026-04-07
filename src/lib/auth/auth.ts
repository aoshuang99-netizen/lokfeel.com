import { compare, hash } from 'bcryptjs'
import NextAuth from 'next-auth'
import { authConfig } from './config'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import { UserRole } from "@/generated/client"

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
 */
export async function requireAuth() {
  const session = await auth()
  
  if (!session?.user) {
    throw new Error('Unauthorized')
  }
  
  const userId = (session.user as any).id
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, image: true },
  })
  
  if (!user) {
    throw new Error('User not found')
  }
  
  return { user, session }
}

/**
 * Require admin role. Throws if not admin.
 */
export async function requireAdminAuth() {
  const { user, session } = await requireAuth()
  
  if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    throw new Error('Forbidden: Admin access required')
  }
  
  return { user, session }
}

/**
 * Get the current authenticated user from the session
 */
export async function getCurrentUser() {
  const session = await auth()
  
  if (!session?.user) return null
  
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

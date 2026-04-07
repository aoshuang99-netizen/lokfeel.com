'use client'

import { useSession, signIn, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useCallback } from 'react'
import { SUBSCRIPTION_PLANS } from '@/constants'
import type { SubscriptionPlan, SubscriptionFeatures } from '@/types'

// ============================================================================
// Types
// ============================================================================

interface User {
  id: string
  email: string
  name: string | null
  image: string | null
  role: 'USER' | 'ADMIN'
}

interface Session {
  user?: User
  expires: string
}

interface UseAuthReturn {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  isAdmin: boolean
  login: (provider: string, options?: { callbackUrl?: string }) => Promise<void>
  loginWithCredentials: (email: string, password: string, callbackUrl?: string) => Promise<{ error?: string }>
  logout: (callbackUrl?: string) => Promise<void>
}

// ============================================================================
// useCurrentUser Hook
// ============================================================================

/**
 * Hook to get the current authenticated user
 * Returns null if not authenticated
 */
export function useCurrentUser(): User | null {
  const { data: session, status } = useSession()
  
  if (status === 'loading') {
    return null
  }
  
  return (session?.user as User) || null
}

/**
 * Hook to get the full session
 */
export function useSessionData(): Session | null {
  const { data: session } = useSession()
  return (session as Session) || null
}

// ============================================================================
// useRequireAuth Hook
// ============================================================================

interface UseRequireAuthOptions {
  redirectTo?: string
  onUnauthenticated?: () => void
}

/**
 * Hook that requires authentication
 * Redirects to login if not authenticated
 */
export function useRequireAuth(options: UseRequireAuthOptions = {}): UseAuthReturn {
  const { redirectTo = '/auth/signin', onUnauthenticated } = options
  const { data: session, status } = useSession()
  const router = useRouter()
  
  const isLoading = status === 'loading'
  const isAuthenticated = status === 'authenticated'
  const user = (session?.user as User) || null
  const isAdmin = user?.role === 'ADMIN'
  
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      if (onUnauthenticated) {
        onUnauthenticated()
      } else {
        const callbackUrl = encodeURIComponent(window.location.pathname)
        router.push(`${redirectTo}?callbackUrl=${callbackUrl}`)
      }
    }
  }, [isLoading, isAuthenticated, redirectTo, onUnauthenticated, router])
  
  const login = useCallback(async (provider: string, options?: { callbackUrl?: string }) => {
    await signIn(provider, {
      callbackUrl: options?.callbackUrl || '/dashboard',
    })
  }, [])
  
  const loginWithCredentials = useCallback(async (
    email: string,
    password: string,
    callbackUrl?: string
  ): Promise<{ error?: string }> => {
    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
      callbackUrl: callbackUrl || '/dashboard',
    })
    
    if (result?.error) {
      return { error: result.error }
    }
    
    if (result?.url) {
      router.push(result.url)
    }
    
    return {}
  }, [router])
  
  const logout = useCallback(async (callbackUrl?: string) => {
    await signOut({
      callbackUrl: callbackUrl || '/',
    })
  }, [])
  
  return {
    user,
    isLoading,
    isAuthenticated,
    isAdmin,
    login,
    loginWithCredentials,
    logout,
  }
}

// ============================================================================
// useOptionalAuth Hook
// ============================================================================

/**
 * Hook for optional authentication
 * Doesn't redirect, just returns auth state
 */
export function useOptionalAuth(): Omit<UseAuthReturn, 'login' | 'loginWithCredentials' | 'logout'> & {
  login: (provider: string) => Promise<void>
  logout: () => Promise<void>
} {
  const { data: session, status } = useSession()
  
  const isLoading = status === 'loading'
  const isAuthenticated = status === 'authenticated'
  const user = (session?.user as User) || null
  const isAdmin = user?.role === 'ADMIN'
  
  const login = useCallback(async (provider: string) => {
    await signIn(provider, { callbackUrl: '/dashboard' })
  }, [])
  
  const logout = useCallback(async () => {
    await signOut({ callbackUrl: '/' })
  }, [])
  
  return {
    user,
    isLoading,
    isAuthenticated,
    isAdmin,
    login,
    logout,
  }
}

// ============================================================================
// useSubscriptionStatus Hook
// ============================================================================

interface UseSubscriptionStatusReturn {
  plan: SubscriptionPlan
  isPremium: boolean
  features: SubscriptionFeatures
  weeklyMatches: number
  canSeeWhoLikedMe: boolean
  canRematch: boolean
  hasAdvancedFilters: boolean
  hasPrioritySupport: boolean
  hasIncognitoMode: boolean
  hasReadReceipts: boolean
}

/**
 * Hook to check subscription status and features
 * Note: This is a client-side hook that works with the session
 * For server-side checks, use the subscription service
 */
export function useSubscriptionStatus(
  userPlan: SubscriptionPlan = 'FREE'
): UseSubscriptionStatusReturn {
  const planConfig = SUBSCRIPTION_PLANS[userPlan]
  
  return {
    plan: userPlan,
    isPremium: userPlan !== 'FREE',
    features: planConfig.features as SubscriptionFeatures,
    weeklyMatches: planConfig.features.weeklyMatches,
    canSeeWhoLikedMe: planConfig.features.canSeeWhoLikedMe,
    canRematch: planConfig.features.canRematch,
    hasAdvancedFilters: planConfig.features.advancedFilters,
    hasPrioritySupport: planConfig.features.prioritySupport,
    hasIncognitoMode: planConfig.features.incognitoMode,
    hasReadReceipts: planConfig.features.readReceipts,
  }
}

// ============================================================================
// useAdmin Hook
// ============================================================================

interface UseAdminReturn {
  isAdmin: boolean
  isLoading: boolean
  requireAdmin: () => void
}

/**
 * Hook for admin-only functionality
 */
export function useAdmin(): UseAdminReturn {
  const { data: session, status } = useSession()
  const router = useRouter()
  
  const isLoading = status === 'loading'
  const isAdmin = (session?.user as any)?.role === 'ADMIN'
  
  const requireAdmin = useCallback(() => {
    if (!isLoading && !isAdmin) {
      router.push('/')
    }
  }, [isLoading, isAdmin, router])
  
  return {
    isAdmin,
    isLoading,
    requireAdmin,
  }
}

// ============================================================================
// useOnboardingStatus Hook
// ============================================================================

interface UseOnboardingStatusReturn {
  isOnboardingComplete: boolean
  currentStep: number
  redirectToOnboarding: () => void
}

/**
 * Hook to check and manage onboarding status
 * Note: This requires the profile data to be passed in or fetched
 */
export function useOnboardingStatus(
  onboardingCompleted: boolean = false,
  onboardingStep: number = 0
): UseOnboardingStatusReturn {
  const router = useRouter()
  
  const redirectToOnboarding = useCallback(() => {
    if (!onboardingCompleted) {
      router.push('/onboarding')
    }
  }, [onboardingCompleted, router])
  
  return {
    isOnboardingComplete: onboardingCompleted,
    currentStep: onboardingStep,
    redirectToOnboarding,
  }
}

// ============================================================================
// Utility Exports
// ============================================================================

/**
 * Check if user has required role
 */
export function hasRole(user: User | null, role: 'USER' | 'ADMIN'): boolean {
  return user?.role === role
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(user: User | null): boolean {
  return !!user?.id
}

/**
 * Get display name for user
 */
export function getUserDisplayName(user: User | null): string {
  return user?.name || user?.email?.split('@')[0] || 'Anonymous'
}

/**
 * Get user initials for avatar
 */
export function getUserInitials(user: User | null): string {
  if (!user?.name) return '??'
  return user.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

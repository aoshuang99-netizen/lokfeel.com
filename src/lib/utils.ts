import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, differenceInYears } from 'date-fns'

/**
 * Combines multiple class values into a single string using clsx and tailwind-merge
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats a date to a readable string
 */
export function formatDate(
  date: Date | string | number,
  formatStr: string = 'MMM d, yyyy'
): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  return format(d, formatStr)
}

/**
 * Formats a date to relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - d.getTime()) / 1000)

  if (diffInSeconds < 60) return 'just now'
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`
  return format(d, 'MMM d')
}

/**
 * Formats a number as currency
 */
export function formatCurrency(
  amount: number,
  currency: string = 'USD',
  locale: string = 'en-US'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount)
}

/**
 * Truncates a string to a specified length
 */
export function truncate(str: string, length: number, suffix: string = '...'): string {
  if (str.length <= length) return str
  return str.slice(0, length - suffix.length) + suffix
}

/**
 * Calculates age from birth date
 */
export function calculateAge(birthDate: Date | string | number): number {
  const bd = typeof birthDate === 'string' || typeof birthDate === 'number' 
    ? new Date(birthDate) 
    : birthDate
  return differenceInYears(new Date(), bd)
}

/**
 * Generates a compatibility score between two users
 * Returns a score from 0-100 with a breakdown
 */
export interface MatchScoreBreakdown {
  overall: number
  attachment: number
  communication: number
  conflict: number
  values: number
  lifestyle: number
}

export function generateMatchScore(
  user1Profile: {
    attachmentStyle?: string | null
    communicationStyle?: string | null
    conflictResolution?: string | null
    priorities?: string[]
    dealbreakers?: string[]
  },
  user2Profile: {
    attachmentStyle?: string | null
    communicationStyle?: string | null
    conflictResolution?: string | null
    priorities?: string[]
    dealbreakers?: string[]
  }
): MatchScoreBreakdown {
  // Attachment compatibility (25% weight)
  const attachmentScore = calculateAttachmentCompatibility(
    user1Profile.attachmentStyle,
    user2Profile.attachmentStyle
  )

  // Communication compatibility (20% weight)
  const communicationScore = calculateCommunicationCompatibility(
    user1Profile.communicationStyle,
    user2Profile.communicationStyle
  )

  // Conflict resolution compatibility (20% weight)
  const conflictScore = calculateConflictCompatibility(
    user1Profile.conflictResolution,
    user2Profile.conflictResolution
  )

  // Values alignment (20% weight)
  const valuesScore = calculateValuesCompatibility(
    user1Profile.priorities || [],
    user2Profile.priorities || []
  )

  // Lifestyle compatibility (15% weight)
  const lifestyleScore = calculateLifestyleCompatibility(
    user1Profile.dealbreakers || [],
    user2Profile.dealbreakers || []
  )

  // Weighted average
  const overall = Math.round(
    attachmentScore * 0.25 +
    communicationScore * 0.20 +
    conflictScore * 0.20 +
    valuesScore * 0.20 +
    lifestyleScore * 0.15
  )

  return {
    overall: Math.min(100, Math.max(0, overall)),
    attachment: attachmentScore,
    communication: communicationScore,
    conflict: conflictScore,
    values: valuesScore,
    lifestyle: lifestyleScore,
  }
}

// Helper functions for match scoring
function calculateAttachmentCompatibility(style1?: string | null, style2?: string | null): number {
  if (!style1 || !style2) return 50
  
  const compatibility: Record<string, Record<string, number>> = {
    secure: { secure: 95, anxious: 75, avoidant: 70, disorganized: 60 },
    anxious: { secure: 85, anxious: 60, avoidant: 40, disorganized: 45 },
    avoidant: { secure: 80, anxious: 35, avoidant: 55, disorganized: 40 },
    disorganized: { secure: 70, anxious: 45, avoidant: 40, disorganized: 35 },
  }

  return compatibility[style1]?.[style2] ?? 50
}

function calculateCommunicationCompatibility(style1?: string | null, style2?: string | null): number {
  if (!style1 || !style2) return 50
  
  const compatibility: Record<string, Record<string, number>> = {
    direct: { direct: 85, indirect: 55, analytical: 75, emotional: 70 },
    indirect: { direct: 50, indirect: 80, analytical: 60, emotional: 65 },
    analytical: { direct: 80, indirect: 55, analytical: 90, emotional: 60 },
    emotional: { direct: 70, indirect: 65, analytical: 55, emotional: 85 },
  }

  return compatibility[style1]?.[style2] ?? 50
}

function calculateConflictCompatibility(style1?: string | null, style2?: string | null): number {
  if (!style1 || !style2) return 50
  
  const compatibility: Record<string, Record<string, number>> = {
    collaborative: { collaborative: 95, compromising: 85, accommodating: 70, competing: 50 },
    compromising: { collaborative: 85, compromising: 80, accommodating: 75, competing: 55 },
    accommodating: { collaborative: 75, compromising: 75, accommodating: 60, competing: 40 },
    competing: { collaborative: 45, compromising: 50, accommodating: 35, competing: 40 },
  }

  return compatibility[style1]?.[style2] ?? 50
}

function calculateValuesCompatibility(priorities1: string[], priorities2: string[]): number {
  if (priorities1.length === 0 || priorities2.length === 0) return 50
  
  const set1 = new Set(priorities1)
  const set2 = new Set(priorities2)
  
  const intersection = [...set1].filter(p => set2.has(p))
  const union = new Set([...set1, ...set2])
  
  if (union.size === 0) return 50
  
  return Math.round((intersection.length / union.size) * 100)
}

function calculateLifestyleCompatibility(dealbreakers1: string[], dealbreakers2: string[]): number {
  // Check for conflicting dealbreakers
  const conflicts = dealbreakers1.filter(db => dealbreakers2.includes(db))
  
  if (conflicts.length > 0) return Math.max(0, 100 - conflicts.length * 30)
  
  return 85
}

/**
 * Generates a unique ID
 */
export function generateId(length: number = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Debounces a function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

/**
 * Throttles a function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

/**
 * Safely parses JSON with a fallback value
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

/**
 * Capitalizes the first letter of a string
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Converts a string to title case
 */
export function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

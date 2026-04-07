import type { User, Profile, Match, Message, Notification, Subscription } from "@/generated/client"

// ============================================================================
// User & Profile Types
// ============================================================================

export interface UserProfileExtended extends User {
  profile: Profile | null
  subscription: Subscription | null
}

export interface ProfileWithUser extends Profile {
  user: User
}

export interface UserWithFullProfile extends User {
  profile: Profile | null
  subscription: Subscription | null
  _count?: {
    matchesAsUser1: number
    matchesAsUser2: number
    sentMessages: number
    receivedMessages: number
    notifications: number
  }
}

// ============================================================================
// Match Types
// ============================================================================

export interface MatchWithProfiles extends Match {
  sender: UserWithFullProfile
  receiver: UserWithFullProfile
}

export interface MatchWithDetails extends Match {
  sender: UserWithFullProfile
  receiver: UserWithFullProfile
  messages: ChatMessageWithSender[]
}

// Alias for compatibility
export type MessageWithSender = ChatMessageWithSender

export interface MatchCompatibilityScores {
  overall: number
  attachment: number
  communication: number
  conflict: number
  values: number
  lifestyle: number
}

export interface MatchExplanation {
  summary: string
  strengths: string[]
  considerations: string[]
  conversationStarters: string[]
}

export interface WeeklyMatch {
  match: MatchWithProfiles
  score: MatchCompatibilityScores
  explanation: MatchExplanation
  warnings: ConflictWarning[]
}

// ============================================================================
// Message Types
// ============================================================================

export interface ChatMessageWithSender extends Message {
  sender: Pick<User, 'id' | 'name' | 'image'>
}

export interface MessageWithReadStatus extends Message {
  sender: Pick<User, 'id' | 'name' | 'image'>
  isRead: boolean
  readAt: Date | null
}

export interface ChatRoom {
  id: string
  matchId: string
  participants: Pick<User, 'id' | 'name' | 'image'>[]
  lastMessage?: ChatMessageWithSender
  unreadCount: number
  createdAt: Date
  updatedAt: Date
}

export interface ChatRoomWithMembers {
  id: string
  matchId: string
  createdAt: Date
  updatedAt: Date
  isArchived: boolean
  messages: ChatMessageWithSender[]
  unreadCount: number
  otherMember?: Pick<User, 'id' | 'name' | 'image'>
  match?: MatchWithProfiles
}

// Alias for backward compatibility
export type NotificationWithData = NotificationWithUser

// ============================================================================
// Notification Types
// ============================================================================

export interface NotificationWithUser extends Notification {
  user: User
}

export interface NotificationPayload {
  type: NotificationType
  title: string
  body: string
  data?: Record<string, unknown>
  actionUrl?: string
}

export type NotificationType = 
  | 'MATCH_CREATED'
  | 'MATCH_EXPIRING'
  | 'MESSAGE_RECEIVED'
  | 'PROFILE_VIEWED'
  | 'VERIFICATION_APPROVED'
  | 'VERIFICATION_REJECTED'
  | 'SUBSCRIPTION_EXPIRING'
  | 'WEEKLY_DIGEST'
  | 'SYSTEM'

// ============================================================================
// Subscription Types
// ============================================================================

export interface SubscriptionWithUser extends Subscription {
  user: User
}

export type SubscriptionPlan = 'FREE' | 'PREMIUM_MONTHLY' | 'PREMIUM_YEARLY'

export interface SubscriptionFeatures {
  weeklyMatches: number
  canSeeWhoLikedMe: boolean
  canRematch: boolean
  advancedFilters: boolean
  prioritySupport: boolean
  incognitoMode: boolean
  readReceipts: boolean
}

// ============================================================================
// Admin Types
// ============================================================================

export interface AdminUserListParams {
  page?: number
  limit?: number
  search?: string
  status?: 'active' | 'suspended' | 'pending_verification' | 'all'
  sortBy?: 'createdAt' | 'lastActiveAt' | 'name' | 'email'
  sortOrder?: 'asc' | 'desc'
}

export interface AdminUserListResult {
  users: UserWithFullProfile[]
  total: number
  page: number
  totalPages: number
}

export interface AdminAnalytics {
  userGrowth: {
    total: number
    newThisWeek: number
    newThisMonth: number
    byDay: { date: string; count: number }[]
  }
  matchMetrics: {
    total: number
    pending: number
    accepted: number
    rejected: number
    averageScore: number
    acceptanceRate: number
  }
  revenue: {
    total: number
    thisMonth: number
    mrr: number
    activeSubscriptions: number
  }
  activity: {
    activeUsersToday: number
    activeUsersThisWeek: number
    messagesSentToday: number
    avgMessagesPerChat: number
  }
}

// ============================================================================
// Dashboard & Analytics Types
// ============================================================================

export interface DashboardStats {
  totalUsers: number
  activeUsers: number
  newUsersToday: number
  newUsersThisWeek: number
  totalMatches: number
  successfulMatches: number
  totalMessages: number
  messagesToday: number
  conversionRate: number
  revenue: {
    today: number
    thisWeek: number
    thisMonth: number
    total: number
  }
}

export interface UserFunnelStage {
  stage: string
  count: number
  percentage: number
  dropOff: number
}

export interface UserFunnel {
  stages: UserFunnelStage[]
  totalStarted: number
  totalCompleted: number
  overallConversion: number
}

export interface AnalyticsEvent {
  id: string
  userId?: string
  event: string
  properties?: Record<string, unknown>
  timestamp: Date
  sessionId?: string
}

// ============================================================================
// Matching Engine Types
// ============================================================================

export interface ConflictWarning {
  type: 'attachment' | 'communication' | 'conflict' | 'values' | 'lifestyle'
  severity: 'low' | 'medium' | 'high'
  message: string
  suggestion: string
}

export interface MatchCandidate {
  userId: string
  profile: Profile
  compatibilityScore: MatchCompatibilityScores
  explanation: MatchExplanation
  warnings: ConflictWarning[]
}

export interface WeeklyDigest {
  userId: string
  weekOf: Date
  matches: WeeklyMatch[]
  stats: {
    totalMatches: number
    averageScore: number
    highestScore: number
  }
}

// ============================================================================
// Profile Configuration Types
// ============================================================================

export interface RelationshipPreference {
  type: string
  description: string
  icon: string
}

export interface AttachmentStyle {
  id: string
  name: string
  description: string
  compatibleWith: string[]
  challengingWith: string[]
}

export interface CommunicationStyle {
  id: string
  name: string
  description: string
  characteristics: string[]
}

export interface ConflictStyle {
  id: string
  name: string
  description: string
  approach: string
}

export interface LoveLanguage {
  id: string
  name: string
  description: string
  examples: string[]
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: ApiError
  meta?: ApiMeta
}

export interface ApiError {
  code: string
  message: string
  details?: Record<string, string[]>
}

export interface ApiMeta {
  page?: number
  limit?: number
  total?: number
  totalPages?: number
}

export interface PaginatedResponse<T> extends ApiResponse<T> {
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasMore: boolean
  }
}

// ============================================================================
// Form & Input Types
// ============================================================================

export interface OnboardingStep {
  id: string
  title: string
  description: string
  fields: FormField[]
  isRequired: boolean
}

export interface FormField {
  name: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'date' | 'number' | 'boolean'
  options?: { value: string; label: string }[]
  placeholder?: string
  validation?: {
    required?: boolean
    min?: number
    max?: number
    pattern?: string
  }
}

export interface ProfileFormData {
  displayName: string
  bio: string
  birthDate: Date
  gender: string
  sexuality: string
  location: string
  occupation: string
  education: string
  relationshipGoal: string
  attachmentStyle: string
  communicationStyle: string
  conflictResolution: string
  loveLanguages: string[]
  priorities: string[]
  dealbreakers: string[]
  interests: string[]
  photos: string[]
}

export type ProfileUpdateInput = Partial<ProfileFormData>

// ============================================================================
// Real-time Types
// ============================================================================

export interface PusherEvent {
  type: string
  data: unknown
  timestamp: number
}

export interface ChatEvent extends PusherEvent {
  type: 'message' | 'typing' | 'read'
  data: {
    messageId?: string
    senderId?: string
    content?: string
    timestamp?: number
  }
}

export interface NotificationEvent extends PusherEvent {
  type: 'notification'
  data: NotificationPayload
}

// ============================================================================
// Search & Filter Types
// ============================================================================

export interface UserSearchFilters {
  ageMin?: number
  ageMax?: number
  location?: string
  distance?: number
  gender?: string[]
  relationshipGoal?: string[]
  hasPhoto?: boolean
  isVerified?: boolean
  isOnline?: boolean
}

export interface UserSearchResult {
  users: UserWithFullProfile[]
  total: number
  hasMore: boolean
}

// ============================================================================
// Auth Types
// ============================================================================

export interface AuthSession {
  user: {
    id: string
    email: string
    name: string | null
    image: string | null
    role: 'USER' | 'ADMIN'
  }
  expires: string
}

export interface JwtPayload {
  sub: string
  email: string
  name: string | null
  role: 'USER' | 'ADMIN'
  iat: number
  exp: number
}

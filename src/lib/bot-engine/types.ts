/**
 * LokFee! Bot Behavior Engine — Type Definitions
 *
 * Defines all interfaces and types for the behavior simulation system.
 * Bot users simulate realistic online presence, browsing, matching, and chat behaviors.
 */

// ═══════════════════════════════════════════════════════════════
// Core Bot Identity
// ═══════════════════════════════════════════════════════════════

export type PersonalityType =
  | 'explorer'       // Active swiper, many matches
  | 'selective'      // Careful reviewer, few but high-quality matches
  | 'social'         // Frequent chatter, engages deeply
  | 'passive'        // Checks occasionally, slow responder
  | 'enthusiastic'   // Super likes, quick responses, high engagement
  | 'cautious';      // Takes time, reads everything, rarely initiates

export type BotGender = 'male' | 'female' | 'non_binary';

export interface BotIdentity {
  userId: string;
  personalityType: PersonalityType;
  gender: BotGender;
  timezone: string;       // IANA timezone, e.g. "America/New_York"
  activityLevel: number;  // 0-1, how active this bot is overall
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// Behavior Configuration (per-bot, stored in User.botConfig)
// ═══════════════════════════════════════════════════════════════

export interface BotBehaviorConfig {
  personalityType: PersonalityType;

  // Online behavior
  online: OnlineBehaviorConfig;

  // Browsing behavior
  browsing: BrowsingBehaviorConfig;

  // Match response behavior
  matching: MatchResponseConfig;

  // Chat behavior
  chat: ChatBehaviorConfig;

  // Seed for deterministic randomness (same bot behaves consistently)
  seed: number;
}

export interface OnlineBehaviorConfig {
  /** Average number of sessions per day */
  avgSessionsPerDay: number;
  /** Average session duration in minutes */
  avgSessionDurationMin: number;
  /** Peak activity hours (0-23, server time adjusted for timezone) */
  peakHours: number[];
  /** Probability of being online during off-peak hours (0-1) */
  offPeakProbability: number;
  /** Days of week most active (0=Sun, 6=Sat) */
  activeDays: number[];
}

export interface BrowsingBehaviorConfig {
  /** Average profiles viewed per session */
  avgProfilesPerSession: number;
  /** Average time spent per profile in seconds */
  avgProfileViewDurationSec: number;
  /** Standard deviation for view duration */
  profileViewDurationStdDev: number;
  /** Probability of viewing full profile details (vs just thumbnail) */
  detailedViewProbability: number;
  /** Probability of revisiting a previously viewed profile */
  revisitProbability: number;
}

export interface MatchResponseConfig {
  /** Base probability of accepting a match (0-1) */
  baseAcceptProbability: number;
  /** How much match score influences acceptance (score multiplier) */
  scoreInfluenceWeight: number;
  /** Probability of using Super Like (only for high scores) */
  superLikeProbability: number;
  /** Min match score to consider Super Like */
  superLikeMinScore: number;
  /** Response time distribution: mean in minutes */
  responseTimeMeanMin: number;
  /** Response time distribution: standard deviation in minutes */
  responseTimeStdDevMin: number;
  /** Probability of never responding (ghosting) */
  ghostProbability: number;
}

export interface ChatBehaviorConfig {
  /** Average messages per day when in active conversation */
  avgMessagesPerDay: number;
  /** Average response time in minutes */
  avgResponseTimeMin: number;
  /** Standard deviation for response time */
  responseTimeStdDevMin: number;
  /** Probability of initiating conversation after match acceptance */
  initConversationProbability: number;
  /** Probability of sending a follow-up if no response */
  followUpProbability: number;
  /** Max follow-ups before giving up */
  maxFollowUps: number;
  /** Conversation length preference: avg number of exchanges before tapering */
  avgConversationLength: number;
  /** Probability of ending conversation (vs letting it fade) */
  activeEndProbability: number;
}

// ═══════════════════════════════════════════════════════════════
// Behavior Events (what the bot "does")
// ═══════════════════════════════════════════════════════════════

export type BehaviorEventType =
  | 'online_status_change'
  | 'profile_view'
  | 'match_reaction'
  | 'chat_message_sent'
  | 'chat_message_received'
  | 'session_start'
  | 'session_end'
  | 'super_like'
  | 'profile_browse_batch';

export interface BehaviorEvent {
  id: string;
  botUserId: string;
  type: BehaviorEventType;
  timestamp: Date;
  data: Record<string, unknown>;
  metadata?: {
    personalityType?: PersonalityType;
    scheduledAt?: Date;
    executedAt?: Date;
    error?: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// Online State
// ═══════════════════════════════════════════════════════════════

export interface BotOnlineState {
  botUserId: string;
  isOnline: boolean;
  currentSessionStart: Date | null;
  sessionCount: number;
  lastActivityAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// Engine Scheduling
// ═══════════════════════════════════════════════════════════════

export interface ScheduledAction {
  id: string;
  botUserId: string;
  actionType: BehaviorEventType;
  scheduledFor: Date;
  payload: Record<string, unknown>;
  priority: number; // 1-5, lower = higher priority
  retryCount: number;
  maxRetries: number;
}

export interface EngineConfig {
  /** How often the engine tick runs (milliseconds) */
  tickIntervalMs: number;
  /** Max actions processed per tick */
  maxActionsPerTick: number;
  /** Global simulation speed multiplier (1 = real-time, 60 = 1min = 1hour) */
  speedMultiplier: number;
  /** Whether to log all behavior events */
  enableLogging: boolean;
  /** Maximum concurrent active bot sessions */
  maxConcurrentSessions: number;
  /** Rate limiting: min ms between actions for the same bot */
  minActionIntervalMs: number;
}

export interface EngineState {
  isRunning: boolean;
  tickCount: number;
  lastTickAt: Date | null;
  activeBots: Map<string, BotOnlineState>;
  scheduledActions: ScheduledAction[];
  eventLog: BehaviorEvent[];
  stats: EngineStats;
}

export interface EngineStats {
  totalEventsProcessed: number;
  eventsByType: Record<BehaviorEventType, number>;
  activeSessions: number;
  totalBotActions: number;
  errors: number;
  startedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// Match Reaction Result
// ═══════════════════════════════════════════════════════════════

export type MatchReactionDecision = 'accept' | 'reject' | 'maybe' | 'ghost' | 'super_like';

export interface MatchReactionResult {
  botUserId: string;
  matchId: string;
  matchScore: number;
  decision: MatchReactionDecision;
  responseDelayMin: number;
  reason: string;
}

// ═══════════════════════════════════════════════════════════════
// Chat Message Generation
// ═══════════════════════════════════════════════════════════════

export interface ChatMessageContext {
  botUserId: string;
  chatRoomId: string;
  partnerId: string;
  partnerName: string;
  partnerPersonality?: PersonalityType;
  conversationHistory: Array<{
    senderId: string;
    content: string;
    sentAt: Date;
  }>;
  matchScore: number;
  isInitiating: boolean;
  followUpCount: number;
  isReceiver?: boolean;
  minutesSinceLastMessage?: number;
}

export interface GeneratedMessage {
  content: string;
  type: 'greeting' | 'response' | 'follow_up' | 'question' | 'compliment' | 'share' | 'closing';
  delayMs: number;
}

/**
 * LokFee! Bot Behavior Engine — Core Scheduler
 *
 * The main orchestrator that coordinates all bot behavior modules.
 * Runs on a tick-based loop, managing online states, browsing sessions,
 * match reactions, and chat behavior across all bot users.
 *
 * Architecture:
 *   BotEngine (singleton)
 *     ├── tick() — Main loop, runs every tickIntervalMs
 *     ├── OnlineStateManager — Track online/offline states
 *     ├── ActionScheduler — Queue and execute scheduled actions
 *     └── BehaviorLogger — Record all events
 *
 * Integration:
 *   - Reads bot users from DB (WHERE isBot = true)
 *   - Calls existing API routes for match reactions, chat messages
 *   - Persists behavior events via AnalyticsEvent model
 */

import type {
  BotBehaviorConfig,
  BotIdentity,
  BotOnlineState,
  BehaviorEvent,
  EngineConfig,
  EngineState,
  ScheduledAction,
  MatchReactionResult,
  ChatMessageContext,
} from '../types';
import { createBotConfig, deserializeBotConfig, DEFAULT_ENGINE_CONFIG } from '../config';
import { hashStringToSeed, createSeededRandom, generateEventId } from '../utils';
import { BehaviorLogger } from '../modules/logger';
import { evaluateOnlineTransition, createOnlineState, estimateNextSessionDelay } from '../modules/online-status';
import { simulateBrowseSession, shouldBrowseNow } from '../modules/browsing';
import { makeMatchDecision, processPendingMatches, createMatchReactionEvent } from '../modules/match-response';
import {
  shouldInitiateConversation,
  getInitiationDelay,
  generateResponse,
  shouldEndConversation,
  createChatMessageEvent,
} from '../modules/chat';

// ═══════════════════════════════════════════════════════════════
// Bot Engine Class
// ═══════════════════════════════════════════════════════════════

export class BotEngine {
  private config: EngineConfig;
  private state: EngineState;
  private logger: BehaviorLogger;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private botConfigs: Map<string, BotBehaviorConfig> = new Map();
  private botIdentities: Map<string, BotIdentity> = new Map();
  private dbAdapter: BotEngineDbAdapter;

  constructor(
    dbAdapter: BotEngineDbAdapter,
    engineConfig: Partial<EngineConfig> = {},
    loggerConfig?: Partial<import('../modules/logger').LoggerConfig>,
  ) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...engineConfig };
    this.dbAdapter = dbAdapter;
    this.logger = new BehaviorLogger(loggerConfig);

    this.state = {
      isRunning: false,
      tickCount: 0,
      lastTickAt: null,
      activeBots: new Map(),
      scheduledActions: [],
      eventLog: [],
      stats: {
        totalEventsProcessed: 0,
        eventsByType: {
          online_status_change: 0,
          profile_view: 0,
          match_reaction: 0,
          chat_message_sent: 0,
          chat_message_received: 0,
          session_start: 0,
          session_end: 0,
          super_like: 0,
          profile_browse_batch: 0,
        },
        activeSessions: 0,
        totalBotActions: 0,
        errors: 0,
        startedAt: new Date(),
      },
    };
  }

  // ─── Lifecycle ───────────────────────────────────────────

  /**
   * Start the engine. Loads bot users from DB and begins the tick loop.
   */
  async start(): Promise<void> {
    if (this.state.isRunning) return;

    console.log('[BotEngine] Starting...');
    await this.loadBotUsers();

    this.state.isRunning = true;
    this.state.stats.startedAt = new Date();

    // Start tick loop
    this.tickTimer = setInterval(() => {
      this.tick().catch(err => {
        console.error('[BotEngine] Tick error:', err);
        this.logger.logError('engine', 'tick', err);
      });
    }, this.config.tickIntervalMs);

    // Run first tick immediately
    await this.tick();

    console.log(`[BotEngine] Running with ${this.botConfigs.size} bot users. Tick interval: ${this.config.tickIntervalMs}ms`);
  }

  /**
   * Stop the engine gracefully.
   */
  stop(): void {
    if (!this.state.isRunning) return;

    console.log('[BotEngine] Stopping...');
    this.state.isRunning = false;

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    this.logger.destroy();
    console.log('[BotEngine] Stopped.');
  }

  // ─── Main Tick ───────────────────────────────────────────

  /**
   * Main tick — executed every tickIntervalMs.
   * Processes all bot behaviors in order of priority.
   */
  private async tick(): Promise<void> {
    const tickStart = Date.now();
    this.state.tickCount++;
    this.state.lastTickAt = new Date();

    const now = new Date();

    // 1. Evaluate online status transitions for all bots
    await this.processOnlineTransitions(now);

    // 2. Execute scheduled actions (match reactions, chat messages)
    await this.processScheduledActions(now);

    // 3. For online bots, trigger browsing sessions
    await this.processBrowsingSessions(now);

    // 4. Check for pending matches that need responses
    await this.processMatchReactions(now);

    // 5. Check for chat messages that need responses
    await this.processChatResponses(now);

    // 6. Run anomaly detection
    const anomalies = this.logger.detectAnomalies();
    for (const anomaly of anomalies) {
      console.warn(`[BotEngine] Anomaly: ${anomaly.message}`);
    }

    const tickDuration = Date.now() - tickStart;
    if (tickDuration > this.config.tickIntervalMs * 0.8) {
      console.warn(`[BotEngine] Tick ${this.state.tickCount} took ${tickDuration}ms (>${this.config.tickIntervalMs * 0.8}ms)`);
    }
  }

  // ─── Online Status Management ────────────────────────────

  private async processOnlineTransitions(now: Date): Promise<void> {
    for (const [botUserId, identity] of this.botIdentities) {
      const config = this.botConfigs.get(botUserId);
      if (!config) continue;

      const currentState = this.state.activeBots.get(botUserId) ?? createOnlineState(botUserId);

      const { state: newState, events } = evaluateOnlineTransition(
        currentState,
        config,
        identity.timezone,
      );

      // Fix botUserId in events (was set to seed placeholder)
      for (const event of events) {
        event.botUserId = botUserId;
        this.logger.log(event);
      }

      this.state.activeBots.set(botUserId, newState);

      // Update DB online status
      if (newState.isOnline !== currentState.isOnline) {
        try {
          await this.dbAdapter.updateOnlineStatus(botUserId, newState.isOnline);
        } catch (err) {
          this.logger.logError(botUserId, 'update_online_status', err as Error);
        }
      }
    }
  }

  // ─── Browsing Sessions ───────────────────────────────────

  private async processBrowsingSessions(now: Date): Promise<void> {
    for (const [botUserId, onlineState] of this.state.activeBots) {
      if (!onlineState.isOnline || !onlineState.currentSessionStart) continue;

      const config = this.botConfigs.get(botUserId);
      if (!config) continue;

      // Calculate session progress
      const sessionMinutes = (now.getTime() - onlineState.currentSessionStart.getTime()) / 60_000;
      const expectedDuration = config.online.avgSessionDurationMin;

      // Decide if bot should browse now
      if (!shouldBrowseNow(config, sessionMinutes, expectedDuration)) continue;

      // Check rate limiting
      const lastBrowse = this.getLastActionTime(botUserId, 'profile_browse_batch');
      if (lastBrowse && (now.getTime() - lastBrowse.getTime()) < this.config.minActionIntervalMs) {
        continue;
      }

      // Get available profiles to browse
      try {
        const availableProfiles = await this.dbAdapter.getBrowsableProfiles(botUserId);

        if (availableProfiles.length === 0) continue;

        // Get previously viewed profiles
        const previousViews = await this.dbAdapter.getPreviouslyViewedProfiles(botUserId);

        const result = simulateBrowseSession(config, botUserId, availableProfiles, previousViews);

        // Log all events
        for (const event of result.events) {
          this.logger.log(event);
        }

        // Record views in DB
        const viewedIds = result.events
          .filter(e => e.type === 'profile_view')
          .map(e => (e.data as { profileId: string }).profileId);

        if (viewedIds.length > 0) {
          await this.dbAdapter.recordProfileViews(botUserId, viewedIds);
        }

      } catch (err) {
        this.logger.logError(botUserId, 'browse_session', err as Error);
      }
    }
  }

  // ─── Match Reaction Processing ───────────────────────────

  private async processMatchReactions(now: Date): Promise<void> {
    for (const [botUserId, onlineState] of this.state.activeBots) {
      if (!onlineState.isOnline) continue;

      const config = this.botConfigs.get(botUserId);
      if (!config) continue;

      try {
        // Get pending matches for this bot
        const pendingMatches = await this.dbAdapter.getPendingMatches(botUserId);

        if (pendingMatches.length === 0) continue;

        // Process matches
        const results = processPendingMatches(config, botUserId, pendingMatches);

        for (const result of results) {
          // Log the event
          const event = createMatchReactionEvent(result);
          this.logger.log(event);

          // If ghosting, schedule a delayed "no response" check
          if (result.decision === 'ghost') {
            this.scheduleAction({
              id: generateEventId(),
              botUserId,
              actionType: 'match_reaction',
              scheduledFor: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days
              payload: { matchId: result.matchId, decision: 'ghost' },
              priority: 5,
              retryCount: 0,
              maxRetries: 0,
            });
            continue;
          }

          // Schedule the reaction with delay
          const delayMs = result.responseDelayMin * 60 * 1000;
          const adjustedDelay = Math.max(
            this.config.minActionIntervalMs,
            delayMs / this.config.speedMultiplier,
          );

          this.scheduleAction({
            id: generateEventId(),
            botUserId,
            actionType: 'match_reaction',
            scheduledFor: new Date(now.getTime() + adjustedDelay),
            payload: {
              matchId: result.matchId,
              decision: result.decision,
              reason: result.reason,
            },
            priority: result.decision === 'super_like' ? 1 : 2,
            retryCount: 0,
            maxRetries: 2,
          });
        }
      } catch (err) {
        this.logger.logError(botUserId, 'match_reaction_processing', err as Error);
      }
    }
  }

  // ─── Chat Response Processing ────────────────────────────

  private async processChatResponses(now: Date): Promise<void> {
    for (const [botUserId, onlineState] of this.state.activeBots) {
      if (!onlineState.isOnline) continue;

      const config = this.botConfigs.get(botUserId);
      if (!config) continue;

      try {
        // Get chat rooms where bot needs to respond
        const pendingChats = await this.dbAdapter.getPendingChatResponses(botUserId);

        for (const chatRoom of pendingChats) {
          // Check conversation lifecycle
          if (shouldEndConversation(config, chatRoom, chatRoom.minutesSinceLastMessage)) {
            // Generate closing message
            const closingMessage = generateResponse(config, {
              ...chatRoom,
              isInitiating: false,
            });

            if (closingMessage.type === 'closing' && closingMessage.content) {
              const delayMs = Math.max(
                this.config.minActionIntervalMs,
                closingMessage.delayMs / this.config.speedMultiplier,
              );

              this.scheduleAction({
                id: generateEventId(),
                botUserId,
                actionType: 'chat_message_sent',
                scheduledFor: new Date(now.getTime() + delayMs),
                payload: {
                  chatRoomId: chatRoom.chatRoomId,
                  content: closingMessage.content,
                  messageType: closingMessage.type,
                },
                priority: 3,
                retryCount: 0,
                maxRetries: 1,
              });
            }
            continue;
          }

          // Check if bot should initiate (new match, no messages yet)
          if (chatRoom.conversationHistory.length === 0) {
            if (shouldInitiateConversation(config, chatRoom.matchScore, chatRoom.isReceiver)) {
              const initDelay = getInitiationDelay(config, chatRoom.matchScore);
              const delayMs = Math.max(
                this.config.minActionIntervalMs,
                (initDelay * 60 * 1000) / this.config.speedMultiplier,
              );

              const initMessage = generateResponse(config, {
                ...chatRoom,
                isInitiating: true,
              });

              this.scheduleAction({
                id: generateEventId(),
                botUserId,
                actionType: 'chat_message_sent',
                scheduledFor: new Date(now.getTime() + delayMs),
                payload: {
                  chatRoomId: chatRoom.chatRoomId,
                  content: initMessage.content,
                  messageType: initMessage.type,
                },
                priority: 2,
                retryCount: 0,
                maxRetries: 1,
              });
            }
            continue;
          }

          // Generate a response to the latest message
          const responseMessage = generateResponse(config, {
            ...chatRoom,
            isInitiating: false,
          });

          const delayMs = Math.max(
            this.config.minActionIntervalMs,
            responseMessage.delayMs / this.config.speedMultiplier,
          );

          this.scheduleAction({
            id: generateEventId(),
            botUserId,
            actionType: 'chat_message_sent',
            scheduledFor: new Date(now.getTime() + delayMs),
            payload: {
              chatRoomId: chatRoom.chatRoomId,
              content: responseMessage.content,
              messageType: responseMessage.type,
            },
            priority: 3,
            retryCount: 0,
            maxRetries: 1,
          });
        }
      } catch (err) {
        this.logger.logError(botUserId, 'chat_response_processing', err as Error);
      }
    }
  }

  // ─── Scheduled Action Execution ──────────────────────────

  private scheduleAction(action: ScheduledAction): void {
    this.state.scheduledActions.push(action);

    // Sort by priority then scheduled time
    this.state.scheduledActions.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.scheduledFor.getTime() - b.scheduledFor.getTime();
    });
  }

  private async processScheduledActions(now: Date): Promise<void> {
    const dueActions = this.state.scheduledActions.filter(
      action => action.scheduledFor <= now,
    );

    const actionsToProcess = dueActions.slice(0, this.config.maxActionsPerTick);

    for (const action of actionsToProcess) {
      try {
        await this.executeAction(action);
        // Remove from queue
        this.state.scheduledActions = this.state.scheduledActions.filter(
          a => a.id !== action.id,
        );
      } catch (err) {
        if (action.retryCount < action.maxRetries) {
          // Retry with exponential backoff
          action.retryCount++;
          action.scheduledFor = new Date(
            now.getTime() + Math.pow(2, action.retryCount) * 60_000,
          );
          console.warn(`[BotEngine] Retrying action ${action.id} (attempt ${action.retryCount}/${action.maxRetries})`);
        } else {
          console.error(`[BotEngine] Action ${action.id} failed permanently:`, err);
          this.logger.logError(action.botUserId, `action_${action.actionType}`, err as Error);
          this.state.scheduledActions = this.state.scheduledActions.filter(
            a => a.id !== action.id,
          );
        }
      }
    }
  }

  private async executeAction(action: ScheduledAction): Promise<void> {
    switch (action.actionType) {
      case 'match_reaction': {
        const { matchId, decision, reason } = action.payload as {
          matchId: string;
          decision: string;
          reason?: string;
        };

        if (decision === 'ghost') {
          // Ghost = mark as expired after 7 days (already scheduled for this)
          await this.dbAdapter.expireMatch(matchId);
          return;
        }

        await this.dbAdapter.submitMatchReaction(
          action.botUserId,
          matchId,
          decision as 'accept' | 'reject' | 'maybe',
          reason,
        );

        this.logger.log({
          id: action.id,
          botUserId: action.botUserId,
          type: 'match_reaction',
          timestamp: new Date(),
          data: { matchId, decision, reason },
          metadata: {
            executedAt: new Date(),
          },
        });
        break;
      }

      case 'chat_message_sent': {
        const { chatRoomId, content, messageType } = action.payload as {
          chatRoomId: string;
          content: string;
          messageType: string;
        };

        await this.dbAdapter.sendChatMessage(
          action.botUserId,
          chatRoomId,
          content,
        );

        this.logger.log({
          id: action.id,
          botUserId: action.botUserId,
          type: 'chat_message_sent',
          timestamp: new Date(),
          data: { chatRoomId, content, messageType },
          metadata: { executedAt: new Date() },
        });
        break;
      }

      default:
        console.warn(`[BotEngine] Unknown action type: ${action.actionType}`);
    }
  }

  // ─── Bot Loading ─────────────────────────────────────────

  private async loadBotUsers(): Promise<void> {
    try {
      const bots = await this.dbAdapter.loadBotUsers();

      for (const bot of bots) {
        const config = bot.botConfig
          ? deserializeBotConfig(bot.botConfig)
          : createBotConfig(
              bot.userId,
              bot.personalityType,
              bot.gender,
              hashStringToSeed(bot.userId),
            );

        this.botConfigs.set(bot.userId, config);
        this.botIdentities.set(bot.userId, {
          userId: bot.userId,
          personalityType: bot.personalityType,
          gender: bot.gender,
          timezone: bot.timezone,
          activityLevel: config.online.avgSessionsPerDay / 6, // Normalize to 0-1
          createdAt: bot.createdAt,
        });
      }

      console.log(`[BotEngine] Loaded ${this.botConfigs.size} bot configurations`);
    } catch (err) {
      console.error('[BotEngine] Failed to load bot users:', err);
      throw err;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────

  private getLastActionTime(botUserId: string, actionType: string): Date | null {
    const recentEvents = this.logger.getBotEvents(botUserId, 10);
    const lastAction = recentEvents
      .filter(e => e.type === actionType)
      .pop();
    return lastAction?.timestamp ?? null;
  }

  // ─── Public API ──────────────────────────────────────────

  /**
   * Get engine health and statistics.
   */
  getHealth() {
    return {
      isRunning: this.state.isRunning,
      tickCount: this.state.tickCount,
      lastTickAt: this.state.lastTickAt,
      botCount: this.botConfigs.size,
      activeSessions: this.state.stats.activeSessions,
      scheduledActionsPending: this.state.scheduledActions.length,
      loggerHealth: this.logger.getHealthSummary(),
      anomalies: this.logger.detectAnomalies(),
      globalStats: this.logger.getGlobalStats(),
    };
  }

  /**
   * Get behavior statistics for a specific bot.
   */
  getBotBehaviorStats(botUserId: string) {
    return this.logger.getBotStats(botUserId);
  }

  /**
   * Manually trigger a match reaction for a bot (for testing/overrides).
   */
  async manualMatchReaction(
    botUserId: string,
    matchId: string,
    matchScore: number,
  ): Promise<MatchReactionResult> {
    const config = this.botConfigs.get(botUserId);
    if (!config) throw new Error(`Bot ${botUserId} not found`);

    return makeMatchDecision(config, botUserId, matchId, matchScore);
  }

  /**
   * Manually trigger a chat message for a bot (for testing/overrides).
   */
  async manualChatMessage(
    botUserId: string,
    context: ChatMessageContext,
  ) {
    const config = this.botConfigs.get(botUserId);
    if (!config) throw new Error(`Bot ${botUserId} not found`);

    return generateResponse(config, context);
  }
}

// ═══════════════════════════════════════════════════════════════
// Database Adapter Interface
// ═══════════════════════════════════════════════════════════════

/**
 * Interface that the engine uses to interact with the database.
 * Implement this to connect the engine to your Prisma/DB layer.
 */
export interface BotEngineDbAdapter {
  // ─── Bot User Loading ──────────────────────────────────

  /** Load all bot users with their configurations */
  loadBotUsers(): Promise<Array<{
    userId: string;
    personalityType: import('../types').PersonalityType;
    gender: 'male' | 'female' | 'non_binary';
    timezone: string;
    botConfig: string | null;
    createdAt: Date;
  }>>;

  // ─── Online Status ─────────────────────────────────────

  /** Update a bot's online status in the database */
  updateOnlineStatus(botUserId: string, isOnline: boolean): Promise<void>;

  // ─── Profile Browsing ──────────────────────────────────

  /** Get profiles available for browsing (approved, not self, not previously matched) */
  getBrowsableProfiles(botUserId: string): Promise<string[]>;

  /** Get list of profile IDs the bot has already viewed */
  getPreviouslyViewedProfiles(botUserId: string): Promise<string[]>;

  /** Record profile views in analytics */
  recordProfileViews(botUserId: string, profileIds: string[]): Promise<void>;

  // ─── Match Reactions ───────────────────────────────────

  /** Get pending matches for a bot (status=PENDING, not yet reacted) */
  getPendingMatches(botUserId: string): Promise<Array<{
    matchId: string;
    matchScore: number;
    createdAt: Date;
  }>>;

  /** Submit a match reaction to the database */
  submitMatchReaction(
    botUserId: string,
    matchId: string,
    decision: 'accept' | 'reject' | 'maybe',
    reason?: string,
  ): Promise<void>;

  /** Mark a match as expired (ghost behavior) */
  expireMatch(matchId: string): Promise<void>;

  // ─── Chat ──────────────────────────────────────────────

  /** Get chat rooms where bot needs to respond */
  getPendingChatResponses(botUserId: string): Promise<Array<ChatMessageContext & {
    chatRoomId: string;
    isReceiver: boolean;
    matchScore: number;
    minutesSinceLastMessage: number;
  }>>;

  /** Send a chat message via the existing chat API */
  sendChatMessage(
    botUserId: string,
    chatRoomId: string,
    content: string,
  ): Promise<void>;
}

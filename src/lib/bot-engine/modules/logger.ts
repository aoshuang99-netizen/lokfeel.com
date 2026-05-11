/**
 * LokFee! Bot Behavior Engine — Behavior Logger
 *
 * Centralized logging and monitoring for all bot behavior events.
 * Provides:
 * - In-memory event ring buffer for recent activity
 * - Structured logging with configurable verbosity
 * - Aggregated statistics per bot and globally
 * - Event replay capability for debugging
 * - Health monitoring and anomaly detection
 */

import type { BehaviorEvent, BehaviorEventType, EngineStats, PersonalityType } from '../types';
import { generateEventId } from '../utils';

// ═══════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════

export interface LoggerConfig {
  /** Maximum events to keep in memory (ring buffer) */
  maxBufferSize: number;
  /** Whether to log to console */
  consoleLogging: boolean;
  /** Minimum log level: 'error' | 'warn' | 'info' | 'debug' */
  logLevel: LogLevel;
  /** Whether to persist events to database (handled by scheduler) */
  persistToDb: boolean;
  /** Batch size for DB persistence */
  persistBatchSize: number;
  /** Flush interval in ms */
  persistFlushIntervalMs: number;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  maxBufferSize: 10_000,
  consoleLogging: false,
  logLevel: 'info',
  persistToDb: true,
  persistBatchSize: 100,
  persistFlushIntervalMs: 30_000,
};

// ═══════════════════════════════════════════════════════════════
// Behavior Logger
// ═══════════════════════════════════════════════════════════════

export class BehaviorLogger {
  private config: LoggerConfig;
  private eventBuffer: BehaviorEvent[] = [];
  private botStats: Map<string, BotStats> = new Map();
  private globalStats: EngineStats;
  private persistQueue: BehaviorEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_LOGGER_CONFIG, ...config };
    this.globalStats = {
      totalEventsProcessed: 0,
      eventsByType: this.createEmptyEventsByType(),
      activeSessions: 0,
      totalBotActions: 0,
      errors: 0,
      startedAt: new Date(),
    };

    if (this.config.persistToDb) {
      this.startFlushTimer();
    }
  }

  // ─── Event Recording ─────────────────────────────────────

  /**
   * Record a behavior event.
   */
  log(event: BehaviorEvent): void {
    // Add to ring buffer
    if (this.eventBuffer.length >= this.config.maxBufferSize) {
      this.eventBuffer.shift();
    }
    this.eventBuffer.push(event);

    // Update stats
    this.globalStats.totalEventsProcessed++;
    this.globalStats.eventsByType[event.type] =
      (this.globalStats.eventsByType[event.type] || 0) + 1;
    this.globalStats.totalBotActions++;

    // Update per-bot stats
    this.updateBotStats(event);

    // Queue for persistence
    if (this.config.persistToDb) {
      this.persistQueue.push(event);
    }

    // Console logging
    if (this.config.consoleLogging) {
      this.logToConsole(event);
    }
  }

  /**
   * Record an error event.
   */
  logError(botUserId: string, action: string, error: Error | string): void {
    const event: BehaviorEvent = {
      id: generateEventId(),
      botUserId,
      type: 'session_end', // Reuse as error marker
      timestamp: new Date(),
      data: { action, error: error instanceof Error ? error.message : error },
      metadata: { error: error instanceof Error ? error.stack : error },
    };

    this.log(event);
    this.globalStats.errors++;
  }

  // ─── Stats & Monitoring ──────────────────────────────────

  /**
   * Get global engine statistics.
   */
  getGlobalStats(): EngineStats {
    return { ...this.globalStats };
  }

  /**
   * Get statistics for a specific bot.
   */
  getBotStats(botUserId: string): BotStats | undefined {
    return this.botStats.get(botUserId);
  }

  /**
   * Get statistics for all bots.
   */
  getAllBotStats(): Map<string, BotStats> {
    return new Map(this.botStats);
  }

  /**
   * Get recent events (from ring buffer).
   */
  getRecentEvents(limit: number = 100): BehaviorEvent[] {
    return this.eventBuffer.slice(-limit);
  }

  /**
   * Get events for a specific bot.
   */
  getBotEvents(botUserId: string, limit: number = 50): BehaviorEvent[] {
    return this.eventBuffer
      .filter(e => e.botUserId === botUserId)
      .slice(-limit);
  }

  /**
   * Get events by type.
   */
  getEventsByType(type: BehaviorEventType, limit: number = 50): BehaviorEvent[] {
    return this.eventBuffer
      .filter(e => e.type === type)
      .slice(-limit);
  }

  /**
   * Get health summary for monitoring dashboards.
   */
  getHealthSummary(): HealthSummary {
    const uptime = Date.now() - this.globalStats.startedAt.getTime();
    const eventsPerMinute = this.globalStats.totalEventsProcessed / (uptime / 60_000);

    return {
      uptimeMinutes: Math.round(uptime / 60_000),
      totalEventsProcessed: this.globalStats.totalEventsProcessed,
      eventsPerMinute: Math.round(eventsPerMinute * 100) / 100,
      activeBots: this.botStats.size,
      errors: this.globalStats.errors,
      errorRate: this.globalStats.totalEventsProcessed > 0
        ? this.globalStats.errors / this.globalStats.totalEventsProcessed
        : 0,
      persistQueueSize: this.persistQueue.length,
      bufferSize: this.eventBuffer.length,
      bufferSizeMax: this.config.maxBufferSize,
    };
  }

  // ─── Anomaly Detection ───────────────────────────────────

  /**
   * Check for anomalies in bot behavior.
   * Flags bots that are behaving unusually (e.g., too many actions, errors).
   */
  detectAnomalies(): AnomalyReport[] {
    const anomalies: AnomalyReport[] = [];
    const now = Date.now();

    for (const [botUserId, stats] of this.botStats) {
      // Check for excessive action rate
      if (stats.lastEventAt) {
        const minutesSinceLastEvent = (now - stats.lastEventAt.getTime()) / 60_000;
        if (minutesSinceLastEvent < 1 && stats.totalEvents > 50) {
          anomalies.push({
            botUserId,
            type: 'excessive_activity',
            severity: 'warn',
            message: `Bot ${botUserId} has ${stats.totalEvents} events in < 1 minute`,
            timestamp: new Date(),
          });
        }
      }

      // Check for high error rate
      if (stats.errorCount > 0 && stats.totalEvents > 0) {
        const errorRate = stats.errorCount / stats.totalEvents;
        if (errorRate > 0.3) {
          anomalies.push({
            botUserId,
            type: 'high_error_rate',
            severity: 'error',
            message: `Bot ${botUserId} has ${(errorRate * 100).toFixed(1)}% error rate (${stats.errorCount}/${stats.totalEvents})`,
            timestamp: new Date(),
          });
        }
      }
    }

    return anomalies;
  }

  // ─── Persistence ─────────────────────────────────────────

  /**
   * Get events pending persistence and clear the queue.
   * Called by the scheduler for batch DB writes.
   */
  drainPersistQueue(): BehaviorEvent[] {
    const events = [...this.persistQueue];
    this.persistQueue = [];
    return events;
  }

  /**
   * Stop the flush timer and clean up.
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // ─── Private Methods ─────────────────────────────────────

  private updateBotStats(event: BehaviorEvent): void {
    let stats = this.botStats.get(event.botUserId);

    if (!stats) {
      stats = this.createEmptyBotStats(event.botUserId);
      this.botStats.set(event.botUserId, stats);
    }

    stats.totalEvents++;
    stats.lastEventAt = event.timestamp;
    stats.eventCountsByType[event.type] =
      (stats.eventCountsByType[event.type] || 0) + 1;

    // Track session-specific stats
    if (event.type === 'session_start') {
      stats.activeSessions++;
      this.globalStats.activeSessions++;
    }
    if (event.type === 'session_end') {
      stats.activeSessions = Math.max(0, stats.activeSessions - 1);
      this.globalStats.activeSessions = Math.max(0, this.globalStats.activeSessions - 1);
    }
    if (event.type === 'match_reaction') {
      stats.matchReactions++;
    }
    if (event.type === 'chat_message_sent') {
      stats.messagesSent++;
    }
    if (event.type === 'profile_view') {
      stats.profilesViewed++;
    }
    if (event.type === 'super_like') {
      stats.superLikes++;
    }
  }

  private logToConsole(event: BehaviorEvent): void {
    const shouldLog = this.shouldLogLevel(event.type);
    if (!shouldLog) return;

    const timestamp = event.timestamp.toISOString();
    const level = this.getLogLevelForEvent(event.type);

    switch (level) {
      case 'error':
        console.error(`[BOT-ENGINE:${level.toUpperCase()}] ${timestamp} | ${event.type} | bot=${event.botUserId}`, event.data);
        break;
      case 'warn':
        console.warn(`[BOT-ENGINE:${level.toUpperCase()}] ${timestamp} | ${event.type} | bot=${event.botUserId}`, event.data);
        break;
      default:
        console.log(`[BOT-ENGINE:INFO] ${timestamp} | ${event.type} | bot=${event.botUserId}`, event.data);
    }
  }

  private shouldLogLevel(eventType: BehaviorEventType): boolean {
    const levelOrder: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const eventLevel = this.getLogLevelForEvent(eventType);
    return levelOrder.indexOf(eventLevel) >= levelOrder.indexOf(this.config.logLevel);
  }

  private getLogLevelForEvent(eventType: BehaviorEventType): LogLevel {
    if (eventType === 'session_end' && this.eventBuffer.some(e => e.metadata?.error)) {
      return 'error';
    }
    if (eventType === 'super_like') return 'info';
    return 'debug';
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.persistQueue.length >= this.config.persistBatchSize) {
        // Signal to flush — actual DB write handled by scheduler
        this.logToConsole({
          id: generateEventId(),
          botUserId: 'system',
          type: 'session_start',
          timestamp: new Date(),
          data: { message: `Persist queue has ${this.persistQueue.length} events` },
        });
      }
    }, this.config.persistFlushIntervalMs);
  }

  private createEmptyEventsByType(): Record<BehaviorEventType, number> {
    return {
      online_status_change: 0,
      profile_view: 0,
      match_reaction: 0,
      chat_message_sent: 0,
      chat_message_received: 0,
      session_start: 0,
      session_end: 0,
      super_like: 0,
      profile_browse_batch: 0,
    };
  }

  private createEmptyBotStats(botUserId: string): BotStats {
    return {
      botUserId,
      personalityType: 'passive',
      totalEvents: 0,
      activeSessions: 0,
      matchReactions: 0,
      messagesSent: 0,
      profilesViewed: 0,
      superLikes: 0,
      errorCount: 0,
      lastEventAt: null,
      eventCountsByType: {},
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// Stats Types
// ═══════════════════════════════════════════════════════════════

export interface BotStats {
  botUserId: string;
  personalityType: PersonalityType;
  totalEvents: number;
  activeSessions: number;
  matchReactions: number;
  messagesSent: number;
  profilesViewed: number;
  superLikes: number;
  errorCount: number;
  lastEventAt: Date | null;
  eventCountsByType: Partial<Record<BehaviorEventType, number>>;
}

export interface HealthSummary {
  uptimeMinutes: number;
  totalEventsProcessed: number;
  eventsPerMinute: number;
  activeBots: number;
  errors: number;
  errorRate: number;
  persistQueueSize: number;
  bufferSize: number;
  bufferSizeMax: number;
}

export interface AnomalyReport {
  botUserId: string;
  type: 'excessive_activity' | 'high_error_rate' | 'unexpected_behavior';
  severity: 'warn' | 'error';
  message: string;
  timestamp: Date;
}

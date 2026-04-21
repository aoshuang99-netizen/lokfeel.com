/**
 * Pace Controller — Token Bucket Rate Limiting via Redis
 * Based on Power Board Rule Engine Spec §2.1
 * 
 * Features:
 * - Per-sender-per-receiver rate limiting
 * - Token bucket algorithm with refill
 * - Hourly and daily quota tracking
 * - Progressive cooldown (escalating penalties)
 */

import { redis, RedisKeys } from '../redis';
import type { PaceControl, PaceLimitNotification } from '../types';

export interface PaceCheckResult {
  allowed: boolean;
  remaining: number;
  hourlyCount: number;
  dailyCount: number;
  cooldownUntil?: number;
  resetAfterMs?: number;
  paceLimit?: PaceLimitNotification;
}

export class PaceController {
  /**
   * Check if sender is allowed to send a message to receiver
   * Uses Token Bucket algorithm via Redis HSET
   */
  async checkRateLimit(
    senderId: string,
    receiverId: string,
    rules: PaceControl
  ): Promise<PaceCheckResult> {
    const key = RedisKeys.pace(senderId, receiverId);
    const now = Date.now();

    try {
      // Get current bucket state
      const result = await redis.hmget(key, 'tokens', 'lastRefill', 'hourlyCount', 'dailyCount', 'hourStart', 'dayStart');
      const [tokensStr, lastRefillStr, hourlyCountStr, dailyCountStr, hourStartStr, dayStartStr] = Array.isArray(result) ? result : [];

      const tokens = parseFloat(tokensStr as string || String(rules.maxMessagesPerHour));
      const lastRefill = parseInt(lastRefillStr as string || String(now));
      const hourlyCount = parseInt(hourlyCountStr as string || '0');
      const dailyCount = parseInt(dailyCountStr as string || '0');
      const hourStart = parseInt(hourStartStr as string || String(now));
      const dayStart = parseInt(dayStartStr as string || String(now));

      // Calculate token refill
      const timePassed = (now - lastRefill) / 1000; // seconds
      const refillRate = rules.maxMessagesPerHour / 3600; // tokens per second
      const newTokens = Math.min(
        rules.maxMessagesPerHour,
        tokens + timePassed * refillRate
      );

      // Reset period counters
      let updatedHourlyCount = hourlyCount;
      let updatedDailyCount = dailyCount;
      let updatedHourStart = hourStart;
      let updatedDayStart = dayStart;

      if (now - hourStart > 3600000) {
        updatedHourlyCount = 0;
        updatedHourStart = now;
      }
      if (now - dayStart > 86400000) {
        updatedDailyCount = 0;
        updatedDayStart = now;
      }

      // Check if allowed
      const canSend = newTokens >= 1 &&
        updatedHourlyCount < rules.maxMessagesPerHour &&
        updatedDailyCount < rules.maxMessagesPerDay;

      if (canSend) {
        // Consume token
        await redis.hmset(key, {
          tokens: String(newTokens - 1),
          lastRefill: String(now),
          hourlyCount: String(updatedHourlyCount + 1),
          dailyCount: String(updatedDailyCount + 1),
          hourStart: String(updatedHourStart),
          dayStart: String(updatedDayStart),
        });
        await redis.expire(key, RedisKeys.paceTtl);

        return {
          allowed: true,
          remaining: Math.floor(newTokens - 1),
          hourlyCount: updatedHourlyCount + 1,
          dailyCount: updatedDailyCount + 1,
        };
      }

      // Rate limited — calculate cooldown
      const cooldownMs = rules.enforceCooldown
        ? rules.cooldownMinutes * 60000
        : this.calculateDynamicCooldown(updatedHourlyCount, rules);

      const resetAfterMs = this.calculateResetTime(updatedHourStart, updatedDayStart, now);

      const paceLimit: PaceLimitNotification = {
        convId: '', // will be filled by caller
        cooldownUntil: now + cooldownMs,
        reason: 'pace.limit_exceeded',
        messagesRemaining: 0,
        maxMessages: rules.maxMessagesPerHour,
        resetAfterMinutes: Math.ceil(resetAfterMs / 60000),
      };

      return {
        allowed: false,
        remaining: 0,
        hourlyCount: updatedHourlyCount,
        dailyCount: updatedDailyCount,
        cooldownUntil: now + cooldownMs,
        resetAfterMs,
        paceLimit,
      };
    } catch (error) {
      console.error('[PaceController] Redis error, allowing message (fail-open):', error);
      // Fail-open: if Redis is down, allow the message
      return {
        allowed: true,
        remaining: -1,
        hourlyCount: 0,
        dailyCount: 0,
      };
    }
  }

  /**
   * Progressive cooldown: escalating penalties for repeated violations
   */
  private calculateDynamicCooldown(hourlyCount: number, rules: PaceControl): number {
    const baseCooldown = 5 * 60 * 1000; // 5 minutes base
    const multiplier = Math.min(4, Math.floor(hourlyCount / 5));
    return baseCooldown * (1 + multiplier);
  }

  /**
   * Calculate when the current rate limit window resets
   */
  private calculateResetTime(hourStart: number, dayStart: number, now: number): number {
    const hourReset = hourStart + 3600000 - now;
    const dayReset = dayStart + 86400000 - now;
    return Math.min(hourReset, dayReset);
  }

  /**
   * Reset pace counters for a sender-receiver pair
   * Used when rules change
   */
  async resetPaceCounters(senderId: string, receiverId: string): Promise<void> {
    const key = RedisKeys.pace(senderId, receiverId);
    await redis.del(key);
  }
}

// Singleton
export const paceController = new PaceController();

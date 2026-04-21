/**
 * Sequence Number Generator — Monotonic sequence per conversation
 * Uses Redis INCR for atomic, monotonic sequence assignment
 */

import { redis, RedisKeys } from '../redis';

export class SeqGenerator {
  /**
   * Get next sequence number for a conversation
   * Atomic increment via Redis INCR
   */
  async nextSeq(convId: string): Promise<number> {
    const key = RedisKeys.seqCounter(convId);
    const seq = await redis.incr(key);
    // Set TTL on first use
    if (seq === 1) {
      await redis.expire(key, 86400 * 30); // 30 days TTL
    }
    return seq;
  }

  /**
   * Get current sequence number without incrementing
   */
  async currentSeq(convId: string): Promise<number> {
    const key = RedisKeys.seqCounter(convId);
    const val = await redis.get(key);
    return parseInt(val as string || '0');
  }

  /**
   * Initialize sequence counter from DB (for migration)
   * Called when Redis doesn't have the counter yet
   */
  async initializeFromDb(convId: string, lastSeq: number): Promise<void> {
    const key = RedisKeys.seqCounter(convId);
    const current = await redis.get(key);
    if (!current) {
      // Only set if not already present
      await redis.set(key, String(lastSeq), { ex: 86400 * 30 });
    }
  }
}

// Singleton
export const seqGenerator = new SeqGenerator();
